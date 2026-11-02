import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SceneSnapshot } from '../../contracts/src/scene';
import type { StoneSpec } from '../../contracts/src/finishes';
import { layoutFinish, stoneOf, type Piece } from '../../finishes/src/plan';
import type { FinishSurface } from '../../finishes/src/surfaces';
import { STAIR_STONE, WALL_STONE } from '../../finishes/src/surfaces';
import { DETAIL_SIZE, detailTexture, stoneTexture } from './stone-texture';

// Stone finishes renderer. Every piece of the layout is its own solid with a micro-bevelled edge, its own texture
// window (real-scale veins, random offset and flip) and a slight tone; joints are real gaps over a grout bed.
// Materials are standard MeshPhysicalMaterial so scene lighting and environment maps apply unchanged.

const BEVEL = .0008;
const materials = new Map<string, T.MeshPhysicalMaterial>();
/** Polished and honed stone differ in roughness, clearcoat and fine relief. */
export function stoneMaterial(stone: StoneSpec) {
  const key = `${stone.id}@${stone.version}`;
  let material = materials.get(key);
  if (!material) {
    const polished = stone.surface === 'polished', detail = detailTexture(stone.texture.seed % 997);
    material = new T.MeshPhysicalMaterial({
      map: stoneTexture(stone.texture), vertexColors: true, metalness: 0,
      roughness: polished ? .14 : .66, roughnessMap: detail,
      clearcoat: polished ? .85 : 0, clearcoatRoughness: polished ? .035 : 0,
      specularIntensity: polished ? 1 : .45, ior: 1.55,
      ...(polished ? {} : { bumpMap: detail, bumpScale: .6 }),
    });
    material.userData = { stone: key, surface: stone.surface, shared: true };
    materials.set(key, material);
  }
  return material;
}

const random = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Solid for one piece in surface coordinates; top face at z = 0, body towards -z (into the surface). */
function pieceGeometry(piece: Piece, stone: StoneSpec, thickness: number) {
  const [outer, ...holes] = piece.polygon;
  const shape = new T.Shape(outer.map(([x, y]) => new T.Vector2(x, y)));
  shape.holes = holes.map(hole => new T.Path(hole.map(([x, y]) => new T.Vector2(x, y))));
  const geometry = new T.ExtrudeGeometry(shape, { depth: Math.max(.001, thickness - 2 * BEVEL), bevelEnabled: true,
    bevelThickness: BEVEL, bevelSize: BEVEL, bevelOffset: -BEVEL, bevelSegments: 1, curveSegments: 1 });
  geometry.translate(0, 0, -(thickness - BEVEL));
  // Texture window: the tile's own axes at true scale, randomly offset and flipped within the slab image.
  const rng = random(piece.seed), slab = Math.max(stone.texture.slabSize, piece.tile.length, piece.tile.width);
  const flipA = rng() < .5, flipB = rng() < .5, offsetA = rng() * (slab - piece.tile.length), offsetB = rng() * (slab - piece.tile.width);
  const ca = Math.cos(piece.tile.angle), sa = Math.sin(piece.tile.angle), [cx, cy] = piece.tile.center;
  const position = geometry.getAttribute('position'), count = position.count;
  const uv = new Float32Array(count * 2), uv1 = new Float32Array(count * 2), color = new Float32Array(count * 3);
  const tone = 1 + (rng() - .5) * .07, warm = (rng() - .5) * .012;
  for (let i = 0; i < count; i++) {
    const x = position.getX(i), y = position.getY(i), dx = x - cx, dy = y - cy;
    let a = dx * ca + dy * sa + piece.tile.length / 2, b = -dx * sa + dy * ca + piece.tile.width / 2;
    if (flipA) a = piece.tile.length - a; if (flipB) b = piece.tile.width - b;
    uv[i * 2] = (offsetA + a) / slab; uv[i * 2 + 1] = (offsetB + b) / slab;
    uv1[i * 2] = x / DETAIL_SIZE; uv1[i * 2 + 1] = y / DETAIL_SIZE;
    color[i * 3] = tone + warm; color[i * 3 + 1] = tone; color[i * 3 + 2] = tone - warm;
  }
  geometry.setAttribute('uv', new T.BufferAttribute(uv, 2)); geometry.setAttribute('uv1', new T.BufferAttribute(uv1, 2));
  geometry.setAttribute('color', new T.BufferAttribute(color, 3));
  return geometry.index ? geometry.toNonIndexed() : geometry;
}

/** Surface frame → world matrix: local z is the outward normal, so the top face (z = 0) lies on the visible face. */
function frameMatrix(surface: FinishSurface) {
  const { origin, u, v, normal } = surface.frame;
  const U = new T.Vector3(...u).normalize(), V = new T.Vector3(...v).normalize(), N = new T.Vector3(...normal).normalize();
  // When u×v points into the surface the basis is mirrored; triangle winding is then reversed to keep faces outward.
  const mirrored = new T.Vector3().crossVectors(U, V).dot(N) < 0;
  return { matrix: new T.Matrix4().makeBasis(U, V, N).setPosition(...origin), mirrored };
}
function reverseWinding(geometry: T.BufferGeometry) {
  for (const attribute of Object.values(geometry.attributes) as T.BufferAttribute[]) {
    const array = attribute.array as Float32Array, size = attribute.itemSize;
    for (let t = 0; t < attribute.count; t += 3) for (let k = 0; k < size; k++) {
      const a = (t + 1) * size + k, b = (t + 2) * size + k, swap = array[a]; array[a] = array[b]; array[b] = swap;
    }
  }
  return geometry;
}

function groutGeometry(surface: FinishSurface) {
  const shapes = surface.polygon.map(([outer, ...holes]) => {
    const shape = new T.Shape(outer.map(([x, y]) => new T.Vector2(x, y)));
    shape.holes = holes.map(hole => new T.Path(hole.map(([x, y]) => new T.Vector2(x, y)))); return shape;
  });
  const geometry = new T.ShapeGeometry(shapes); geometry.translate(0, 0, -.0025);
  return geometry;
}

/**
 * Integration entry used by createSceneModel: stone meshes for every tiled finish on the shown levels.
 * Returns one group per finish (userData.id = finish id) so picking and selection work like other scene objects.
 */
export function createFinishMeshes(data: SceneSnapshot, shownLevelIds: string[]) {
  const groups: T.Group[] = [], design = data.surfaceDesign;
  if (!design || !data.finishes?.length) return groups;
  for (const tiling of design.tilings) {
    const finish = data.finishes.find(item => item.id === tiling.finishId), field = stoneOf(design, tiling);
    if (!finish || !field) continue;
    const border = tiling.border ? stoneOf(design, tiling.border) ?? field : field;
    const layout = layoutFinish(finish, data, tiling);
    const group = new T.Group(); group.userData = { id: finish.id, finish: finish.kind, tiling: true };
    const parts = new Map<StoneSpec, T.BufferGeometry[]>(), grout: T.BufferGeometry[] = [];
    for (const { surface, layout: region } of layout.surfaces) {
      if (!shownLevelIds.includes(surface.levelId)) continue;
      const { matrix, mirrored } = frameMatrix(surface);
      const thickness = surface.part === 'wall' ? WALL_STONE : surface.part === 'floor' ? Math.min(field.thickness, .02) : STAIR_STONE;
      for (const piece of region.pieces) {
        const stone = piece.role === 'border' ? border : field, geometry = pieceGeometry(piece, stone, thickness).applyMatrix4(matrix);
        if (mirrored) reverseWinding(geometry);
        (parts.get(stone) ?? parts.set(stone, []).get(stone)!).push(geometry);
      }
      if (tiling.joint.width > 0 && region.pieces.length) grout.push(groutGeometry(surface).applyMatrix4(matrix));
    }
    for (const [stone, geometries] of parts) {
      const merged = mergeGeometries(geometries); geometries.forEach(geometry => geometry.dispose());
      if (!merged) continue;
      merged.computeVertexNormals();
      const mesh = new T.Mesh(merged, stoneMaterial(stone)); mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData = { finishId: finish.id, stone: `${stone.id}@${stone.version}` }; group.add(mesh);
    }
    if (grout.length) {
      const merged = mergeGeometries(grout.map(geometry => geometry.toNonIndexed())); grout.forEach(geometry => geometry.dispose());
      if (merged) {
        const mesh = new T.Mesh(merged, new T.MeshStandardMaterial({ color: tiling.joint.color, roughness: .92, side: T.DoubleSide }));
        mesh.receiveShadow = true; mesh.userData = { finishId: finish.id, grout: true }; group.add(mesh);
      }
    }
    if (group.children.length) groups.push(group);
  }
  return groups;
}
