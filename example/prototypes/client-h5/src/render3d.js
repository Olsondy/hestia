// 效果图（确定性离屏渲染）与简化 3D 体块查看。仅为原型演示，不代表正式出图管线。
import * as THREE from 'three';
import {villa, facetById} from './data.js';
import {floorCanvas, wallCanvas, stoneCanvas} from './stone.js';

let shared = null;
const images = new Map();

function tex(canvas, repeat) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
const plaster = color => new THREE.MeshStandardMaterial({color, roughness: .92});
function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  parent.add(m); return m;
}

function furnish(scene, W, D, kind) {
  const fabric = plaster('#d9cfc3'), dark = new THREE.MeshStandardMaterial({color: '#3a302b', roughness: .45}), wood = plaster('#8a6a52');
  if (kind === 'tea') {
    box(2.2, .38, .9, wood, .4, .19, -.2, scene);
    for (const dx of [-.8, .8]) box(.5, .12, .5, fabric, .4 + dx, .06, .65, scene);
    box(.9, .9, .35, dark, W / 2 - .5, .45, -D / 2 + .3, scene);
    return;
  }
  const chair = x => { const g = new THREE.Group(); box(.8, .36, .8, fabric, 0, .18, 0, g); box(.8, .4, .14, fabric, 0, .55, .33, g); g.position.set(x, 0, .9); g.rotation.y = Math.PI + (x > 0 ? -.35 : .35); scene.add(g); };
  chair(1.9);
  const table = new THREE.Mesh(new THREE.CylinderGeometry(.45, .45, .34, 48), dark);
  table.position.set(1.2, .17, -.2); table.castShadow = true; scene.add(table);
  box(2.4, .5, .42, dark, .2, .25, -D / 2 + .32, scene); // 电视柜
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(.22, .17, .5, 32), plaster('#cdbfae'));
  pot.position.set(W / 2 - .5, .25, -D / 2 + .6); pot.castShadow = true; scene.add(pot);
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(.48, 24, 16), plaster('#5f6b4f'));
  leaf.position.set(W / 2 - .5, 1.05, -D / 2 + .6); leaf.scale.set(1, 1.3, 1); leaf.castShadow = true; scene.add(leaf);
}

function buildRoom(floorId, scheme) {
  const fl = villa.floors.find(f => f.id === floorId);
  const sc = fl.scene;
  const room = fl.rooms.find(r => r.id === sc.room);
  const [, , W, D] = room.rect, H = 3.2;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8e0d5');
  const fin = scheme.finishes[sc.floor];
  const floorMat = fin
    ? new THREE.MeshStandardMaterial({map: tex(floorCanvas(fin, W, D)), roughness: .22, metalness: .02})
    : new THREE.MeshStandardMaterial({color: '#c9b9a6', roughness: .7});
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const wallMat = plaster('#efe8de');
  box(W, H, .12, wallMat, 0, H / 2, -D / 2 - .06, scene);
  box(.12, H, D, wallMat, -W / 2 - .06, H / 2, 0, scene);
  const wallFin = sc.wall && scheme.finishes[sc.wall];
  if (wallFin) {
    const ww = 4.2, wh = 2.9;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), new THREE.MeshStandardMaterial({map: tex(wallCanvas(wallFin, ww, wh)), roughness: .3}));
    panel.position.set(.2, wh / 2 + .02, -D / 2 + .005); panel.receiveShadow = true; scene.add(panel);
  } else if (sc.room === 'tea') {
    box(3.2, 2.2, .04, plaster('#9a7b62'), .4, 1.4, -D / 2 + .02, scene);
  }
  const stairFin = sc.stair && scheme.finishes[sc.stair];
  if (sc.stair) {
    const treadMat = stairFin ? new THREE.MeshStandardMaterial({map: tex(stoneCanvas(stairFin.stone), [1, .3]), roughness: .28}) : plaster('#b7a48f');
    const riser = plaster('#e6ddd1');
    for (let i = 0; i < 12; i++) {
      const y = (i + 1) * .175, z = D / 2 - .9 - i * .28;
      box(1.1, y - .04, .28, riser, -W / 2 + .6, (y - .04) / 2, z, scene);
      box(1.14, .04, .3, treadMat, -W / 2 + .6, y - .02, z + .01, scene);
    }
  }
  furnish(scene, W, D, sc.room);
  scene.add(new THREE.HemisphereLight('#fff7ec', '#a8927c', 1.1));
  const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
  sun.position.set(W / 2 + 4, 6, D / 2 + 1); sun.target.position.set(-1, 0, -1);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {left: -8, right: 8, top: 8, bottom: -8});
  sun.shadow.bias = -.0004; sun.shadow.radius = 6;
  scene.add(sun, sun.target);
  const fill = new THREE.PointLight('#ffe6c8', 6, 12); fill.position.set(0, 2.9, 0); scene.add(fill);
  return {scene, W, D, H};
}

function renderer() {
  if (shared) return shared;
  const r = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = .86;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  shared = r; return r;
}

export function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

// 渲染某方案某楼层的效果图，返回 dataURL 并缓存。
export function renderImage(floorId, scheme, w = 960, h = 760) {
  const key = JSON.stringify([floorId, scheme.finishes, w, h]);
  if (images.has(key)) return images.get(key);
  if (!webglOK()) return null;
  const r = renderer();
  r.setPixelRatio(1); r.setSize(w, h, false);
  const {scene, W, D} = buildRoom(floorId, scheme);
  const cam = new THREE.PerspectiveCamera(52, w / h, .1, 60);
  cam.position.set(W / 2 - .2, 1.45, D / 2 + .9);
  cam.lookAt(-W * .12, .45, -D * .2);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/jpeg', .88);
  scene.traverse(o => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
  images.set(key, url);
  return url;
}

// 简化 3D：三层体块剖切，房间地面贴当前方案石材。
export function mountViewer(host, scheme, floorId, mode) {
  if (!webglOK()) { host.innerHTML = '<p class="viewer-fallback">此浏览器不支持 WebGL，无法显示 3D 演示。</p>'; return () => {}; }
  const r = new THREE.WebGLRenderer({antialias: true});
  r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
  r.setPixelRatio(Math.min(2, devicePixelRatio));
  host.append(r.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#ddd2c4');
  scene.add(new THREE.HemisphereLight('#fff8ee', '#9c8a78', 1.6));
  const sun = new THREE.DirectionalLight('#fff', 1.8); sun.position.set(8, 14, 10); scene.add(sun);
  const root = new THREE.Group(); scene.add(root);
  const slab = plaster('#efe8de'), wall = plaster('#f6f1e8'), neutral = plaster('#cdbca8');
  villa.floors.forEach((fl, i) => {
    if (mode === 'floor' && fl.id !== floorId) return;
    const g = new THREE.Group(); g.position.y = mode === 'floor' ? 0 : i * 3.4;
    const [FW, FD] = fl.footprint;
    box(FW, .22, FD, slab, FW / 2 - 6, -.11, FD / 2 - 4.5, g);
    for (const room of fl.rooms) {
      const [x, z, w, d] = room.rect;
      const facet = Object.values(facetById).find(f => f.floor === fl.id && f.room === room.id && f.kind === 'floor');
      const fin = facet && scheme.finishes[facet.id];
      const mat = fin ? new THREE.MeshStandardMaterial({map: tex(floorCanvas(fin, w, d, 90)), roughness: .3}) : (room.stair ? plaster('#bfae99') : neutral);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w - .06, d - .06), mat);
      p.rotation.x = -Math.PI / 2; p.position.set(x + w / 2 - 6, .005, z + d / 2 - 4.5); g.add(p);
      const h = .95;
      box(w, h, .1, wall, x + w / 2 - 6, h / 2, z - 4.5, g); box(w, h, .1, wall, x + w / 2 - 6, h / 2, z + d - 4.5, g);
      box(.1, h, d, wall, x - 6, h / 2, z + d / 2 - 4.5, g); box(.1, h, d, wall, x + w - 6, h / 2, z + d / 2 - 4.5, g);
      if (room.stair) {
        const sf = Object.values(facetById).find(f => f.floor === fl.id && f.kind === 'stair');
        const smat = sf && scheme.finishes[sf.id] ? new THREE.MeshStandardMaterial({map: tex(stoneCanvas(scheme.finishes[sf.id].stone), [1, .3])}) : plaster('#d8ccbd');
        for (let s = 0; s < 8; s++) box(1, .18 * (s + 1), .32, smat, x + .6 - 6, .09 * (s + 1), z + d - .3 - s * .32 - 4.5, g);
      }
    }
    root.add(g);
  });
  const cam = new THREE.PerspectiveCamera(36, 1, .1, 200);
  let yaw = -.7, pitch = mode === 'floor' ? .95 : .55, auto = true, raf = 0;
  const dist = mode === 'floor' ? 21 : 29, target = new THREE.Vector3(0, mode === 'floor' ? 0 : 3.4, 0);
  function size() { const {width, height} = host.getBoundingClientRect(); r.setSize(width, height, false); cam.aspect = width / Math.max(1, height); cam.updateProjectionMatrix(); }
  function frame() {
    if (auto) yaw += .0025;
    cam.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    cam.lookAt(target); r.render(scene, cam); raf = requestAnimationFrame(frame);
  }
  let drag = null;
  const down = e => { auto = false; drag = {x: e.clientX, y: e.clientY, yaw, pitch}; host.setPointerCapture(e.pointerId); };
  const move = e => { if (!drag) return; yaw = drag.yaw - (e.clientX - drag.x) * .008; pitch = Math.min(1.3, Math.max(.15, drag.pitch + (e.clientY - drag.y) * .006)); };
  const up = () => { drag = null; };
  host.addEventListener('pointerdown', down); host.addEventListener('pointermove', move); host.addEventListener('pointerup', up);
  const ro = new ResizeObserver(size); ro.observe(host); size();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) auto = false;
  frame();
  return () => { cancelAnimationFrame(raf); ro.disconnect(); r.dispose(); r.forceContextLoss(); r.domElement.remove(); };
}
