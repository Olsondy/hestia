import type { SpatialState } from '../../contracts/src/project';
import type { CandidateCheck } from '../../contracts/src/candidates';
import { footprint } from '../../geometry/src/placement';
import { hash } from '../../candidates/src/checks';
import { PLAN_LIMITS, type PlannerContext } from './contract';

type Object3D = SpatialState['currentLayout']['objects'][number];
type Point = { x: number; z: number };
export function rectangle(state: SpatialState, roomId: string) {
  if (state.fixedFacts.rooms.length !== 1 || state.fixedFacts.rooms[0].id !== roomId) return null;
  const p = state.fixedFacts.rooms[0].outline;
  if (p.length !== 4 || p.some((a, i) => { const b = p[(i + 1) % 4]; return Math.abs(a.x - b.x) > 1e-8 && Math.abs(a.z - b.z) > 1e-8; })) return null;
  const x0 = Math.min(...p.map(v => v.x)), x1 = Math.max(...p.map(v => v.x)), z0 = Math.min(...p.map(v => v.z)), z1 = Math.max(...p.map(v => v.z));
  if (x1 - x0 < 1 || z1 - z0 < 1 || x1 - x0 > 20 || z1 - z0 > 20) return null;
  // Four axis-aligned edges alone can also describe a repeated/degenerate ring.
  // Require each distinct corner of the envelope before using a rectangular route grid.
  if (new Set(p.map(v => `${v.x}:${v.z}`)).size !== 4 || p.some(v =>
    ![x0, x1].some(x => Math.abs(v.x - x) < 1e-8) || ![z0, z1].some(z => Math.abs(v.z - z) < 1e-8))) return null;
  // No unsupported interior walls, diagonal walls or openings detached from the room envelope.
  const inside = (v: Point) => v.x >= x0 - 1e-8 && v.x <= x1 + 1e-8 && v.z >= z0 - 1e-8 && v.z <= z1 + 1e-8;
  if (state.fixedFacts.walls.some(w => !inside(w.a) || !inside(w.b) || Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) < 1e-8 || !((Math.abs(w.a.x - w.b.x) < 1e-8 && [x0, x1].some(x => Math.abs(w.a.x - x) < 1e-8))
    || (Math.abs(w.a.z - w.b.z) < 1e-8 && [z0, z1].some(z => Math.abs(w.a.z - z) < 1e-8))))) return null;
  return { x0, x1, z0, z1 };
}
const aabb = (object: Object3D) => { const ring = footprint(object)[0]; return {
  x0: Math.min(...ring.map(p => p[0])), x1: Math.max(...ring.map(p => p[0])), z0: Math.min(...ring.map(p => p[1])), z1: Math.max(...ring.map(p => p[1])) }; };
export function forward(object: Object3D, distance: number): Point {
  return { x: object.position.x + Math.sin(object.yaw) * distance, z: object.position.z + Math.cos(object.yaw) * distance };
}
/** A conservative 0.7m square swept along grid edges. AABB enlargement can reject usable
 * diagonal gaps, but cannot claim a narrower gap passes. This is not accessibility certification. */
export function inspectPlannerLayout(base: SpatialState, objects: Object3D[], context: PlannerContext): Pick<CandidateCheck, 'adoptable' | 'checks' | 'issues'> {
  const checks: CandidateCheck['checks'] = [], issues: CandidateCheck['issues'] = [];
  const add = (code: string, passed: boolean, message: string) => { checks.push({ code, status: passed ? 'passed' : 'failed', required: true }); if (!passed) issues.push({ code: code.toUpperCase(), message }); };
  const room = rectangle(base, context.roomId);
  if (!room) return { adoptable: false, checks: [{ code: 'planner-room', status: 'not-checked', required: true }], issues: [{ code: 'PLANNER_ROOM_UNSUPPORTED', message: '当前仅检查单个矩形房间，无通道结论。' }] };
  const existingPreserved = base.currentLayout.objects.every(old => {
    const next = objects.find(o => o.id === old.id);
    const immutable = (o: Object3D) => ({ ...o, position: { ...o.position, x: 0, z: 0 }, yaw: 0 });
    return next && hash(immutable(old)) === hash(immutable(next));
  });
  add('planner-retained-objects', existingPreserved, '已有家具被删除、换件或缩小，不能作为原需求推荐。');
  add('planner-preserved-poses', context.preservePoseIds.every(id => hash(objects.find(o => o.id === id)) === hash(base.currentLayout.objects.find(o => o.id === id))), '原位保留对象发生变化。');
  const sofa = objects.find(o => o.id === context.sofaId), desk = objects.find(o => o.id === context.deskId), chair = objects.find(o => o.id === context.chairId);
  const roles = sofa?.catalog?.assetId === 'prototype-sofa' && desk?.catalog?.assetId === 'prototype-study-desk' && chair?.catalog?.assetId === 'prototype-reading-chair';
  add('planner-functional-assets', !!roles, '会客与办公功能需要已识别的沙发、工作桌和座椅。');
  if (!roles || !sofa || !desk || !chair) return { adoptable: false, checks, issues };
  const expectedChair = forward(desk, desk.size.depth / 2 + .15 + chair.size.depth / 2);
  add('planner-workstation', Math.hypot(chair.position.x - expectedChair.x, chair.position.z - expectedChair.z) < .01
    && Math.abs(Math.cos(chair.yaw - desk.yaw) + 1) < .001, '工作桌与座椅的使用关系不符合本次有限规划。');
  const obstacles = [...base.fixedFacts.objects, ...objects].map(aabb), half = PLAN_LIMITS.aisleM / 2;
  const freeSegment = (a: Point, b: Point) => {
    const swept = { x0: Math.min(a.x, b.x) - half, x1: Math.max(a.x, b.x) + half, z0: Math.min(a.z, b.z) - half, z1: Math.max(a.z, b.z) + half };
    return swept.x0 >= room.x0 - 1e-8 && swept.x1 <= room.x1 + 1e-8 && swept.z0 >= room.z0 - 1e-8 && swept.z1 <= room.z1 + 1e-8
      && !obstacles.some(o => swept.x0 < o.x1 - 1e-8 && swept.x1 > o.x0 + 1e-8 && swept.z0 < o.z1 - 1e-8 && swept.z1 > o.z0 + 1e-8);
  };
  const entrances: Point[] = [];
  for (const w of base.fixedFacts.walls) for (const o of w.openings.filter(o => o.sill <= .001 && o.width >= PLAN_LIMITS.aisleM)) {
    const length = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z), t = (o.offset + o.width / 2) / length;
    const center = { x: w.a.x + (w.b.x - w.a.x) * t, z: w.a.z + (w.b.z - w.a.z) * t };
    const p = { x: Math.min(room.x1 - half - .02, Math.max(room.x0 + half + .02, center.x)), z: Math.min(room.z1 - half - .02, Math.max(room.z0 + half + .02, center.z)) };
    // Boundary approach only: the opening width and known door sweep are checked separately.
    if (freeSegment(p, p)) entrances.push(p);
  }
  const step = PLAN_LIMITS.gridM, nx = Math.floor((room.x1 - room.x0 - 2 * half) / step) + 1, nz = Math.floor((room.z1 - room.z0 - 2 * half) / step) + 1;
  const point = (i: number): Point => ({ x: room.x0 + half + (i % nx) * step, z: room.z0 + half + Math.floor(i / nx) * step });
  const nodes = Array.from({ length: nx * nz }, (_, i) => point(i)), free = nodes.map(p => freeSegment(p, p));
  const reachable = new Set<number>(), queue: number[] = [];
  for (let i = 0; i < nodes.length; i++) if (free[i] && entrances.some(p => Math.hypot(p.x - nodes[i].x, p.z - nodes[i].z) <= step * 1.5 && freeSegment(p, nodes[i]))) { reachable.add(i); queue.push(i); }
  for (let n = 0; n < queue.length; n++) { const i = queue[n], x = i % nx, z = Math.floor(i / nx);
    for (const next of [x > 0 ? i - 1 : -1, x < nx - 1 ? i + 1 : -1, z > 0 ? i - nx : -1, z < nz - 1 ? i + nx : -1])
      if (next >= 0 && free[next] && !reachable.has(next) && freeSegment(nodes[i], nodes[next])) { reachable.add(next); queue.push(next); }
  }
  const targets = [forward(sofa, sofa.size.depth / 2 + half + .06), forward(desk, desk.size.depth / 2 + .15 + chair.size.depth + half + .06)];
  const accessible = targets.every(target => freeSegment(target, target) && [...reachable].some(i => Math.hypot(nodes[i].x - target.x, nodes[i].z - target.z) <= step * 1.5 && freeSegment(nodes[i], target)));
  add('planner-entry-functional-route-0.7m', entrances.length > 0 && accessible, '有限网格未证明入口到沙发前与工作椅后的 0.7m 连续通道；不推荐为已满足功能。');
  checks.push({ code: 'ergonomics-accessibility-certification', status: 'not-checked', required: false });
  return { adoptable: issues.length === 0, checks, issues };
}
