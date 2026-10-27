import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { planLayout } from './planner';
import { syntheticPlanningInput } from './fixtures';
import { inspectPlannerLayout } from './checks';
import { inspectLayout, hash } from '../../candidates/src/checks';

test('bounded search creates actual layouts at different dimensions and translated origins without user coordinates', () => {
  for (const [w, d, x, z] of [[6, 5, 0, 0], [7, 5.5, -3, 4], [5.6, 5.2, 2, -7]]) {
    const input = syntheticPlanningInput(w, d, x, z), before = hash(input.state), result = planLayout(input);
    assert.equal(result.report.status, 'recommended', JSON.stringify(result.report));
    assert.ok(result.report.objects!.length > input.state.currentLayout.objects.length);
    assert.equal(hash(input.state), before); assert.ok(result.report.metrics.nodes <= 6000); assert.ok(result.report.metrics.candidatesChecked <= 24);
    assert.equal(inspectLayout(input.state, result.report.objects!).adoptable, true);
    assert.equal(inspectPlannerLayout(input.state, result.report.objects!, result.context!).adoptable, true);
    assert.deepEqual(result.report.objects!.find(o => o.id === 'existing-sofa')!.size, input.state.currentLayout.objects[0].size);
  }
});
test('scope cannot come from old requirements, quotations, questions or model-controlled requirement omission', () => {
  for (const text of ['只整理会客办公需求，暂不生成方案', '如果生成会客办公布局会怎样', '例如：生成会客办公布局', '生成会客办公布局吗']) {
    const input = syntheticPlanningInput(); input.brief.inputs[0].text = text;
    assert.equal(planLayout(input).report.status, 'needs_input');
  }
  const input = syntheticPlanningInput(); input.brief.requirements.push({ id: randomUUID(), revision: 1, content: '需要轮椅通行', sourceKind: 'user_explicit', sourceInputIds: [input.brief.inputs[0].id], createdAtIntentVersion: 1, confirmedByInputId: null });
  assert.equal(planLayout(input).report.status, 'needs_input');
  input.decision.requirementIds = [input.brief.requirements[0].id];
  const result = planLayout(input); assert.equal(result.report.status, 'needs_input'); assert.equal(result.report.requirements[0].status, 'not_checked');
});
test('missing scale, unsupported room and unknown door clearance never produce a qualified recommendation', () => {
  const input = syntheticPlanningInput(); input.state.scale = 'missing'; assert.equal(planLayout(input).report.status, 'needs_input');
  input.state.scale = 'synthetic'; input.state.fixedFacts.rooms[0].outline[1].z += .3; assert.equal(planLayout(input).report.status, 'needs_input');
  const doors = syntheticPlanningInput(); doors.state.fixedFacts.openingClearances = []; assert.equal(planLayout(doors).report.status, 'needs_input');
  const detached = syntheticPlanningInput();
  // A collinear wall is still outside this room; its opening cannot seed an interior route.
  const entryWall = detached.state.fixedFacts.walls.find(w => w.id === 'west')!;
  entryWall.a.z += 10; entryWall.b.z += 10;
  assert.equal(planLayout(detached).report.status, 'needs_input');
  const repeatedCorner = syntheticPlanningInput();
  repeatedCorner.state.fixedFacts.rooms[0].outline[3] = { ...repeatedCorner.state.fixedFacts.rooms[0].outline[1] };
  assert.equal(planLayout(repeatedCorner).report.status, 'needs_input');
});
test('finite work allowance stops search and impossible rooms never shrink existing furniture', () => {
  const input = syntheticPlanningInput(); input.limits = { maxNodes: 0 }; const stopped = planLayout(input);
  assert.equal(stopped.report.status, 'not_found'); assert.equal(stopped.report.metrics.nodes, 0); assert.equal(stopped.report.metrics.exhausted, true);
  const tiny = syntheticPlanningInput(2.5, 2.5); const before = hash(tiny.state); const result = planLayout(tiny);
  assert.equal(result.report.status, 'not_found'); assert.equal(result.report.objects, null); assert.equal(hash(tiny.state), before);
});
test('retained objects, locked poses and functional approach remain required on later candidate edits', () => {
  const input = syntheticPlanningInput(), result = planLayout(input); assert.equal(result.report.status, 'recommended');
  const changed = structuredClone(result.report.objects!); changed.find(o => o.id === 'existing-sofa')!.size.width -= .1;
  assert.equal(inspectPlannerLayout(input.state, changed, result.context!).adoptable, false);
  const movedChair = structuredClone(result.report.objects!); movedChair.find(o => o.id === result.context!.chairId)!.position.x += 1;
  assert.equal(inspectPlannerLayout(input.state, movedChair, result.context!).adoptable, false);
  input.state.currentLayout.lockedObjectIds = ['existing-sofa']; const locked = planLayout(input);
  if (locked.report.status === 'recommended') assert.deepEqual(locked.report.objects!.find(o => o.id === 'existing-sofa'), input.state.currentLayout.objects[0]);
});

test('a sourced supplemental condition continues an earlier goal without reusing old checks or requiring repeated scope', () => {
  const input = syntheticPlanningInput(), first = planLayout(input);
  assert.equal(first.report.status, 'recommended');
  const latestId = randomUUID(), oldInputId = input.brief.inputs[0].id;
  input.brief.history.push({ intentVersion: 1, input: { message: input.brief.inputs[0].text, selectedObjectId: null, referenceFrame: 'plan' },
    reply: '已生成候选', outcome: { kind: 'candidate', message: '候选待选择', candidateId: randomUUID() },
    modelUsage: { inputTokens: 1, outputTokens: 1 }, status: 'finished', unknownUsage: false });
  input.brief.intentVersion = 2;
  input.brief.inputs.push({ id: latestId, intentVersion: 2, kind: 'message', text: '保留现有家具', author: 'user',
    questionId: null, requirementId: null, createdAt: new Date().toISOString() });
  input.decision.sourceInputIds = [latestId];
  input.seedObjects = first.report.objects!;
  input.seedCandidate = { id: randomUUID(), revision: 1 };
  const next = planLayout(input);
  assert.equal(next.report.status, 'recommended', next.report.reason);
  assert.deepEqual(next.report.objects, first.report.objects);
  assert.deepEqual(next.report.source.reusedFromCandidate, input.seedCandidate);
  assert.ok(next.report.source.inputIds.includes(oldInputId));
  assert.ok(next.report.source.inputIds.includes(latestId));
  assert.equal(next.report.source.intentVersion, 2);
  assert.equal(next.report.metrics.candidatesChecked, 1);
  assert.equal(inspectPlannerLayout(input.state, next.report.objects!, next.context!).adoptable, true);
});

test('a new original-pose constraint rechecks and repairs a prior candidate against the current project', () => {
  const input = syntheticPlanningInput(), first = planLayout(input);
  assert.equal(first.report.status, 'recommended');
  const initialSofa = input.state.currentLayout.objects.find(object => object.id === 'existing-sofa')!;
  assert.notDeepEqual(first.report.objects!.find(object => object.id === initialSofa.id)!.position, initialSofa.position);
  const latestId = randomUUID(); input.brief.intentVersion = 2;
  input.brief.history.push({ intentVersion: 1, input: { message: input.brief.inputs[0].text, selectedObjectId: null, referenceFrame: 'plan' },
    reply: '已生成候选', outcome: { kind: 'candidate', message: '候选待选择', candidateId: randomUUID() },
    modelUsage: { inputTokens: 1, outputTokens: 1 }, status: 'finished', unknownUsage: false });
  input.brief.inputs.push({ id: latestId, intentVersion: 2, kind: 'message', text: '原位保留沙发', author: 'user',
    questionId: null, requirementId: null, createdAt: new Date().toISOString() });
  input.decision.sourceInputIds = [latestId]; input.seedObjects = first.report.objects!;
  input.seedCandidate = { id: randomUUID(), revision: 1 };
  const next = planLayout(input);
  assert.equal(next.report.status, 'recommended', next.report.reason);
  assert.deepEqual(next.report.objects!.find(object => object.id === initialSofa.id), initialSofa);
  assert.equal(next.report.source.reusedFromCandidate, undefined);
  assert.ok(next.report.metrics.candidatesChecked >= 2);
});

test('an explicit unchanged condition never allows moving the existing sofa', () => {
  const input = syntheticPlanningInput(), first = planLayout(input);
  assert.equal(first.report.status, 'recommended');
  input.brief.intentVersion = 2;
  input.brief.history.push({ intentVersion: 1, input: { message: input.brief.inputs[0].text, selectedObjectId: null, referenceFrame: 'plan' },
    reply: '候选待选择', outcome: { kind: 'candidate', message: '候选待选择', candidateId: randomUUID() },
    modelUsage: { inputTokens: 1, outputTokens: 1 }, status: 'finished', unknownUsage: false });
  const latestId = randomUUID(); input.brief.inputs.push({ id: latestId, intentVersion: 2, kind: 'message', text: '沙发保持不变',
    author: 'user', questionId: null, requirementId: null, createdAt: new Date().toISOString() });
  input.decision.sourceInputIds = [latestId]; input.seedObjects = first.report.objects!;
  const result = planLayout(input);
  assert.equal(result.report.status, 'recommended', result.report.reason);
  assert.deepEqual(result.report.objects!.find(object => object.id === 'existing-sofa'), input.state.currentLayout.objects[0]);
});

test('a revocation or unsupported intervening input cannot be skipped by a later supplement', () => {
  for (const text of ['暂不生成方案', '不要设计', '保留沙发吗？', '保留沙发并增加餐厅']) {
    const input = syntheticPlanningInput(); input.brief.intentVersion = 3;
    input.brief.history.push({ intentVersion: 1, input: { message: input.brief.inputs[0].text, selectedObjectId: null, referenceFrame: 'plan' },
      reply: null, outcome: null, modelUsage: { inputTokens: null, outputTokens: null }, status: 'superseded', unknownUsage: false });
    input.brief.inputs.push({ id: randomUUID(), intentVersion: 2, kind: 'message', text, author: 'user', questionId: null, requirementId: null, createdAt: new Date().toISOString() });
    const latestId = randomUUID(); input.brief.inputs.push({ id: latestId, intentVersion: 3, kind: 'message', text: '保留现有家具', author: 'user', questionId: null, requirementId: null, createdAt: new Date().toISOString() });
    input.brief.history.push({ intentVersion: 2, input: { message: text, selectedObjectId: null, referenceFrame: 'plan' },
      reply: null, outcome: null, modelUsage: { inputTokens: null, outputTokens: null }, status: 'superseded', unknownUsage: false });
    input.decision.sourceInputIds = [latestId];
    assert.equal(planLayout(input).report.status, 'needs_input', text);
  }
});

test('an adopted design stays closed even if a subsequent unrelated input is itself superseded', () => {
  const input = syntheticPlanningInput(); input.brief.intentVersion = 4;
  const followups = ['保留现有家具', '保留现有家具', '保留现有家具'];
  for (let i = 0; i < followups.length; i++) input.brief.inputs.push({ id: randomUUID(), intentVersion: i + 2, kind: 'message',
    text: followups[i], author: 'user', questionId: null, requirementId: null, createdAt: new Date().toISOString() });
  const userInput = (message: string) => ({ message, selectedObjectId: null, referenceFrame: 'plan' as const });
  const usage = { inputTokens: null, outputTokens: null };
  input.brief.history.push({ intentVersion: 1, input: userInput(input.brief.inputs[0].text), reply: null, outcome: null, modelUsage: usage, status: 'superseded', unknownUsage: false });
  input.brief.history.push({ intentVersion: 2, input: userInput(followups[0]), reply: '已采用', outcome: { kind: 'candidate', message: '已采用', candidateId: randomUUID(), operationId: randomUUID() }, modelUsage: usage, status: 'finished', unknownUsage: false });
  input.brief.history.push({ intentVersion: 3, input: userInput(followups[1]), reply: null, outcome: null, modelUsage: usage, status: 'superseded', unknownUsage: false });
  input.decision.sourceInputIds = [input.brief.inputs[3].id];
  assert.equal(planLayout(input).report.status, 'needs_input');
});

test('a completed and adopted design cannot authorize a new plan from an unrelated supplement', () => {
  const input = syntheticPlanningInput(); input.brief.intentVersion = 2;
  const latestId = randomUUID(); input.brief.inputs.push({ id: latestId, intentVersion: 2, kind: 'message', text: '保留现有家具', author: 'user', questionId: null, requirementId: null, createdAt: new Date().toISOString() });
  input.brief.history.push({ intentVersion: 1, input: { message: input.brief.inputs[0].text, selectedObjectId: null, referenceFrame: 'plan' },
    reply: '已采用', outcome: { kind: 'candidate', message: '已采用', candidateId: randomUUID(), operationId: randomUUID() },
    modelUsage: { inputTokens: 1, outputTokens: 1 }, status: 'finished', unknownUsage: false });
  input.decision.sourceInputIds = [latestId];
  assert.equal(planLayout(input).report.status, 'needs_input');
});
