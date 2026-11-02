import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { PgBoss } from 'pg-boss';
import { and, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { createTaskSchema, conversationInputSchema, terminalTaskStatuses, type TaskView, type TaskStatus, type TaskStep, type TaskEvent, type TaskError } from '../../contracts/src/tasks';
import { DomainError, idSchema, spatialStateSchema } from '../../contracts/src/project';
import type { ConversationState } from '../../contracts/src/tasks';
import type { Principal } from '../../projects/src/service';
import { canAccessProject } from '../../workspaces/src/access';
import { advisoryXactLock, db, orm, transaction } from '../../persistence/src/client';
import { designTasks, operations, projects, taskEvents } from '../../persistence/src/schema';
import { enqueueTask } from './queue';
import { initialBrief, archiveTurn } from '../../conversation/src/brief';
import { initialExecution, retained, settleAttempt } from './budget';

export type StoredStep = TaskStep & { operationId: string };
export type TaskRow = {
  id: string; actor_id: string; project_id: string; request_id: string; request_hash: string; protocol: 'deterministic-v1' | 'conversation-v1';
  status: TaskStatus; steps: StoredStep[]; next_step: number; expected_revision: number; generation: number;
  lease_until: Date | null; lease_valid?: boolean; attempts: number; usage_limit: number; usage_used: number; usage_reserved: number;
  event_seq: number; error: TaskError | null; created_at: Date; updated_at: Date;
  conversation: (ConversationState & { operationId: string; context: unknown; callStarted: boolean; response: unknown;
    configuration?: Record<string, unknown>; effectiveDecision?: unknown }) | null;
};
/** Callers (budget, conversation runner) read tasks in the column (snake_case) shape. */
export const taskRow = (r: typeof designTasks.$inferSelect): TaskRow => ({ id: r.id, actor_id: r.actorId, project_id: r.projectId,
  request_id: r.requestId, request_hash: r.requestHash, protocol: r.protocol as TaskRow['protocol'], status: r.status as TaskStatus,
  steps: r.steps as StoredStep[], next_step: r.nextStep, expected_revision: r.expectedRevision, generation: r.generation, lease_until: r.leaseUntil,
  attempts: r.attempts, usage_limit: r.usageLimit, usage_used: r.usageUsed, usage_reserved: r.usageReserved, event_seq: r.eventSeq,
  error: r.error as TaskError | null, created_at: r.createdAt, updated_at: r.updatedAt, conversation: r.conversation as TaskRow['conversation'] });
const activeStatuses = ['queued', 'running', 'retry_wait', 'waiting_input', 'waiting_selection'];
const one = { one: sql`1` };
export const taskView = (row: TaskRow): TaskView => ({ id: row.id, projectId: row.project_id, protocol: row.protocol,
  label: row.protocol === 'conversation-v1' ? '空间对话' : '确定性协议测试 · 非真实模型设计', status: row.status,
  checkpoint: { nextStep: row.next_step, totalSteps: row.protocol === 'conversation-v1' ? 1 : row.steps.length, expectedRevision: row.expected_revision },
  generation: row.generation, usage: { limit: row.usage_limit, used: row.usage_used, reserved: row.usage_reserved, unit: row.protocol === 'conversation-v1' ? 'model-call' : 'protocol-step' },
  ...(row.conversation ? { conversation: { input: row.conversation.input, phase: row.conversation.phase,
    outcome: row.conversation.outcome, modelUsage: row.conversation.modelUsage, ...(row.conversation.brief ? { brief: row.conversation.brief } : {}),
    ...(row.conversation.execution ? { execution: row.conversation.execution } : {}), retained: retained(row.conversation) } } : {}),
  eventsCursor: row.event_seq, error: row.error, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
const notFound = () => new DomainError('NOT_FOUND', '项目或任务不存在。', 404);
function owner(principal: Principal) {
  if (!principal.userId) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  return principal.userId;
}
export async function appendEvent(client: PoolClient, taskId: string, type: TaskEvent['type'], data: Record<string, unknown>) {
  const tx = orm(client);
  const [{ eventSeq }] = await tx.update(designTasks).set({ eventSeq: sql`${designTasks.eventSeq}+1`, updatedAt: sql`clock_timestamp()` })
    .where(eq(designTasks.id, taskId)).returning({ eventSeq: designTasks.eventSeq });
  await tx.insert(taskEvents).values({ taskId, seq: eventSeq, type, data });
}
export async function createTask(principal: Principal, projectId: string, input: unknown, producer?: PgBoss) {
  const userId = owner(principal), id = idSchema.parse(projectId), request = createTaskSchema.parse(input);
  const hash = createHash('sha256').update(JSON.stringify({ projectId: id, ...request })).digest('hex');
  const taskId = await transaction(async (client, tx) => {
    // Match the commands advisory-lock namespace: one client operation cannot identify two effects.
    await advisoryXactLock(tx, `${userId}:${request.operationId}`);
    const [project] = await tx.select({ revision: projects.revision, snapshot: projects.snapshot }).from(projects)
      .where(and(eq(projects.id, id), canAccessProject(projects.id, userId))).for('update');
    if (!project) throw notFound();
    const [previous] = await tx.select({ id: designTasks.id, requestHash: designTasks.requestHash }).from(designTasks)
      .where(and(eq(designTasks.actorId, userId), eq(designTasks.requestId, request.operationId)));
    if (previous) {
      if (previous.requestHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此请求标识已用于不同任务。', 409);
      return previous.id;
    }
    if ((await tx.select(one).from(operations).where(and(eq(operations.actorId, userId), eq(operations.id, request.operationId)))).length)
      throw new DomainError('IDEMPOTENCY_CONFLICT', '此请求标识已用于其他操作。', 409);
    if (project.revision !== request.expectedRevision) throw new DomainError('REVISION_CONFLICT', '项目已更新，请重新加载。', 409);
    if ((await tx.select(one).from(designTasks).where(and(eq(designTasks.projectId, id), inArray(designTasks.status, activeStatuses)))).length)
      throw new DomainError('TASK_ACTIVE', '此项目已有进行中的任务，请等待结束或取消。', 409);
    const taskId = randomUUID(), steps = request.protocol === 'deterministic-v1' ? request.steps.map(step => ({ ...step, operationId: randomUUID() })) : [];
    let conversation: TaskRow['conversation'] = null;
    if (request.protocol === 'conversation-v1') {
      const state = spatialStateSchema.parse(project.snapshot);
      if (request.selectedObjectId && ![...state.currentLayout.objects, ...state.fixedFacts.objects].some(object => object.id === request.selectedObjectId))
        throw new DomainError('INVALID_SELECTION', '所选对象不属于当前项目。', 400);
      conversation = { input: { message: request.message, selectedObjectId: request.selectedObjectId ?? null, referenceFrame: request.referenceFrame },
        phase: 'accepted', outcome: null, modelUsage: { inputTokens: null, outputTokens: null }, operationId: randomUUID(),
        context: state, callStarted: false, response: null, brief: initialBrief(request.message), execution: initialExecution() };
    }
    await tx.insert(designTasks).values({ id: taskId, actorId: userId, projectId: id, requestId: request.operationId, requestHash: hash,
      protocol: request.protocol, status: 'queued', steps, expectedRevision: project.revision, conversation, usageLimit: 8 });
    await appendEvent(client, taskId, 'status', { status: 'queued', protocol: request.protocol, label: conversation ? '空间对话' : '确定性协议测试 · 非真实模型设计' });
    await tx.insert(operations).values({ actorId: userId, id: request.operationId, projectId: id, requestHash: hash, result: { kind: 'task', taskId } });
    await enqueueTask(client, taskId, producer);
    return taskId;
  });
  return getTask(principal, id, taskId);
}
/** User input and the next dispatch commit atomically. No model call happens in a request. */
export async function appendConversationInput(principal: Principal, projectId: string, taskId: string, input: unknown, producer?: PgBoss) {
  const userId = owner(principal), id = idSchema.parse(projectId), task = idSchema.parse(taskId), request = conversationInputSchema.parse(input);
  const hash = createHash('sha256').update(JSON.stringify({ projectId: id, taskId: task, ...request })).digest('hex');
  await transaction(async (client, tx) => {
    await advisoryXactLock(tx, `${userId}:${request.operationId}`);
    const [locked] = await tx.select().from(designTasks)
      .where(and(eq(designTasks.id, task), eq(designTasks.projectId, id), canAccessProject(designTasks.projectId, userId))).for('update');
    if (!locked) throw notFound();
    const row = taskRow(locked);
    const [project] = await tx.select({ revision: projects.revision, snapshot: projects.snapshot }).from(projects)
      .where(and(eq(projects.id, id), canAccessProject(projects.id, userId))).for('update');
    if (!project) throw notFound();
    const [previous] = await tx.select({ requestHash: operations.requestHash, result: operations.result }).from(operations)
      .where(and(eq(operations.actorId, userId), eq(operations.id, request.operationId)));
    if (previous) {
      const result = previous.result as { kind?: string; taskId?: string };
      if (previous.requestHash !== hash || result.kind !== 'conversation-input' || result.taskId !== task)
        throw new DomainError('IDEMPOTENCY_CONFLICT', '此请求标识已用于不同操作。', 409);
      return;
    }
    if (row.protocol !== 'conversation-v1' || !row.conversation || ['cancelled', 'failed', 'partial'].includes(row.status))
      throw new DomainError('TASK_NOT_CONTINUABLE', '此任务无法继续接收输入，请重新发起。', 409);
    const conversation = row.conversation, brief = conversation.brief ??= initialBrief(conversation.input.message);
    if (brief.intentVersion !== request.expectedIntentVersion) throw new DomainError('INTENT_CONFLICT', '已有新的补充，请刷新后重试。', 409);
    if (project.revision !== request.expectedRevision) throw new DomainError('REVISION_CONFLICT', '项目已更新，请刷新后补充。', 409);
    if (brief.inputs.length >= 40) throw new DomainError('INPUT_LIMIT', '本任务输入数量达到上限，已有记录保留。');
    if ((await tx.select(one).from(designTasks).where(and(eq(designTasks.projectId, id), ne(designTasks.id, task), inArray(designTasks.status, activeStatuses)))).length)
      throw new DomainError('TASK_ACTIVE', '此项目已有另一个进行中的任务。', 409);
    const state = spatialStateSchema.parse(project.snapshot);
    const selectedObjectId = request.kind === 'message' ? request.selectedObjectId ?? conversation.input.selectedObjectId : conversation.input.selectedObjectId;
    if (selectedObjectId && ![...state.currentLayout.objects, ...state.fixedFacts.objects].some(object => object.id === selectedObjectId))
      throw new DomainError('INVALID_SELECTION', '所选对象不属于当前项目。');
    const inputId = randomUUID(), nextIntent = brief.intentVersion + 1;
    let message: string, questionId: string | null = null, requirementId: string | null = null;
    if (request.kind === 'message') {
      message = request.message;
      if (request.questionId) {
        const question = brief.questions.find(item => item.id === request.questionId);
        if (!question || question.status !== 'open') throw new DomainError('QUESTION_NOT_OPEN', '问题不存在或已经回答，请以新补充记录修正。', 409);
        question.status = 'answered'; question.answerInputId = inputId; questionId = question.id;
      }
    } else {
      const requirement = brief.requirements.find(item => item.id === request.requirementId);
      if (!requirement || requirement.sourceKind !== 'assistant_suggestion' || requirement.revision !== request.requirementRevision)
        throw new DomainError('REQUIREMENT_CONFLICT', '建议已变化或已确认，请刷新后核对。', 409);
      requirement.sourceKind = 'user_confirmed'; requirement.revision++; requirement.confirmedByInputId = inputId;
      requirement.sourceInputIds = [...requirement.sourceInputIds, inputId]; requirementId = requirement.id;
      message = `确认这条居住需求：${requirement.content}`;
    }
    if (conversation.callStarted && !conversation.response) settleAttempt(row);
    const unknownCall = archiveTurn(conversation, ['completed', 'waiting_input', 'waiting_selection'].includes(row.status) ? 'finished' : 'superseded');
    const used = row.usage_used + (unknownCall ? 1 : 0);
    if (used >= row.usage_limit) throw new DomainError('USAGE_LIMIT', '本任务调用达到上限，已有成果和输入记录保留。', 409);
    brief.intentVersion = nextIntent;
    brief.inputs.push({ id: inputId, intentVersion: nextIntent, kind: request.kind === 'message' ? 'message' : 'confirmation', text: message,
      author: 'user', questionId, requirementId, createdAt: new Date().toISOString() });
    brief.workCompleted = [];
    conversation.input = { message, selectedObjectId, referenceFrame: 'plan' }; conversation.context = state;
    conversation.operationId = randomUUID(); conversation.callStarted = false; conversation.response = null; delete conversation.configuration;
    delete conversation.effectiveDecision;
    conversation.phase = 'accepted'; conversation.outcome = null; conversation.modelUsage = { inputTokens: null, outputTokens: null };
    await tx.update(designTasks).set({ conversation, status: 'queued', generation: sql`${designTasks.generation}+1`, attempts: 0, nextStep: 0,
      expectedRevision: project.revision, leaseUntil: null, usageUsed: used, usageReserved: 0, error: null }).where(eq(designTasks.id, task));
    await appendEvent(client, task, 'status', { status: 'queued', phase: 'accepted', intentVersion: nextIntent, inputId, unknownPriorUsage: unknownCall });
    await tx.insert(operations).values({ actorId: userId, id: request.operationId, projectId: id, requestHash: hash,
      result: { kind: 'conversation-input', taskId: task, inputId, intentVersion: nextIntent } });
    await enqueueTask(client, task, producer, randomUUID(), nextIntent);
  });
  return getTask(principal, id, task);
}
export async function getTask(principal: Principal, projectId: string, taskId: string) {
  const [row] = await db.select().from(designTasks).where(and(eq(designTasks.id, idSchema.parse(taskId)), eq(designTasks.projectId, idSchema.parse(projectId)),
    canAccessProject(designTasks.projectId, owner(principal))));
  if (!row) throw notFound();
  return taskView(taskRow(row));
}
export async function listTasks(principal: Principal, projectId: string) {
  const userId = owner(principal), id = idSchema.parse(projectId);
  if (!(await db.select(one).from(projects).where(and(eq(projects.id, id), canAccessProject(projects.id, userId)))).length) throw notFound();
  const rows = await db.select().from(designTasks).where(eq(designTasks.projectId, id)).orderBy(desc(designTasks.createdAt)).limit(20);
  return rows.map(row => taskView(taskRow(row)));
}
export async function cancelTask(principal: Principal, projectId: string, taskId: string) {
  const userId = owner(principal), id = idSchema.parse(projectId), task = idSchema.parse(taskId);
  await transaction(async (client, tx) => {
    const [locked] = await tx.select().from(designTasks)
      .where(and(eq(designTasks.id, task), eq(designTasks.projectId, id), canAccessProject(designTasks.projectId, userId))).for('update', { of: designTasks });
    if (!locked) throw notFound();
    const row = taskRow(locked);
    if (terminalTaskStatuses.has(row.status)) return;
    // This lock also fences command commits. A winning prior commit remains in the checkpoint.
    const unknownCall = row.conversation?.callStarted && !row.conversation.response;
    if (row.conversation) { settleAttempt(row); await tx.update(designTasks).set({ conversation: row.conversation }).where(eq(designTasks.id, task)); }
    await tx.update(designTasks).set({ status: 'cancelled', generation: sql`${designTasks.generation}+1`, leaseUntil: null,
      usageUsed: sql`${designTasks.usageUsed}+${unknownCall ? row.usage_reserved : 0}`, usageReserved: 0, error: null }).where(eq(designTasks.id, task));
    await appendEvent(client, task, 'status', { status: 'cancelled', completedSteps: row.next_step, message: '任务已取消；已提交的修改保留，可在操作历史撤销。' });
  });
  return getTask(principal, id, task);
}
export async function readTaskEvents(principal: Principal, projectId: string, taskId: string, after: number) {
  if (!Number.isSafeInteger(after) || after < 0) throw new DomainError('INVALID_CURSOR', '事件游标不正确。');
  const task = await getTask(principal, projectId, taskId);
  if (after > task.eventsCursor) throw new DomainError('INVALID_CURSOR', '事件游标超出当前任务进度。');
  const rows = await db.select({ seq: taskEvents.seq, type: taskEvents.type, data: taskEvents.data, createdAt: taskEvents.createdAt }).from(taskEvents)
    .where(and(eq(taskEvents.taskId, taskId), gt(taskEvents.seq, after))).orderBy(taskEvents.seq).limit(100);
  return { task, events: rows.map((row): TaskEvent => ({ taskId, seq: row.seq, type: row.type as TaskEvent['type'], data: row.data as TaskEvent['data'], createdAt: row.createdAt.toISOString() })) };
}
