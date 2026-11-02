import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Parametric ambience props for non-catalog scene objects (e.g. imported HouseSpec furniture keys such as `lSofa`).
// Every builder fills the object's size envelope exactly: width along x, depth along z, height up from the floor,
// origin at the footprint centre. The front (seat side, doors, foot of a bed) faces +z, the back faces -z.
// Procedural geometry only; no external models or textures.

type V3 = [number, number, number];
export type PropSize = { width: number; height: number; depth: number };
type Surface = 'fabric' | 'cushion' | 'linen' | 'wood' | 'darkWood' | 'lacquer' | 'stone' | 'metal' | 'brass' | 'chrome' | 'black'
  | 'ceramic' | 'glass' | 'leaf' | 'leafDark' | 'bark' | 'soil' | 'water' | 'felt' | 'screen' | 'paint' | 'rubber' | 'lamp' | 'grass' | 'concrete' | 'matte';

const cache = new Map<string, T.MeshStandardMaterial>();
/** Shared physically based materials. Base colours stay in sRGB hex like the rest of the scene. */
function material(surface: Surface, tint: string) {
  const key = `${surface}:${tint}`;
  let mat = cache.get(key);
  if (mat) return mat;
  const spec: Record<Surface, T.MeshPhysicalMaterialParameters> = {
    fabric: { color: tint, roughness: .92, sheen: 1, sheenRoughness: .6, sheenColor: new T.Color(tint).lerp(new T.Color('#ffffff'), .35) },
    cushion: { color: new T.Color(tint).offsetHSL(0, -.02, .06), roughness: .9, sheen: 1, sheenRoughness: .55, sheenColor: '#ffffff' },
    linen: { color: '#f3efe7', roughness: .88, sheen: .8, sheenRoughness: .6, sheenColor: '#ffffff' },
    wood: { color: '#b48a62', roughness: .55, clearcoat: .2, clearcoatRoughness: .5 },
    darkWood: { color: '#5e4433', roughness: .5, clearcoat: .25, clearcoatRoughness: .45 },
    lacquer: { color: '#efebe4', roughness: .35, clearcoat: .4, clearcoatRoughness: .3 },
    stone: { color: '#e6e0d6', roughness: .18, clearcoat: .6, clearcoatRoughness: .12 },
    metal: { color: '#2d2f31', roughness: .38, metalness: .85 },
    brass: { color: '#b89a64', roughness: .3, metalness: 1 },
    chrome: { color: '#d8dadc', roughness: .12, metalness: 1 },
    black: { color: '#1d1e20', roughness: .2, clearcoat: 1, clearcoatRoughness: .08 },
    ceramic: { color: '#f7f6f2', roughness: .12, clearcoat: .8, clearcoatRoughness: .05 },
    glass: { color: '#dfeef0', roughness: .04, metalness: 0, transparent: true, opacity: .22, depthWrite: false, envMapIntensity: 1.6 },
    leaf: { color: '#5d7449', roughness: .75, side: T.DoubleSide },
    leafDark: { color: '#435a37', roughness: .78, side: T.DoubleSide },
    bark: { color: '#5b4636', roughness: .9 },
    soil: { color: '#3c3129', roughness: 1 },
    water: { color: '#6fa3ad', roughness: .03, metalness: 0, clearcoat: 1, transparent: true, opacity: .88 },
    felt: { color: '#2f6b4f', roughness: .95, sheen: .6, sheenColor: '#7fbf9a' },
    screen: { color: '#111315', roughness: .08, clearcoat: 1, clearcoatRoughness: .02 },
    paint: { color: tint, roughness: .3, metalness: .5, clearcoat: 1, clearcoatRoughness: .06 },
    rubber: { color: '#1b1b1c', roughness: .85 },
    lamp: { color: '#fff6e5', roughness: .4, emissive: '#ffd9a0', emissiveIntensity: 0 },
    grass: { color: '#6f8a4c', roughness: 1 },
    concrete: { color: '#bdb6aa', roughness: .85 },
    matte: { color: tint, roughness: .8 },
  };
  mat = new T.MeshPhysicalMaterial(spec[surface]);
  if (surface === 'lamp') mat.userData.lamp = true;
  cache.set(key, mat);
  return mat;
}

class Kit {
  readonly group = new T.Group();
  constructor(readonly tint: string) {}
  m(surface: Surface) { return material(surface, this.tint); }
  add(geometry: T.BufferGeometry, surface: Surface | T.Material, at: V3, rotation?: V3) {
    const mesh = new T.Mesh(geometry, typeof surface === 'string' ? this.m(surface) : surface);
    mesh.position.set(...at); if (rotation) mesh.rotation.set(...rotation);
    this.group.add(mesh); return mesh;
  }
  /** Box by min corner [x0,y0,z0] and max corner. */
  box(surface: Surface, min: V3, max: V3) {
    return this.add(new T.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]), surface, center(min, max));
  }
  rbox(surface: Surface, min: V3, max: V3, radius = .04) {
    const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
    return this.add(new RoundedBoxGeometry(w, h, d, 3, Math.max(.001, Math.min(radius, w / 2.2, h / 2.2, d / 2.2))), surface, center(min, max));
  }
  cyl(surface: Surface, at: V3, radiusTop: number, radiusBottom: number, height: number, segments = 20) {
    return this.add(new T.CylinderGeometry(radiusTop, radiusBottom, height, segments), surface, [at[0], at[1] + height / 2, at[2]]);
  }
  sphere(surface: Surface, at: V3, radius: number, scale: V3 = [1, 1, 1], detail = 1) {
    const mesh = this.add(new T.IcosahedronGeometry(radius, detail), surface, at); mesh.scale.set(...scale); return mesh;
  }
  rod(surface: Surface, a: V3, b: V3, radius = .015, segments = 10) {
    const va = new T.Vector3(...a), vb = new T.Vector3(...b), length = va.distanceTo(vb);
    const mesh = this.add(new T.CylinderGeometry(radius, radius, length, segments), surface, va.clone().add(vb).multiplyScalar(.5).toArray() as V3);
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), vb.sub(va).normalize()); return mesh;
  }
  /** Point a night light at this position (prop-local). */
  light(at: V3, strength = 1) { const anchor = new T.Object3D(); anchor.position.set(...at); anchor.userData.lightAnchor = strength; this.group.add(anchor); }
}
const center = (min: V3, max: V3): V3 => [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];

type Builder = (k: Kit, w: number, h: number, d: number) => void;

function legs(k: Kit, w: number, d: number, top: number, inset: number, radius: number, surface: Surface = 'darkWood', taper = .7) {
  for (const x of [-1, 1]) for (const z of [-1, 1]) k.cyl(surface, [x * (w / 2 - inset), 0, z * (d / 2 - inset)], radius * taper, radius, top);
}
function sofa(k: Kit, w: number, h: number, d: number, options: { chaise?: boolean; seats?: number; arms?: boolean } = {}) {
  const arm = Math.min(.2, w * .09), base = Math.min(.14, h * .17), seatTop = Math.min(.45, h * .55), back = Math.min(.24, d * .26);
  k.box('darkWood', [-w / 2 + .05, 0, -d / 2 + .05], [w / 2 - .05, base * .5, d / 2 - .05]);
  k.rbox('fabric', [-w / 2, base * .5, -d / 2], [w / 2, seatTop - .12, d / 2], .05);
  k.rbox('fabric', [-w / 2 + (options.arms === false ? 0 : arm), seatTop - .14, -d / 2], [w / 2 - (options.arms === false ? 0 : arm), h, -d / 2 + back], .07);
  if (options.arms !== false) for (const s of [-1, 1]) k.rbox('fabric', [s > 0 ? w / 2 - arm : -w / 2, base * .5, -d / 2], [s > 0 ? w / 2 : -w / 2 + arm, Math.min(h, seatTop + .2), d / 2], .07);
  const inner = w - (options.arms === false ? 0 : arm * 2), seats = options.seats ?? Math.max(1, Math.round(inner / .75));
  const seatFront = options.chaise ? d / 2 : d / 2 - .02;
  for (let i = 0; i < seats; i++) {
    const x0 = -inner / 2 + inner * i / seats + .01, x1 = -inner / 2 + inner * (i + 1) / seats - .01;
    k.rbox('cushion', [x0, seatTop - .13, -d / 2 + back - .02], [x1, seatTop, Math.min(seatFront, -d / 2 + back + .75)], .06);
    const cushion = k.rbox('cushion', [x0 + .02, seatTop - .02, -d / 2 + back - .02], [x1 - .02, Math.min(h - .02, seatTop + .4), -d / 2 + back + .14], .07);
    cushion.rotation.x = -.12;
  }
  if (options.chaise) {
    // L-shaped sofa: the right end extends to the full depth as a chaise.
    const cx0 = w / 2 - (options.arms === false ? 0 : arm) - Math.min(.9, inner / seats), cx1 = w / 2 - (options.arms === false ? 0 : arm) - .01;
    k.rbox('cushion', [cx0, seatTop - .13, -d / 2 + back + .74], [cx1, seatTop, d / 2 - .02], .06);
    k.rbox('fabric', [cx0 - .01, base * .5, -d / 2 + back + .7], [w / 2 - (options.arms === false ? 0 : arm), seatTop - .12, d / 2], .05);
  }
  // Scatter cushions: one at each end against the back.
  for (const s of [-1, 1]) {
    const x = s * (inner / 2 - .26), pillow = k.rbox('linen', [x - .2, seatTop - .02, -d / 2 + back], [x + .2, seatTop + .36, -d / 2 + back + .13], .06);
    pillow.rotation.set(-.2, 0, s * .12);
  }
}
function chair(k: Kit, w: number, h: number, d: number, arms = false) {
  const seat = Math.min(.46, h * .52);
  for (const x of [-1, 1]) {
    k.rod('darkWood', [x * (w / 2 - .04), 0, d / 2 - .05], [x * (w / 2 - .04), seat - .03, d / 2 - .07], .018);
    k.rod('darkWood', [x * (w / 2 - .04), 0, -d / 2 + .03], [x * (w / 2 - .04), h, -d / 2 + .08], .018);
  }
  k.rbox('fabric', [-w / 2 + .01, seat - .06, -d / 2 + .05], [w / 2 - .01, seat, d / 2 - .02], .025);
  const back = k.rbox('fabric', [-w / 2 + .03, seat + .12, -d / 2 + .04], [w / 2 - .03, h - .04, -d / 2 + .1], .025); back.rotation.x = -.08;
  if (arms) for (const x of [-1, 1]) k.box('darkWood', [x * (w / 2 - .03) - .02, seat + .18, -d / 2 + .05], [x * (w / 2 - .03) + .02, seat + .21, d / 2 - .06]);
}
function table(k: Kit, w: number, h: number, d: number, top: Surface = 'stone', leg: Surface = 'darkWood', round = false) {
  const t = Math.min(.04, h * .08);
  if (round) {
    k.cyl(top, [0, h - t, 0], Math.min(w, d) / 2, Math.min(w, d) / 2, t, 40);
    k.cyl(leg, [0, 0, 0], .06, .06, h - t, 16); k.cyl(leg, [0, 0, 0], Math.min(w, d) * .28, Math.min(w, d) * .3, .03, 32);
    return;
  }
  k.rbox(top, [-w / 2, h - t, -d / 2], [w / 2, h, d / 2], .008);
  k.box(leg, [-w / 2 + .06, h - t - .06, -d / 2 + .06], [w / 2 - .06, h - t, d / 2 - .06]);
  legs(k, w, d, h - t, .09, Math.min(.03, w * .03), leg);
}
function cabinet(k: Kit, w: number, h: number, d: number, options: { doors?: number; drawers?: boolean; body?: Surface; front?: Surface; top?: Surface; plinth?: boolean; open?: 'books' | 'bottles' | 'plants' | 'display' } = {}) {
  const body = options.body ?? 'wood', plinth = options.plinth === false ? 0 : Math.min(.08, h * .1), gap = .004;
  if (plinth) k.box('black', [-w / 2 + .03, 0, -d / 2 + .03], [w / 2 - .03, plinth, d / 2 - .04]);
  if (options.open) {
    const t = .022, shelves = Math.max(2, Math.round((h - plinth) / .38));
    k.box(body, [-w / 2, plinth, -d / 2], [w / 2, h, -d / 2 + t]);
    for (const x of [-w / 2, w / 2 - t]) k.box(body, [x, plinth, -d / 2], [x + t, h, d / 2]);
    for (let i = 0; i <= shelves; i++) {
      const y = plinth + (h - plinth - t) * i / shelves; k.box(body, [-w / 2 + t, y, -d / 2 + t], [w / 2 - t, y + t, d / 2]);
      if (i < shelves) fillShelf(k, options.open, -w / 2 + t + .02, w / 2 - t - .02, y + t, (h - plinth) / shelves - t - .04, d, i);
    }
    return;
  }
  k.box(body, [-w / 2, plinth, -d / 2], [w / 2, h - (options.top ? .02 : 0), d / 2 - .02]);
  if (options.top) k.box(options.top, [-w / 2 - .005, h - .02, -d / 2], [w / 2 + .005, h, d / 2 + .005]);
  const doors = options.doors ?? Math.max(1, Math.round(w / .5)), top = h - (options.top ? .02 : 0);
  const rows = options.drawers ? Math.max(1, Math.round((top - plinth) / .22)) : 1;
  for (let i = 0; i < doors; i++) for (let r = 0; r < rows; r++) {
    const x0 = -w / 2 + w * i / doors + gap, x1 = -w / 2 + w * (i + 1) / doors - gap;
    const y0 = plinth + (top - plinth) * r / rows + gap, y1 = plinth + (top - plinth) * (r + 1) / rows - gap;
    k.box(options.front ?? 'lacquer', [x0, y0, d / 2 - .02], [x1, y1, d / 2]);
    const hx = options.drawers ? (x0 + x1) / 2 : i % 2 ? x0 + .04 : x1 - .04, hy = options.drawers ? y1 - .05 : Math.min(y1 - .1, plinth + 1.05);
    if (options.drawers) k.box('brass', [hx - .07, hy - .006, d / 2], [hx + .07, hy + .006, d / 2 + .018]);
    else k.box('brass', [hx - .006, hy - Math.min(.12, (y1 - y0) / 4), d / 2], [hx + .006, hy + Math.min(.12, (y1 - y0) / 4), d / 2 + .018]);
  }
}
function fillShelf(k: Kit, kind: 'books' | 'bottles' | 'plants' | 'display', x0: number, x1: number, y: number, room: number, d: number, row: number) {
  let seed = 1 + row * 7919; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const z = -d / 2 + d * .45, palette = ['#7d6a58', '#b9a78d', '#5f6f63', '#a35f4c', '#d8cdb9', '#3f4a52'];
  if (kind === 'books') {
    let x = x0 + rand() * .2;
    while (x < x1 - .1) {
      if (rand() < .18) { x += .12 + rand() * .2; continue; }
      const n = 3 + Math.floor(rand() * 8);
      for (let i = 0; i < n && x < x1 - .03; i++) {
        const bh = Math.min(room, .18 + rand() * .1), bw = .022 + rand() * .02;
        k.add(new T.BoxGeometry(bw, bh, d * .7), material('matte', palette[Math.floor(rand() * palette.length)]), [x + bw / 2, y + bh / 2, z]); x += bw + .002;
      }
      x += .05 + rand() * .1;
    }
  } else if (kind === 'bottles') {
    for (let x = x0 + .06; x < x1 - .04; x += .1) { k.cyl('glass', [x, y, z], .035, .035, Math.min(room, .3), 10); k.cyl('darkWood', [x, y, z], .033, .033, Math.min(room, .22), 10); }
  } else if (kind === 'plants') {
    for (let x = x0 + .15; x < x1 - .1; x += .32) { k.cyl('ceramic', [x, y, z], .07, .055, .13, 16); k.sphere(rand() > .5 ? 'leaf' : 'leafDark', [x, y + .2, z], .1, [1.1, .9, 1.1], 1); }
  } else {
    for (let x = x0 + .2; x < x1 - .1; x += .45) {
      if (rand() > .5) { k.cyl('ceramic', [x, y, z], .05, .08, Math.min(room * .8, .25), 18); }
      else { k.sphere('brass', [x, y + .07, z], .07, [1, 1, 1], 2); }
    }
  }
}
function bed(k: Kit, w: number, h: number, d: number) {
  const frame = .32, mattress = .54, board = Math.min(.1, d * .05);
  k.rbox('fabric', [-w / 2, 0, -d / 2 + board], [w / 2, frame, d / 2], .03);
  k.rbox('fabric', [-w / 2, 0, -d / 2], [w / 2, h, -d / 2 + board], .04);
  for (let i = 0; i < 4; i++) { const x0 = -w / 2 + .05 + (w - .1) * i / 4; k.box('cushion', [x0 + .01, frame + .1, -d / 2 + board], [x0 + (w - .1) / 4 - .01, h - .06, -d / 2 + board + .03]); }
  k.rbox('linen', [-w / 2 + .03, frame, -d / 2 + board + .02], [w / 2 - .03, mattress, d / 2 - .03], .05);
  const duvet = k.rbox('cushion', [-w / 2 + .01, mattress - .1, -d / 2 + board + .55], [w / 2 - .01, mattress + .07, d / 2 - .01], .06);
  duvet.material = material('fabric', '#d9d0c4');
  k.rbox('fabric', [-w / 2 + .005, mattress - .02, d / 2 - .55], [w / 2 - .005, mattress + .085, d / 2 - .005], .04);
  const pillows = w > 1.3 ? 2 : 1;
  for (let i = 0; i < pillows; i++) {
    const x = pillows === 1 ? 0 : (i ? 1 : -1) * w / 4;
    const p = k.rbox('linen', [x - Math.min(.34, w / 4.6), mattress, -d / 2 + board + .08], [x + Math.min(.34, w / 4.6), mattress + .14, -d / 2 + board + .5], .07); p.rotation.x = -.25;
  }
}
function plant(k: Kit, w: number, h: number, d: number) {
  const r = Math.min(w, d) / 2, pot = Math.min(.45, h * .28);
  k.cyl('concrete', [0, 0, 0], r * .48, r * .4, pot, 24); k.cyl('soil', [0, pot - .03, 0], r * .44, r * .44, .02, 16);
  let seed = 11; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2, rr = r * (.15 + rand() * .5), y = pot + (h - pot) * (.35 + rand() * .5);
    k.rod('bark', [0, pot, 0], [Math.cos(a) * rr * .6, y, Math.sin(a) * rr * .6], .012, 6);
    const leaf = k.sphere(i % 2 ? 'leaf' : 'leafDark', [Math.cos(a) * rr, y, Math.sin(a) * rr], Math.min(r * .45, (h - pot) * .22), [1, .55, 1], 1);
    leaf.rotation.set(rand(), rand() * 3, rand());
  }
}
function tree(k: Kit, w: number, h: number, d: number) {
  const r = Math.min(w, d) / 2;
  k.cyl('bark', [0, 0, 0], .08, .13, h * .55, 10);
  let seed = 5; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2, rr = i ? r * .45 : 0, y = h * (i ? .58 + rand() * .15 : .72);
    k.sphere(i % 2 ? 'leaf' : 'leafDark', [Math.cos(a) * rr, y, Math.sin(a) * rr], r * (.5 + rand() * .12), [1, .8, 1], 1);
  }
}
function car(k: Kit, w: number, h: number, d: number, tint: string) {
  const wheel = Math.min(.36, h * .22), paint = material('paint', tint);
  k.rbox('paint', [-w / 2 + .02, wheel * .55, -d / 2], [w / 2 - .02, h * .55, d / 2], .14).material = paint;
  k.rbox('paint', [-w / 2 + .12, h * .5, -d / 2 + d * .22], [w / 2 - .12, h, d / 2 - d * .3], .16).material = paint;
  k.rbox('screen', [-w / 2 + .115, h * .58, -d / 2 + d * .24], [w / 2 - .115, h * .96, d / 2 - d * .32], .12);
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const tyre = k.add(new T.CylinderGeometry(wheel, wheel, .22, 24), 'rubber', [x * (w / 2 - .14), wheel, z * (d / 2 - d * .18)], [0, 0, Math.PI / 2]);
    tyre.scale.set(1, 1, 1); k.add(new T.CylinderGeometry(wheel * .6, wheel * .6, .23, 16), 'chrome', [x * (w / 2 - .14), wheel, z * (d / 2 - d * .18)], [0, 0, Math.PI / 2]);
  }
  for (const x of [-1, 1]) k.box('lamp', [x * w * .32 - .12, h * .42, d / 2 - .02], [x * w * .32 + .12, h * .48, d / 2]);
}

const builders: [RegExp, Builder][] = [
  [/^lSofa$|L形沙发|转角沙发/, (k, w, h, d) => sofa(k, w, h, d, { chaise: true })],
  [/^theaterSofa$|影音沙发/, (k, w, h, d) => sofa(k, w, h, d, { seats: Math.max(2, Math.round(w / .85)) })],
  [/^(sofa|loveseat)$|沙发/, (k, w, h, d) => sofa(k, w, h, d)],
  [/^(armchair|lounge)$|单人椅|休闲椅|扶手椅/, (k, w, h, d) => sofa(k, w, h, d, { seats: 1 })],
  [/^sunLounger$/, (k, w, h, d) => {
    k.box('darkWood', [-w / 2, .2, -d / 2], [w / 2, .26, d / 2]); legs(k, w, d, .2, .05, .02, 'darkWood', 1);
    k.rbox('cushion', [-w / 2 + .03, .26, -d / 2 + d * .35], [w / 2 - .03, .33, d / 2 - .02], .03);
    const back = k.rbox('cushion', [-w / 2 + .03, .26, -d / 2 + .02], [w / 2 - .03, .33, -d / 2 + d * .38], .03); back.rotation.x = .5; back.position.y += .12;
  }],
  [/^officeChair$|办公椅/, (k, w, h, d) => {
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; k.rod('metal', [0, .06, 0], [Math.cos(a) * w * .42, .03, Math.sin(a) * d * .42], .015); k.sphere('rubber', [Math.cos(a) * w * .42, .03, Math.sin(a) * d * .42], .03); }
    k.cyl('chrome', [0, .06, 0], .025, .025, .36, 12); k.rbox('fabric', [-w * .4, .42, -d * .38], [w * .4, .5, d * .4], .04);
    const back = k.rbox('fabric', [-w * .38, .58, -d / 2], [w * .38, h, -d / 2 + .07], .04); back.rotation.x = -.1;
  }],
  [/^(chair|diningChair|barStool)$|餐椅|椅/, (k, w, h, d) => chair(k, w, h, d)],
  [/^(bed\d*|bed)$|床$/, bed],
  [/^bedBench$|床尾凳/, (k, w, h, d) => { k.rbox('fabric', [-w / 2, h - .14, -d / 2], [w / 2, h, d / 2], .04); legs(k, w, d, h - .14, .06, .02, 'brass', 1); }],
  [/^(coffeeTable)$|茶几/, (k, w, h, d) => {
    k.rbox('stone', [-w / 2, h - .05, -d / 2], [w / 2, h, d / 2], .02); k.rbox('darkWood', [-w / 2 + .1, .05, -d / 2 + .08], [w / 2 - .1, h - .05, d / 2 - .08], .02);
    k.box('black', [-w / 2 + .14, 0, -d / 2 + .12], [w / 2 - .14, .05, d / 2 - .12]);
    k.box('linen', [-w * .3, h, -d * .2], [-w * .05, h + .03, d * .15]); k.cyl('ceramic', [w * .25, h, 0], .05, .07, .2, 20); k.sphere('leaf', [w * .25, h + .26, 0], .08, [1, .7, 1]);
  }],
  [/^(teaTable)$|茶台/, (k, w, h, d) => { table(k, w, h, d, 'darkWood', 'darkWood'); k.box('stone', [-w * .3, h, -d * .25], [w * .1, h + .02, d * .25]); for (let i = 0; i < 4; i++) k.cyl('ceramic', [-w * .25 + i * .09, h + .02, 0], .025, .02, .045, 12); }],
  [/^(mahjong)$/, (k, w, h, d) => { cabinet(k, w, h - .04, d, { doors: 1, drawers: true, body: 'darkWood', front: 'darkWood', plinth: false }); k.box('felt', [-w / 2 + .05, h - .04, -d / 2 + .05], [w / 2 - .05, h - .02, d / 2 - .05]); k.box('darkWood', [-w / 2, h - .04, -d / 2], [w / 2, h, d / 2]).scale.set(1, .5, 1); }],
  [/^(outdoorSet)$/, (k, w, h, d) => {
    const r = Math.min(w, d) * .25; k.cyl('metal', [0, 0, 0], .04, .04, h - .02, 10); k.cyl('stone', [0, h - .03, 0], r, r, .03, 32); k.cyl('metal', [0, 0, 0], r * .5, r * .55, .02, 20);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4, cx = Math.cos(a) * (w / 2 - .25), cz = Math.sin(a) * (d / 2 - .25); const g = new Kit(k.tint); chair(g, .44, .8, .46); g.group.position.set(cx, 0, cz); g.group.rotation.y = Math.atan2(-cx, -cz); k.group.add(g.group); }
  }],
  [/^(longTable|diningTable|desk|consoleTable|table)$|餐桌|书桌|桌/, (k, w, h, d) => {
    if (w <= 1.3 && d < .5) { cabinet(k, w, h, d, { doors: 2, drawers: true, body: 'darkWood', front: 'darkWood', top: 'stone' }); return; }
    table(k, w, h, d, w > 1.8 ? 'stone' : 'wood', w > 1.8 ? 'metal' : 'darkWood');
    if (w > 1.8) { k.cyl('ceramic', [0, h, 0], .07, .05, .16, 24); k.sphere('leaf', [0, h + .2, 0], .09, [1.3, .6, 1]); for (const x of [-.6, .6]) k.cyl('ceramic', [x * w / 2.4, h, 0], .12, .1, .015, 24); }
  }],
  [/^(kitchenIsland|barCounter)$|岛台|吧台/, (k, w, h, d) => { cabinet(k, w, h, d - .05, { doors: Math.round(w / .6), body: 'lacquer', front: 'wood', top: 'stone' }); k.box('stone', [-w / 2, h - .03, -d / 2], [w / 2, h, d / 2]); for (const x of [-.25, .25]) k.cyl('ceramic', [x * w, h, 0], .06, .045, .12, 16); }],
  [/^lCounter$|橱柜/, (k, w, h, d) => {
    const depth = Math.min(.62, d / 2);
    cabinetAt(k, [-w / 2, -d / 2], [w / 2, -d / 2 + depth], h, { drawers: true, front: 'wood', top: 'stone', body: 'lacquer' });
    cabinetAt(k, [-w / 2, -d / 2 + depth], [-w / 2 + depth, d / 2], h, { front: 'wood', top: 'stone', body: 'lacquer', facing: 'x' });
    k.box('chrome', [-.25, h - .005, -d / 2 + .1], [.25, h + .002, -d / 2 + .5]); k.box('black', [w / 2 - .7, h, -d / 2 + .1], [w / 2 - .1, h + .006, -d / 2 + .52]);
    k.rod('chrome', [0, h, -d / 2 + .06], [0, h + .32, -d / 2 + .06], .012); k.rod('chrome', [0, h + .32, -d / 2 + .06], [0, h + .3, -d / 2 + .25], .012);
  }],
  [/^(fridge\w*)$|冰箱/, (k, w, h, d) => { k.rbox('chrome', [-w / 2, 0, -d / 2], [w / 2, h, d / 2 - .01], .02); k.box('black', [-.003, .05, d / 2 - .012], [.003, h - .05, d / 2]); for (const s of [-1, 1]) k.box('metal', [s * .05 - .008, h * .45, d / 2], [s * .05 + .008, h * .8, d / 2 + .03]); }],
  [/^(washer|dryer)$|洗衣机|烘干机/, (k, w, h, d) => { k.rbox('ceramic', [-w / 2, 0, -d / 2], [w / 2, h, d / 2 - .01], .03); k.add(new T.TorusGeometry(Math.min(w, h) * .26, .025, 10, 32), 'chrome', [0, h * .45, d / 2 - .005]); k.add(new T.CircleGeometry(Math.min(w, h) * .25, 32), 'glass', [0, h * .45, d / 2 - .002]); k.box('black', [-w / 2 + .05, h - .12, d / 2 - .01], [w / 2 - .05, h - .05, d / 2 + .002]); }],
  [/^(boiler|waterSoftener|manifold|evCharger|acFloor)$/, (k, w, h, d) => { k.rbox('ceramic', [-w / 2, 0, -d / 2], [w / 2, h, d / 2], .03); k.box('black', [-w * .3, h * .7, d / 2 - .005], [w * .3, h * .78, d / 2 + .003]); for (let i = 0; i < 5; i++) k.box('metal', [-w * .35, h * (.15 + i * .08), d / 2 - .004], [w * .35, h * (.15 + i * .08) + .006, d / 2 + .002]); }],
  [/^(acWall)$|空调/, (k, w, h, d) => { k.rbox('ceramic', [-w / 2, 0, -d / 2], [w / 2, h, d / 2], .05); k.box('metal', [-w / 2 + .05, .03, d / 2 - .03], [w / 2 - .05, .05, d / 2 + .001]); }],
  [/^(toilet)$|马桶/, (k, w, h, d) => {
    k.rbox('ceramic', [-w / 2, h * .5, -d / 2], [w / 2, h, -d / 2 + d * .28], .04);
    const bowl = k.add(new T.CylinderGeometry(w * .48, w * .32, h * .5, 28), 'ceramic', [0, h * .25, d * .08]); bowl.scale.set(1, 1, 1.35);
    const seat = k.add(new T.TorusGeometry(w * .36, .03, 10, 28), 'ceramic', [0, h * .51, d * .08], [Math.PI / 2, 0, 0]); seat.scale.set(1, 1.35, 1);
    k.box('chrome', [-.03, h - .005, -d / 2 + .08], [.03, h + .005, -d / 2 + .14]);
  }],
  [/^(vanity)$|浴室柜|台盆/, (k, w, h, d) => {
    cabinet(k, w, h - .03, d, { doors: 2, body: 'wood', front: 'wood', plinth: false });
    k.box('stone', [-w / 2, h - .03, -d / 2], [w / 2, h, d / 2 + .01]);
    const basin = k.add(new T.CylinderGeometry(.2, .15, .12, 32), 'ceramic', [0, h + .06, .02]); basin.scale.set(1.2, 1, 1);
    k.rod('chrome', [0, h, -d / 2 + .06], [0, h + .25, -d / 2 + .06], .012); k.rod('chrome', [0, h + .25, -d / 2 + .06], [0, h + .23, -d / 2 + .2], .012);
  }],
  [/^(shower)$|淋浴/, (k, w, h, d) => {
    k.box('stone', [-w / 2, 0, -d / 2], [w / 2, .04, d / 2]);
    k.box('glass', [-w / 2, .04, d / 2 - .01], [w / 2, h, d / 2]); k.box('glass', [-w / 2, .04, -d / 2], [-w / 2 + .01, h, d / 2]);
    k.box('chrome', [-w / 2, h - .02, d / 2 - .02], [w / 2, h, d / 2]); k.box('chrome', [-w / 2, h - .02, -d / 2], [-w / 2 + .02, h, d / 2]);
    k.rod('chrome', [w / 2 - .1, 1, -d / 2 + .03], [w / 2 - .1, h - .05, -d / 2 + .03], .012); k.cyl('chrome', [w / 2 - .1, h - .1, -d / 2 + .15], .1, .1, .015, 24);
  }],
  [/^(bathtub)$|浴缸/, (k, w, h, d) => {
    k.rbox('ceramic', [-w / 2, 0, -d / 2], [w / 2, h, d / 2], .12);
    const inner = k.rbox('water', [-w / 2 + .08, h * .45, -d / 2 + .08], [w / 2 - .08, h - .02, d / 2 - .08], .1); inner.scale.y = 1;
    k.rod('chrome', [w / 2 - .12, h, 0], [w / 2 - .12, h + .2, 0], .015); k.rod('chrome', [w / 2 - .12, h + .2, 0], [w / 2 - .22, h + .18, 0], .012);
  }],
  [/^(sauna)$|桑拿/, (k, w, h, d) => { k.box('wood', [-w / 2, 0, -d / 2], [w / 2, h, d / 2 - .02]); k.box('glass', [-w * .3, .05, d / 2 - .02], [w * .3, h - .1, d / 2]); k.box('darkWood', [-w / 2 + .05, .45, -d / 2 + .05], [w / 2 - .05, .5, 0]); }],
  [/^(wardrobe|cabWardrobe)$|衣柜/, (k, w, h, d) => cabinet(k, w, h, d, { doors: Math.max(2, Math.round(w / .5)), body: 'lacquer', front: 'lacquer' })],
  [/^(bookshelf)$|书架|书柜/, (k, w, h, d) => cabinet(k, w, h, d, { open: 'books', body: 'wood' })],
  [/^(displayCabinet)$|展示柜|博古架/, (k, w, h, d) => cabinet(k, w, h, d, { open: 'display', body: 'darkWood' })],
  [/^(wineCabinet)$|酒柜/, (k, w, h, d) => cabinet(k, w, h, d, { open: 'bottles', body: 'darkWood' })],
  [/^(plantShelf)$/, (k, w, h, d) => cabinet(k, w, h, d, { open: 'plants', body: 'metal', plinth: false })],
  [/^(garageShelf)$/, (k, w, h, d) => cabinet(k, w, h, d, { open: 'display', body: 'metal', plinth: false })],
  [/^(workbench)$/, (k, w, h, d) => { table(k, w, .9, d, 'wood', 'metal'); k.box('lacquer', [-w / 2, .9, -d / 2], [w / 2, h, -d / 2 + .03]); for (let i = 0; i < 6; i++) k.box('metal', [-w / 2 + .1 + i * (w - .2) / 6, 1.2, -d / 2 + .03], [-w / 2 + .14 + i * (w - .2) / 6, 1.45, -d / 2 + .06]); }],
  [/^(nightstand)$|床头柜/, (k, w, h, d) => {
    cabinet(k, w, h, d, { doors: 1, drawers: true, body: 'darkWood', front: 'darkWood' });
    k.cyl('ceramic', [w * .15, h, -d * .1], .06, .07, .2, 20); k.cyl('linen', [w * .15, h + .2, -d * .1], .1, .13, .16, 24).material = material('lamp', '');
    k.light([w * .15, h + .3, -d * .1], .35);
  }],
  [/^(tvCabinet|sideboard|shoeCabinet)$|电视柜|边柜|鞋柜/, (k, w, h, d) => {
    cabinet(k, w, h, d, { doors: Math.max(2, Math.round(w / .6)), drawers: h < .6, body: 'darkWood', front: 'wood', top: h < .6 ? 'stone' : undefined });
    if (w > 1.5) { k.cyl('ceramic', [-w * .32, h, 0], .06, .09, .3, 24); k.sphere('brass', [w * .3, h + .08, 0], .08, [1, 1, 1], 2); }
  }],
  [/^(rug)$|地毯/, (k, w, h, d) => {
    k.rbox('fabric', [-w / 2, 0, -d / 2], [w / 2, Math.max(.008, h), d / 2], .004).castShadow = false;
    k.box('cushion', [-w / 2 + .12, Math.max(.008, h), -d / 2 + .12], [w / 2 - .12, Math.max(.008, h) + .001, -d / 2 + .16]).castShadow = false;
    k.box('cushion', [-w / 2 + .12, Math.max(.008, h), d / 2 - .16], [w / 2 - .12, Math.max(.008, h) + .001, d / 2 - .12]).castShadow = false;
  }],
  [/^(curtain)$|窗帘/, (k, w, h, d) => {
    const folds = Math.max(6, Math.round(w / .12)), shape = new T.Shape();
    shape.moveTo(-w / 2, 0);
    for (let i = 0; i <= folds * 8; i++) { const x = -w / 2 + w * i / (folds * 8); shape.lineTo(x, Math.sin(i / 8 * Math.PI * 2) * (d / 2 - .02)); }
    for (let i = folds * 8; i >= 0; i--) { const x = -w / 2 + w * i / (folds * 8); shape.lineTo(x, Math.sin(i / 8 * Math.PI * 2) * (d / 2 - .02) - .012); }
    const geometry = new T.ExtrudeGeometry(shape, { depth: h - .06, bevelEnabled: false, curveSegments: 2 });
    geometry.rotateX(-Math.PI / 2);
    const mesh = k.add(geometry, 'linen', [0, 0, 0]); mesh.material = material('fabric', '#ece6dc');
    k.rod('brass', [-w / 2, h - .03, 0], [w / 2, h - .03, 0], .015);
  }],
  [/^(chandelier)$|吊灯/, (k, w, h, d) => {
    const r = Math.min(w, d) / 2 - .05;
    k.rod('brass', [0, h, 0], [0, h * .35, 0], .01); k.cyl('brass', [0, h - .02, 0], .08, .08, .02, 20);
    for (const [rr, y] of [[r, h * .2], [r * .62, h * .08]] as [number, number][]) {
      k.add(new T.TorusGeometry(rr, .012, 8, 48), 'brass', [0, y + .2, 0], [Math.PI / 2, 0, 0]);
      for (let i = 0; i < Math.round(rr * 14); i++) { const a = i / Math.round(rr * 14) * Math.PI * 2; k.sphere('lamp', [Math.cos(a) * rr, y + .12, Math.sin(a) * rr], .045, [1, 1.4, 1], 1); k.rod('brass', [0, y + .45, 0], [Math.cos(a) * rr, y + .21, Math.sin(a) * rr], .004, 4); }
    }
    k.light([0, h * .2, 0], 1.6);
  }],
  [/^(lawnLamp|floorLamp)$|落地灯|草坪灯/, (k, w, h, d) => { k.cyl('metal', [0, 0, 0], w * .2, w * .3, h - .15, 12); k.cyl('lamp', [0, h - .15, 0], w * .4, w * .45, .13, 16); k.cyl('metal', [0, h - .02, 0], w * .5, w * .5, .02, 16); k.light([0, h - .1, 0], .3); }],
  [/^(bigPlant|plant|pottedPlant)$|绿植|盆栽/, plant],
  [/^(shrub)$/, (k, w, h, d) => { for (let i = 0; i < 5; i++) { const a = i * 1.3; k.sphere(i % 2 ? 'leaf' : 'leafDark', [Math.cos(a) * w * .22, h * .45, Math.sin(a) * d * .22], Math.min(w, d) * .32, [1, h / Math.min(w, d) * 1.1, 1]); } }],
  [/^(tree)$|树/, tree],
  [/^(lawn)$|草坪/, (k, w, h, d) => { k.box('grass', [-w / 2, 0, -d / 2], [w / 2, Math.max(.01, h), d / 2]).castShadow = false; }],
  [/^(stepStones)$/, (k, w, h, d) => { const n = Math.max(2, Math.round(d / .75)); for (let i = 0; i < n; i++) { const z = -d / 2 + d * (i + .5) / n; k.rbox('concrete', [-w / 2, 0, z - .22], [w / 2, Math.max(.02, h), z + .22], .01).castShadow = false; } }],
  [/^(pool)$|泳池/, (k, w, h, d) => { k.box('stone', [-w / 2, 0, -d / 2], [w / 2, Math.max(.03, h), -d / 2 + .25]); k.box('stone', [-w / 2, 0, d / 2 - .25], [w / 2, Math.max(.03, h), d / 2]); k.box('stone', [-w / 2, 0, -d / 2 + .25], [-w / 2 + .25, Math.max(.03, h), d / 2 - .25]); k.box('stone', [w / 2 - .25, 0, -d / 2 + .25], [w / 2, Math.max(.03, h), d / 2 - .25]); k.box('water', [-w / 2 + .25, 0, -d / 2 + .25], [w / 2 - .25, Math.max(.03, h) - .015, d / 2 - .25]).castShadow = false; }],
  [/^(parasol)$|遮阳伞/, (k, w, h, d) => { k.cyl('metal', [0, 0, 0], .25, .3, .06, 20); k.rod('wood', [0, .06, 0], [0, h - .1, 0], .025); k.add(new T.ConeGeometry(Math.min(w, d) / 2, .5, 8, 1, true), 'linen', [0, h - .25, 0]).material = material('fabric', '#ece3d3'); }],
  [/^(gazebo|carport\d*)$|凉亭|车棚/, (k, w, h, d) => {
    for (const x of [-1, 1]) for (const z of [-1, 1]) k.box('darkWood', [x * (w / 2 - .06) - .06, 0, z * (d / 2 - .06) - .06], [x * (w / 2 - .06) + .06, h - .15, z * (d / 2 - .06) + .06]);
    k.box('darkWood', [-w / 2, h - .2, -d / 2], [w / 2, h - .1, d / 2]).scale.set(1, 1, 1);
    for (let i = 0; i < Math.round(w / .3); i++) { const x = -w / 2 + .1 + i * (w - .2) / Math.max(1, Math.round(w / .3) - 1); k.box('wood', [x - .025, h - .1, -d / 2], [x + .025, h, d / 2]); }
  }],
  [/^(swing)$|秋千/, (k, w, h, d) => { for (const x of [-1, 1]) { k.rod('darkWood', [x * w / 2, 0, -d / 2], [x * w / 2, h, 0], .04); k.rod('darkWood', [x * w / 2, 0, d / 2], [x * w / 2, h, 0], .04); k.rod('metal', [x * w * .25, h, 0], [x * w * .25, .5, 0], .008); } k.rod('darkWood', [-w / 2, h, 0], [w / 2, h, 0], .05); k.rbox('cushion', [-w * .3, .45, -.25], [w * .3, .55, .25], .04); }],
  [/^(bbq)$/, (k, w, h, d) => { cabinet(k, w, h - .02, d, { doors: 3, body: 'metal', front: 'chrome', plinth: false }); k.box('black', [-w / 2, h - .02, -d / 2], [w / 2, h, d / 2]); }],
  [/^(waterFeature)$|水景/, (k, w, h, d) => { k.box('stone', [-w / 2, 0, -d / 2], [w / 2, h, -d / 2 + .2]); k.box('stone', [-w / 2, 0, -d / 2], [w / 2, .4, d / 2]); k.box('water', [-w / 2 + .06, .3, -d / 2 + .2], [w / 2 - .06, .38, d / 2 - .06]); k.box('water', [-w * .2, .38, -d / 2 + .2], [w * .2, h - .2, -d / 2 + .215]); }],
  [/^(gate)$|大门/, (k, w, h, d) => { k.box('metal', [-w / 2, h - .06, -d / 2], [w / 2, h, d / 2]); k.box('metal', [-w / 2, 0, -d / 2], [w / 2, .08, d / 2]); for (let x = -w / 2 + .05; x <= w / 2 - .02; x += .12) k.box('metal', [x - .015, .08, -.015], [x + .015, h - .06, .015]); }],
  [/^(bicycle)$/, (k, w, h, d) => { for (const z of [-1, 1]) k.add(new T.TorusGeometry(.33, .022, 8, 32), 'rubber', [0, .35, z * (d / 2 - .35)], [0, Math.PI / 2, 0]); k.rod('paint', [0, .35, -d / 2 + .35], [0, .75, 0], .02); k.rod('paint', [0, .35, d / 2 - .35], [0, .75, 0], .02); k.rod('paint', [0, .75, 0], [0, .85, -d / 2 + .45], .02); k.box('black', [-.06, .85, -d / 2 + .4], [.06, .9, -d / 2 + .6]); k.rod('chrome', [-w / 2 + .05, h - .05, d / 2 - .4], [w / 2 - .05, h - .05, d / 2 - .4], .015); }],
  [/^(grandPiano|piano)$|钢琴/, (k, w, h, d) => {
    const shape = new T.Shape(); shape.moveTo(-w / 2, -d / 2); shape.lineTo(w / 2, -d / 2); shape.lineTo(w / 2, d * .05);
    shape.bezierCurveTo(w / 2, d * .45, w * .1, d * .1, -w * .05, d / 2); shape.lineTo(-w / 2, d / 2); shape.lineTo(-w / 2, -d / 2);
    const body = new T.ExtrudeGeometry(shape, { depth: .3, bevelEnabled: true, bevelSize: .01, bevelThickness: .01, bevelSegments: 2 }); body.rotateX(Math.PI / 2);
    k.add(body, 'black', [0, h * .72 + .3, 0]);
    for (const [x, z] of [[-w * .4, -d * .4], [w * .4, -d * .4], [-w * .2, d * .4]]) k.cyl('black', [x, 0, z], .04, .05, h * .72 - .01, 12);
    k.box('ceramic', [-w / 2 + .05, h * .72 + .02, -d / 2 - .0], [w / 2 - .05, h * .72 + .06, -d / 2 + .14]);
    const lid = k.add(new T.ExtrudeGeometry(shape, { depth: .015, bevelEnabled: false }), 'black', [0, h * .72 + .32, 0]); lid.geometry.rotateX(Math.PI / 2);
  }],
  [/^(billiards)$|台球/, (k, w, h, d) => { legs(k, w, d, h - .18, .2, .07, 'darkWood', .8); k.box('darkWood', [-w / 2 + .1, h - .3, -d / 2 + .1], [w / 2 - .1, h - .12, d / 2 - .1]); k.rbox('darkWood', [-w / 2, h - .12, -d / 2], [w / 2, h, d / 2], .03); k.box('felt', [-w / 2 + .12, h - .1, -d / 2 + .12], [w / 2 - .12, h - .015, d / 2 - .12]); }],
  [/^(projScreen)$|幕布/, (k, w, h, d) => { k.box('black', [-w / 2, 0, -d / 2], [w / 2, h, d / 2]); k.box('ceramic', [-w / 2 + .05, .05, d / 2 - .01], [w / 2 - .05, h - .05, d / 2 + .002]); }],
  [/^(speaker)$|音箱/, (k, w, h, d) => { k.rbox('darkWood', [-w / 2, 0, -d / 2], [w / 2, h, d / 2], .02); for (const [y, r] of [[h * .3, w * .32], [h * .62, w * .25], [h * .85, w * .12]]) k.add(new T.CircleGeometry(r, 24), 'black', [0, y, d / 2 + .002]); }],
  [/^(elevator)$|电梯/, (k, w, h, d) => { k.box('concrete', [-w / 2, 0, -d / 2], [w / 2, h, d / 2 - .03]); k.box('chrome', [-w * .4, 0, d / 2 - .03], [w * .4, Math.min(h, 2.2), d / 2]); k.box('black', [-.002, 0, d / 2 - .001], [.002, Math.min(h, 2.2), d / 2 + .001]); }],
  [/^(car|suv)$|汽车/, (k, w, h, d) => car(k, w, h, d, k.tint)],
];

/** Builds a detailed prop for a named object, or null when the name has no builder (callers keep the plain volume). */
export function ambienceProp(name: string | undefined, size: PropSize, color: string): T.Group | null {
  if (!name) return null;
  const builder = builders.find(([pattern]) => pattern.test(name))?.[1];
  const kit = new Kit(color);
  const { width: w, height: h, depth: d } = size;
  if (builder) builder(kit, w, h, d);
  else kit.rbox('fabric', [-w / 2, 0, -d / 2], [w / 2, h, d / 2], Math.min(.03, w / 6, h / 6, d / 6));
  return finish(kit.group);
}

/** Merge by material to keep draw calls low on phones; lamp-tagged meshes stay separate for night toggling. */
function finish(group: T.Group) {
  group.updateMatrixWorld(true);
  const buckets = new Map<T.Material, T.BufferGeometry[]>(), shadowless = new Set<T.Material>(), keep: T.Object3D[] = [];
  const meshes: T.Mesh[] = [];
  group.traverse(node => { if (node instanceof T.Mesh) meshes.push(node); else if (node.userData.lightAnchor) keep.push(node); });
  for (const mesh of meshes) {
    const mat = mesh.material as T.Material;
    const geometry = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
    for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    if (!geometry.attributes.uv) geometry.setAttribute('uv', new T.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    geometry.clearGroups();
    if (!mesh.castShadow) shadowless.add(mat);
    buckets.set(mat, [...buckets.get(mat) ?? [], geometry]);
    mesh.geometry.dispose();
  }
  const result = new T.Group();
  for (const [mat, geometries] of buckets) {
    const merged = mergeGeometries(geometries, false); geometries.forEach(geometry => geometry.dispose());
    if (!merged) continue;
    const mesh = new T.Mesh(merged, mat);
    mesh.castShadow = !shadowless.has(mat) && !(mat as T.MeshStandardMaterial).transparent; mesh.receiveShadow = true;
    result.add(mesh);
  }
  for (const anchor of keep) { anchor.position.setFromMatrixPosition(anchor.matrixWorld); anchor.removeFromParent(); result.add(anchor); }
  return result;
}

function cabinetAt(k: Kit, min: [number, number], max: [number, number], h: number, options: { drawers?: boolean; front: Surface; top: Surface; body: Surface; facing?: 'x' }) {
  const sub = new Kit(k.tint), w = max[0] - min[0], d = max[1] - min[1];
  if (options.facing === 'x') { cabinet(sub, d, h, w, { doors: Math.round(d / .6), drawers: options.drawers, front: options.front, top: options.top, body: options.body }); sub.group.rotation.y = Math.PI / 2; }
  else cabinet(sub, w, h, d, { doors: Math.round(w / .6), drawers: options.drawers, front: options.front, top: options.top, body: options.body });
  sub.group.position.set((min[0] + max[0]) / 2, 0, (min[1] + max[1]) / 2); k.group.add(sub.group);
}
