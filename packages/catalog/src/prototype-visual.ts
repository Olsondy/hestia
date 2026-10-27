import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { CatalogMaterial, CatalogSize } from '../../contracts/src/catalog';

/** Port of the named furniture builders in example/prototypes/projects/src/sample/model.js.
 * Local primitives, cushions, joinery and tabletop props retain that source geometry; no external models.
 * The source's west-facing sofa/table are rotated to width=x, depth=z, then fitted to the catalog envelope.
 */
export function prototypeFurniture(itemId: string, material: CatalogMaterial, size: CatalogSize) {
  const root = new T.Group(), content = new T.Group(); root.add(content);
  const textures = prototypeTextures();
  const colors: Record<string, string> = { ceramic: '#faf9f0', metal: '#343e3b', black: '#272e2e', white: '#eeeee7', screen: '#263c42', ...material.colors };
  const mats: Record<string, T.MeshStandardMaterial> = {};
  for (const [surface, color] of Object.entries(colors)) {
    const fabric = ['fabric', 'linen', 'green', 'rug'].includes(surface), wood = ['oak', 'walnut'].includes(surface);
    const map = fabric ? textures.fabric : wood ? material.id === 'prototype-cream' ? null : material.id === 'prototype-chinese' ? textures.walnut : textures.wood : null;
    mats[surface] = new T.MeshStandardMaterial({ color, roughness: fabric ? .95 : surface === 'ceramic' ? .19 : surface === 'metal' || surface === 'brass' ? .36 : .52,
      metalness: surface === 'metal' || surface === 'brass' ? .65 : 0, map: map || null, ...(fabric && map ? { bumpMap: map, bumpScale: .009 } : {}) });
  }
  const m = mats;
  const add = (g: T.Group, geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number) => {
    const mesh = new T.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh;
  };
  const box = (g: T.Group, x: number, y: number, z: number, w: number, h: number, d: number, mat = m.oak) => add(g, new T.BoxGeometry(w, h, d), mat, x, y, z);
  const round = (g: T.Group, x: number, y: number, z: number, w: number, h: number, d: number, mat = m.fabric, r = .06) => add(g, new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 3, h / 3, d / 3)), mat, x, y, z);
  const cyl = (g: T.Group, x: number, y: number, z: number, r: number, h: number, mat = m.metal) => add(g, new T.CylinderGeometry(r, r, h, 24), mat, x, y, z);
  const rod = (g: T.Group, a: [number, number, number], b: [number, number, number], r = .014, mat = m.metal) => {
    const va = new T.Vector3(...a), vb = new T.Vector3(...b), mid = va.clone().add(vb).multiplyScalar(.5);
    const mesh = cyl(g, mid.x, mid.y, mid.z, r, va.distanceTo(vb), mat); mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), vb.sub(va).normalize()); return mesh;
  };
  const book = (g: T.Group, x: number, y: number, z: number, w = .16, d = .22, color = '#74806a', rot = 0) => {
    const b = new T.Group(); b.position.set(x, y, z); b.rotation.y = rot; g.add(b);
    box(b, 0, .017, 0, w, .034, d, new T.MeshStandardMaterial({ color, roughness: .85 })); box(b, 0, .017, .004, w - .01, .02, d - .012, m.linen);
  };
  const cup = (g: T.Group, x: number, y: number, z: number) => {
    cyl(g, x, y + .055, z, .04, .11, m.ceramic); const handle = add(g, new T.TorusGeometry(.033, .008, 8, 20), m.ceramic, x + .047, y + .06, z); handle.rotation.y = Math.PI / 2;
  };
  const deskLamp = (g: T.Group, x: number, y: number, z: number) => {
    cyl(g, x, y + .015, z, .1, .03, m.brass); rod(g, [x, y + .02, z], [x, y + .32, z], .012, m.brass); rod(g, [x, y + .32, z], [x + .1, y + .44, z], .012, m.brass);
    const shade = add(g, new T.ConeGeometry(.105, .14, 24, 1, true), m.brass, x + .1, y + .41, z); shade.rotation.z = -.25;
    box(g, x + .1, y + .355, z, .12, .006, .12, new T.MeshStandardMaterial({ color: '#fff0c8' }));
  };
  const g = content;
  if (itemId === 'sofa') {
    round(g, 0, .3, 0, .95, .34, 2.2, m.fabric, .1); round(g, .36, .67, 0, .24, .77, 2.04, m.fabric, .1);
    for (const zz of [-.68, 0, .68]) { round(g, -.12, .53, zz, .65, .18, .64, m.linen, .07); const back = round(g, .2, .83, zz, .19, .53, .65, m.fabric, .08); back.rotation.z = -.13; }
    for (const zz of [-1.03, 1.03]) round(g, -.04, .62, zz, .82, .46, .16, m.fabric, .06);
    for (const xx of [-.32, .32]) for (const zz of [-.91, .91]) cyl(g, xx, .1, zz, .025, .2, m.walnut);
    const pillow = round(g, -.16, .79, -.71, .26, .39, .38, m.green, .08); pillow.rotation.x = .1; pillow.rotation.z = .35;
    content.rotation.y = -Math.PI / 2;
  } else if (itemId === 'coffee-table') {
    round(g, 0, .4, 0, .55, .065, .9, m.oak, .05);
    for (const xx of [-.2, .2]) for (const zz of [-.34, .34]) cyl(g, xx, .2, zz, .022, .38, m.walnut);
    book(g, -.06, .44, -.17, .19, .27, '#75826f', .12); cup(g, .12, .44, .19); content.rotation.y = -Math.PI / 2;
  } else if (itemId === 'reading-chair') {
    round(g, 0, .47, 0, .72, .17, .72, m.linen, .1); round(g, 0, .76, .29, .71, .65, .15, m.fabric, .09);
    for (const xx of [-.31, .31]) { round(g, xx, .63, 0, .1, .24, .65, m.oak, .04); rod(g, [xx, .05, -.24], [xx, .5, -.24], .025, m.walnut); rod(g, [xx, .05, .27], [xx, .5, .27], .025, m.walnut); }
  } else if (itemId === 'study-desk') {
    round(g, 0, .75, 0, 1.4, .055, .6, m.oak, .02);
    for (const xx of [-.6, .6]) for (const zz of [-.22, .22]) rod(g, [xx, .04, zz], [xx, .72, zz], .023, m.walnut);
    box(g, 0, .8, .03, .35, .018, .25, m.metal); const screen = box(g, 0, .93, -.06, .35, .24, .014, m.screen); screen.rotation.x = -.16;
    deskLamp(g, -.52, .78, -.14); for (let i = 0; i < 3; i++) book(g, .45, .78 + i * .04, .02, .2, .25, ['#7c8b6f', '#b5a186', '#8d7964'][i], .05 * i);
  } else throw new Error('Unsupported prototype furniture item.');
  root.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(content), sourceSize = bounds.getSize(new T.Vector3()), center = bounds.getCenter(new T.Vector3());
  content.position.set(-center.x, -bounds.min.y, -center.z);
  root.scale.set(size.width / sourceSize.x, size.height / sourceSize.y, size.depth / sourceSize.z);
  root.userData.sourceDimensions = { width: sourceSize.x, height: sourceSize.y, depth: sourceSize.z };
  // Dispose eagerly allocated unused palette resources; used resources belong to this object only.
  const usedMaterials = new Set<T.Material>(); root.traverse(node => { if (node instanceof T.Mesh) (Array.isArray(node.material) ? node.material : [node.material]).forEach(mat => usedMaterials.add(mat)); });
  const usedTextures = new Set<T.Texture>(); for (const mat of usedMaterials) if (mat instanceof T.MeshStandardMaterial) { if (mat.map) usedTextures.add(mat.map); if (mat.bumpMap) usedTextures.add(mat.bumpMap); }
  Object.values(mats).filter(mat => !usedMaterials.has(mat)).forEach(mat => mat.dispose());
  Object.values(textures).filter((texture): texture is T.Texture => !!texture && !usedTextures.has(texture)).forEach(texture => texture.dispose());
  return root;
}

/** Deterministic port of the original wood/walnut/fabric canvas textures. No texture URLs or DOM requirement in geometry tests. */
function prototypeTextures(): { wood: T.Texture | null; walnut: T.Texture | null; fabric: T.Texture | null } {
  if (typeof document === 'undefined') return { wood: null, walnut: null, fabric: null };
  let seed = 71933; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const texture = (draw: (c: CanvasRenderingContext2D, size: number) => void, size = 512) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size; const c = canvas.getContext('2d'); if (!c) return null;
    draw(c, size); const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace; map.wrapS = map.wrapT = T.RepeatWrapping; return map;
  };
  const wood = texture((c, size) => {
    c.fillStyle = '#c8b28e'; c.fillRect(0, 0, size, size);
    for (let k = 0; k < 8; k++) { const y = k * size / 8; c.fillStyle = `hsl(35,25%,${63 + rand() * 12}%)`; c.fillRect(0, y, size, size / 8);
      for (let i = 0; i < 100; i++) { c.strokeStyle = `rgba(${rand() > .5 ? '87,64,34' : '246,227,187'},${.025 + rand() * .11})`; c.lineWidth = .3 + rand() * .8; c.beginPath(); const yy = y + rand() * size / 8;
        for (let x = 0; x <= size; x += 8) { const v = Math.sin(x / 55 + k * 2 + i) * .7 + Math.sin(x / 190 + i) * 2; if (!x) c.moveTo(x, yy + v); else c.lineTo(x, yy + v); } c.stroke(); }
      c.fillStyle = '#8e806757'; c.fillRect(0, y, size, 1); c.fillRect((k % 3) * size / 3, y, 1, size / 8);
    }
  }, 1024);
  const walnut = texture((c, size) => { c.fillStyle = '#8a6b47'; c.fillRect(0, 0, size, size); for (let i = 0; i < 1600; i++) { const x = rand() * size; c.strokeStyle = `rgba(42,25,10,${rand() * .14})`; c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + 12 * Math.sin(i), size * .3, x - 9 * Math.cos(i), size * .7, x, size); c.stroke(); } });
  const fabric = texture((c, size) => { c.fillStyle = '#dfdbce'; c.fillRect(0, 0, size, size); for (let y = 0; y < size; y += 3) { c.strokeStyle = `rgba(70,67,53,${.03 + rand() * .08})`; c.beginPath(); c.moveTo(0, y); c.lineTo(size, y); c.stroke(); } for (let x = 0; x < size; x += 3) { c.fillStyle = `rgba(255,255,243,${.07 + rand() * .12})`; c.fillRect(x, 0, 1, size); } for (let i = 0; i < 15000; i++) { c.fillStyle = rand() > .5 ? '#fff8' : '#6554'; c.fillRect(rand() * size, rand() * size, 1, 1); } });
  return { wood, walnut, fabric };
}
