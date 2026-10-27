import type { LanguageModel } from 'ai';
import { DomainError, spatialStateSchema } from '../../contracts/src/project';
import type { ConversationOutcome } from '../../contracts/src/tasks';
import { executeCommandInTransaction } from '../../commands/src/service';
import { pool, transaction } from '../../persistence/src/client';
import { projectAccess } from '../../workspaces/src/access';
import { appendEvent, type TaskRow } from '../../tasks/src/service';
import { claimTask, fenced, type TaskClaim } from '../../tasks/src/runner';
import { resolveConversation, MODEL_TIMEOUT_MS, INSTRUCTIONS_VERSION, type ModelResponse } from './model';
import { exactLocalCommand } from './intent';
import { applyBriefProposal } from './brief';
import { randomUUID } from 'node:crypto';
import { execution, hasRetainedWork, reserveAttempt, settleAttempt } from '../../tasks/src/budget';
import { admittedConfigurations, productionConfigurations, type ModelConfiguration } from './configurations';
import { planRoomCandidateInTransaction } from '../../layout-planner/src/service';
import { prepareLayoutProposal } from './layout-decision';
import { selectModelProfile } from './profile';

export type ConversationRunOptions = {
  /** Test injection into the real SDK boundary, not a production alternative. */
  model?: LanguageModel;
  /** Controlled protocol-test registry; never accepted from HTTP or model output. */
  configurations?: ModelConfiguration[];
  afterResponsePersisted?: () => Promise<void>;
  beforeCommit?: () => Promise<void>;
  intentVersion?: number;
};
async function saveConversation(client: import('pg').PoolClient, row: TaskRow) {
  await client.query('UPDATE design_tasks SET conversation=$2 WHERE id=$1', [row.id, row.conversation]);
}
async function fail(claim: TaskClaim, code: string, message: string) {
  await transaction(async client => {
    const row = await fenced(client, claim);
    row.conversation!.phase = 'finished';
    settleAttempt(row); execution(row).stopReason = code;
    await saveConversation(client, row);
    const unknownCall = row.conversation!.callStarted && !row.conversation!.response;
    const status = hasRetainedWork(row) ? 'partial' : 'failed';
    await client.query("UPDATE design_tasks SET status=$3,lease_until=NULL,usage_used=usage_used+$4,usage_reserved=0,error=$2 WHERE id=$1",
      [row.id, { code, message }, status, unknownCall ? row.usage_reserved : 0]);
    await appendEvent(client, row.id, 'status', { status, phase: 'finished', message, intentVersion: row.conversation!.brief?.intentVersion ?? 1 });
  });
}
async function preserveRetryOnLostFence(claim: TaskClaim, error: unknown) {
  const row = (await pool.query<TaskRow>('SELECT * FROM design_tasks WHERE id=$1', [claim.taskId])).rows[0];
  // A cancelled task or newer owner needs no acknowledgement from this attempt. An expired
  // current owner must fail the queue callback, otherwise ACK would strand the saved response.
  if (row?.status === 'running' && row.generation === claim.generation) throw error;
}
async function heartbeat(claim: TaskClaim) {
  await transaction(async client => {
    await fenced(client, claim);
    await client.query("UPDATE design_tasks SET lease_until=clock_timestamp()+interval '15 seconds' WHERE id=$1", [claim.taskId]);
  });
}
async function commitResponse(claim: TaskClaim, response: ModelResponse) {
  await transaction(async client => {
    const row = await fenced(client, claim), conversation = row.conversation!;
    const decision = response.decision;
    if (response.failure || !decision) throw new DomainError(response.failure ?? 'MODEL_EMPTY_RESPONSE', '模型没有返回完整、有效的本轮结果；空间未修改。');
    if (typeof response.reply !== 'string' || !response.reply.trim())
      throw new DomainError('MODEL_REPLY_REQUIRED', '旧版或不完整响应缺少本轮答复，空间未修改；请重新发起本轮。');
    // Even read-only answers are explicitly tied to the accepted project revision.
    const project = (await client.query(`SELECT revision FROM projects p WHERE p.id=$1 AND ${projectAccess('p.id', '$2')} FOR UPDATE`, [row.project_id, row.actor_id])).rows[0];
    if (!project || project.revision !== row.expected_revision) throw new DomainError('REVISION_CONFLICT', '项目已有新修订，本轮旧结果未应用；请重新发起。', 409);
    // UI discards abandoned-generation drafts. Replaying a durable, complete response in the
    // current generation preserves the answer after recovery without invoking the model again.
    const hasCurrentReply = (await client.query("SELECT 1 FROM task_events WHERE task_id=$1 AND type='text' AND data->>'source'='model' AND data->>'generation'=$2 LIMIT 1",
      [row.id, String(claim.generation)])).rowCount;
    if (!hasCurrentReply) await appendEvent(client, row.id, 'text', { text: response.reply, source: 'model', provisional: true,
      completeReply: true, replayedFromCheckpoint: true, generation: claim.generation, intentVersion: conversation.brief?.intentVersion ?? 1 });
    if (decision.kind !== 'propose_layout' && response.brief && conversation.brief) {
      applyBriefProposal(conversation.brief, response.brief);
      await saveConversation(client, row);
    }
    let outcome: ConversationOutcome;
    if (decision.kind === 'answer' || decision.kind === 'clarification') {
      // Generated prose is never promoted to an authoritative claim that a mutation occurred.
      outcome = { kind: decision.kind, message: decision.kind === 'answer' ? '本轮已回复，空间未修改。' : '本轮需要补充信息，空间未修改。' };
    }
    else if (decision.kind === 'propose_layout') {
      if (!conversation.brief) throw new DomainError('BRIEF_REQUIRED', '请先提供可追溯的居住需求。');
      const prepared = prepareLayoutProposal(conversation.brief, decision, response.brief);
      conversation.brief = prepared.brief;
      const effectiveDecision = prepared.decision;
      conversation.effectiveDecision = effectiveDecision; await saveConversation(client, row);
      const result = await planRoomCandidateInTransaction(client, { ownerId: row.actor_id, projectId: row.project_id,
        baseRevision: row.expected_revision, operationId: conversation.operationId, taskId: row.id,
        intentVersion: conversation.brief.intentVersion, decision: effectiveDecision, brief: conversation.brief, input: conversation.input });
      // Planner adds only independently verified application-owned input IDs to its provenance.
      conversation.effectiveDecision = { ...effectiveDecision, sourceInputIds: result.report.source.inputIds };
      await fenced(client, claim);
      if (result.status === 'recommended') {
        conversation.brief.scope = 'single_room_candidate';
        outcome = { kind: 'candidate', message: '单房间推荐已生成并检查，当前方案尚未改变；请查看后选择是否采用。',
          candidateId: result.candidateId, candidateRevision: result.candidateRevision, checkId: result.checkId, planReport: result.report };
      } else outcome = { kind: result.status === 'needs_input' ? 'clarification' : 'no_change', message: result.report.reason, planReport: result.report };
    }
    else {
      const state = spatialStateSchema.parse(conversation.context), intent = conversation.brief?.inputs.at(-1)?.kind === 'confirmation'
        ? { clarification: '本轮只确认居住需求，不授权空间修改。' } : exactLocalCommand(conversation.input, state, decision);
      if ('clarification' in intent) outcome = { kind: 'clarification', message: intent.clarification };
      else {
        await executeCommandInTransaction(client, { userId: row.actor_id }, row.project_id,
          { operationId: conversation.operationId, expectedRevision: row.expected_revision, command: intent.command });
        const result = (await client.query('SELECT result FROM operations WHERE actor_id=$1 AND id=$2', [row.actor_id, conversation.operationId])).rows[0].result;
        await fenced(client, claim); // Project lock waits cannot allow a stale generation to commit.
        const object = state.currentLayout.objects.find(item => item.id === intent.objectId)!;
        const after = intent.command as Extract<typeof intent.command, { type: 'move-furniture' }>;
        outcome = { kind: 'applied', message: decision.kind === 'move' ? '已按原请求的方向和距离移动所选家具，可在空间中查看并撤销。' : '已按原请求旋转所选家具，可在空间中查看并撤销。',
          operationId: conversation.operationId, projectRevision: result.revision, objectId: intent.objectId };
        await appendEvent(client, row.id, 'operation', { operationId: conversation.operationId, revision: result.revision, objectId: intent.objectId,
          before: { x: object.position.x, z: object.position.z, yaw: object.yaw }, after: { x: after.x, z: after.z, yaw: after.yaw }, authoritative: true });
        row.expected_revision = result.revision;
      }
    }
    const brief = conversation.brief;
    if (brief && outcome.kind === 'clarification' && !brief.questions.some(question => question.status === 'open')) {
      const prompt = decision.kind === 'clarification' ? response.reply : outcome.message;
      const key = 'clarification-' + prompt.replace(/[\s\p{P}]/gu, '').slice(0, 60);
      if (!brief.questions.some(question => question.key === key || question.prompt === prompt))
        brief.questions.push({ id: randomUUID(), key, prompt: prompt.slice(0, 600), status: 'open', createdAtIntentVersion: brief.intentVersion, answerInputId: null });
    }
    if (brief) {
      if (!response.brief) brief.workCompleted = ['已保存本轮答复'];
      if (outcome.kind === 'applied') brief.workCompleted.push('已提交精确局部修改');
      if (outcome.kind === 'candidate') brief.workCompleted.push('已生成并检查单房间候选');
      if (response.brief && outcome.kind === 'answer') outcome.message = '本轮需求整理已保存，空间未修改；尚未生成或采用设计方案。';
    }
    const status = outcome.kind === 'candidate' ? 'waiting_selection' : outcome.planReport?.status === 'not_found' ? 'partial'
      : brief?.questions.some(question => question.status === 'open') ? 'waiting_input' : 'completed';
    conversation.phase = 'finished'; conversation.outcome = outcome;
    await saveConversation(client, row);
    await fenced(client, claim);
    await client.query('UPDATE design_tasks SET status=$3,next_step=1,expected_revision=$2,lease_until=NULL,usage_reserved=0,error=$4 WHERE id=$1',
      [row.id, row.expected_revision, status, status === 'partial' ? { code: 'LAYOUT_NOT_FOUND', message: outcome.message } : null]);
    await appendEvent(client, row.id, 'status', { status, phase: 'finished', outcome, intentVersion: brief?.intentVersion ?? 1 });
  });
}
/** One bounded invocation using the existing task lease/state machine. No daemon or queue polling. */
export async function runConversationTask(taskId: string, options: ConversationRunOptions = {}) {
  const claim = await claimTask(taskId, options.intentVersion);
  if (!claim) return;
  const abort = new AbortController();
  let heartbeatWork: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (heartbeatWork) return;
    heartbeatWork = heartbeat(claim).catch(() => abort.abort()).finally(() => { heartbeatWork = null; });
  }, 4000);
  try {
    // At most initial + one known-rejection retry + one admitted fallback per intent.
    for (let cycle = 0; cycle < 4; cycle++) {
    let row = (await pool.query<TaskRow>('SELECT * FROM design_tasks WHERE id=$1', [taskId])).rows[0];
    let response = row.conversation!.response as ModelResponse | null;
    // Saved complete results are reusable even if the current provider configuration is gone.
    if (response && !response.failure) {
      if (options.beforeCommit) await options.beforeCommit();
      await commitResponse(claim, response); return;
    }
    const budget = execution(row), intentVersion = row.conversation!.brief?.intentVersion ?? 1;
    const attempts = budget.attempts.filter(attempt => attempt.intentVersion === intentVersion);
    if (response?.failure) {
      const previous = attempts.at(-1);
      if (previous?.outcome !== 'rejected') {
        await commitResponse(claim, response); return;
      }
      if (attempts.length >= 3) throw new DomainError('MODEL_RETRY_LIMIT', '平台模型仍不可用，已停止有限重试；已有成果保留。');
    }
    if (!response && row.conversation!.callStarted) {
      await fail(claim, 'MODEL_OUTCOME_UNKNOWN', '先前模型调用的完整结果未保存，用量待核对；为避免重复调用，本轮已停止。'); return;
    }
    const profile = selectModelProfile(row.conversation!.input, spatialStateSchema.parse(row.conversation!.context));
    const registry = admittedConfigurations(options.configurations ?? (options.model ? [{ id: 'test-primary', modelId: 'injected-test-model',
      profiles: ['edit_fast', 'design_quality'], admission: { accepted: true, evidence: 'controlled SDK protocol fixture', kind: 'protocol-fixture' },
      createModel: () => options.model! }] : productionConfigurations()), profile);
    const configuration = registry[attempts.length >= 2 ? 1 : 0];
    if (!configuration) throw new DomainError(attempts.length ? 'MODEL_NO_ADMITTED_FALLBACK' : 'MODEL_NOT_ADMITTED',
      attempts.length ? '平台模型暂不可用，且没有通过验收的备用配置；已有成果保留。' : '没有匹配此任务的已验收平台配置，已有成果保留。');
    if (response) {
      // Durable retry preparation: a restart sees the same rejected attempt and next config.
      await transaction(async client => {
        const current = await fenced(client, claim);
        current.conversation!.callStarted = false; current.conversation!.response = null; current.conversation!.phase = 'accepted';
        await saveConversation(client, current);
        await client.query("UPDATE design_tasks SET generation=generation+1,lease_until=clock_timestamp()+interval '15 seconds' WHERE id=$1", [taskId]);
        claim.generation++;
        await appendEvent(client, taskId, 'status', { status: 'running', phase: 'accepted', generation: claim.generation,
          intentVersion, reason: attempts.length === 1 ? 'retry' : 'fallback', message: attempts.length === 1 ? '平台请求被拒绝，进行一次有限重试。' : '切换到已验收的备用配置。' });
      });
      response = null;
    }
    if (!response) {
      let model: LanguageModel; let networkDispatches = 0;
      try { model = configuration.createModel(() => { networkDispatches++; }); } catch {
        await fail(claim, 'MODEL_NOT_CONFIGURED', '平台模型配置不可用；空间未修改。'); return;
      }
      row = await transaction(async client => {
        const current = await fenced(client, claim);
        const project = (await client.query(`SELECT revision FROM projects p WHERE p.id=$1 AND ${projectAccess('p.id', '$2')}`, [current.project_id, current.actor_id])).rows[0];
        if (!project || project.revision !== current.expected_revision) throw new DomainError('REVISION_CONFLICT', '项目已更新，本轮未调用模型。', 409);
        reserveAttempt(current, { configurationId: configuration.id, profile,
          reason: attempts.length === 0 ? 'initial' : attempts.length === 1 ? 'retry' : 'fallback',
          contextBytes: Buffer.byteLength(JSON.stringify({ input: current.conversation!.input, context: current.conversation!.context, brief: current.conversation!.brief }), 'utf8') });
        current.conversation!.callStarted = true; current.conversation!.phase = 'calling_model';
        current.conversation!.configuration = { model: configuration.modelId, configurationId: configuration.id, profile,
          instructionsVersion: INSTRUCTIONS_VERSION, toolContractVersion: 'resolve-turn-4-layout', policyVersion: 'bounded-execution-1',
          timeoutMs: MODEL_TIMEOUT_MS, maxOutputTokens: 1600, maxRetries: 0 };
        await saveConversation(client, current);
        await client.query('UPDATE design_tasks SET usage_reserved=1 WHERE id=$1', [taskId]);
        await appendEvent(client, taskId, 'status', { status: 'running', phase: 'calling_model', generation: claim.generation, intentVersion: current.conversation!.brief?.intentVersion ?? 1 });
        return current;
      });
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]);
      response = await resolveConversation({ model, input: row.conversation!.input, brief: row.conversation!.brief, state: spatialStateSchema.parse(row.conversation!.context), signal,
        onText: text => transaction(async client => { const current = await fenced(client, claim); await appendEvent(client, taskId, 'text', { text, source: 'model', provisional: true, generation: claim.generation, intentVersion: current.conversation!.brief?.intentVersion ?? 1 }); }) });
      response.networkDispatches = networkDispatches;
      await transaction(async client => {
        const current = await fenced(client, claim);
        current.conversation!.response = response; current.conversation!.modelUsage = response!.usage; current.conversation!.phase = 'validating';
        settleAttempt(current, response!);
        await saveConversation(client, current);
        // The complete reply and response checkpoint share a transaction. Replay never appends it twice.
        if (!response!.failure && response!.reply && response!.reply !== response!.streamedReply)
          await appendEvent(client, taskId, 'text', { text: response!.reply, source: 'model', provisional: true, completeReply: true, generation: claim.generation, intentVersion: current.conversation!.brief?.intentVersion ?? 1 });
        // Response existence proves this call was settled: both writes share this transaction.
        await client.query('UPDATE design_tasks SET usage_used=usage_used+1,usage_reserved=0 WHERE id=$1', [taskId]);
        await appendEvent(client, taskId, 'usage', { ...response!.usage, unit: 'token', elapsedMs: response!.elapsedMs });
        await appendEvent(client, taskId, 'status', { status: 'running', phase: 'validating' });
      });
      // Test hook simulates a process disappearing only after the durable response commit.
      if (options.afterResponsePersisted) { await options.afterResponsePersisted(); }
    }
    if (response.failure) continue;
    if (options.beforeCommit) await options.beforeCommit();
    await commitResponse(claim, response); return;
    }
    throw new DomainError('MODEL_RETRY_LIMIT', '本轮执行达到有限重试上限，已有成果保留。');
  } catch (error) {
    if (options.afterResponsePersisted && !(error instanceof DomainError)) throw error;
    const domain = error instanceof DomainError ? error : null;
    if (domain?.code === 'TASK_FENCE_LOST') await preserveRetryOnLostFence(claim, error);
    else {
      try { await fail(claim, domain?.code ?? 'CONVERSATION_FAILED', domain?.message ?? '本轮处理未完成；空间修改以已记录的操作结果为准。'); }
      catch (failure) { if (failure instanceof DomainError && failure.code === 'TASK_FENCE_LOST') await preserveRetryOnLostFence(claim, failure); else throw failure; }
    }
  } finally {
    clearInterval(timer); abort.abort(); if (heartbeatWork) await heartbeatWork;
  }
}
