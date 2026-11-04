import * as T from 'three';
import { effectiveLevels, levelOf } from '../../contracts/src/building';
import type { SceneSnapshot } from './snapshot';
import { inside, isOutdoorRoom } from './architecture';

/**
 * Overview ("dollhouse") presentation of one storey: walls are cut at about 1.1 m above the floor so every room can
 * be seen into, except outer walls on the far side of the camera, which stay full height as a backdrop, and walls
 * whose stone-clad face looks toward the camera, so a feature wall stays visible. The cut follows the camera as it
 * orbits. Cut meshes get cloned materials with a clipping plane; the originals are restored when the cut is lifted.
 */
export const CUT_HEIGHT = 1.1;
type Point = { x: number; z: number };

type WallCut = {
  id: string; mid: Point; outward: Point; exterior: boolean; elevation: number;
  /** Stone-clad faces of this wall (unit normals in plan). */
  clad: Point[];
  nodes: T.Object3D[];
};

export class Cutaway {
  private walls: WallCut[] = [];
  private planes = new Map<number, T.Plane>();
  private clones = new Map<T.Material, Map<number, T.Material>>();
  private originals = new Map<T.Mesh, T.Material | T.Material[]>();
  private cutIds = new Set<string>();
  private active = false;
  private lastAzimuth = NaN;

  constructor(data: SceneSnapshot, objects: Map<string, T.Object3D>, shownLevels: string[]) {
    const levels = effectiveLevels(data);
    const rooms = data.rooms.filter(room => shownLevels.includes(levelOf(room, levels)));
    for (const wall of data.walls) {
      const levelId = levelOf(wall, levels), level = levels.find(item => item.id === levelId);
      const group = objects.get(wall.id);
      if (!level || !group || !shownLevels.includes(levelId)) continue;
      const dx = wall.b.x - wall.a.x, dz = wall.b.z - wall.a.z, length = Math.hypot(dx, dz) || 1;
      const mid = { x: (wall.a.x + wall.b.x) / 2, z: (wall.a.z + wall.b.z) / 2 };
      const left = { x: -dz / length, z: dx / length };
      const sameLevel = rooms.filter(room => levelOf(room, levels) === levelId);
      const covered = (side: number) => sameLevel.some(room => inside({ x: mid.x + left.x * side * .35, z: mid.z + left.z * side * .35 }, room.outline) && !isOutdoorRoom(room));
      const leftIn = covered(1), rightIn = covered(-1);
      // Outer wall: indoor room on one side only; its outward normal points to the other side.
      const exterior = leftIn !== rightIn;
      const outward = leftIn ? { x: -left.x, z: -left.z } : left;
      const finishes = (data.finishes ?? []).filter(finish => finish.kind === 'wall' && finish.wallId === wall.id
        && data.surfaceDesign?.tilings.some(tiling => tiling.finishId === finish.id));
      const clad = finishes.map(finish => finish.kind === 'wall' ? { x: left.x * finish.side, z: left.z * finish.side } : left);
      const nodes: T.Object3D[] = [group];
      for (const finish of finishes) { const node = objects.get(finish.id); if (node) nodes.push(node); }
      this.walls.push({ id: wall.id, mid, outward, exterior, elevation: level.elevation, clad, nodes });
    }
  }

  /** Call every frame in overview; re-evaluates only when the view has turned noticeably. Returns true on change. */
  update(camera: T.Camera, target: T.Vector3) {
    const view = new T.Vector3().subVectors(target, camera.position); // Points away from the viewer.
    const azimuth = Math.atan2(view.x, view.z);
    if (this.active && Math.abs(angleDelta(azimuth, this.lastAzimuth)) < T.MathUtils.degToRad(4)) return false;
    this.active = true; this.lastAzimuth = azimuth;
    const away = { x: Math.sin(azimuth), z: Math.cos(azimuth) };
    const cut = new Set<string>();
    for (const wall of this.walls) {
      const far = wall.exterior && dot(wall.outward, away) > .3;
      const feature = wall.clad.some(face => dot(face, away) < -.3);
      if (!far && !feature) cut.add(wall.id);
    }
    if (sameSet(cut, this.cutIds)) return false;
    this.cutIds = cut;
    for (const wall of this.walls) this.apply(wall, cut.has(wall.id));
    return true;
  }

  /** Restores every wall to full height (interior views, stills). */
  clear() {
    if (!this.active) return false;
    this.active = false; this.lastAzimuth = NaN;
    for (const wall of this.walls) this.apply(wall, false);
    this.cutIds.clear();
    return true;
  }

  /** True when a ray hit lands on the removed upper part of a cut wall (it should pass through). */
  clipped(object: T.Object3D, point: T.Vector3) {
    if (!this.active) return false;
    let node: T.Object3D | null = object;
    while (node) {
      const id = node.userData.id as string | undefined, wall = id && this.walls.find(item => item.nodes.includes(node!));
      if (wall) return this.cutIds.has(wall.id) && point.y > wall.elevation + CUT_HEIGHT;
      node = node.parent;
    }
    return false;
  }

  dispose() {
    this.clear();
    for (const byLevel of this.clones.values()) for (const material of byLevel.values()) material.dispose();
    this.clones.clear(); this.originals.clear();
  }

  private apply(wall: WallCut, cut: boolean) {
    for (const node of wall.nodes) node.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      if (!this.originals.has(object)) this.originals.set(object, object.material);
      const original = this.originals.get(object)!;
      object.material = cut ? (Array.isArray(original) ? original.map(m => this.clipMaterial(m, wall.elevation)) : this.clipMaterial(original, wall.elevation)) : original;
    });
  }

  private clipMaterial(material: T.Material, elevation: number) {
    const byLevel = this.clones.get(material) ?? this.clones.set(material, new Map()).get(material)!;
    let clone = byLevel.get(elevation);
    if (!clone) {
      clone = material.clone(); clone.userData = { ...material.userData, shared: false };
      clone.clippingPlanes = [this.plane(elevation)]; clone.clipShadows = true;
      byLevel.set(elevation, clone);
    }
    return clone;
  }

  private plane(elevation: number) {
    let plane = this.planes.get(elevation);
    if (!plane) { plane = new T.Plane(new T.Vector3(0, -1, 0), elevation + CUT_HEIGHT); this.planes.set(elevation, plane); }
    return plane;
  }
}

/** A point inside the room near its visual centre, for labels and focusing. */
export function roomAnchor(outline: Point[]): Point {
  let area = 0, cx = 0, cz = 0;
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length], cross = p.x * q.z - q.x * p.z;
    area += cross; cx += (p.x + q.x) * cross; cz += (p.z + q.z) * cross;
  });
  const centroid = Math.abs(area) > 1e-9 ? { x: cx / (3 * area), z: cz / (3 * area) } : outline[0];
  if (inside(centroid, outline)) return centroid;
  // Concave rooms: the average of the vertices, else the midpoint of the longest diagonal that stays inside.
  const mean = { x: outline.reduce((s, p) => s + p.x, 0) / outline.length, z: outline.reduce((s, p) => s + p.z, 0) / outline.length };
  if (inside(mean, outline)) return mean;
  let best = outline[0], length = -1;
  for (let i = 0; i < outline.length; i++) for (let j = i + 2; j < outline.length; j++) {
    const m = { x: (outline[i].x + outline[j].x) / 2, z: (outline[i].z + outline[j].z) / 2 }, d = Math.hypot(outline[i].x - outline[j].x, outline[i].z - outline[j].z);
    if (d > length && inside(m, outline)) { best = m; length = d; }
  }
  return best;
}

const dot = (a: Point, b: Point) => a.x * b.x + a.z * b.z;
const angleDelta = (a: number, b: number) => Number.isNaN(b) ? Math.PI : Math.atan2(Math.sin(a - b), Math.cos(a - b));
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(id => b.has(id));
