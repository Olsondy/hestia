import * as T from 'three';
import polygonClipping, { type Polygon } from 'polygon-clipping';
import { stairBlocks, type Level, type Stair, type StairBlock } from '../../contracts/src/building';
import type { SceneSnapshot } from './snapshot';

// Architectural detail layered on the structural model: skirting boards, door/window frames and glazing, ceilings
// with downlights, and stair balustrades. Detail is presentation only: it never changes structural meshes, IDs or
// picking (meshes are tagged `userData.detail` and ceilings ignore rays), and it stays inside the owning wall/stair
// group so view filtering applies unchanged.

export type Lamp = { position: T.Vector3; levelId: string; roomId: string; area: number };
type Point = { x: number; z: number };

const outdoor = /庭院|院子|花园|露台|天台|阳台|平台|挑空|terrace|garden|yard|balcony|void/i;
const mats = {
  skirting: new T.MeshStandardMaterial({ color: '#d6cabb', roughness: .45 }),
  frame: new T.MeshStandardMaterial({ color: '#4a4440', roughness: .4, metalness: .6 }),
  casing: new T.MeshStandardMaterial({ color: '#e9e2d7', roughness: .5 }),
  sill: new T.MeshPhysicalMaterial({ color: '#ddd5c9', roughness: .25, clearcoat: .4 }),
  glass: new T.MeshPhysicalMaterial({ color: '#d4e6ea', roughness: .03, transparent: true, opacity: .16, depthWrite: false, envMapIntensity: 2, side: T.DoubleSide }),
  ceiling: new T.MeshStandardMaterial({ color: '#f7f4ee', roughness: .95 }),
  downlight: new T.MeshStandardMaterial({ color: '#f4efe6', roughness: .4, emissive: '#ffe2b8', emissiveIntensity: 0 }),
  rail: new T.MeshPhysicalMaterial({ color: '#2f2b28', roughness: .35, metalness: .7 }),
  handrail: new T.MeshPhysicalMaterial({ color: '#6b4b35', roughness: .4, clearcoat: .3 }),
};
mats.downlight.userData.lamp = true;
/** Shared detail materials survive model disposal so they are never disposed per model. */
for (const material of Object.values(mats)) material.userData.shared = true;

function mesh(geometry: T.BufferGeometry, material: T.Material, shadow = true) {
  const node = new T.Mesh(geometry, material);
  node.castShadow = shadow && !material.transparent; node.receiveShadow = true; node.userData.detail = true;
  return node;
}
function box(material: T.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, shadow = true) {
  const node = mesh(new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material, shadow);
  node.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return node;
}

type Wall = SceneSnapshot['walls'][number];
/** Wall-local frame: x along the wall from a (0) to b (span), y up from the storey floor, z across the thickness. */
function wallDetail(wall: Wall) {
  const out: T.Object3D[] = [], span = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z), t = wall.thickness / 2;
  const openings = [...wall.openings].sort((a, b) => a.offset - b.offset);
  // Skirting on both faces, interrupted by floor-level openings.
  let cursor = 0;
  const skirting = (start: number, end: number) => {
    if (end - start < .02) return;
    for (const side of [-1, 1]) out.push(box(mats.skirting, start, end, 0, .09, side > 0 ? t : -t - .012, side > 0 ? t + .012 : -t, false));
  };
  for (const opening of openings) { if (opening.sill < .09) { skirting(cursor, opening.offset); cursor = opening.offset + opening.width; } }
  skirting(cursor, span);
  for (const o of openings) {
    const x0 = o.offset, x1 = o.offset + o.width, fullHeight = o.head >= wall.height - 1e-3;
    if (fullHeight) continue; // Openings up to the wall top are passages or open notches (e.g. low garden walls).
    const window = o.sill > 0, glazed = window || (o.width >= 1.8 && wall.thickness >= .2);
    const f = .05, depth = window || glazed ? .07 : wall.thickness + .02;
    // Reveal lining (door) or slim metal frame (window / glazed door).
    const frame = glazed ? mats.frame : mats.casing, z0 = glazed ? -depth / 2 : -t - .01, z1 = glazed ? depth / 2 : t + .01;
    out.push(box(frame, x0, x1, o.head - f, o.head, z0, z1), box(frame, x0, x0 + f, o.sill, o.head, z0, z1), box(frame, x1 - f, x1, o.sill, o.head, z0, z1));
    if (window) out.push(box(frame, x0, x1, o.sill, o.sill + f, z0, z1));
    if (!glazed) {
      // Architraves on both faces of a door.
      for (const side of [-1, 1]) {
        const za = side > 0 ? t : -t - .015, zb = side > 0 ? t + .015 : -t;
        out.push(box(mats.casing, x0 - .07, x0, 0, o.head + .07, za, zb), box(mats.casing, x1, x1 + .07, 0, o.head + .07, za, zb), box(mats.casing, x0 - .07, x1 + .07, o.head, o.head + .07, za, zb));
      }
      continue;
    }
    // Mullions split wide glazing into panes; sills project on both faces.
    const panes = Math.max(1, Math.round((x1 - x0) / 1.2));
    for (let i = 1; i < panes; i++) { const x = x0 + (x1 - x0) * i / panes; out.push(box(frame, x - .025, x + .025, o.sill, o.head, z0, z1)); }
    const glass = mesh(new T.PlaneGeometry(x1 - x0 - 2 * f, o.head - o.sill - (window ? 2 * f : f)), mats.glass, false);
    glass.position.set((x0 + x1) / 2, (o.sill + (window ? f : 0) + o.head - f) / 2, 0); glass.raycast = () => {};
    out.push(glass);
    if (window) for (const side of [-1, 1]) out.push(box(mats.sill, x0 - .04, x1 + .04, o.sill - .03, o.sill, side > 0 ? 0 : -t - .04, side > 0 ? t + .04 : 0));
  }
  return out;
}

function ring(points: Point[]) { return points.map(p => [p.x, p.z] as [number, number]); }
function centroid(points: Point[]) {
  let a = 0, x = 0, z = 0;
  points.forEach((p, i) => { const q = points[(i + 1) % points.length], c = p.x * q.z - q.x * p.z; a += c; x += (p.x + q.x) * c; z += (p.z + q.z) * c; });
  return { area: Math.abs(a / 2), x: x / (3 * a), z: z / (3 * a) };
}
export function inside(point: Point, polygon: Point[]) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}
export const isOutdoorRoom = (room: { name?: string }) => !!room.name && outdoor.test(room.name);

/** Ceiling of a room at the storey's clear height, minus openings in the slab above. Visible from below only. */
function ceiling(room: SceneSnapshot['rooms'][number], level: Level, above: Point[][], lamps: Lamp[]) {
  const polygons = above.length ? polygonClipping.difference([ring(room.outline)] as Polygon, ...above.map(h => [ring(h)] as Polygon)) : [[ring(room.outline)]];
  const group = new T.Group(); group.userData = { detail: true, ceiling: true };
  const y = level.elevation + level.height - .004;
  for (const [outer, ...holes] of polygons) {
    const shape = new T.Shape(outer.map(([x, z]) => new T.Vector2(x, z)));
    shape.holes = holes.map(hole => new T.Path(hole.map(([x, z]) => new T.Vector2(x, z))));
    const geometry = new T.ShapeGeometry(shape); geometry.rotateX(Math.PI / 2);
    const node = mesh(geometry, mats.ceiling, true); node.position.y = y; node.raycast = () => {}; node.userData.ceiling = true;
    group.add(node);
  }
  // Downlights on a ~1.5 m grid, inset from walls and kept off slab openings.
  const xs = room.outline.map(p => p.x), zs = room.outline.map(p => p.z);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const nx = Math.max(1, Math.round((maxX - minX - 1) / 1.5)), nz = Math.max(1, Math.round((maxZ - minZ - 1) / 1.5));
  const spots: T.BufferGeometry[] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const p = { x: minX + .5 + (maxX - minX - 1) * (i + .5) / nx, z: minZ + .5 + (maxZ - minZ - 1) * (j + .5) / nz };
    if (!inside(p, room.outline) || above.some(hole => inside(p, hole))) continue;
    const disc = new T.CylinderGeometry(.045, .045, .01, 16); disc.translate(p.x, y - .005, p.z); spots.push(disc);
  }
  if (spots.length) {
    const merged = mergeAll(spots), node = mesh(merged, mats.downlight, false); node.raycast = () => {}; group.add(node);
  }
  const c = centroid(room.outline), at = inside(c, room.outline) && !above.some(hole => inside(c, hole)) ? c : null;
  if (at) lamps.push({ position: new T.Vector3(at.x, y - .35, at.z), levelId: level.id, roomId: room.id, area: c.area });
  return group;
}
function mergeAll(geometries: T.BufferGeometry[]) {
  const positions: number[] = [], normals: number[] = [];
  for (const g of geometries) {
    const flat = g.index ? g.toNonIndexed() : g;
    positions.push(...flat.attributes.position.array as Float32Array); normals.push(...flat.attributes.normal.array as Float32Array);
    g.dispose(); if (flat !== g) flat.dispose();
  }
  const merged = new T.BufferGeometry();
  merged.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); merged.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  return merged;
}

/** Glass balustrade with end posts and a timber handrail along the open edge of each flight (stair-local). */
function stairRails(stair: Stair) {
  const out: T.Object3D[] = [], W = stair.width / 2, height = .9, flights: StairBlock[][] = [[]];
  for (const block of stairBlocks(stair)) { if (block.landing) flights.push([]); else flights.at(-1)!.push(block); }
  const edges: { flight: StairBlock[]; along: 'x' | 'z'; at: number }[] = [];
  flights.filter(flight => flight.length).forEach((flight, index, all) => {
    if (stair.kind === 'straight') { edges.push({ flight, along: 'z', at: -W + .04 }, { flight, along: 'z', at: W - .04 }); return; }
    // U stair: the middle flight of three runs across the back; side flights get a rail on their well-side edge.
    if (all.length === 3 && index === 1) { edges.push({ flight, along: 'x', at: -stair.depth / 2 + stair.landingDepth - .04 }); return; }
    const { x0, x1 } = flight[0];
    edges.push({ flight, along: 'z', at: Math.abs(x0) < Math.abs(x1) ? x0 + .04 : x1 - .04 });
  });
  for (const { flight, along, at } of edges) {
    const tops = flight.map(b => along === 'z' ? new T.Vector3(at, b.top, (b.z0 + b.z1) / 2) : new T.Vector3((b.x0 + b.x1) / 2, b.top, at));
    const first = tops[0], last = tops.at(-1)!;
    for (const p of tops.length > 1 ? [first, last] : [first]) { const post = mesh(new T.CylinderGeometry(.02, .02, height, 10), mats.rail); post.position.set(p.x, p.y + height / 2, p.z); out.push(post); }
    if (tops.length < 2) continue;
    const a = first.clone().setY(first.y + height), b = last.clone().setY(last.y + height);
    const rail = mesh(new T.BoxGeometry(.05, .04, a.distanceTo(b)), mats.handrail);
    rail.position.copy(a).add(b).multiplyScalar(.5); rail.lookAt(b); out.push(rail);
    const run = Math.hypot(last.x - first.x, last.z - first.z), rise = last.y - first.y;
    const shape = new T.Shape([new T.Vector2(0, 0), new T.Vector2(run, rise), new T.Vector2(run, rise + height - .06), new T.Vector2(0, height - .06)]);
    const panel = mesh(new T.ShapeGeometry(shape), mats.glass, false); panel.raycast = () => {};
    const dir = along === 'z' ? Math.sign(last.z - first.z) : Math.sign(last.x - first.x);
    panel.position.copy(first).setY(first.y + .02);
    panel.rotation.y = along === 'z' ? (dir > 0 ? -Math.PI / 2 : Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    out.push(panel);
  }
  return out;
}

/** Adds detail to an already built structural model and returns ceiling lamp anchors for night lighting. */
export function addArchitecturalDetail(model: { root: T.Group; objects: Map<string, T.Object3D>; data: SceneSnapshot }, levels: Level[], shown: string[]) {
  const lamps: Lamp[] = [], levelOf = (id?: string) => levels.find(level => level.id === (id ?? levels[0].id))!;
  for (const wall of model.data.walls) {
    const group = model.objects.get(wall.id); if (!group) continue;
    for (const node of wallDetail(wall)) group.add(node);
  }
  for (const stair of model.data.stairs ?? []) {
    const group = model.objects.get(stair.id); if (!group) continue;
    for (const node of stairRails(stair)) group.add(node);
  }
  const ceilings = new T.Group(); ceilings.userData = { detail: true, ceilings: true };
  for (const room of model.data.rooms) {
    const level = levelOf(room.levelId); if (!shown.includes(level.id) || isOutdoorRoom(room)) continue;
    const index = levels.indexOf(level), next = levels[index + 1];
    const above = next ? (model.data.slabOpenings ?? []).filter(opening => opening.levelId === next.id).map(opening => opening.outline) : [];
    ceilings.add(ceiling(room, level, above, lamps));
  }
  model.root.add(ceilings);
  return { lamps };
}
