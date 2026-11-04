import * as T from 'three';
import { noise } from './stone-texture';

// 示意材质纹理：procedural, tileable detail for soft furnishing, timber and walls (woven fabric, linen slub, wood
// grain, leather pebble, wall plaster). Pure arithmetic like the stone textures, so interactive views, headless
// stills and Node tests get identical pixels. Each map is a near-white grey multiplied onto the material colour
// (tones are kept) and doubles as the bump map. UVs come from `projectUV` in metres divided by the kind's tile size.

export type SurfaceKind = 'fabric' | 'linen' | 'wood' | 'leather' | 'plaster';
/** World size of one texture repeat, metres. */
export const SURFACE_TILE: Record<SurfaceKind, number> = { fabric: .09, linen: .22, wood: .9, leather: .3, plaster: 1.6 };
const SIZE: Record<SurfaceKind, number> = { fabric: 256, linen: 256, wood: 512, leather: 256, plaster: 512 };
/** Bump strength per kind (three r18x bump units). */
export const SURFACE_BUMP: Record<SurfaceKind, number> = { fabric: 1.2, linen: .9, wood: .35, leather: .8, plaster: .5 };

/** Tileable fractal noise: every octave's lattice period divides the texture, so edges wrap seamlessly. */
function fbm(x: number, y: number, seed: number, period: number, octaves: number) {
  let sum = 0, amp = .5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) { sum += amp * noise(x * f, y * f, seed + i * 31, period * f); norm += amp; f *= 2; amp *= .5; }
  return sum / norm;
}

/** Grey level 0..1 at texel (u, v) in 0..1 (tile space). */
function shade(kind: SurfaceKind, u: number, v: number) {
  switch (kind) {
    case 'fabric': {
      // Plain weave: alternating warp/weft threads, each thread a soft ridge, with yarn irregularity.
      const n = 24, x = u * n, y = v * n, cx = Math.floor(x), cy = Math.floor(y);
      const over = (cx + cy) % 2 === 0, along = over ? x - cx : y - cy, across = over ? y - cy : x - cx;
      const ridge = Math.sin(Math.PI * across) ** .6 * (.85 + .15 * Math.sin(Math.PI * along));
      return .8 + .14 * ridge + .06 * (fbm(u * 8, v * 8, 11, 8, 3) - .5);
    }
    case 'linen': {
      // Fine horizontal threads with slubs (thicker stretches) and a faint cross weave.
      const rows = 60, row = Math.floor(v * rows), within = v * rows - row;
      const slub = fbm(u * 6, row * .37, 23 + row, 6, 2), thread = Math.sin(Math.PI * within) ** .8;
      return .84 + .1 * thread * (.6 + .8 * slub) + .04 * Math.sin(u * Math.PI * 2 * 90) ** 2 - .03;
    }
    case 'wood': {
      // Grain runs along u: thin dark latewood lines bent by low-frequency noise, finer lines between, pores, streaks.
      const warp = fbm(u * 2, v * 2, 41, 2, 4) * 2.5, ring = .5 + .5 * Math.sin((v * 18 + warp) * Math.PI * 2);
      const fine = .5 + .5 * Math.sin((v * 90 + warp * 3) * Math.PI * 2);
      const pores = fbm(u * 32, v * 32, 57, 32, 2), streak = fbm(u * 1, v * 8, 63, 1, 3);
      return .93 - .1 * ring ** 6 - .035 * fine ** 4 + .04 * (pores - .5) - .05 * Math.max(0, streak - .55) * 3;
    }
    case 'leather': {
      // Pebbled grain: small cells from thresholded noise, soft creases.
      const cells = fbm(u * 24, v * 24, 71, 24, 2), crease = Math.abs(fbm(u * 4, v * 4, 79, 4, 3) - .5) * 2;
      return .84 + .1 * Math.min(1, Math.abs(cells - .5) * 4) - .06 * (1 - crease) ** 6;
    }
    case 'plaster': {
      // Trowelled lime plaster: broad soft clouds and fine sand grain, deliberately subtle.
      return .9 + .06 * (fbm(u * 3, v * 3, 89, 3, 4) - .5) + .04 * (fbm(u * 96, v * 96, 97, 96, 1) - .5);
    }
  }
}

const cache = new Map<SurfaceKind, T.DataTexture>();
/** Shared, cached texture per kind (survives model reloads; disposal only drops the GPU copy). */
export function surfaceTexture(kind: SurfaceKind) {
  let texture = cache.get(kind);
  if (!texture) {
    const size = SIZE[kind], data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const g = Math.round(Math.min(1, Math.max(0, shade(kind, x / size, y / size))) * 255), i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g; data[i + 3] = 255;
    }
    texture = new T.DataTexture(data, size, size, T.RGBAFormat);
    texture.colorSpace = T.SRGBColorSpace; texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.magFilter = T.LinearFilter; texture.minFilter = T.LinearMipmapLinearFilter; texture.generateMipmaps = true;
    texture.anisotropy = 8; texture.flipY = false; texture.needsUpdate = true; texture.userData.shared = true;
    cache.set(kind, texture);
  }
  return texture;
}

/** Material parameters adding the texture of `kind` (colour detail plus bump) to a standard/physical material. */
export function surfaceDetail(kind: SurfaceKind) {
  const map = surfaceTexture(kind);
  return { map, bumpMap: map, bumpScale: SURFACE_BUMP[kind] };
}

/**
 * Box-projected UVs in metres / tile: each vertex takes the plane its normal faces most (top faces use x,z; front
 * and back x,y; sides z,y), so textures keep true scale on any size and wood grain runs horizontally.
 */
export function projectUV(geometry: T.BufferGeometry, tile: number) {
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  if (!position || !normal) return geometry;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const [a, b] = ny >= nx && ny >= nz ? [x, z] : nz >= nx ? [x, y] : [z, y];
    uv[i * 2] = a / tile; uv[i * 2 + 1] = b / tile;
  }
  geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
  return geometry;
}
