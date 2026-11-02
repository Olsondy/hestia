// H5 客户端风格探索（P03 前置）：同一内容、同一组页面，三种视觉方向并排比较。演示数据，不接服务端。
import {swatchURL} from '../../client-h5/src/stone.js';
import {stones, softStyles} from '../../client-h5/src/data.js';
import img1 from '../assets/scheme-1.jpg';
import img2 from '../assets/scheme-2.jpg';
import img3 from '../assets/scheme-3.jpg';
import aerial from '../assets/aerial.jpg';

// 与后台真实出图一致（示例别墅一层，规则生成的三个方案）。软装风格为示意标签；家具款式随风格变化在 K01 实现。
const schemes = [
  {id: 'A', name: '留白', soft: '现代简约', stone: '白色细纹大理石', spec: '1200×1200', pattern: '直铺', border: '深色金脉石波打线', wall: '白色细纹大理石 · 1200×600 · 工字铺', img: img1, sw: 'yashi'},
  {id: 'B', name: '暖调', soft: '轻奢', stone: '米黄大理石', spec: '800×800', pattern: '斜铺', border: '无波打线', wall: '米黄大理石 · 900×600 · 工字铺', img: img2, sw: 'shaanna'},
  {id: 'C', name: '肌理', soft: '新中式', stone: '灰色木纹石', spec: '600×200', pattern: '人字铺', border: '无波打线', wall: '灰色木纹石 · 1200×300 · 工字铺', img: img3, sw: 'huimu'},
];
const dirs = [
  {id: 'a', name: 'A · 柔和中性', note: '暖浅灰底、白色圆角卡片、近黑强调；底部悬浮药丸导航。安静、像工具类精品 App。'},
  {id: 'b', name: 'B · 夜色沉浸', note: '近黑底、满版效果图、毛玻璃浮层、荧光绿点缀。最突出效果图，科技感强。'},
  {id: 'c', name: 'C · 森绿暖阳', note: '浅底配深森绿色块、暖黄主按钮、Bento 卡片。亲和、偏生活方式品牌。'},
];
const screens = [['home', '首页'], ['scheme', '方案'], ['adjust', '调整'], ['confirm', '确认']];
const ui = {screen: 'home', scheme: 0, tab: 'soft', soft: 0, stone: 0};
const ic = {
  back: 'M15 5l-7 7 7 7', arrow: 'M5 12h14m-6-6 6 6-6 6', home: 'M3 10 12 3l9 7M5 9v12h14V9', folder: 'M3 7V4h6l3 3h9v13H3z', user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21c1-4 4-6 8-6s7 2 8 6',
  cube: 'm12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9', image: 'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5', link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
  check: 'm4 12 5 5L20 6', sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6', undo: 'M9 4 3 10l6 6M3 10h10a7 7 0 0 1 7 7', phone: 'M7 2h10v20H7zM11 18h2',
};
const icon = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ic[n]}"/></svg>`;
const nav = active => `<nav class="tabbar">${[['home', '首页'], ['folder', '项目'], ['user', '我的']].map(([n, t], i) => `<button class="${i === active ? 'on' : ''}">${icon(n, 19)}<span>${t}</span></button>`).join('')}</nav>`;
const top = (title, back = true) => `<header class="topbar">${back ? `<button class="round" data-go="home">${icon('back', 18)}</button>` : '<span class="logo">标志</span>'}<b>${title}</b><button class="round">${icon('user', 17)}</button></header>`;

function home() {
  return `<div class="scroll">${top('演示家装企业', false)}
    <section class="hero"><img src="${img1}" alt=""><div class="hero-glass"><span class="kicker">示例别墅 · 一层客厅</span><b>硬装 + 软装<br>整体方案</b></div></section>
    <h1 class="headline">为你的家，<br>先做一遍<em>硬装与软装</em></h1>
    <p class="body">提交户型和石材偏好，1–2 分钟得到 3 个整体方案的效果图，在给定选项内调整后确认。</p>
    <button class="cta" data-go="scheme">提交方案需求 <span>${icon('arrow', 18)}</span></button>
    <div class="bento">
      <div class="tile big"><span class="num">3</span><span>个整体方案</span><small>硬装铺贴 + 软装风格</small></div>
      <div class="tile"><span class="num">6</span><span>款石材</span></div>
      <div class="tile accent"><span class="num">3</span><span>套软装</span></div>
    </div>
    <div class="section-title"><b>企业石材库</b><span>示意素材</span></div>
    <div class="strip">${stones.map(s => `<figure><img src="${swatchURL(s.id, 160)}" alt=""><figcaption>${s.name}</figcaption></figure>`).join('')}</div>
    <div class="share-card">${icon('link', 20)}<div><b>收到企业分享的链接？</b><small>直接打开即可预览，登录绑定后可调整与确认</small></div></div>
  </div>${nav(0)}`;
}
function scheme() {
  const s = schemes[ui.scheme];
  return `<div class="scroll">${top('示例别墅 · 方案')}
    <section class="stage"><img src="${s.img}" alt=""><div class="stage-top"><span class="pill glass">${icon('image', 14)} 效果图</span><span class="pill glass ghost">${icon('cube', 14)} 3D</span></div>
      <div class="stage-bottom glass"><div><span class="kicker">方案 ${s.id}</span><b>${s.name}</b></div><span class="tag">${s.soft}</span></div></section>
    <div class="dots">${schemes.map((x, i) => `<button class="${i === ui.scheme ? 'on' : ''}" data-scheme="${i}">${x.id} · ${x.name}</button>`).join('')}</div>
    <div class="spec">
      <div class="spec-card"><span class="label">硬装 · 客厅地面</span><div class="spec-row"><img src="${swatchURL(s.sw, 80)}" alt=""><div><b>${s.stone}</b><small>${s.spec} · ${s.pattern} · ${s.border}</small></div></div></div>
      <div class="spec-card"><span class="label">软装风格</span><div class="spec-row"><span class="pal">${Object.values(softStyles[[0, 2, 1][ui.scheme]].palette).slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span><div><b>${s.soft}</b><small>${softStyles[[0, 2, 1][ui.scheme]].line}</small></div></div></div>
    </div>
    <div class="section-title"><b>三个方案</b><span>左右滑动比较</span></div>
    <div class="compare">${schemes.map((x, i) => `<button class="mini ${i === ui.scheme ? 'on' : ''}" data-scheme="${i}"><img src="${x.img}" alt=""><b>${x.id} · ${x.name}</b><small>${x.stone} · ${x.soft}</small></button>`).join('')}</div>
    <div class="aerial"><img src="${aerial}" alt=""><span class="pill glass">${icon('cube', 14)} 整栋 3D 查看</span></div>
  </div>
  <div class="dock"><button class="ghost-btn" data-go="adjust">调整</button><button class="cta small" data-go="confirm">确认方案 ${s.id}</button></div>`;
}
function adjust() {
  const s = schemes[ui.scheme];
  return `<div class="scroll">${top('调整方案 ' + s.id)}
    <section class="stage compact"><img src="${s.img}" alt=""><div class="stage-bottom glass"><div><span class="kicker">修订 1 → 2</span><b>${softStyles[ui.soft].name}</b></div><span class="tag">${icon('undo', 13)} 撤回</span></div></section>
    <div class="seg">${[['soft', '软装风格'], ['hard', '硬装石材']].map(([k, t]) => `<button class="${ui.tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
    ${ui.tab === 'soft' ? `<div class="styles">${softStyles.map((st, i) => `<button class="style ${i === ui.soft ? 'on' : ''}" data-soft="${i}"><span class="pal big">${Object.values(st.palette).slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span><div><b>${st.name}</b><small>${st.line}</small></div><span class="radio">${i === ui.soft ? icon('check', 14) : ''}</span></button>`).join('')}</div>`
      : `<div class="stones">${stones.map((st, i) => `<button class="stone ${i === ui.stone ? 'on' : ''}" data-stone="${i}"><img src="${swatchURL(st.id, 160)}" alt=""><span>${st.name}</span></button>`).join('')}</div>
        <div class="chips">${['600×600', '800×800', '1200×1200', '600×300'].map((t, i) => `<span class="chip ${i === 2 ? 'on' : ''}">${t}</span>`).join('')}</div>
        <div class="chips">${['直铺', '工字', '人字', '斜铺'].map((t, i) => `<span class="chip ${i === 0 ? 'on' : ''}">${t}</span>`).join('')}</div>
        <div class="hint">${icon('sparkle', 16)}<span>客厅南北向靠墙约 20 cm 会出现窄条，可改为起铺点居中。</span></div>`}
  </div>
  <div class="dock"><button class="cta small wide">重新出图 · 约 1–2 分钟</button></div>`;
}
function confirm() {
  const s = schemes[ui.scheme];
  return `<div class="scroll">${top('确认方案')}
    <div class="confirm-head"><img src="${s.img}" alt=""><div><span class="kicker">方案 ${s.id} · 修订 2</span><b>${s.name} · ${s.soft}</b></div></div>
    <div class="list">
      <div class="row"><span>软装风格</span><b>${s.soft}</b></div>
      <div class="row"><span>客厅地面</span><b>${s.stone} · ${s.spec} · ${s.pattern}</b></div>
      <div class="row"><span>餐厅地面</span><b>${s.stone} · ${s.spec} · ${s.pattern}</b></div>
      <div class="row"><span>电视背景墙</span><b>${s.wall}</b></div>
      <div class="row"><span>楼梯踏面</span><b>${s.stone} · 1200×400 整板踏步</b></div>
    </div>
    <label class="field"><span>给企业留言</span><textarea rows="3" placeholder="例如：周末想看样品。"></textarea></label>
    <div class="toggle-row"><div><b>请企业联系我</b><small>139 **** 9000 · 下午</small></div><span class="switch on"><i></i></span></div>
  </div>
  <div class="dock"><button class="cta small wide">确认方案 ${s.id} · 修订 2</button></div>`;
}
const views = {home, scheme, adjust, confirm};

function render() {
  document.querySelector('#app').innerHTML = `
    <header class="board-head"><div><b>H5 客户端 · 风格探索</b><small>同一内容的三种视觉方向 · 效果图为后台真实出图（示意素材） · 演示数据</small></div>
      <nav>${screens.map(([k, t]) => `<button class="${ui.screen === k ? 'on' : ''}" data-screen="${k}">${t}</button>`).join('')}</nav></header>
    <main class="board">${dirs.map(d => `<section class="col"><div class="col-head"><b>${d.name}</b><small>${d.note}</small></div>
      <div class="phone dir-${d.id}"><div class="notch"></div><div class="screen">${views[ui.screen]()}</div></div></section>`).join('')}</main>`;
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-screen],[data-go],[data-scheme],[data-tab],[data-soft],[data-stone]'); if (!el) return;
  const d = el.dataset;
  if (d.screen) ui.screen = d.screen; if (d.go) ui.screen = d.go; if (d.scheme) ui.scheme = +d.scheme;
  if (d.tab) ui.tab = d.tab; if (d.soft) ui.soft = +d.soft; if (d.stone) ui.stone = +d.stone;
  render();
});
render();
