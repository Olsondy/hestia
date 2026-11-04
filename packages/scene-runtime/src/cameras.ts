import { effectiveLevels, levelOf, type SceneView } from '../../contracts/src/building';
import type { SceneSnapshot } from './snapshot';
import { inside, isOutdoorRoom } from './architecture';

/**
 * Preset shots shared by the H5 result page and background stills. Viewing is one storey at a time: each storey has
 * an overview (that storey only, seen from above, reframed to the model and canvas aspect when applied) and eye-level
 * interior shots that load only their own storey. Interior shots use a horizontal field of view so phones in portrait
 * and landscape stills frame the same room. There is no whole-building view: customers look at one floor's finishes.
 */
export type CameraPreset =
  | { id: string; name: string; kind: 'aerial'; view: SceneView; direction: [number, number, number] }
  | { id: string; name: string; kind: 'interior'; view: SceneView; position: [number, number, number]; target: [number, number, number]; horizontalFov: number; roomId: string };

const service = /卫|厕|浴|设备|储|车库|衣帽|洗衣|garage|bath|toilet|storage|utility/i;
const eye = 1.4, interiorFov = 78;

/**
 * The storey the interactive viewer shows: the one carrying most tiled floor finishes (the demo villa's ground floor),
 * otherwise the first. Customers look at one floor's soft furnishing and finishes, not a multi-storey model.
 */
export function mainLevelId(snapshot: SceneSnapshot) {
  const levels = effectiveLevels(snapshot), tiled = new Set(snapshot.surfaceDesign?.tilings.map(tiling => tiling.finishId) ?? []);
  const rooms = new Map(snapshot.rooms.map(room => [room.id, levelOf(room, levels)]));
  const weight = (levelId: string) => (snapshot.finishes ?? []).filter(finish => tiled.has(finish.id) && finish.kind === 'floor'
    && (finish.levelId ?? (finish.roomId ? rooms.get(finish.roomId) : undefined)) === levelId).length;
  return [...levels].sort((a, b) => weight(b.id) - weight(a.id))[0]?.id;
}

/** `levelId` limits the shots to one storey and drops the storey name from their labels. */
export function cameraPresets(snapshot: SceneSnapshot, levelId?: string): CameraPreset[] {
  const all = effectiveLevels(snapshot), presets: CameraPreset[] = [];
  const levels = levelId ? all.filter(level => level.id === levelId) : all;
  const many = !!snapshot.levels && levels.length > 1;
  const levelView = (id: string): SceneView => snapshot.levels ? { mode: 'level', levelId: id } : { mode: 'building' };
  levels.forEach((level, index) => {
    const name = many ? `${level.name ?? `${index + 1} 层`} · 全层` : '全层浏览';
    presets.push({ id: many ? `overview-${level.id}` : 'overview', name, kind: 'aerial', view: levelView(level.id), direction: [.55, 1.1, .8] });
  });
  for (const level of levels) {
    const rooms = snapshot.rooms.filter(room => levelOf(room, all) === level.id && room.name && !isOutdoorRoom(room) && !service.test(room.name));
    const stairRoom = rooms.find(room => /楼梯|stair/i.test(room.name!) && (snapshot.stairs ?? []).some(stair => stair.fromLevelId === level.id && inside(stair.position, room.outline)));
    const main = rooms.filter(room => room !== stairRoom).map(room => ({ room, area: area(room.outline) })).sort((a, b) => b.area - a.area)[0]?.room;
    for (const room of [main, stairRoom]) {
      if (!room) continue;
      const shot = interiorShot(snapshot, room, level.elevation, level.id, all, room === stairRoom);
      if (shot) presets.push({ id: `interior-${room.id}`, name: `${many && level.name ? `${level.name} · ` : ''}${room.name}`, kind: 'interior', view: levelView(level.id), ...shot, horizontalFov: interiorFov, roomId: room.id });
    }
  }
  return presets;
}

type Point = { x: number; z: number };
function area(points: Point[]) { return Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.z - q.x * p.z; }, 0) / 2); }

/** Stand in a convex corner, looking across the room at whatever is furnished; stair shots look at the stair. */
function interiorShot(snapshot: SceneSnapshot, room: SceneSnapshot['rooms'][number], elevation: number, levelId: string, levels: ReturnType<typeof effectiveLevels>, stair: boolean) {
  const outline = room.outline, n = outline.length;
  const furniture = snapshot.objects.filter(object => levelOf(object, levels) === levelId && inside(object.position, outline));
  const focus = stair ? (snapshot.stairs ?? []).filter(s => s.fromLevelId === levelId && inside(s.position, outline)).map(s => ({ x: s.position.x, z: s.position.z, weight: 6 }))
    : furniture.map(object => ({ x: object.position.x, z: object.position.z, weight: Math.min(4, object.size.width * object.size.depth + .3) }));
  const centre = outline.reduce((sum, p) => ({ x: sum.x + p.x / n, z: sum.z + p.z / n }), { x: 0, z: 0 });
  let best: { score: number; position: Point; target: Point } | undefined;
  outline.forEach((corner, i) => {
    const prev = outline[(i + n - 1) % n], next = outline[(i + 1) % n];
    const a = unit({ x: prev.x - corner.x, z: prev.z - corner.z }), b = unit({ x: next.x - corner.x, z: next.z - corner.z });
    const bisector = unit({ x: a.x + b.x, z: a.z + b.z });
    if (!Number.isFinite(bisector.x)) return;
    const position = { x: corner.x + bisector.x * .75, z: corner.z + bisector.z * .75 };
    if (!inside(position, outline)) return; // Reflex corner.
    if (furniture.some(o => Math.abs(o.position.x - position.x) < o.size.width / 2 + .3 && Math.abs(o.position.z - position.z) < o.size.depth / 2 + .3 && o.size.height > .3)) return;
    const points = focus.length ? focus : [{ ...centre, weight: 1 }];
    const total = points.reduce((sum, p) => sum + p.weight, 0);
    const target = points.reduce((sum, p) => ({ x: sum.x + p.x * p.weight / total, z: sum.z + p.z * p.weight / total }), { x: 0, z: 0 });
    const view = unit({ x: target.x - position.x, z: target.z - position.z }), half = interiorFov / 2 * Math.PI / 180;
    // Score: weighted furniture inside the horizontal field of view, plus depth of the view.
    let score = Math.hypot(target.x - position.x, target.z - position.z) * .6;
    for (const p of points) {
      const d = { x: p.x - position.x, z: p.z - position.z }, distance = Math.hypot(d.x, d.z);
      if (distance > .8 && Math.acos(Math.min(1, (d.x * view.x + d.z * view.z) / distance)) < half * .85) score += p.weight;
    }
    if (!best || score > best.score) best = { score, position, target };
  });
  if (!best) return undefined;
  const { position, target } = best, lift = stair ? .9 : -.25;
  return { position: [position.x, elevation + eye, position.z] as [number, number, number], target: [target.x, elevation + eye + lift, target.z] as [number, number, number] };
}
function unit(v: Point) { const l = Math.hypot(v.x, v.z); return { x: v.x / l, z: v.z / l }; }
