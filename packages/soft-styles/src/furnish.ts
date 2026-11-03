import type { SceneSnapshot } from '../../contracts/src/scene';
import { roomTypesOf, type RoomType, type SoftExtra, type SoftStyle } from '../../contracts/src/soft-styles';

// 按软装风格布置家具（K01）：按楼层与房间类型，在原家具占地内换成本风格款式并上色，再按规则补充陈设。
// 补充的陈设逐件校验：落在房间内、不与其他家具重叠、不挡门（门洞两侧各留通行区）、不压楼梯；挂画避开门窗。
// 纯函数：输入场景，输出新的物品列表与没能放下的陈设，不改动墙、门窗、楼梯与饰面。

type Scene = Pick<SceneSnapshot, 'rooms' | 'walls' | 'objects' | 'stairs' | 'levels'>;
type Obj = SceneSnapshot['objects'][number];
type P = { x: number; z: number };
export const EXTRA_PREFIX = 'soft-';
const DOOR_CLEARANCE = .8, GAP = .12;

const levelOf = (scene: Scene, item: { levelId?: string }) => item.levelId ?? scene.levels?.[0]?.id ?? '';
function inside(p: P, poly: P[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    if ((poly[i].z > p.z) !== (poly[j].z > p.z) && p.x < (poly[j].x - poly[i].x) * (p.z - poly[i].z) / (poly[j].z - poly[i].z) + poly[i].x) hit = !hit;
  return hit;
}
/** Plan rectangle as corners (x along width, z along depth, rotated by yaw). */
function corners(c: P, width: number, depth: number, yaw: number): P[] {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
    const x = u * width / 2, z = v * depth / 2;
    return { x: c.x + x * cos + z * sin, z: c.z - x * sin + z * cos };
  });
}
/** Separating-axis test for two convex quads; touching is not overlap. */
function overlap(a: P[], b: P[]) {
  for (const poly of [a, b]) for (let i = 0; i < 4; i++) {
    const p = poly[i], q = poly[(i + 1) % 4], ax = { x: q.z - p.z, z: p.x - q.x };
    const project = (pts: P[]) => pts.map(t => t.x * ax.x + t.z * ax.z);
    const pa = project(a), pb = project(b);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6) return false;
  }
  return true;
}
const footprint = (o: Pick<Obj, 'position' | 'size' | 'yaw'>) => corners(o.position, o.size.width, o.size.depth, o.yaw);
/** Things on the floor that furniture must not overlap: not rugs, not wall art, not hanging lamps. */
const onFloor = (o: Obj) => o.position.y < .3 && o.size.height > .05 && !/^(rug|wallArt)$/.test(o.name ?? '');
const local = (o: Pick<Obj, 'position' | 'yaw'>, x: number, z: number): P =>
  ({ x: o.position.x + x * Math.cos(o.yaw) + z * Math.sin(o.yaw), z: o.position.z - x * Math.sin(o.yaw) + z * Math.cos(o.yaw) });

/** Door clearance zones (both sides of every floor-level opening) and opening spans (for wall art), per level. */
function openingZones(scene: Scene, level: string) {
  return scene.walls.filter(w => levelOf(scene, w) === level).flatMap(wall => {
    const len = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z) || 1, ux = (wall.b.x - wall.a.x) / len, uz = (wall.b.z - wall.a.z) / len;
    const yaw = Math.atan2(uz, ux) * -1;
    return wall.openings.map(o => {
      const mid = o.offset + o.width / 2, c = { x: wall.a.x + ux * mid, z: wall.a.z + uz * mid };
      const door = o.sill <= .05;
      return { door, zone: corners(c, o.width + .1, door ? DOOR_CLEARANCE * 2 + wall.thickness : wall.thickness + .3, yaw) };
    });
  });
}
function stairZones(scene: Scene, level: string) {
  return (scene.stairs ?? []).filter(s => s.fromLevelId === level || s.toLevelId === level)
    .map(s => corners(s.position, s.width + .2, s.depth + .2, s.yaw));
}

export type Skipped = { roomId: string; key: string; reason: string };
/** Undo a previous style: drop its extras, restore swapped keys, clear tones. */
export function unfurnish(objects: Obj[]): Obj[] {
  return objects.filter(o => !o.id.startsWith(EXTRA_PREFIX)).map(({ softStyle, tones: _tones, ...o }) => ({ ...o, ...(softStyle?.base ? { name: softStyle.base } : {}) }));
}

export function furnish(scene: Scene, style: SoftStyle): { objects: Obj[]; skipped: Skipped[] } {
  const ref = { styleId: style.id, styleVersion: style.version };
  const base = unfurnish(scene.objects), skipped: Skipped[] = [];
  const roomOf = (o: Obj) => scene.rooms.find(r => levelOf(scene, r) === levelOf(scene, o) && inside(o.position, r.outline));
  // 1 Swap and tone the furniture of typed rooms, in place.
  let objects: Obj[] = base.map(o => {
    const room = roomOf(o), types = roomTypesOf(room?.name);
    if (!room || !types.length || o.position.y > 1.5 && o.name !== 'chandelier') return o;
    const target = types.map(t => style.swap[t]?.[o.name ?? '']).find(Boolean);
    return { ...o, ...(target ? { name: target } : {}), softStyle: { ...ref, ...(target ? { base: o.name } : {}) }, tones: style.tones };
  });
  // 2 Extras per typed room, each checked against everything placed so far.
  for (const room of scene.rooms) {
    const types = roomTypesOf(room.name);
    if (!types.length) continue;
    const level = levelOf(scene, room), height = scene.levels?.find(l => l.id === level)?.height ?? 2.8;
    const zones = openingZones(scene, level), stairs = stairZones(scene, level);
    const inRoom = (o: Obj) => levelOf(scene, o) === level && inside(o.position, room.outline);
    const extras = types.flatMap(t => (style.extras[t] ?? []).map(extra => ({ extra, type: t })));
    for (const [n, { extra, type }] of extras.entries()) {
      const id = `${EXTRA_PREFIX}${room.id}-${type}-${n}-${extra.key}`;
      const candidates = place(extra, objects.filter(inRoom), room.outline, height, scene.walls.filter(w => levelOf(scene, w) === level));
      if (!candidates.length) continue; // the anchor furniture is not in this room: the extra does not apply
      const placed = candidates
        .map(at => ({ id, levelId: room.levelId, kind: 'fixed' as const, name: extra.key, color: style.tones.accent, softStyle: ref, tones: style.tones,
          position: { x: at.x, y: at.y, z: at.z }, size: { width: extra.width, height: extra.height, depth: extra.depth }, yaw: at.yaw }))
        .find(candidate => fits(candidate, extra, room.outline, objects.filter(o => levelOf(scene, o) === level), zones, stairs));
      if (placed) objects = [...objects, placed];
      else skipped.push({ roomId: room.id, key: extra.key, reason: '没有不挡门窗、不压楼梯又不与家具重叠的位置' });
    }
  }
  return { objects, skipped };
}

type At = P & { y: number; yaw: number };
/** Distance from `p` along `dir` to the near face of a wall roughly parallel to the anchor's back, or null. */
function faceBehind(wall: Scene['walls'][number], p: P, dir: P): number | null {
  const ex = wall.b.x - wall.a.x, ez = wall.b.z - wall.a.z, len = Math.hypot(ex, ez) || 1, nx = -ez / len, nz = ex / len;
  const facing = dir.x * nx + dir.z * nz;
  if (Math.abs(facing) < .95) return null;
  const dist = ((wall.a.x - p.x) * nx + (wall.a.z - p.z) * nz) / facing - wall.thickness / 2;
  const along = ((p.x - wall.a.x) * ex + (p.z - wall.a.z) * ez) / len;
  return dist >= -.05 && along > .3 && along < len - .3 ? Math.max(0, dist) : null;
}
function place(extra: SoftExtra, roomObjects: Obj[], outline: P[], height: number, walls: Scene['walls']): At[] {
  // `bed` also matches sized keys (bed15, bed18); a swapped piece is found by its original key too.
  const matches = (k: string | undefined) => !!k && !!extra.anchor && new RegExp(`^${extra.anchor}\\d*$`).test(k);
  const anchors = roomObjects.filter(o => matches(o.name) || matches(o.softStyle?.base));
  if (extra.place === 'corner') {
    const xs = outline.map(p => p.x), zs = outline.map(p => p.z), inset = (v: number) => v / 2 + .15;
    const [x0, x1, z0, z1] = [Math.min(...xs) + inset(extra.width), Math.max(...xs) - inset(extra.width), Math.min(...zs) + inset(extra.depth), Math.max(...zs) - inset(extra.depth)];
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => ({ x, z, y: 0, yaw: 0 }));
  }
  if (extra.place === 'wall' && anchors.length) {
    // Behind the anchor first; when that wall has a window or door there, another wall of the room.
    return [...anchors.flatMap(a => anchored(a)), ...roomWalls(extra, outline, walls)];
  }
  return anchors.flatMap(a => anchored(a));
  function anchored(a: Obj): At[] {
    if (extra.place === 'beside') {
      const sides = [1, -1].map(side => ({ ...local(a, side * (a.size.width / 2 + extra.width / 2 + GAP), -a.size.depth / 2 + extra.depth / 2), y: 0, yaw: a.yaw }));
      // Chairs may also stand in front of or behind the anchor (a table), facing it.
      const faces = /Chair$/.test(extra.key) ? [1, -1].map(side => ({ ...local(a, 0, side * (a.size.depth / 2 + extra.depth / 2 + GAP)), y: 0, yaw: a.yaw + (side > 0 ? Math.PI : 0) })) : [];
      return [...sides, ...faces];
    }
    if (extra.place === 'wall') {
      // Hang on a real wall face right behind the anchor (furniture backed against it), never in the air.
      const back = local(a, 0, -a.size.depth / 2), dir = { x: back.x - a.position.x, z: back.z - a.position.z }, n = Math.hypot(dir.x, dir.z) || 1;
      const wall = walls.map(w => ({ w, hit: faceBehind(w, back, { x: dir.x / n, z: dir.z / n }) })).filter(x => x.hit !== null && x.hit < .35).sort((x, y) => x.hit! - y.hit!)[0];
      if (!wall) return [];
      const t = wall.hit! + .005 + extra.depth / 2;
      return [{ x: back.x + dir.x / n * t, z: back.z + dir.z / n * t, y: Math.max(a.size.height + .3, 1.05), yaw: a.yaw }];
    }
    return [{ ...local(a, 0, 0), y: Math.max(height - extra.height - .02, 2.1), yaw: a.yaw }];
  }
}
/** Wall art fallback: points along the room's walls, on the inner face, facing into the room. */
function roomWalls(extra: SoftExtra, outline: P[], walls: Scene['walls']): At[] {
  const c = outline.reduce((sum, p) => ({ x: sum.x + p.x / outline.length, z: sum.z + p.z / outline.length }), { x: 0, z: 0 });
  return walls.flatMap(w => {
    const ex = w.b.x - w.a.x, ez = w.b.z - w.a.z, len = Math.hypot(ex, ez);
    if (len < extra.width + .6) return [];
    let nx = -ez / len, nz = ex / len;
    if ((c.x - w.a.x) * nx + (c.z - w.a.z) * nz < 0) { nx = -nx; nz = -nz; }
    const off = w.thickness / 2 + .005 + extra.depth / 2;
    return [.5, .3, .7].map(t => ({ x: w.a.x + ex * t + nx * off, z: w.a.z + ez * t + nz * off, y: 1.3, yaw: Math.atan2(nx, nz) }))
      .filter(p => inside(p, outline));
  });
}
function fits(o: Obj, extra: SoftExtra, outline: P[], levelObjects: Obj[], zones: ReturnType<typeof openingZones>, stairs: P[][]) {
  const f = footprint(o);
  if (extra.place === 'above') return inside(o.position, outline);
  if (extra.place === 'wall') {
    const reach = corners(o.position, o.size.width + .1, .5, o.yaw);
    return inside(o.position, outline) && zones.every(z => !overlap(f, z.zone))
      && levelObjects.every(other => !(other.name === 'wallArt' && overlap(f, footprint(other))))
      && levelObjects.filter(other => onFloor(other) && other.position.y + other.size.height > o.position.y - .05).every(other => !overlap(reach, footprint(other)));
  }
  // A little air around extras (plant canopies and lamp shades are wider than their stems); tall pieces keep clear of windows too.
  const air = corners(o.position, o.size.width + .3, o.size.depth + .3, o.yaw), tall = o.size.height > .9;
  return f.every(p => inside(p, outline)) && levelObjects.filter(onFloor).every(other => !overlap(other.id.startsWith(EXTRA_PREFIX) ? air : f, footprint(other)))
    && zones.filter(z => z.door || tall).every(z => !overlap(f, z.zone)) && stairs.every(s => !overlap(f, s));
}

/** Problems of a furnished scene's extras, for tests and acceptance: outside room, overlapping, blocking doors or stairs. */
export function furnishingIssues(scene: Scene): string[] {
  const issues: string[] = [];
  for (const o of scene.objects.filter(item => item.id.startsWith(EXTRA_PREFIX))) {
    const level = levelOf(scene, o), f = footprint(o), room = scene.rooms.find(r => levelOf(scene, r) === level && inside(o.position, r.outline));
    if (!room) { issues.push(`${o.id} 不在任何房间内`); continue; }
    if (!onFloor(o)) continue;
    if (!f.every(p => inside(p, room.outline))) issues.push(`${o.id} 越出房间`);
    for (const other of scene.objects.filter(x => x.id !== o.id && levelOf(scene, x) === level && onFloor(x)))
      if (overlap(f, footprint(other))) issues.push(`${o.id} 与 ${other.id} 重叠`);
    if (openingZones(scene, level).some(z => z.door && overlap(f, z.zone))) issues.push(`${o.id} 挡门`);
    if (stairZones(scene, level).some(s => overlap(f, s))) issues.push(`${o.id} 压楼梯`);
  }
  return issues;
}
export const styledRoomTypes = (name: string | undefined): RoomType[] => roomTypesOf(name);
