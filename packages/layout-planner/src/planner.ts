import { createHash } from 'node:crypto';
import type { SpatialState } from '../../contracts/src/project';
import { catalogInstance } from '../../catalog/src/instances';
import { getCatalog } from '../../catalog/src/catalog';
import { hash, inspectLayout, hasLayoutChange } from '../../candidates/src/checks';
import { footprint } from '../../geometry/src/placement';
import { forward, inspectPlannerLayout, rectangle } from './checks';
import { PLAN_LIMITS, PLANNER_VERSION, planDecisionSchema, type PlanInput, type LayoutPlan, type PlannerContext } from './contract';

type Object3D = SpatialState['currentLayout']['objects'][number];
export type Planned = { report: LayoutPlan; context: PlannerContext | null };
const denied = /[?？“”‘’「」『』"']|假设|如果|假如|比如|例如|示例|举例|暂不|先不|不要生成|不要设计|不想生成|不需要生成|只整理|仅整理|会怎样|吗/u;
/** Conservative supported vocabulary: unrepresented hard requirements are never declared met.
 * This is a capability bound, not a second model/router or a general natural-language parser. */
function covered(text: string, state: SpatialState) {
  let rest = text;
  for (const object of [...state.fixedFacts.objects, ...state.currentLayout.objects])
    for (const name of [object.name, object.id].filter((v): v is string => !!v).sort((a, b) => b.length - a.length)) rest = rest.split(name).join('');
  for (const [assetId, aliases] of [['prototype-sofa', ['沙发']], ['prototype-study-desk', ['书桌', '工作桌']], ['prototype-coffee-table', ['茶几']], ['prototype-reading-chair', ['座椅']]] as const)
    if (state.currentLayout.objects.some(o => o.catalog?.assetId === assetId)) for (const alias of aliases) rest = rest.split(alias).join('');
  rest = rest.replace(/原位保留|保持原位|不要移动|不移动|保留现有|现有家具|固定设施|固定事实|家具|现有|已有|原位|保留|保持|不变/g, '');
  rest = rest.replace(/帮我|请为|希望|需要|想要|这个|单个|房间|客厅|生成|设计|规划|安排|一个|推荐|方案|布局|满足|支持|同时|兼顾|会客|办公|工作|功能|用于|可以|的|为|给|我|请|该|和|与|及|并|都|也/g, '');
  return rest.replace(/[\s\p{P}]/gu, '') === '';
}
function bound(value: number | undefined, platform: number) { return Number.isFinite(value) ? Math.max(0, Math.min(platform, Math.floor(value!))) : platform; }
function stableId(operationId: string, role: string) { return `planned-${createHash('sha256').update(`${operationId}:${role}`).digest('hex').slice(0, 24)}`; }
export function planLayout(input: PlanInput): Planned {
  const started = performance.now(), state = structuredClone(input.state), brief = input.brief;
  const decision = planDecisionSchema.parse(input.decision), latest = brief.inputs.at(-1);
  const report: LayoutPlan = { version: PLANNER_VERSION, baseHash: hash(state), requestHash: hash({ decision, brief }), status: 'needs_input', objects: null,
    reason: '', checks: [], requirements: [], source: { inputIds: decision.sourceInputIds, requirementIds: decision.requirementIds, intentVersion: brief.intentVersion, roomId: decision.roomId },
    metrics: { nodes: 0, candidatesChecked: 0, correctionAttempts: 0, elapsedMs: 0, questions: 0, modelCalls: 0, exhausted: false } };
  const finish = (reason: string, status: LayoutPlan['status'] = 'needs_input', context: PlannerContext | null = null): Planned => {
    report.reason = reason; report.status = status; report.metrics.elapsedMs = performance.now() - started;
    report.metrics.questions = status === 'needs_input' ? 1 : 0;
    return { report, context };
  };
  const isGoal = (text: string) => !denied.test(text) && /(生成|设计|规划|安排)/u.test(text)
    && /(布局|方案)/u.test(text) && /会客/u.test(text) && /(办公|工作)/u.test(text);
  // Start from the last independently verified user goal. Every later input is rechecked;
  // model-supplied IDs do not confer permission and a later revocation cannot be skipped.
  let goalIndex = -1;
  for (let i = brief.inputs.length - 1; i >= 0; i--) {
    const item = brief.inputs[i];
    if (item.kind === 'message' && item.author === 'user' && isGoal(item.text)) { goalIndex = i; break; }
  }
  const chain = goalIndex < 0 ? [] : brief.inputs.slice(goalIndex);
  const goal = chain[0], goalTurn = brief.history.find(turn => turn.intentVersion === goal?.intentVersion);
  const priorTurn = brief.history.find(turn => turn.intentVersion === (latest?.intentVersion ?? 0) - 1);
  // A finished/adopted design does not turn a later unrelated message into a new design task.
  // A superseded active turn, an unadopted candidate, or a design waiting for input may continue.
  const wasActive = (turn: typeof goalTurn) => !!turn && (turn.status === 'superseded'
    || turn.outcome?.kind === 'candidate' && !turn.outcome.operationId
    || turn.outcome?.kind === 'clarification' && turn.outcome.planReport?.status === 'needs_input');
  const adoptedSinceGoal = brief.history.some(turn => turn.intentVersion >= (goal?.intentVersion ?? 0)
    && turn.outcome?.kind === 'candidate' && !!turn.outcome.operationId);
  const activeGoal = goal === latest || wasActive(goalTurn) && wasActive(priorTurn) && !adoptedSinceGoal;
  if (!latest || latest.kind !== 'message' || latest.intentVersion !== brief.intentVersion || !chain.length
    || !activeGoal || chain.length > 8 || chain.some(item => item.kind !== 'message' || item.author !== 'user' || denied.test(item.text) || !covered(item.text, state))
    || !decision.sourceInputIds.includes(latest.id) || decision.sourceInputIds.some(id => !brief.inputs.some(i => i.id === id)))
    return finish('本轮没有可核对的会客与办公布局生成请求；旧需求或模型提案不能扩大当前范围。');
  const sourceInputIds = [...new Set([...decision.sourceInputIds, ...chain.map(item => item.id)])];
  if (sourceInputIds.length > 8) return finish('本轮需要核对的原始输入超出当前上限，请先整理需求。');
  report.source.inputIds = sourceInputIds;
  const hard = brief.requirements.filter(r => r.sourceKind !== 'assistant_suggestion');
  if (new Set(decision.requirementIds).size !== hard.length || hard.some(r => !decision.requirementIds.includes(r.id))
    || decision.requirementIds.some(id => !hard.some(r => r.id === id))) return finish('需求引用必须包含全部有来源的硬需求，不能跳过保留条件。');
  let unsupportedRequirement = false;
  for (const requirement of hard) {
    const traceable = requirement.sourceInputIds.length > 0 && requirement.sourceInputIds.every(id => brief.inputs.some(i => i.id === id));
    const supported = traceable && covered(requirement.content, state);
    unsupportedRequirement ||= !supported;
    report.requirements.push({ id: requirement.id, status: 'not_checked', evidence: supported ? '将核对保留对象、功能家具与连续通道；几何成功后才成立。' : '此硬需求没有受支持的确定性检查，不能声明已满足。' });
  }
  if (unsupportedRequirement) return finish('存在未覆盖的硬需求；保留来源并等待澄清，不生成假合格推荐。');
  if (state.scale !== 'calibrated' && !(state.synthetic && state.scale === 'synthetic')) return finish('尺度未可靠确认，不能判断实际可放置，请先补充可靠尺寸。');
  const room = rectangle(state, decision.roomId);
  if (!room || state.currentLayout.objects.length > 20 || state.fixedFacts.objects.length > 20) return finish('当前有限规划只覆盖单个矩形房间与至多 20 件既有家具；复杂空间未检查。');
  const doorIds = state.fixedFacts.walls.flatMap(w => w.openings.filter(o => o.sill <= .001).map(o => o.id));
  if (!doorIds.length || doorIds.some(id => !state.fixedFacts.openingClearances.some(c => c.openingId === id))) return finish('缺少入口或门扇开启信息，无法完成入口通道检查。');
  const original = structuredClone(state.currentLayout.objects), additions: Object3D[] = [];
  const choose = (assetId: string, role: string) => {
    const found = original.find(o => o.catalog?.assetId === assetId);
    if (found) return found;
    // A previous candidate is only an input to fresh checks, never authority to adopt.
    const prior = input.seedObjects?.find(o => o.catalog?.assetId === assetId && !original.some(existing => existing.id === o.id));
    if (prior) { additions.push(structuredClone(prior)); return additions.at(-1)!; }
    const asset = getCatalog().assets.find(a => a.id === assetId)!;
    const next = catalogInstance(stableId(input.operationId, role), { assetId, assetVersion: asset.version, materialId: asset.defaultMaterialId, materialVersion: 1 }, asset.defaultSize, { x: 0, z: 0, yaw: 0 });
    additions.push(next); return next;
  };
  const sofa = choose('prototype-sofa', 'sofa'), desk = choose('prototype-study-desk', 'desk'), chair = choose('prototype-reading-chair', 'chair');
  const originPreserved = /原位|不移动|不要移动|保持位置|不变/u.test([...chain.map(item => item.text), ...hard.map(r => r.content)].join('\n'));
  // Preserve every existing pose when the requested subset cannot be safely inferred. This is
  // stricter than preserving the physical object; ordinary “保留家具” still permits rearrangement.
  const preservePoseIds = [...new Set([...state.currentLayout.lockedObjectIds, ...(originPreserved ? original.map(o => o.id) : [])])];
  const context: PlannerContext = { version: PLANNER_VERSION, roomId: decision.roomId, sofaId: sofa.id, deskId: desk.id, chairId: chair.id,
    preservePoseIds, requirementIds: hard.map(r => r.id), inputIds: sourceInputIds, intentVersion: brief.intentVersion };
  const all = [...original, ...additions], moving = new Set([sofa.id, desk.id, chair.id]);
  const stable = all.filter(o => !moving.has(o.id));
  const maxNodes = bound(input.limits?.maxNodes, PLAN_LIMITS.maxNodes), maxCandidates = bound(input.limits?.maxCandidates, PLAN_LIMITS.maxCandidates), maxMs = bound(input.limits?.maxMs, PLAN_LIMITS.maxMs);
  const exhausted = () => report.metrics.nodes >= maxNodes || report.metrics.candidatesChecked >= maxCandidates || performance.now() - started >= maxMs;
  // Reuse only still-valid geometry. Recalculate every check against the current project and
  // intent; candidate creation below always issues a new ID/check, never old user selection.
  if (input.seedObjects?.length && !exhausted()) {
    report.metrics.candidatesChecked++;
    const objects = structuredClone(input.seedObjects);
    const functionCheck = inspectPlannerLayout(state, objects, context), geometry = inspectLayout(state, objects);
    report.checks = [...geometry.checks, ...functionCheck.checks].map(c => ({ code: c.code,
      status: c.status === 'not-checked' || c.status === 'not-applicable' ? 'not_checked' : c.status,
      detail: [...geometry.issues, ...functionCheck.issues].filter(i => i.code.toLowerCase() === c.code.toLowerCase()).map(i => i.message).join('；') }));
    if (hasLayoutChange(state, objects) && geometry.adoptable && functionCheck.adoptable) {
      report.objects = objects;
      if (input.seedCandidate) report.source.reusedFromCandidate = input.seedCandidate;
      report.requirements = report.requirements.map(r => ({ ...r, status: 'satisfied', evidence: '在当前项目和最新要求下重新检查了已有实物、原位条件、功能家具和入口通道。' }));
      return finish('沿用仍有效的候选几何，并按最新要求重新检查；这是新的待选择候选，尚未采用。', 'recommended', context);
    }
    report.metrics.correctionAttempts++;
  }
  const poses = (object: Object3D) => {
    if (preservePoseIds.includes(object.id)) return [structuredClone(object)];
    const results: Object3D[] = [];
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const width = Math.abs(Math.cos(yaw)) * object.size.width + Math.abs(Math.sin(yaw)) * object.size.depth;
      const depth = Math.abs(Math.sin(yaw)) * object.size.width + Math.abs(Math.cos(yaw)) * object.size.depth;
      const x0 = room.x0 + width / 2 + .12, x1 = room.x1 - width / 2 - .12, z0 = room.z0 + depth / 2 + .12, z1 = room.z1 - depth / 2 - .12;
      const xs: number[] = [], zs: number[] = [];
      for (let x = x0; x <= x1 + 1e-8; x += PLAN_LIMITS.gridM) xs.push(x);
      for (let z = z0; z <= z1 + 1e-8; z += PLAN_LIMITS.gridM) zs.push(z);
      if (x1 >= x0) xs.push(x1); if (z1 >= z0) zs.push(z1);
      for (const x of xs) for (const z of zs) results.push({ ...object, position: { ...object.position, x, z }, yaw });
    }
    const score = (o: Object3D) => { const f = forward(o, 1); const towards = Math.hypot(f.x - (room.x0 + room.x1) / 2, f.z - (room.z0 + room.z1) / 2);
      return Math.min(o.position.x - room.x0, room.x1 - o.position.x, o.position.z - room.z0, room.z1 - o.position.z) + towards * .15; };
    return results.sort((a, b) => score(a) - score(b));
  };
  const box = (o: Object3D) => { const ring = footprint(o)[0]; return { x0: Math.min(...ring.map(p => p[0])), x1: Math.max(...ring.map(p => p[0])), z0: Math.min(...ring.map(p => p[1])), z1: Math.max(...ring.map(p => p[1])) }; };
  const quickValid = (objects: Object3D[]) => {
    const boxes = [...state.fixedFacts.objects, ...objects].map(o => ({ ...box(o), id: o.id }));
    for (const o of objects) { const b = box(o);
      if (b.x0 < room.x0 + .1 || b.x1 > room.x1 - .1 || b.z0 < room.z0 + .1 || b.z1 > room.z1 - .1) return false;
      if (boxes.some(a => a.id !== o.id && b.x0 < a.x1 && b.x1 > a.x0 && b.z0 < a.z1 && b.z1 > a.z0)) return false;
    } return true;
  };
  // Search a finite two-zone product. All other objects stay intact. The work chair is coupled
  // geometrically to the desk, not placed at a fixture-specific coordinate.
  const deskPoses = poses(desk), sofaPoses = poses(sofa);
  outer: for (const s of sofaPoses) {
    if (exhausted()) break;
    report.metrics.nodes++;
    if (!quickValid([...stable, s])) continue;
    for (const d of deskPoses) {
      if (exhausted()) break outer;
      report.metrics.nodes++;
      const chairPosition = forward(d, d.size.depth / 2 + .15 + chair.size.depth / 2);
      const c = { ...chair, position: { ...chair.position, ...chairPosition }, yaw: d.yaw > 0 ? d.yaw - Math.PI : d.yaw + Math.PI };
      if (preservePoseIds.includes(chair.id) && hash(c) !== hash(chair)) continue;
      const objects = [...stable, s, d, c];
      if (!quickValid(objects) || !hasLayoutChange(state, objects)) continue;
      // Fast conservative route test before expensive complete geometry. Both count as an
      // attempted final candidate; failures consume the finite correction allowance.
      report.metrics.candidatesChecked++; report.metrics.correctionAttempts = report.metrics.candidatesChecked - 1;
      const functionCheck = inspectPlannerLayout(state, objects, context), geometry = inspectLayout(state, objects);
      report.checks = [...geometry.checks, ...functionCheck.checks].map(c => ({ code: c.code, status: c.status === 'not-checked' || c.status === 'not-applicable' ? 'not_checked' : c.status, detail: [...geometry.issues, ...functionCheck.issues].filter(i => i.code.toLowerCase() === c.code.toLowerCase()).map(i => i.message).join('；') }));
      if (geometry.adoptable && functionCheck.adoptable) {
        report.objects = objects;
        report.requirements = report.requirements.map(r => ({ ...r, status: 'satisfied', evidence: '既有家具身份与尺寸保留；功能家具、原位条件及入口到使用区通道均经确定性检查。' }));
        return finish('已生成一个会客与办公布局候选，保留既有实物和固定事实；尚未采用。', 'recommended', context);
      }
    }
  }
  report.metrics.exhausted = exhausted();
  report.requirements = report.requirements.map(r => ({ ...r, status: 'not_checked', evidence: '有限搜索未得到同时通过全部检查的布局，不能声明满足。' }));
  return finish('有限搜索未找到通过全部功能、空间与通道检查的布局；没有生成假合格候选，也没有缩小或删除实物。', 'not_found', context);
}
