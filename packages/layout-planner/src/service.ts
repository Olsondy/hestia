import type { PoolClient } from 'pg';
import { DomainError, spatialStateSchema } from '../../contracts/src/project';
import type { ConversationBrief, ConversationState } from '../../contracts/src/tasks';
import { savePlannedCandidateInTransaction } from '../../candidates/src/service';
import { hash } from '../../candidates/src/checks';
import { projectAccess } from '../../workspaces/src/access';
import { planLayout } from './planner';
import type { LayoutPlan, PlanDecision } from './contract';

export type PlanCandidateResult = { status: LayoutPlan['status']; candidateId?: string; candidateRevision?: number; checkId?: string; report: LayoutPlan };
/** Existing runner owns the transaction and task fence. This entry has no network or queue. */
export async function planRoomCandidateInTransaction(client: PoolClient, input: {
  ownerId: string; projectId: string; baseRevision: number; operationId: string; taskId: string; intentVersion: number;
  decision: PlanDecision; brief: ConversationBrief; input: ConversationState['input'];
}): Promise<PlanCandidateResult> {
  const task = (await client.query('SELECT conversation,status FROM design_tasks WHERE id=$1 AND project_id=$2 AND actor_id=$3', [input.taskId, input.projectId, input.ownerId])).rows[0];
  if (!task || task.status !== 'running' || task.conversation?.brief?.intentVersion !== input.intentVersion || input.brief.intentVersion !== input.intentVersion
    || hash(task.conversation.brief) !== hash(input.brief) || hash(task.conversation.input) !== hash(input.input))
    throw new DomainError('PLANNER_INTENT_CONFLICT', '布局请求不属于当前执行意图。', 409);
  const plannerRequestHash = hash(input);
  const previous = (await client.query('SELECT result FROM operations WHERE actor_id=$1 AND id=$2', [input.ownerId, input.operationId])).rows[0]?.result;
  if (previous) {
    if (previous.plannerRequestHash !== plannerRequestHash || !previous.report) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已经用于另一布局请求。', 409);
    return { status: 'recommended', candidateId: previous.candidateId, candidateRevision: previous.candidateRevision, checkId: previous.checkId, report: previous.report };
  }
  const project = (await client.query(`SELECT revision,snapshot FROM projects p WHERE p.id=$1 AND ${projectAccess('p.id', '$2')} FOR UPDATE`, [input.projectId, input.ownerId])).rows[0];
  if (!project || project.revision !== input.baseRevision) throw new DomainError('REVISION_CONFLICT', '项目已变化，不能保存旧布局。', 409);
  const state = spatialStateSchema.parse(project.snapshot);
  // Reuse geometry only from an actual prior candidate of this task, never an ID supplied by
  // the model. The source project revision and complete base snapshot must still match.
  const history = [...input.brief.history].reverse().find(turn => turn.status === 'finished' && turn.outcome?.kind === 'candidate' && turn.outcome.candidateId);
  let seedObjects: typeof state.currentLayout.objects | undefined;
  let seedCandidate: { id: string; revision: number } | undefined;
  if (history?.outcome?.candidateId) {
    const candidate = (await client.query(`SELECT id,revision,base_revision,base_state,objects,planner_context FROM candidates
      WHERE id=$1 AND project_id=$2 AND status<>'adopted' FOR UPDATE`,
      [history.outcome.candidateId, input.projectId])).rows[0];
    if (candidate && candidate.base_revision === project.revision && hash(candidate.base_state) === hash(state)
      && candidate.planner_context?.taskId === input.taskId && candidate.planner_context?.intentVersion === history.intentVersion) {
      seedObjects = candidate.objects;
      seedCandidate = { id: candidate.id, revision: candidate.revision };
    }
  }
  const planned = planLayout({ state, brief: input.brief, decision: input.decision, operationId: input.operationId, seedObjects, seedCandidate });
  if (planned.report.status !== 'recommended' || !planned.report.objects || !planned.context) return { status: planned.report.status, report: planned.report };
  const saved = await savePlannedCandidateInTransaction(client, { userId: input.ownerId }, input.projectId, { operationId: input.operationId,
    expectedRevision: input.baseRevision, baseHash: planned.report.baseHash, objects: planned.report.objects, context: { ...planned.context, taskId: input.taskId }, report: planned.report, plannerRequestHash });
  return { status: 'recommended', candidateId: saved.candidateId, candidateRevision: saved.candidateRevision, checkId: saved.checkId, report: saved.report };
}
