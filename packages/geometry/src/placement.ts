import polygonClipping, { type MultiPolygon, type Polygon, type Pair } from 'polygon-clipping';
import { sceneSnapshotSchema, type SceneSnapshot } from '../../contracts/src/scene';
import { openingClearanceSchema, type OpeningClearance } from '../../contracts/src/project';
import { furniturePoseSchema, type FurniturePose } from '../../contracts/src/commands';

// Explicit geometric tolerance, not a construction/measurement accuracy claim.
export const TOLERANCE = { insetM: .001, verticalM: .001, areaM2: 1e-8, arcOuterErrorM: .0005 } as const;
type Point = { x: number; z: number };
type Object3D = SceneSnapshot['objects'][number];
export type GeometryInput = Pick<SceneSnapshot, 'rooms' | 'walls' | 'objects'>;
export type PlacementIssue = { code: string; objectId: string; relatedObjectId?: string; message: string };
export type PlacementReport = { valid: boolean; issues: PlacementIssue[]; checks: { code: string; status: 'passed' | 'failed' | 'not-applicable' | 'not-checked' }[] };

/** Pure geometry: no renderer, project store, network, or persistence dependency. */
export function footprint(object: Object3D, inset = 0): Polygon {
  const w = object.size.width / 2 - inset, d = object.size.depth / 2 - inset;
  if (!(w > 0 && d > 0)) throw new Error('Footprint is smaller than the numerical inset.');
  const c = Math.cos(object.yaw), s = Math.sin(object.yaw);
  // Three +y rotation: x'=cos*x+sin*z; z'=-sin*x+cos*z.
  const ring: Pair[] = [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, z]) =>
    [object.position.x + x * c + z * s, object.position.z - x * s + z * c]);
  return [ring];
}
function ringArea(ring: Pair[]) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; area += a[0] * b[1] - b[0] * a[1]; }
  return area / 2;
}
function area(polygons: MultiPolygon) { return polygons.reduce((sum, polygon) => sum + Math.abs(ringArea(polygon[0])) - polygon.slice(1).reduce((n, r) => n + Math.abs(ringArea(r)), 0), 0); }
function intersects(a: Polygon, b: Polygon) { return area(polygonClipping.intersection(a, b)) > TOLERANCE.areaM2; }
function verticalOverlap(a: number, b: number, c: number, d: number) { return Math.min(b, d) - Math.max(a, c) > TOLERANCE.verticalM; }
function cross(a: Point, b: Point, c: Point) { return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x); }
function onSegment(a: Point, b: Point, p: Point) {
  return Math.abs(cross(a, b, p)) < 1e-10 && p.x >= Math.min(a.x, b.x) - 1e-10 && p.x <= Math.max(a.x, b.x) + 1e-10 && p.z >= Math.min(a.z, b.z) - 1e-10 && p.z <= Math.max(a.z, b.z) + 1e-10;
}
function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
    || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
function simpleOutline(points: Point[]) {
  if (Math.abs(ringArea(points.map(p => [p.x, p.z]))) <= TOLERANCE.areaM2) return false;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 1e-8) return false;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (segmentsIntersect(a, b, points[j], points[(j + 1) % points.length])) return false;
    }
  }
  return true;
}
function wallStrip(wall: SceneSnapshot['walls'][number], from: number, to: number): Polygon {
  const length = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z), dx = (wall.b.x - wall.a.x) / length, dz = (wall.b.z - wall.a.z) / length;
  const p = (along: number, across: number): Pair => [wall.a.x + dx * along - dz * across, wall.a.z + dz * along + dx * across];
  return [[p(from, -wall.thickness / 2), p(to, -wall.thickness / 2), p(to, wall.thickness / 2), p(from, wall.thickness / 2)]];
}
/** Circumscribed arc polygon: never misses the true sector; maximum excess <= 0.5mm. */
function sector(center: Point, radius: number, start: number, sweep: number): Polygon {
  const maxStep = Math.min(Math.PI / 18, 2 * Math.acos(radius / (radius + TOLERANCE.arcOuterErrorM)));
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / maxStep)), step = sweep / count;
  const p = (angle: number, r: number): Pair => [center.x + Math.cos(angle) * r, center.z + Math.sin(angle) * r];
  const ring: Pair[] = [[center.x, center.z], p(start, radius)];
  for (let i = 0; i < count; i++) ring.push(p(start + (i + .5) * step, radius / Math.cos(step / 2)));
  ring.push(p(start + sweep, radius)); return [ring];
}

export function validatePlacement(input: GeometryInput, objectId: string, pose: FurniturePose, clearances: OpeningClearance[] = []): PlacementReport {
  const issues: PlacementIssue[] = [];
  const checks: PlacementReport['checks'] = [];
  const issue = (code: string, message: string, relatedObjectId?: string) => issues.push({ code, objectId, ...(relatedObjectId ? { relatedObjectId } : {}), message });
  const parse = sceneSnapshotSchema.safeParse({ version: 1, unit: 'm', plane: 'xz', label: 'Geometry input', synthetic: false, ...input });
  const parsedPose = furniturePoseSchema.safeParse(pose);
  const parsedClearances = openingClearanceSchema.array().max(1000).safeParse(clearances);
  if (!parse.success || !parsedPose.success || !parsedClearances.success) {
    issue('INVALID_GEOMETRY', '空间或坐标数据无效，无法校验。'); return { valid: false, issues, checks: [{ code: 'input', status: 'failed' }] };
  }
  const scene = parse.data, original = scene.objects.find(o => o.id === objectId);
  if (!original || original.kind !== 'furniture') {
    issue('NOT_MOVABLE', '只能修改可移动家具。'); return { valid: false, issues, checks: [{ code: 'input', status: 'failed' }] };
  }
  const target = { ...original, position: { ...original.position, x: pose.x, z: pose.z }, yaw: pose.yaw };
  const bottom = target.position.y, top = bottom + target.size.height;
  if (target.size.width <= 2 * TOLERANCE.insetM || target.size.depth <= 2 * TOLERANCE.insetM || bottom < -TOLERANCE.verticalM) {
    issue('INVALID_GEOMETRY', '家具尺寸或高程不适用于当前摆放校验。'); return { valid: false, issues, checks: [{ code: 'input', status: 'failed' }] };
  }
  const floorOpenings = new Set(scene.walls.flatMap(w => w.openings.filter(o => o.sill <= TOLERANCE.verticalM).map(o => o.id)));
  if (new Set(clearances.map(c => c.openingId)).size !== clearances.length || clearances.some(c => !floorOpenings.has(c.openingId))) {
    issue('INVALID_GEOMETRY', '门扇信息必须引用唯一的落地开口。'); return { valid: false, issues, checks: [{ code: 'input', status: 'failed' }] };
  }
  for (const room of scene.rooms) if (!simpleOutline(room.outline)) issue('INVALID_ROOM_OUTLINE', '房间轮廓退化或自相交。', room.id);
  if (!scene.rooms.length) issue('MISSING_BOUNDARY', '没有可校验的空间边界。');
  if (issues.length) return { valid: false, issues, checks: [{ code: 'boundary', status: 'failed' }] };
  try {
    const shape = footprint(target, TOLERANCE.insetM);
    const roomPolygons: Polygon[] = scene.rooms.map(r => [r.outline.map(p => [p.x, p.z])]);
    const roomUnion = polygonClipping.union(roomPolygons[0], ...roomPolygons.slice(1));
    if (area(polygonClipping.difference(shape, roomUnion)) > TOLERANCE.areaM2) issue('OUT_OF_BOUNDS', '家具旋转后的占地超出空间边界或进入凹口。');
    checks.push({ code: 'boundary', status: issues.length ? 'failed' : 'passed' });
    for (const other of scene.objects) {
      if (other.id === objectId || !verticalOverlap(bottom, top, other.position.y, other.position.y + other.size.height)) continue;
      if (intersects(shape, footprint(other))) issue(other.kind === 'fixed' ? 'FIXED_COLLISION' : 'FURNITURE_COLLISION', other.kind === 'fixed' ? '家具与固定设施相撞。' : '家具与另一件家具相撞。', other.id);
    }
    checks.push({ code: 'objects', status: issues.some(i => i.code.endsWith('_COLLISION')) ? 'failed' : 'passed' });
    let applicableDoors = 0, unknownDoors = 0;
    for (const wall of scene.walls) {
      const length = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
      const openings = [...wall.openings].sort((a, b) => a.offset - b.offset);
      let cursor = 0, collided = false;
      for (const opening of openings) {
        if (opening.offset > cursor && verticalOverlap(bottom, top, 0, wall.height) && intersects(shape, wallStrip(wall, cursor, opening.offset))) collided = true;
        // An opening only clears the vertical interval [sill, head]; the sill and lintel remain solid.
        if ((verticalOverlap(bottom, top, 0, opening.sill) || verticalOverlap(bottom, top, opening.head, wall.height)) && intersects(shape, wallStrip(wall, opening.offset, opening.offset + opening.width))) collided = true;
        cursor = opening.offset + opening.width;
        if (opening.sill > TOLERANCE.verticalM || !verticalOverlap(bottom, top, 0, opening.head)) continue;
        const clearance = clearances.find(c => c.openingId === opening.id);
        if (clearance?.kind === 'none') continue;
        applicableDoors++;
        const dx = (wall.b.x - wall.a.x) / length, dz = (wall.b.z - wall.a.z) / length;
        const at = (distance: number) => ({ x: wall.a.x + dx * distance, z: wall.a.z + dz * distance });
        if (clearance?.kind === 'swing') {
          const endHinge = clearance.hinge === 'end', direction = Math.atan2(dz, dx) + (endHinge ? Math.PI : 0);
          const hinge = at(opening.offset + (endHinge ? opening.width : 0));
          if (intersects(shape, sector(hinge, opening.width, direction, (endHinge ? -1 : 1) * clearance.side * clearance.angle)))
            issue('DOOR_SWING_COLLISION', '家具占用了已确认的门扇开启区域。', opening.id);
        } else {
          unknownDoors++;
          // Unknown hinge/side/type: use both possible hinge disks as a conservative exclusion envelope.
          // This is an information restriction, never a claim that an actual door was measured here.
          const hinges = [at(opening.offset), at(opening.offset + opening.width)];
          if (hinges.some(hinge => [1, -1].some(sign => intersects(shape, sector(hinge, opening.width, 0, sign * Math.PI)))))
            issue('DOOR_CLEARANCE_UNKNOWN', '此落地开口的门型或开向未确认，附近暂不能判断可放置。', opening.id);
        }
      }
      if (cursor < length && verticalOverlap(bottom, top, 0, wall.height) && intersects(shape, wallStrip(wall, cursor, length))) collided = true;
      if (collided) issue('WALL_COLLISION', '家具与墙实体、窗台或门窗上方实体相撞。', wall.id);
    }
    checks.push({ code: 'walls', status: issues.some(i => i.code === 'WALL_COLLISION') ? 'failed' : 'passed' });
    checks.push({ code: 'door-clearances', status: issues.some(i => i.code.startsWith('DOOR_')) ? 'failed' : unknownDoors ? 'not-checked' : applicableDoors ? 'passed' : 'not-applicable' });
  } catch {
    issue('GEOMETRY_CHECK_FAILED', '几何运算未能完成，未采用这次修改。');
  }
  return { valid: issues.length === 0, issues, checks };
}
