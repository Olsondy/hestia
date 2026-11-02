import type { PoolClient } from 'pg';
import { and, eq, ne } from 'drizzle-orm';
import { DomainError, spatialStateSchema } from '../../contracts/src/project';
import type { ConversationBrief, ConversationState } from '../../contracts/src/tasks';
import { savePlannedCandidateInTransaction } from '../../candidates/src/service';
import { hash } from '../../candidates/src/checks';
import { canAccessProject } from '../../workspaces/src/access';
import { orm } from '../../persistence/src/client';
import { candidates, designTasks, operations, projects } from '../../persistence/src/schema';
import { planLayout } from './planner';
import type { LayoutPlan, PlanDecision } from './contract';

export type PlanCandidateResult = { status: LayoutPlan['status']; candidateId?: string; candidateRevision?: number; checkId?: string; report: LayoutPlan };
/** Existing runner owns the transaction and task fence. This entry has no network or queue. */
export async function planRoomCandidateInTransaction(client: PoolClient, input: {
  ownerId: string; projectId: string; baseRevision: number; operationId: string; taskId: string; intentVersion: number;
  decision: PlanDecision; brief: ConversationBrief; input: ConversationState['input'];
}): Promise<PlanCandidateResult> {
  const tx = orm(client);
  const [task] = await tx.select({ conversation: designTasks.conversation, status: designTasks.status }).from(designTasks)
    .where(and(eq(designTasks.id, input.taskId), eq(designTasks.projectId, input.projectId), eq(designTasks.actorId, input.ownerId)));
  const conversation = task?.conversation as ConversationState | null | undefined;
  if (!task || task.status !== 'running' || conversation?.brief?.intentVersion !== input.intentVersion || input.brief.intentVersion !== input.intentVersion
    || hash(conversation.brief) !== hash(input.brief) || hash(conversation.input) !== hash(input.input))
    throw new DomainError('PLANNER_INTENT_CONFLICT', '布局请求不属于当前执行意图。', 409);
  const plannerRequestHash = hash(input);
  const [operation] = await tx.select({ result: operations.result }).from(operations)
    .where(and(eq(operations.actorId, input.ownerId), eq(operations.id, input.operationId)));
  const previous = operation?.result as { plannerRequestHash?: string; report?: LayoutPlan; candidateId?: string; candidateRevision?: number; checkId?: string } | undefined;
  if (previous) {
    if (previous.plannerRequestHash !== plannerRequestHash || !previous.report) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已经用于另一布局请求。', 409);
    return { status: 'recommended', candidateId: previous.candidateId, candidateRevision: previous.candidateRevision, checkId: previous.checkId, report: previous.report };
  }
  const [project] = await tx.select({ revision: projects.revision, snapshot: projects.snapshot }).from(projects)
    .where(and(eq(projects.id, input.projectId), canAccessProject(projects.id, input.ownerId))).for('update');
  if (!project || project.revision !== input.baseRevision) throw new DomainError('REVISION_CONFLICT', '项目已变化，不能保存旧布局。', 409);
  const state = spatialStateSchema.parse(project.snapshot);
  // Reuse geometry only from an actual prior candidate of this task, never an ID supplied by
  // the model. The source project revision and complete base snapshot must still match.
  const history = [...input.brief.history].reverse().find(turn => turn.status === 'finished' && turn.outcome?.kind === 'candidate' && turn.outcome.candidateId);
  let seedObjects: typeof state.currentLayout.objects | undefined;
  let seedCandidate: { id: string; revision: number } | undefined;
  if (history?.outcome?.candidateId) {
    const [candidate] = await tx.select({ id: candidates.id, revision: candidates.revision, baseRevision: candidates.baseRevision, baseState: candidates.baseState,
      objects: candidates.objects, plannerContext: candidates.plannerContext }).from(candidates)
      .where(and(eq(candidates.id, history.outcome.candidateId), eq(candidates.projectId, input.projectId), ne(candidates.status, 'adopted'))).for('update');
    const context = candidate?.plannerContext as { taskId?: string; intentVersion?: number } | null | undefined;
    if (candidate && candidate.baseRevision === project.revision && hash(candidate.baseState) === hash(state)
      && context?.taskId === input.taskId && context?.intentVersion === history.intentVersion) {
      seedObjects = candidate.objects as typeof state.currentLayout.objects;
      seedCandidate = { id: candidate.id, revision: candidate.revision };
    }
  }
  const planned = planLayout({ state, brief: input.brief, decision: input.decision, operationId: input.operationId, seedObjects, seedCandidate });
  if (planned.report.status !== 'recommended' || !planned.report.objects || !planned.context) return { status: planned.report.status, report: planned.report };
  const saved = await savePlannedCandidateInTransaction(client, { userId: input.ownerId }, input.projectId, { operationId: input.operationId,
    expectedRevision: input.baseRevision, baseHash: planned.report.baseHash, objects: planned.report.objects, context: { ...planned.context, taskId: input.taskId }, report: planned.report, plannerRequestHash });
  return { status: 'recommended', candidateId: saved.candidateId, candidateRevision: saved.candidateRevision, checkId: saved.checkId, report: saved.report };
}
