import type { PoolClient } from 'pg';
import { and, eq, sql } from 'drizzle-orm';
import { DomainError } from '../../contracts/src/project';
import { terminalTaskStatuses } from '../../contracts/src/tasks';
import { db, orm, transaction } from '../../persistence/src/client';
import { designTasks, operations } from '../../persistence/src/schema';
import type { ConversationRunOptions } from '../../conversation/src/run';
import { executeCommandInTransaction } from '../../commands/src/service';
import { appendEvent, taskRow, type TaskRow, type StoredStep } from './service';
import { hasRetainedWork, settleAttempt } from './budget';

const LEASE_SECONDS = 15, MAX_ATTEMPTS = 3;
export type TaskClaim = { taskId: string; generation: number };
const lease = sql`clock_timestamp()+(${LEASE_SECONDS}*interval '1 second')`;
const lostFence = () => new DomainError('TASK_FENCE_LOST', '任务执行权已过期或任务已取消。', 409);
async function lockedTask(client: PoolClient, id: string) {
  const tx = orm(client), [locked] = await tx.select().from(designTasks).where(eq(designTasks.id, id)).for('update');
  if (!locked) throw new DomainError('NOT_FOUND', '任务不存在。', 404);
  // Evaluate time after acquiring the lock, not in the projection that may precede a lock wait.
  const [{ valid }] = await tx.select({ valid: sql<boolean | null>`${designTasks.leaseUntil}>clock_timestamp()` }).from(designTasks).where(eq(designTasks.id, id));
  return { ...taskRow(locked), lease_valid: !!valid };
}
export async function fenced(client: PoolClient, claim: TaskClaim) {
  const row = await lockedTask(client, claim.taskId);
  if (row.status !== 'running' || row.generation !== claim.generation || !row.lease_valid) throw lostFence();
  return row;
}
async function finish(client: PoolClient, row: TaskRow, status: 'completed' | 'partial' | 'failed', error: TaskRow['error'] = null) {
  const unknownCall = !!row.conversation?.callStarted && !row.conversation.response;
  const tx = orm(client);
  if (row.conversation) { settleAttempt(row); await tx.update(designTasks).set({ conversation: row.conversation }).where(eq(designTasks.id, row.id)); }
  // Exhausted claim recovery can occur before the conversation runner gets a chance to fail.
  // Preserve the already-started call even on that path; null tokens remain unresolved.
  const terminalError = unknownCall && error ? { ...error, message: `${error.message} 模型调用结果未知，用量待核对。` } : error;
  await tx.update(designTasks).set({ status, leaseUntil: null, usageUsed: sql`${designTasks.usageUsed}+${unknownCall ? row.usage_reserved : 0}`,
    usageReserved: 0, error: terminalError }).where(eq(designTasks.id, row.id));
  await appendEvent(client, row.id, 'status', { status, completedSteps: row.next_step, unknownModelUsage: unknownCall, ...(terminalError ? { error: terminalError } : {}) });
}
export async function claimTask(taskId: string, expectedIntentVersion?: number): Promise<TaskClaim | null> {
  return transaction(async (client, tx) => {
    const row = await lockedTask(client, taskId);
    if (terminalTaskStatuses.has(row.status) || row.status === 'waiting_input' || row.status === 'waiting_selection') return null;
    if (expectedIntentVersion !== undefined && expectedIntentVersion !== (row.conversation?.brief?.intentVersion ?? 1)) return null;
    if (row.status === 'running' && row.lease_valid) throw new DomainError('TASK_LEASE_BUSY', '任务正在由另一执行者处理。', 409);
    if (row.attempts >= MAX_ATTEMPTS) {
      await finish(client, row, hasRetainedWork(row) ? 'partial' : 'failed', { code: 'RETRY_LIMIT', message: '恢复次数达到上限，已保存进度。' });
      return null;
    }
    await tx.update(designTasks).set({ status: 'running', generation: sql`${designTasks.generation}+1`, attempts: sql`${designTasks.attempts}+1`,
      leaseUntil: lease, error: null }).where(eq(designTasks.id, taskId));
    const generation = row.generation + 1;
    await appendEvent(client, taskId, 'status', { status: 'running', generation, resumedFromStep: row.next_step });
    return { taskId, generation };
  });
}
/** Durable reservation survives a crash; a retry reuses it rather than resetting the task budget. */
export async function reserveStep(claim: TaskClaim): Promise<{ index: number; step: StoredStep } | null> {
  return transaction(async (client, tx) => {
    const row = await fenced(client, claim);
    if (row.next_step >= row.steps.length) { await finish(client, row, 'completed'); return null; }
    if (!row.usage_reserved && row.usage_used >= row.usage_limit) {
      await finish(client, row, 'partial', { code: 'USAGE_LIMIT', message: '已达到本次协议测试上限，保留已完成步骤。' }); return null;
    }
    if (!row.usage_reserved) {
      await tx.update(designTasks).set({ usageReserved: 1, leaseUntil: lease }).where(eq(designTasks.id, row.id));
      await appendEvent(client, row.id, 'usage', { used: row.usage_used, reserved: 1, limit: row.usage_limit, unit: 'protocol-step' });
    }
    return { index: row.next_step, step: row.steps[row.next_step] };
  });
}
/** Domain effects, usage settlement, checkpoint and visible result share the fenced transaction. */
export async function executeStep(claim: TaskClaim, index: number) {
  return transaction(async (client, tx) => {
    const row = await fenced(client, claim);
    if (row.next_step > index) return; // A lost reply to an already committed checkpoint is harmless.
    if (row.next_step !== index || row.usage_reserved !== 1) throw new DomainError('TASK_CHECKPOINT_CONFLICT', '任务检查点已变化。', 409);
    const step = row.steps[index];
    let revision = row.expected_revision;
    if (step.type === 'command') {
      await executeCommandInTransaction(client, { userId: row.actor_id }, row.project_id,
        { operationId: step.operationId, expectedRevision: revision, command: step.command });
      const [operation] = await tx.select({ result: operations.result }).from(operations)
        .where(and(eq(operations.actorId, row.actor_id), eq(operations.id, step.operationId)));
      revision = (operation.result as { revision: number }).revision;
      // A project lock could have waited past the lease: roll the entire domain write back.
      await fenced(client, claim);
      await appendEvent(client, row.id, 'operation', { operationId: step.operationId, revision, commandType: step.command.type, step: index });
    } else {
      // These are persisted protocol fragments, never a model answer or a business checkpoint by themselves.
      await appendEvent(client, row.id, 'text', { text: step.text, step: index, protocol: row.protocol });
    }
    await tx.update(designTasks).set({ nextStep: sql`${designTasks.nextStep}+1`, expectedRevision: revision, usageUsed: sql`${designTasks.usageUsed}+1`,
      usageReserved: 0, leaseUntil: lease }).where(eq(designTasks.id, row.id));
    await appendEvent(client, row.id, 'usage', { used: row.usage_used + 1, reserved: 0, limit: row.usage_limit, unit: 'protocol-step' });
  });
}
async function recordFailure(claim: TaskClaim, error: unknown) {
  return transaction(async (client, tx) => {
    const row = await lockedTask(client, claim.taskId);
    if (row.status !== 'running' || row.generation !== claim.generation) return false;
    if (!row.lease_valid) return true; // Do not acknowledge an expired attempt and strand its checkpoint.
    if (error instanceof DomainError) {
      await finish(client, row, row.next_step ? 'partial' : 'failed', { code: error.code, message: error.message });
      return false;
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await finish(client, row, row.next_step ? 'partial' : 'failed', { code: 'RETRY_LIMIT', message: '测试执行未能恢复，已保存进度。' }); return false;
    }
    await tx.update(designTasks).set({ status: 'retry_wait', leaseUntil: null, error: { code: 'EXECUTION_INTERRUPTED', message: '测试执行中断，等待队列重试。' } })
      .where(eq(designTasks.id, row.id));
    await appendEvent(client, row.id, 'status', { status: 'retry_wait', message: '测试执行中断，等待队列重试。' });
    return true;
  });
}
/** One bounded task invocation. No daemon, queue polling, HTTP server or model is started here. */
export async function runTask(taskId: string, options: { betweenSteps?: () => Promise<void>; conversation?: ConversationRunOptions; intentVersion?: number } = {}) {
  const [task] = await db.select({ protocol: designTasks.protocol }).from(designTasks).where(eq(designTasks.id, taskId));
  if (task?.protocol === 'conversation-v1') {
    const { runConversationTask } = await import('../../conversation/src/run');
    return runConversationTask(taskId, { ...options.conversation, intentVersion: options.intentVersion });
  }
  const claim = await claimTask(taskId);
  if (!claim) return;
  try {
    for (let count = 0; count <= 12; count++) {
      const next = await reserveStep(claim);
      if (!next) return;
      await options.betweenSteps?.();
      await executeStep(claim, next.index);
    }
    throw new Error('Task exceeded its bounded protocol');
  } catch (error) {
    if (await recordFailure(claim, error)) throw error;
  }
}
