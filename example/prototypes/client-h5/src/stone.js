// 示意石材贴图：程序生成（值噪声 + 脉络），不是企业真实素材，也不是照片。
import {specById} from './data.js';

const hash = (x, y, s) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
function noise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct = 5) {
  let sum = 0, amp = .5, f = 1;
  for (let i = 0; i < oct; i++) { sum += amp * noise(x * f, y * f, s + i * 17); f *= 2.03; amp *= .5; }
  return sum;
}
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));

// 每种石材的生成参数：底色、云雾、脉络颜色与形态。
const recipes = {
  yashi: {base: '#f3f0ea', cloud: '#ddd8cf', vein: '#a9a49d', scale: 3, veins: 2.6, warp: 1.6, sharp: 26, amt: .55, cloudAmt: .35},
  yudu: {base: '#efece7', cloud: '#d9d5cf', vein: '#85817b', scale: 2.4, veins: 2.4, warp: 1.5, sharp: 16, amt: .75, cloudAmt: .4},
  shaanna: {base: '#e6d3ad', cloud: '#cdb58a', vein: '#f4e9d2', scale: 3.4, veins: 2.6, warp: 2.8, sharp: 20, amt: .45, cloudAmt: .75},
  huimu: {base: '#aaa59e', cloud: '#8f8a84', vein: '#d4d0ca', scale: 2, veins: 9, warp: .35, sharp: 6, amt: .55, cloudAmt: .5, grain: true},
  feiwang: {base: '#6e4e3c', cloud: '#58392b', vein: '#d9c4ae', scale: 3.4, veins: 4.5, warp: 3.6, sharp: 14, amt: .8, cloudAmt: .6, net: true},
  heijin: {base: '#2b2522', cloud: '#1b1715', vein: '#e2cfa6', scale: 2.4, veins: 2.2, warp: 3, sharp: 16, amt: .9, cloudAmt: .5},
};

const cache = new Map();
// 返回一张代表约 1.6 m 见方石材的画布。
export function stoneCanvas(id, size = 512) {
  const key = `${id}:${size}`;
  if (cache.has(key)) return cache.get(key);
  const r = recipes[id] || recipes.yashi;
  const seed = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const [b, c, v] = [hex(r.base), hex(r.cloud), hex(r.vein)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = x / size * r.scale, ny = y / size * r.scale;
    let cloud, line;
    if (r.grain) {
      cloud = fbm(nx * .25, ny * 6, seed);
      const t = Math.sin((ny * r.veins + fbm(nx * .3, ny * 2, seed + 5) * r.warp) * Math.PI * 2);
      line = Math.pow(1 - Math.abs(t), r.sharp) * (.4 + .6 * fbm(nx * .6, ny * .6, seed + 9));
    } else {
      cloud = fbm(nx, ny, seed);
      const w = fbm(nx * .55 + 3.1, ny * .55 + 7.7, seed + 3);
      const t = Math.sin(((nx * .8 + ny * .45) * r.veins + w * r.warp * 2) * Math.PI);
      line = Math.pow(1 - Math.abs(t), r.sharp);
      if (r.net) { const t2 = Math.sin(((nx * .35 - ny * .9) * r.veins * .8 + w * r.warp * 2.4) * Math.PI); line = Math.max(line, Math.pow(1 - Math.abs(t2), r.sharp) * .8); }
      line *= .35 + .65 * fbm(nx * .9 + 11, ny * .9, seed + 21, 3);
    }
    const k = Math.min(1, Math.max(0, (cloud - .3) * 1.6)) * r.cloudAmt;
    const m = Math.min(1, line * r.amt * 1.4);
    const i = (y * size + x) * 4;
    for (let ch = 0; ch < 3; ch++) img.data[i + ch] = (b[ch] * (1 - k) + c[ch] * k) * (1 - m) + v[ch] * m;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  cache.set(key, cv);
  return cv;
}

// 铺法图形：在“图案坐标”里生成矩形块，单位米。
function patternTiles(layout, tw, th, W, D) {
  const tiles = [];
  const span = Math.hypot(W, D) + Math.max(tw, th) * 2;
  if (layout === 'herringbone') {
    const S = th, L = tw;
    const n = Math.ceil(span / S) + 4, m = Math.ceil(span / (2 * L)) + 3;
    for (let c = -m; c <= m; c++) for (let t = -n; t <= n; t++) {
      const ox = c * L + t * S, oy = -c * L + t * S;
      tiles.push({x: ox, y: oy, w: L, h: S});
      tiles.push({x: ox, y: oy + S, w: S, h: L});
    }
    return {tiles, angle: Math.PI / 4};
  }
  const rows = Math.ceil(span / th) + 2, cols = Math.ceil(span / tw) + 2;
  for (let r = -rows; r <= rows; r++) for (let c = -cols; c <= cols; c++) {
    const shift = layout === 'running' && r % 2 ? tw / 2 : 0;
    tiles.push({x: c * tw + shift, y: r * th, w: tw, h: th});
  }
  return {tiles, angle: layout === 'diagonal' ? Math.PI / 4 : 0};
}

const texCache = new Map();
// 生成一个地面饰面的铺贴图：W×D 米，含可选波打线；起铺点居中。
export function floorCanvas(fin, W, D, pxPerM = 220) {
  const key = JSON.stringify([fin, W, D, pxPerM]);
  if (texCache.has(key)) return texCache.get(key);
  const spec = specById[fin.spec] || specById['800x800'];
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * pxPerM); cv.height = Math.round(D * pxPerM);
  const ctx = cv.getContext('2d');
  const stone = stoneCanvas(fin.stone);
  const grout = '#a39689';
  ctx.fillStyle = grout; ctx.fillRect(0, 0, cv.width, cv.height);
  const band = fin.border ? .2 : 0, gap = fin.border ? .02 : 0;
  if (fin.border) drawBorder(ctx, fin.borderStone, W, D, pxPerM, band);
  const fx = band + gap, fy = band + gap, fw = W - 2 * (band + gap), fd = D - 2 * (band + gap);
  ctx.save();
  ctx.beginPath(); ctx.rect(fx * pxPerM, fy * pxPerM, fw * pxPerM, fd * pxPerM); ctx.clip();
  const tw = spec.w / 1000, th = spec.h / 1000;
  const {tiles, angle} = patternTiles(fin.layout, tw, th, fw, fd);
  const cx = (fx + fw / 2) * pxPerM, cy = (fy + fd / 2) * pxPerM;
  const seed = [...fin.stone].reduce((a, c) => a + c.charCodeAt(0), 0);
  const groutPx = Math.max(2, .006 * pxPerM);
  tiles.forEach((t, i) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(cx, cy); ctx.rotate(angle);
    ctx.translate((t.x - (fin.layout === 'herringbone' ? 0 : tw / 2)) * pxPerM, (t.y - (fin.layout === 'herringbone' ? 0 : th / 2)) * pxPerM);
    // 快速剔除远离饰面的块
    const m = ctx.getTransform();
    const px = m.e, py = m.f, reach = (t.w + t.h) * pxPerM;
    if (px < -reach || py < -reach || px > cv.width + reach || py > cv.height + reach) return;
    const w = t.w * pxPerM, h = t.h * pxPerM;
    const r1 = hash(i, 3, seed), r2 = hash(i, 7, seed);
    const sw = Math.min(stone.width, stone.width * Math.max(t.w, t.h) / 1.6);
    const sx = r1 * (stone.width - sw), sy = r2 * (stone.height - sw);
    if (t.h > t.w) { ctx.translate(w, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(stone, sx, sy, sw, sw * t.w / t.h, 0, 0, h, w); }
    else ctx.drawImage(stone, sx, sy, sw, sw * t.h / t.w, 0, 0, w, h);
    ctx.setTransform(m);
    ctx.fillStyle = `rgba(${hash(i, 11, seed) > .5 ? '255,255,255' : '40,30,20'},${hash(i, 13, seed) * .05})`;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = grout; ctx.lineWidth = groutPx; ctx.strokeRect(0, 0, w, h);
  });
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  texCache.set(key, cv);
  return cv;
}

function drawBorder(ctx, stoneId, W, D, s, band) {
  const st = stoneCanvas(stoneId);
  const pat = ctx.createPattern(st, 'repeat');
  ctx.save();
  ctx.fillStyle = pat;
  ctx.beginPath();
  ctx.rect(0, 0, W * s, D * s);
  ctx.rect(band * s, band * s, (W - 2 * band) * s, (D - 2 * band) * s);
  ctx.fill('evenodd');
  ctx.strokeStyle = '#b9afa3'; ctx.lineWidth = Math.max(1, .003 * s);
  ctx.strokeRect(band * s, band * s, (W - 2 * band) * s, (D - 2 * band) * s);
  ctx.restore();
}

// 墙面石材：按规格分板，竖向排列。
export function wallCanvas(fin, W, H, pxPerM = 200) {
  const key = JSON.stringify(['wall', fin, W, H, pxPerM]);
  if (texCache.has(key)) return texCache.get(key);
  const spec = specById[fin.spec] || specById['600x1200'];
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * pxPerM); cv.height = Math.round(H * pxPerM);
  const ctx = cv.getContext('2d');
  const stone = stoneCanvas(fin.stone);
  const tw = spec.w / 1000, th = spec.h / 1000;
  ctx.fillStyle = '#b9afa3'; ctx.fillRect(0, 0, cv.width, cv.height);
  const cols = Math.ceil(W / tw) + 2, rows = Math.ceil(H / th) + 1;
  const x0 = (W - Math.ceil(W / tw) * tw) / 2;
  for (let r = 0; r < rows; r++) for (let c = -1; c < cols; c++) {
    const shift = fin.layout === 'running' && r % 2 ? tw / 2 : 0;
    const x = (x0 + c * tw + shift) * pxPerM, y = (H - (r + 1) * th) * pxPerM;
    const flip = (c + r) % 2;
    ctx.save(); ctx.translate(x, y);
    if (flip) { ctx.translate(tw * pxPerM, 0); ctx.scale(-1, 1); }
    ctx.drawImage(stone, 0, 0, stone.width * Math.min(1, tw / 1.6), stone.height * Math.min(1, th / 1.6), 0, 0, tw * pxPerM, th * pxPerM);
    ctx.restore();
    ctx.strokeStyle = '#b9afa3'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, tw * pxPerM, th * pxPerM);
  }
  texCache.set(key, cv);
  return cv;
}

// 小色样：用于石材库与差异表。
export function swatchURL(id, size = 160) {
  const key = `sw:${id}:${size}`;
  if (cache.has(key)) return cache.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  cv.getContext('2d').drawImage(stoneCanvas(id), 0, 0, 260, 260, 0, 0, size, size);
  const url = cv.toDataURL('image/jpeg', .86);
  cache.set(key, url);
  return url;
}
