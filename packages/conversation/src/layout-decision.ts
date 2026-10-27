import { DomainError } from '../../contracts/src/project';
import type { ConversationBrief } from '../../contracts/src/tasks';
import type { PlanDecision } from '../../layout-planner/src/contract';
import { applyBriefProposal, type BriefProposal } from './brief';

/** Validate the model's known references before adding application-created IDs from this turn.
 * This produces a proposal only; the planner still verifies actual user scope and geometry. */
export function prepareLayoutProposal(brief: ConversationBrief, decision: PlanDecision, proposal?: BriefProposal) {
  const previousIds = new Set(brief.requirements.map(requirement => requirement.id));
  const previousHardIds = new Set(brief.requirements.filter(requirement => requirement.sourceKind !== 'assistant_suggestion').map(requirement => requirement.id));
  if (decision.requirementIds.some(id => !previousIds.has(id)) || [...previousHardIds].some(id => !decision.requirementIds.includes(id)))
    throw new DomainError('PLANNER_REQUIREMENT_CONFLICT', '布局提案未覆盖已有明确需求或引用了不存在的需求。');
  const updated = structuredClone(brief);
  if (proposal) applyBriefProposal(updated, proposal);
  const currentInputId = updated.inputs.at(-1)?.id;
  // This includes an older suggestion promoted by the actual current user, not just new IDs.
  const explicitIds = updated.requirements.filter(requirement => !previousHardIds.has(requirement.id) &&
    requirement.sourceKind === 'user_explicit' && !!currentInputId && requirement.sourceInputIds.includes(currentInputId)).map(requirement => requirement.id);
  return { brief: updated, decision: { ...decision, requirementIds: [...new Set([...decision.requirementIds, ...explicitIds])] } };
}
