// H5 客户端布局探索：① 沉浸全屏 ② 画廊对比 ③ 仪表板 Bento，每种都有浅色 / 深色主题。演示数据，不接服务端。
import {swatchURL} from '../../client-h5/src/stone.js';
import {stones, softStyles} from '../../client-h5/src/data.js';
import img1 from '../../client-h5-styles/assets/scheme-1.jpg';
import img2 from '../../client-h5-styles/assets/scheme-2.jpg';
import img3 from '../../client-h5-styles/assets/scheme-3.jpg';
import aerial from '../../client-h5-styles/assets/aerial.jpg';

// 与后台真实出图一致（示例别墅一层，规则生成的三个方案）。软装风格为示意标签；家具随风格变化在 K01 实现。
const schemes = [
  {id: 'A', name: '留白', soft: 0, stone: '白色细纹大理石', spec: '1200×1200', pattern: '直铺', border: '深色金脉石波打线', wall: '1200×600 工字铺', img: img1, sw: 'yashi'},
  {id: 'B', name: '暖调', soft: 2, stone: '米黄大理石', spec: '800×800', pattern: '斜铺', border: '无波打线', wall: '900×600 工字铺', img: img2, sw: 'shaanna'},
  {id: 'C', name: '肌理', soft: 1, stone: '灰色木纹石', spec: '600×200', pattern: '人字铺', border: '无波打线', wall: '1200×300 工字铺', img: img3, sw: 'huimu'},
];
const layouts = [
  {id: 'immersive', name: '① 沉浸全屏', note: '效果图占满整屏，左右滑动切换方案；详情与调整放在可拖起的底部抽屉里。'},
  {id: 'gallery', name: '② 画廊对比', note: '方案以大卡片纵向排列，可选两个方案分屏对比，差异逐项高亮；调整时前后对照。'},
  {id: 'bento', name: '③ 仪表板 Bento', note: '页面由大小不一的方块组成：效果图、硬装、软装、3D、状态各占一块，像控制面板。'},
];
const screens = [['home', '首页'], ['scheme', '方案'], ['adjust', '调整'], ['confirm', '确认']];
const ui = {screen: 'scheme', theme: 'light', scheme: 0, soft: 0, stone: 0, tab: 'soft', sheet: false, compare: false, pair: [0, 1]};

const ic = {
  back: 'M15 5l-7 7 7 7', arrow: 'M5 12h14m-6-6 6 6-6 6', left: 'M15 5l-7 7 7 7', right: 'm9 5 7 7-7 7', home: 'M3 10 12 3l9 7M5 9v12h14V9', folder: 'M3 7V4h6l3 3h9v13H3z',
  user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21c1-4 4-6 8-6s7 2 8 6', cube: 'm12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9', image: 'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5',
  link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1', check: 'm4 12 5 5L20 6', undo: 'M9 4 3 10l6 6M3 10h10a7 7 0 0 1 7 7',
  split: 'M12 3v18M3 5h18v14H3z', grid: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z', chat: 'M4 4h16v12H8l-4 4z', plus: 'M12 5v14M5 12h14', clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
};
const icon = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ic[n]}"/></svg>`;
const pal = (i, cls = '') => `<span class="pal ${cls}">${Object.values(softStyles[i].palette).slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span>`;
const sw = (id, cls = 'sw') => `<img class="${cls}" src="${swatchURL(id, 120)}" alt="">`;
const cur = () => schemes[ui.scheme];
const tabbar = active => `<nav class="tabbar">${[['home', '首页'], ['folder', '项目'], ['user', '我的']].map(([n, t], i) => `<button class="${i === active ? 'on' : ''}" data-go="${i ? 'scheme' : 'home'}">${icon(n, 19)}<span>${t}</span></button>`).join('')}</nav>`;
const bar = (title, {back = true, over = false} = {}) => `<header class="topbar ${over ? 'over' : ''}">${back ? `<button class="round" data-go="home">${icon('back', 18)}</button>` : '<span class="logo">标志</span>'}<b>${title}</b><button class="round">${icon('user', 17)}</button></header>`;
const softName = i => softStyles[i].name;
const finishRows = s => [['软装风格', softName(ui.screen === 'confirm' ? ui.soft : s.soft)], ['客厅地面', `${s.stone} · ${s.spec} · ${s.pattern}`], ['餐厅地面', `${s.stone} · ${s.spec} · ${s.pattern}`], ['电视背景墙', `${s.stone} · ${s.wall}`], ['楼梯踏面', `${s.stone} · 整板踏步`], ['波打线', s.border]];

// ---------- ① 沉浸全屏 ----------
const immersive = {
  home: () => `<div class="full"><img src="${img1}" alt=""><div class="shade"></div>${bar('演示家装企业', {back: false, over: true})}
      <div class="full-copy"><span class="kicker">示例别墅 · 一层客厅 · 方案 A</span><h1>为你的家，<br>先做一遍硬装与软装</h1>
        <button class="cta" data-go="scheme">提交方案需求 <span>${icon('arrow', 18)}</span></button><p class="swipe-hint">上滑了解流程</p></div></div>
    <div class="sheet-under"><div class="grab"></div><div class="steps">${['示例别墅或上传图纸', '勾选饰面、挑选石材', '得到 3 个整体方案'].map((t, i) => `<div><b>0${i + 1}</b><span>${t}</span></div>`).join('')}</div></div>${tabbar(0)}`,
  scheme: () => { const s = cur(); return `<div class="full" data-swipe><img src="${s.img}" alt=""><div class="shade top"></div>${bar('示例别墅', {over: true})}
      <div class="pager">${schemes.map((x, i) => `<i class="${i === ui.scheme ? 'on' : ''}"></i>`).join('')}</div>
      <div class="side-actions"><button class="fab on">${icon('image', 18)}</button><button class="fab">${icon('cube', 18)}</button><button class="fab">${icon('split', 18)}</button></div>
      <button class="nav-arrow l" data-prev>${icon('left', 18)}</button><button class="nav-arrow r" data-next>${icon('right', 18)}</button></div>
    <div class="drawer ${ui.sheet ? 'open' : ''}"><button class="grab-btn" data-sheet><span class="grab"></span></button>
      <div class="drawer-head"><div><span class="kicker">方案 ${s.id} / 3 · 左右滑动切换</span><b class="drawer-title">${s.name}</b></div><span class="tag">${pal(s.soft, 'xs')}${softName(s.soft)}</span></div>
      <div class="drawer-quick">${sw(s.sw)}<div><b>${s.stone}</b><small>${s.spec} · ${s.pattern} · ${s.border}</small></div></div>
      ${ui.sheet ? `<div class="drawer-more"><div class="list">${finishRows(s).map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('')}</div><div class="aerial"><img src="${aerial}" alt=""><span class="pill glass">${icon('cube', 14)} 整栋 3D</span></div></div>` : ''}
      <div class="drawer-actions"><button class="ghost-btn" data-go="adjust">调整</button><button class="cta small" data-go="confirm">确认方案 ${s.id}</button></div></div>`; },
  adjust: () => { const s = cur(); return `<div class="full"><img src="${s.img}" alt=""><div class="shade top"></div>${bar('调整方案 ' + s.id, {over: true})}
      <span class="pill glass float-tag">${icon('clock', 13)} 修订 1 → 2 · 有 1 处未出图</span></div>
    <div class="drawer open adjust-drawer"><span class="grab"></span>
      <div class="seg">${[['soft', '软装风格'], ['hard', '硬装石材']].map(([k, t]) => `<button class="${ui.tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
      ${ui.tab === 'soft' ? `<div class="hscroll">${softStyles.map((st, i) => `<button class="style-card ${i === ui.soft ? 'on' : ''}" data-soft="${i}">${pal(i, 'lg')}<b>${st.name}</b><small>${st.line.split('、').slice(0, 2).join('、')}</small></button>`).join('')}</div>`
        : `<div class="hscroll">${stones.map((st, i) => `<button class="stone-card ${i === ui.stone ? 'on' : ''}" data-stone="${i}">${sw(st.id, 'sq')}<span>${st.name}</span></button>`).join('')}</div>
          <div class="chips">${['600×600', '800×800', '1200×1200'].map((t, i) => `<span class="chip ${i === 2 ? 'on' : ''}">${t}</span>`).join('')}${['直铺', '人字', '斜铺'].map((t, i) => `<span class="chip ${i === 0 ? 'on' : ''}">${t}</span>`).join('')}</div>`}
      <div class="drawer-actions"><button class="round-btn">${icon('undo', 18)}</button><button class="cta small">重新出图 · 约 1–2 分钟</button></div></div>`; },
  confirm: () => { const s = cur(); return `<div class="half"><img src="${s.img}" alt="">${bar('确认方案', {over: true})}</div>
    <div class="drawer open tall"><span class="grab"></span><span class="kicker">方案 ${s.id} · 修订 2</span><b class="drawer-title">${s.name} · ${softName(ui.soft)}</b>
      <div class="list">${finishRows(s).slice(0, 4).map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <label class="field"><textarea rows="2" placeholder="给企业留言，例如：周末想看样品"></textarea></label>
      <div class="toggle-row"><div><b>请企业联系我</b><small>139 **** 9000 · 下午</small></div><span class="switch on"><i></i></span></div>
      <div class="drawer-actions"><button class="cta small wide">确认方案 ${s.id} · 修订 2</button></div></div>`; },
};

// ---------- ② 画廊对比 ----------
const gallery = {
  home: () => `<div class="scroll">${bar('演示家装企业', {back: false})}
      <h1 class="display">3 个方案，<br>挑一个最像家的</h1><p class="body">提交户型和石材偏好，得到硬装 + 软装的整体方案，再逐项对比。</p>
      <div class="gallery-row">${schemes.map((x, i) => `<button class="g-card" data-go="scheme" data-scheme="${i}"><img src="${x.img}" alt=""><span class="g-num">0${i + 1}</span><b>${x.name}</b><small>${x.stone} · ${softName(x.soft)}</small></button>`).join('')}</div>
      <button class="cta" data-go="scheme">提交方案需求 <span>${icon('arrow', 18)}</span></button>
      <div class="section-title"><b>企业石材库</b><span>示意素材</span></div>
      <div class="stone-grid">${stones.slice(0, 6).map(st => `<figure>${sw(st.id, 'sq')}<figcaption>${st.name}</figcaption></figure>`).join('')}</div></div>${tabbar(0)}`,
  scheme: () => {
    if (ui.compare) {
      const [a, b] = ui.pair.map(i => schemes[i]);
      const rows = [['软装', softName(a.soft), softName(b.soft)], ['石材', a.stone, b.stone], ['规格', a.spec, b.spec], ['铺法', a.pattern, b.pattern], ['波打线', a.border, b.border]];
      return `<div class="scroll">${bar('方案对比')}
        <div class="split"><figure><img src="${a.img}" alt=""><figcaption>${a.id} · ${a.name}</figcaption></figure><figure><img src="${b.img}" alt=""><figcaption>${b.id} · ${b.name}</figcaption></figure></div>
        <div class="pick">${schemes.map((x, i) => `<button class="chip ${ui.pair.includes(i) ? 'on' : ''}" data-pair="${i}">${x.id} · ${x.name}</button>`).join('')}</div>
        <div class="diff">${rows.map(([k, x, y]) => `<div class="drow ${x === y ? 'same' : 'differs'}"><span>${k}</span><b>${x}</b><b>${y}</b></div>`).join('')}</div>
        <p class="tiny">高亮为两个方案不同的地方</p></div>
        <div class="dock"><button class="ghost-btn" data-compare>退出对比</button><button class="cta small" data-go="confirm">选 ${b.id} 并确认</button></div>`;
    }
    return `<div class="scroll">${bar('示例别墅 · 3 个方案')}
      <div class="stack">${schemes.map((x, i) => `<article class="s-card ${i === ui.scheme ? 'on' : ''}" data-scheme="${i}"><div class="s-img"><img src="${x.img}" alt=""><span class="pill glass">${icon('cube', 13)} 3D</span></div>
        <div class="s-body"><div><span class="kicker">方案 ${x.id}</span><b>${x.name}</b></div><span class="tag">${pal(x.soft, 'xs')}${softName(x.soft)}</span></div>
        <div class="s-specs">${sw(x.sw)}<small>${x.stone} · ${x.spec} · ${x.pattern}</small></div></article>`).join('')}</div></div>
      <div class="dock"><button class="ghost-btn" data-compare>${icon('split', 16)} 对比</button><button class="ghost-btn" data-go="adjust">调整 ${cur().id}</button><button class="cta small" data-go="confirm">确认 ${cur().id}</button></div>`;
  },
  adjust: () => { const s = cur(); return `<div class="scroll">${bar('调整方案 ' + s.id)}
      <div class="before-after"><figure><img src="${s.img}" alt=""><figcaption>当前 · 修订 1</figcaption></figure><figure class="after"><img src="${s.img}" alt=""><figcaption>调整后 · 待出图</figcaption><span class="pending">${softName(ui.soft)}</span></figure></div>
      <div class="section-title"><b>软装风格</b><span>全屋家具与配色</span></div>
      <div class="list">${softStyles.map((st, i) => `<button class="row pick-row ${i === ui.soft ? 'on' : ''}" data-soft="${i}">${pal(i)}<span class="grow"><b>${st.name}</b><small>${st.line}</small></span><span class="radio">${i === ui.soft ? icon('check', 13) : ''}</span></button>`).join('')}</div>
      <div class="section-title"><b>客厅地面石材</b><span>示意素材</span></div>
      <div class="stone-grid small">${stones.map((st, i) => `<button class="${i === ui.stone ? 'on' : ''}" data-stone="${i}">${sw(st.id, 'sq')}<span>${st.name}</span></button>`).join('')}</div></div>
      <div class="dock"><button class="cta small wide">重新出图 · 约 1–2 分钟</button></div>`; },
  confirm: () => { const s = cur(); return `<div class="scroll">${bar('确认方案')}
      <figure class="poster"><img src="${s.img}" alt=""><figcaption><span class="kicker">方案 ${s.id} · 修订 2</span><b>${s.name}</b></figcaption></figure>
      <div class="list">${finishRows(s).map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <label class="field"><textarea rows="3" placeholder="给企业留言，例如：周末想看样品"></textarea></label>
      <div class="toggle-row"><div><b>请企业联系我</b><small>139 **** 9000 · 下午</small></div><span class="switch on"><i></i></span></div></div>
      <div class="dock"><button class="cta small wide">确认方案 ${s.id} · 修订 2</button></div>`; },
};

// ---------- ③ 仪表板 Bento ----------
const bento = {
  home: () => `<div class="scroll">${bar('演示家装企业', {back: false})}
      <div class="bento">
        <button class="b b-hero" data-go="scheme"><img src="${img1}" alt=""><span class="b-over"><span class="kicker">我的方案 · 已出图</span><b>示例别墅</b><small>3 个整体方案 · 待你确认</small></span></button>
        <button class="b b-cta" data-go="scheme"><span>${icon('plus', 22)}</span><b>提交新需求</b></button>
        <div class="b b-num"><b>3</b><small>套软装风格</small></div>
        <div class="b b-stones"><span class="kicker">企业石材库</span><div class="mini-sw">${stones.slice(0, 4).map(st => sw(st.id, 'dot')).join('')}</div><small>6 款 · 示意素材</small></div>
        <div class="b b-share">${icon('link', 18)}<b>分享给我的方案</b><small>1 个待绑定</small></div>
      </div></div>${tabbar(0)}`,
  scheme: () => { const s = cur(); return `<div class="scroll">${bar('示例别墅')}
      <div class="seg">${schemes.map((x, i) => `<button class="${i === ui.scheme ? 'on' : ''}" data-scheme="${i}">${x.id} · ${x.name}</button>`).join('')}</div>
      <div class="bento">
        <div class="b b-main"><img src="${s.img}" alt=""><span class="pill glass">${icon('image', 13)} 效果图</span></div>
        <div class="b b-hard"><span class="kicker">硬装</span>${sw(s.sw, 'sq-s')}<b>${s.stone}</b><small>${s.spec} · ${s.pattern}</small></div>
        <div class="b b-soft"><span class="kicker">软装</span>${pal(s.soft, 'md')}<b>${softName(s.soft)}</b><small>${softStyles[s.soft].line.split('、')[0]}</small></div>
        <button class="b b-3d"><img src="${aerial}" alt=""><span class="b-over">${icon('cube', 18)}<b>整栋 3D</b></span></button>
        <div class="b b-state"><span class="kicker">状态</span><b>修订 1</b><small>尚未确认</small></div>
      </div></div>
      <div class="dock"><button class="ghost-btn" data-go="adjust">调整</button><button class="cta small" data-go="confirm">确认方案 ${s.id}</button></div>`; },
  adjust: () => { const s = cur(); return `<div class="scroll">${bar('调整方案 ' + s.id)}
      <div class="bento">
        <div class="b b-preview"><img src="${s.img}" alt=""><span class="pill glass">${icon('clock', 13)} 修订 1 → 2</span></div>
        <div class="b b-wide"><span class="kicker">软装风格</span><div class="opt3">${softStyles.map((st, i) => `<button class="${i === ui.soft ? 'on' : ''}" data-soft="${i}">${pal(i, 'md')}<span>${st.name}</span></button>`).join('')}</div></div>
        <div class="b b-wide"><span class="kicker">客厅地面石材</span><div class="opt6">${stones.map((st, i) => `<button class="${i === ui.stone ? 'on' : ''}" data-stone="${i}">${sw(st.id, 'sq-s')}</button>`).join('')}</div></div>
        <div class="b"><span class="kicker">规格</span><div class="stepper"><button>−</button><b>1200</b><button>+</button></div><small>×1200 mm</small></div>
        <div class="b"><span class="kicker">波打线</span><span class="switch on"><i></i></span><small>深色金脉石</small></div>
      </div></div>
      <div class="dock"><button class="round-btn">${icon('undo', 18)}</button><button class="cta small">重新出图</button></div>`; },
  confirm: () => { const s = cur(); return `<div class="scroll">${bar('确认方案')}
      <div class="bento">
        <div class="b b-main"><img src="${s.img}" alt=""><span class="pill glass">方案 ${s.id} · 修订 2</span></div>
        <div class="b b-hard"><span class="kicker">硬装</span>${sw(s.sw, 'sq-s')}<b>${s.stone}</b><small>5 处饰面</small></div>
        <div class="b b-soft"><span class="kicker">软装</span>${pal(ui.soft, 'md')}<b>${softName(ui.soft)}</b></div>
        <div class="b b-wide"><span class="kicker">留言</span><textarea rows="2" placeholder="例如：周末想看样品"></textarea></div>
        <div class="b b-wide row-b"><div><b>请企业联系我</b><small>139 **** 9000 · 下午</small></div><span class="switch on"><i></i></span></div>
      </div></div>
      <div class="dock"><button class="cta small wide">确认方案 ${s.id} · 修订 2</button></div>`; },
};
const views = {immersive, gallery, bento};

function phones(theme) {
  return layouts.map(l => `<section class="col"><div class="col-head"><b>${l.name}${ui.theme === 'both' ? ` · ${theme === 'light' ? '浅色' : '深色'}` : ''}</b><small>${l.note}</small></div>
    <div class="phone"><div class="notch"></div><div class="screen t-${theme} l-${l.id}">${views[l.id][ui.screen]()}</div></div></section>`).join('');
}
function render() {
  const keep = [...document.querySelectorAll('.scroll')].map(el => el.scrollTop);
  document.querySelector('#app').innerHTML = `
    <header class="board-head"><div><b>H5 客户端 · 布局探索</b><small>三种布局 × 浅色 / 深色 · 同一中性配色 · 效果图为后台真实出图（示意素材）· 演示数据</small></div>
      <div class="controls"><nav>${screens.map(([k, t]) => `<button class="${ui.screen === k ? 'on' : ''}" data-screen="${k}">${t}</button>`).join('')}</nav>
        <nav>${[['light', '浅色'], ['dark', '深色'], ['both', '浅深并排']].map(([k, t]) => `<button class="${ui.theme === k ? 'on' : ''}" data-theme="${k}">${t}</button>`).join('')}</nav></div></header>
    <main class="board">${ui.theme === 'both' ? phones('light') + phones('dark') : phones(ui.theme)}</main>`;
  document.querySelectorAll('.scroll').forEach((el, i) => { if (keep[i]) el.scrollTop = keep[i]; });
}
function step(d) { ui.scheme = (ui.scheme + d + schemes.length) % schemes.length; render(); }
document.addEventListener('click', e => {
  const el = e.target.closest('[data-screen],[data-theme],[data-go],[data-scheme],[data-tab],[data-soft],[data-stone],[data-sheet],[data-compare],[data-pair],[data-prev],[data-next]');
  if (!el) return;
  const d = el.dataset;
  if (d.prev !== undefined) return step(-1);
  if (d.next !== undefined) return step(1);
  if (d.screen) { ui.screen = d.screen; ui.sheet = false; ui.compare = false; }
  if (d.theme) ui.theme = d.theme;
  if (d.scheme) ui.scheme = +d.scheme;
  if (d.go) { ui.screen = d.go; ui.sheet = false; ui.compare = false; }
  if (d.tab) ui.tab = d.tab;
  if (d.soft) ui.soft = +d.soft;
  if (d.stone) ui.stone = +d.stone;
  if (d.sheet !== undefined) ui.sheet = !ui.sheet;
  if (d.compare !== undefined) ui.compare = !ui.compare;
  if (d.pair) { const i = +d.pair; if (!ui.pair.includes(i)) ui.pair = [ui.pair[1], i]; }
  render();
});
// 沉浸布局：在效果图上左右滑动切换方案
let sx = null;
document.addEventListener('pointerdown', e => { if (e.target.closest('[data-swipe]')) sx = e.clientX; });
document.addEventListener('pointerup', e => { if (sx !== null && Math.abs(e.clientX - sx) > 40) step(e.clientX < sx ? 1 : -1); sx = null; });
render();
