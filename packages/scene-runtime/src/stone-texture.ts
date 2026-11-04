import * as T from 'three';
import type { ProceduralStoneTexture } from '../../contracts/src/finishes';

// 示意石纹：deterministic procedural stone (value noise, domain warp, layered veins). Pure arithmetic, so interactive
// and headless rendering produce the same pixels. Not a photograph and not supplier material.

const hash = (x: number, y: number, s: number) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
// Random lattice per seed (256×256, wrapping): array reads instead of four hashes per noise sample.
const lattices = new Map<number, Float32Array>();
function lattice(seed: number) {
  let values = lattices.get(seed);
  if (!values) {
    values = new Float32Array(65536);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) values[y * 256 + x] = hash(x, y, seed);
    lattices.set(seed, values);
  }
  return values;
}
export function noise(x: number, y: number, s: number, period = 0) {
  let xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  let x1 = xi + 1, y1 = yi + 1;
  if (period) { xi = ((xi % period) + period) % period; yi = ((yi % period) + period) % period; x1 = (xi + 1) % period; y1 = (yi + 1) % period; }
  const table = lattice(s), r0 = (yi & 255) << 8, r1 = (y1 & 255) << 8;
  const a = table[r0 | (xi & 255)], b = table[r0 | (x1 & 255)], c = table[r1 | (xi & 255)], d = table[r1 | (x1 & 255)];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number, octaves = 5) {
  let sum = 0, amp = .5, f = 1;
  for (let i = 0; i < octaves; i++) { sum += amp * noise(x * f, y * f, s + i * 17); f *= 2.03; amp *= .5; }
  return sum / (1 - .5 ** octaves);
}
const clamp = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

/** Low-frequency field sampled on a coarse grid and bilinearly interpolated: same result, a fraction of the cost. */
type Grid = { values: Float32Array; n: number; step: number };
function coarse(size: number, step: number, fn: (px: number, py: number) => number): Grid {
  const n = Math.ceil(size / step) + 2, values = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) values[j * n + i] = fn(i * step, j * step);
  return { values, n, step };
}
/** Bilinear sample of a grid at cell offset `o` with fractions fx, fy (all grids share one layout). */
function bl(values: Float32Array, o: number, n: number, fx: number, fy: number) {
  return (values[o] * (1 - fx) + values[o + 1] * fx) * (1 - fy) + (values[o + n] * (1 - fx) + values[o + n + 1] * fx) * fy;
}
function sample(grid: Grid, x: number, y: number) {
  const gx = Math.max(0, x / grid.step), gy = Math.max(0, y / grid.step), i = Math.floor(gx), j = Math.floor(gy);
  return bl(grid.values, j * grid.n + i, grid.n, gx - i, gy - j);
}

/** RGBA pixels of one stone slab covering `recipe.slabSize` metres square. */
export function stonePixels(recipe: ProceduralStoneTexture, size: number) {
  const data = new Uint8Array(size * size * 4), s = recipe.seed;
  const [b, c, v] = [rgb(recipe.base), rgb(recipe.cloud), rgb(recipe.vein)];
  const F = recipe.features, grain = recipe.style === 'grain', step = 8, unit = F / size;
  // Grain stone is strongly stretched along x; marbles keep a mild dominant direction.
  const sx = grain ? .12 : .75, sy = grain ? 2.2 : 1;
  const field = (fn: (px: number, py: number) => number) => coarse(size, step, (x, y) => fn(x * unit, y * unit));
  // Domain warp: veins meander and fold like metamorphic flow.
  const warpX = field((px, py) => fbm(px * .45 + 3.1, py * .45 + 7.7, s + 3, 4) - .5), warpY = field((px, py) => fbm(px * .45 + 9.2, py * .45 + 1.3, s + 5, 4) - .5);
  const W = recipe.warp * .9, warped = (px: number, py: number, x: number, y: number): [number, number] => [px + sample(warpX, x, y) * W, py + sample(warpY, x, y) * W];
  // Vein fields: iso-contours of warped turbulence. Low octaves on the coarse grid, fine octaves per pixel.
  // Marbles: a gentle linear drift plus turbulence makes long flowing veins rather than closed islands.
  const drift = grain ? 0 : .5, turb = grain ? 1 : recipe.warp * .55 + .6;
  const mainFn = (px: number, py: number) => { const [qx, qy] = warped(px, py, px / unit, py / unit); return (qx * .83 + qy * .56) * drift + fbm(qx * sx, qy * sy, s + 41, 4) * turb; };
  const hairFn = (px: number, py: number) => { const [qx, qy] = warped(px, py, px / unit, py / unit); return (qy * .9 - qx * .44) * drift * 1.3 + fbm(qx * sx * 2.1 + 5, qy * sy * 2.1, s + 43, 4) * turb; };
  // Gradients per pixel, precomputed on the coarse grid alongside the fields.
  const gradient = (fn: (px: number, py: number) => number, axis: 0 | 1) => field((px, py) => axis
    ? (fn(px, py + unit) - fn(px, py - unit)) / 2 : (fn(px + unit, py) - fn(px - unit, py)) / 2);
  const mainLow = field(mainFn), hairLow = field(hairFn);
  const mainGx = gradient(mainFn, 0), mainGy = gradient(mainFn, 1), hairGx = gradient(hairFn, 0), hairGy = gradient(hairFn, 1);
  const cloudLow = field((px, py) => fbm(px * .9, py * .9, s, 3));
  const fade = field((px, py) => smooth(.28, .62, fbm(px * .55 + 11, py * .55, s + 21, 3)));
  const fade2 = field((px, py) => smooth(.4, .7, fbm(px * .9, py * .9 + 5, s + 23, 3)));
  const tone = field((px, py) => (fbm(px * .2, py * .2, s + 31, 2) - .5) * .07);
  const lines = recipe.veins, metresPerPixel = recipe.slabSize / size;
  // Vein widths in pixels: distance to the contour = value offset / gradient, so lines keep a natural, even width
  // instead of swelling into blots where the field is flat.
  const width = Math.max(.7, .06 / recipe.sharpness / metresPerPixel), hairWidth = Math.max(.5, width * .4);
  const fine = (x: number, y: number, seed: number) => (noise(x * 8.24, y * 8.24, seed) * .6 + noise(x * 21.3, y * 21.3, seed + 1) * .4 - .5);
  const thickness = field((px, py) => .45 + 1.4 * fbm(px * 1.7 + 2, py * 1.7, s + 71, 3));
  const n = warpX.n;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cj = Math.floor(y / step), ci = Math.floor(x / step), fy = y / step - cj, fx = x / step - ci, o = cj * n + ci;
    const px = x * unit, py = y * unit, qx = px + bl(warpX.values, o, n, fx, fy) * W, qy = py + bl(warpY.values, o, n, fx, fy) * W;
    const main = bl(mainLow.values, o, n, fx, fy) + fine(qx * sx, qy * sy, s + 51) * .05 * turb, hairField = bl(hairLow.values, o, n, fx, fy) + fine(qx * sx * 2.1, qy * sy * 2.1, s + 55) * .06 * turb;
    const gx = bl(mainGx.values, o, n, fx, fy), gy = bl(mainGy.values, o, n, fx, fy), hx = bl(hairGx.values, o, n, fx, fy), hy = bl(hairGy.values, o, n, fx, fy);
    const g = main * lines, d = Math.abs(g - Math.round(g)) / Math.max(1e-5, Math.hypot(gx, gy) * lines);
    const w = width * bl(thickness.values, o, n, fx, fy), core = 1 - smooth(w * .35, w, d), halo = (1 - smooth(0, w * 9, d)) * .16;
    const h = hairField * lines * 2.3, dh = Math.abs(h - Math.round(h)) / Math.max(1e-5, Math.hypot(hx, hy) * lines * 2.3);
    const hair = 1 - smooth(hairWidth * .3, hairWidth, dh);
    const f = bl(fade.values, o, n, fx, fy), f2 = bl(fade2.values, o, n, fx, fy);
    let vein = (core + halo) * (.18 + .82 * f) + hair * f2 * (recipe.style === 'net' ? .55 : grain ? .5 : .38);
    if (recipe.style === 'cloud') vein *= .5;
    const cloud = bl(cloudLow.values, o, n, fx, fy) + fine(px, py, s + 61) * .18;
    const k = smooth(.3, .8, cloud) * recipe.cloudAmount, m = clamp(vein * recipe.veinAmount);
    // Fine pores and crystals; a faint low-frequency tone keeps large slabs from looking flat.
    const grainNoise = hash(x, y, s + 101), speck = grainNoise > 1 - recipe.speckle * .05 ? -.16 : grainNoise < recipe.speckle * .04 ? .06 : 0;
    const shade = 1 + bl(tone.values, o, n, fx, fy) + (hash(x >> 1, y >> 1, s + 77) - .5) * .02 + speck;
    const i = (y * size + x) * 4;
    for (let ch = 0; ch < 3; ch++) data[i + ch] = Math.max(0, Math.min(255, ((b[ch] * (1 - k) + c[ch] * k) * (1 - m) + v[ch] * m) * shade));
    data[i + 3] = 255;
  }
  return data;
}

/** Seamless fine surface variation (0..255), used for roughness and honed bump at world scale. */
export function detailPixels(seed: number, size: number) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let sum = 0, amp = .5, norm = 0;
    for (let o = 0, period = 16; o < 4; o++, period *= 2, amp *= .5) { sum += amp * noise(x / size * period, y / size * period, seed + o * 7, period); norm += amp; }
    const value = sum / norm, pore = hash(x, y, seed + 3) > .985 ? -.25 : 0;
    const g = Math.round(clamp(.72 + (value - .5) * .5 + pore) * 255), i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = g; data[i + 3] = 255;
  }
  return data;
}

const textures = new Map<string, T.DataTexture>();
function texture(key: string, size: number, pixels: () => Uint8Array, color: boolean, repeat: boolean) {
  let value = textures.get(key);
  if (!value) {
    value = new T.DataTexture(pixels(), size, size, T.RGBAFormat);
    value.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace;
    value.wrapS = value.wrapT = repeat ? T.RepeatWrapping : T.ClampToEdgeWrapping;
    value.magFilter = T.LinearFilter; value.minFilter = T.LinearMipmapLinearFilter; value.generateMipmaps = true;
    value.anisotropy = 16; value.flipY = false; value.needsUpdate = true;
    value.userData.shared = true;
    textures.set(key, value);
  }
  return value;
}
/** Texture resolution for one stone slab (about 2 mm per pixel over a 2 m slab); generation takes ~0.6 s per stone. */
export const STONE_TEXTURE_SIZE = 1024;
/** World size of one detail-map repeat, metres. */
export const DETAIL_SIZE = .35;
/** Shared, cached per recipe. Cached textures survive model reloads; disposal only drops the GPU copy. */
export function stoneTexture(recipe: ProceduralStoneTexture) {
  return texture(`stone:${JSON.stringify(recipe)}`, STONE_TEXTURE_SIZE, () => stonePixels(recipe, STONE_TEXTURE_SIZE), true, false);
}
export function detailTexture(seed: number) {
  const value = texture(`detail:${seed}`, 512, () => detailPixels(seed, 512), false, true);
  value.channel = 1;
  return value;
}
