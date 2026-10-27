import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { syntheticPlanningInput } from '../../layout-planner/src/fixtures';
import { prepareLayoutProposal } from './layout-decision';

test('a same-turn brief adds application-created explicit IDs without inventing model references or mutating the source', () => {
  const input = syntheticPlanningInput(), original = structuredClone(input.brief), source = input.brief.inputs[0];
  const prepared = prepareLayoutProposal(input.brief, input.decision, { summary: '整理布局目标',
    requirements: [{ content: source.text, sourceKind: 'user_explicit', sourceInputIds: [source.id] }], questions: [] });
  assert.deepEqual(input.brief, original);
  assert.equal(prepared.brief.requirements.length, 1);
  assert.deepEqual(prepared.decision.requirementIds, [prepared.brief.requirements[0].id]);
});

test('an existing suggestion promoted by the complete current user input becomes part of the effective hard scope', () => {
  const input = syntheticPlanningInput(), source = input.brief.inputs[0], id = randomUUID();
  input.brief.requirements.push({ id, revision: 1, content: source.text, sourceKind: 'assistant_suggestion', sourceInputIds: [],
    createdAtIntentVersion: 1, confirmedByInputId: null });
  const prepared = prepareLayoutProposal(input.brief, input.decision, { summary: '已记录用户布局目标',
    requirements: [{ content: source.text, sourceKind: 'user_explicit', sourceInputIds: [source.id] }], questions: [] });
  assert.deepEqual(prepared.decision.requirementIds, [id]);
  assert.equal(prepared.brief.requirements[0].sourceKind, 'user_explicit');
  assert.equal(prepared.brief.requirements[0].revision, 2); assert.equal(prepared.brief.requirements[0].confirmedByInputId, null);
});

test('an added brief cannot conceal omission or forgery of pre-existing hard requirements', () => {
  const input = syntheticPlanningInput(), id = randomUUID();
  input.brief.requirements.push({ id, revision: 1, content: '保留已有家具', sourceKind: 'user_confirmed', sourceInputIds: [input.brief.inputs[0].id],
    createdAtIntentVersion: 1, confirmedByInputId: input.brief.inputs[0].id });
  assert.throws(() => prepareLayoutProposal(input.brief, input.decision), { code: 'PLANNER_REQUIREMENT_CONFLICT' });
  assert.throws(() => prepareLayoutProposal(input.brief, { ...input.decision, requirementIds: [id, randomUUID()] }), { code: 'PLANNER_REQUIREMENT_CONFLICT' });
  const prepared = prepareLayoutProposal(input.brief, { ...input.decision, requirementIds: [id] }, { summary: '建议仍待确认',
    requirements: [{ content: '增加落地灯', sourceKind: 'assistant_suggestion', sourceInputIds: [] }], questions: [] });
  assert.deepEqual(prepared.decision.requirementIds, [id]);
  assert.equal(prepared.brief.requirements.at(-1)!.sourceKind, 'assistant_suggestion');
});
