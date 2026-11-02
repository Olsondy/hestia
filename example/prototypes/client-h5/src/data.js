// 演示 fixture：企业、石材目录、示例别墅、分享链接。全部为中性演示数据，尺寸为示意。

export const workspace = {
  id: 'demo-stone',
  name: '演示石材企业',
  tagline: '别墅 · 酒店 · 展厅石材硬装',
};

// 石材目录（示意素材）：贴图由 stone.js 程序生成，不是企业真实素材。
export const stones = [
  {id: 'yashi', name: '雅士白', tone: '浅', note: '白底，细灰纹', swatch: '#f1eee8'},
  {id: 'yudu', name: '鱼肚白', tone: '浅', note: '白底，舒展灰纹', swatch: '#ebe8e3'},
  {id: 'shaanna', name: '莎安娜米黄', tone: '暖', note: '米黄底，云雾纹', swatch: '#e2cfa9'},
  {id: 'huimu', name: '灰木纹', tone: '灰', note: '灰底，直线木纹', swatch: '#a7a29b'},
  {id: 'feiwang', name: '啡网纹', tone: '深', note: '咖啡底，网状浅纹', swatch: '#6f4f3d'},
  {id: 'heijin', name: '黑金花', tone: '深', note: '黑底，金白脉络', swatch: '#2d2724'},
];
export const stoneById = Object.fromEntries(stones.map(s => [s.id, s]));

export const layouts = [
  {id: 'straight', name: '直铺'},
  {id: 'running', name: '工字'},
  {id: 'herringbone', name: '人字'},
  {id: 'diagonal', name: '斜铺'},
];
export const layoutName = Object.fromEntries(layouts.map(l => [l.id, l.name]));

// 规格以毫米记录；strip 表示条形规格，人字铺只允许条形。
export const floorSpecs = [
  {id: '600x600', w: 600, h: 600},
  {id: '800x800', w: 800, h: 800},
  {id: '600x1200', w: 1200, h: 600},
  {id: '750x1500', w: 1500, h: 750},
  {id: '200x800', w: 800, h: 200, strip: true},
];
export const wallSpecs = [
  {id: '600x1200', w: 600, h: 1200},
  {id: '1200x2400', w: 1200, h: 2400},
];
export const specById = Object.fromEntries([...floorSpecs, ...wallSpecs].map(s => [s.id, s]));
export const specLabel = id => id.replace('x', '×');

// 示例别墅（演示）：三层，单位米，x 向右、z 向下（平面图）。
export const villa = {
  name: '示例别墅（演示）',
  facts: '三层 · 约 12 × 9 m · 示例尺寸，非实测',
  floors: [
    {id: 'f1', name: '一层', short: '1F', footprint: [12, 9],
      rooms: [
        {id: 'living', name: '客厅', rect: [0, 0, 7, 6]},
        {id: 'dining', name: '餐厅', rect: [7, 0, 5, 5]},
        {id: 'foyer', name: '玄关', rect: [7, 5, 5, 4]},
        {id: 'stair1', name: '楼梯', rect: [0, 6, 3, 3], stair: true},
        {id: 'kitchen', name: '厨房', rect: [3, 6, 4, 3]},
      ],
      scene: {room: 'living', floor: 'f1-living', wall: 'f1-wall', stair: 's12'}},
    {id: 'f2', name: '二层', short: '2F', footprint: [12, 9],
      rooms: [
        {id: 'lounge', name: '起居厅', rect: [0, 0, 7, 6]},
        {id: 'master', name: '主卧', rect: [7, 0, 5, 9]},
        {id: 'stair2', name: '楼梯', rect: [0, 6, 3, 3], stair: true},
        {id: 'bath', name: '卫生间', rect: [3, 6, 4, 3]},
      ],
      scene: {room: 'lounge', floor: 'f2-lounge', wall: 'f2-wall', stair: 's23'}},
    {id: 'f3', name: '三层', short: '3F', footprint: [9, 9],
      rooms: [
        {id: 'tea', name: '茶室', rect: [0, 0, 6, 5]},
        {id: 'study', name: '书房', rect: [6, 0, 3, 5]},
        {id: 'hall', name: '走廊', rect: [3, 5, 6, 1.6]},
        {id: 'stair3', name: '楼梯', rect: [0, 5, 3, 4], stair: true},
        {id: 'terrace', name: '露台', rect: [3, 6.6, 6, 2.4]},
      ],
      scene: {room: 'tea', floor: 'f3-tea', wall: null, stair: null}},
  ],
};

// 饰面：建筑表面，属于固定事实。
export const facets = [
  {id: 'f1-living', floor: 'f1', kind: 'floor', name: '客厅地面', room: 'living', size: [7, 6]},
  {id: 'f1-dining', floor: 'f1', kind: 'floor', name: '餐厅地面', room: 'dining', size: [5, 5]},
  {id: 'f1-foyer', floor: 'f1', kind: 'floor', name: '玄关地面', room: 'foyer', size: [5, 4]},
  {id: 'f1-wall', floor: 'f1', kind: 'wall', name: '客厅背景墙', room: 'living', size: [4.2, 2.9]},
  {id: 's12', floor: 'f1', kind: 'stair', name: '楼梯踏面（一至二层）', room: 'stair1', size: [1.1, 0.3], steps: 18},
  {id: 'f2-lounge', floor: 'f2', kind: 'floor', name: '起居厅地面', room: 'lounge', size: [7, 6]},
  {id: 'f2-wall', floor: 'f2', kind: 'wall', name: '起居厅背景墙', room: 'lounge', size: [4.2, 2.9]},
  {id: 's23', floor: 'f2', kind: 'stair', name: '楼梯踏面（二至三层）', room: 'stair2', size: [1.1, 0.3], steps: 18},
  {id: 'f3-tea', floor: 'f3', kind: 'floor', name: '茶室地面', room: 'tea', size: [6, 5]},
  {id: 'f3-hall', floor: 'f3', kind: 'floor', name: '走廊地面', room: 'hall', size: [6, 1.6]},
];
export const facetById = Object.fromEntries(facets.map(f => [f.id, f]));
export const kindName = {floor: '地面', wall: '背景墙', stair: '楼梯踏面'};
export const defaultFacets = ['f1-living', 'f1-dining', 'f1-foyer', 'f1-wall', 's12', 'f2-lounge', 'f2-wall', 's23', 'f3-tea'];

// 规则生成 2–3 个铺贴方案：每个方案至少改变石材、规格或铺法之一。
const themes = [
  {key: 'A', title: '留白', floorSpec: '750x1500', layout: 'straight', border: true, wallSpec: '1200x2400', wallLayout: 'straight',
    line: '大板直铺，深色波打线收边'},
  {key: 'B', title: '暖调', floorSpec: '800x800', layout: 'diagonal', border: true, wallSpec: '600x1200', wallLayout: 'running',
    line: '斜铺放大空间纵深，工字背景墙'},
  {key: 'C', title: '肌理', floorSpec: '200x800', layout: 'herringbone', border: false, wallSpec: '600x1200', wallLayout: 'straight',
    line: '条板人字铺，不设波打线'},
];
const borderFor = stone => (['heijin', 'feiwang', 'huimu'].includes(stone) ? 'yashi' : 'heijin');
const wallFor = (stone, key) => ({A: stone === 'yashi' ? 'yudu' : stone, B: 'feiwang', C: stone}[key]);

export function makeSchemes(facetIds, picked = []) {
  const pool = [...picked, 'yashi', 'shaanna', 'huimu'].filter((v, i, a) => a.indexOf(v) === i);
  return themes.map((t, i) => {
    const stone = pool[i] || pool[0];
    const finishes = {};
    for (const id of facetIds) {
      const f = facetById[id];
      if (f.kind === 'floor') finishes[id] = {stone, spec: t.floorSpec, layout: t.layout, border: t.border && f.size[1] > 2, borderStone: borderFor(stone)};
      if (f.kind === 'wall') finishes[id] = {stone: wallFor(stone, t.key), spec: t.wallSpec, layout: t.wallLayout};
      if (f.kind === 'stair') finishes[id] = {stone};
    }
    return {id: t.key, title: t.title, line: t.line, finishes};
  });
}

// 校验：硬冲突阻止出图，提示允许继续。只做演示用的确定性计算。
export function checkFinish(facetId, fin) {
  const f = facetById[facetId];
  const out = [];
  if (!f || f.kind !== 'floor') return out;
  const spec = specById[fin.spec];
  if (fin.layout === 'herringbone' && !spec.strip) out.push({level: 'conflict', text: `人字铺需要条形规格，${specLabel(fin.spec)} 无法排出人字。请改用 200×800，或换一种铺法。`});
  if (fin.layout !== 'herringbone' && spec.strip) out.push({level: 'conflict', text: '200×800 条板只用于人字铺。请换规格，或改为人字铺。'});
  if (out.length) return out;
  if (fin.layout === 'straight' || fin.layout === 'running') {
    const inset = fin.border ? 0.4 : 0;
    const [w, d] = [f.size[0] - inset, f.size[1] - inset];
    const along = [[w, spec.w / 1000, '东西向'], [d, spec.h / 1000, '南北向']];
    const narrow = along.map(([len, tile, dir]) => [+(len % tile).toFixed(3), tile, dir]).filter(([rest, tile]) => rest > 0.01 && rest < tile / 3);
    if (narrow.length) out.push({level: 'hint', text: `${f.name}${narrow.map(([r, , d]) => `${d}靠墙约 ${Math.round(r * 100)} cm`).join('、')}会出现窄条。可改为起铺点居中、换规格，${fin.border ? '或关闭波打线' : '或加波打线收边'}。`});
  }
  return out;
}

// 分享链接（演示令牌）。
export const shares = {
  direct: {token: 'direct', mode: 'phone', phone: '13800138000', status: 'active', expires: '2026-11-30', note: '定向分享：指定手机号登录即可绑定'},
  code: {token: 'code', mode: 'code', code: 'K7M2Q9', status: 'active', expires: '2026-11-30', note: '绑定码分享：企业另行告知一次性绑定码'},
  revoked: {token: 'revoked', mode: 'phone', phone: '13800138000', status: 'revoked', expires: '2026-11-30'},
  expired: {token: 'expired', mode: 'code', code: 'K7M2Q9', status: 'expired', expires: '2026-10-20'},
};

export const sharedProject = {
  name: '临水别墅 · 企业预置方案',
  member: '方案顾问 · 演示成员',
};

export const demoPhone = '13800138000';
export const maskPhone = p => (p ? `${p.slice(0, 3)} **** ${p.slice(7)}` : '');
