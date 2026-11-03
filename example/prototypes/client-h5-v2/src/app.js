// H5 客户端交互原型 v2（P03）：A 柔和中性 + ① 沉浸全屏，浅色 / 深色跟随系统。纯前端、演示数据、不接服务端。
// 结构按将来的 React 组件拆分：Components（AppBar、TabBar、Button…）→ Screens（HomeScreen…）→ 路由与状态。
// 组件、状态与服务端差异的对照见 docs/design/H5_UI_DESIGN.md。
import {swatchURL} from '../../client-h5/src/stone.js';
import {images, workspace, stones, stoneById, sizes, patterns, patternName, finishes, makeSchemes, checks, shares, demoPhone, maskPhone, spaced, softStyles} from './data.js';

const KEY = 'hestia.client-h5-v2';
const softById = Object.fromEntries(softStyles.map(s => [s.id, s]));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const clone = v => JSON.parse(JSON.stringify(v));
const attr = (name, on) => (on ? ` ${name}` : '');
const pressed = on => ` aria-pressed="${!!on}"`;
const today = () => { const d = new Date(); return `${d.getMonth() + 1} 月 ${d.getDate()} 日`; };
const SCOPES = [['floor', '各层地面'], ['wall', '背景墙'], ['stair', '楼梯踏面']];
const FLOOR = '一层地面';

// ---------- 状态 ----------
const freshLogin = () => ({phone: '', input: '', sent: false, code: '', expiresAt: 0, attempts: 5, sends: [], cooldownUntil: 0, error: null});
const freshDraft = () => ({step: 1, source: null, file: null, finishes: finishes.map(f => f.id), scopes: SCOPES.map(([v]) => v), stones: [], tone: null, patterns: [], border: 'auto', note: ''});
const initial = () => ({session: null, theme: 'system', login: freshLogin(), draft: freshDraft(), projects: [], binds: {}, seq: 1, ui: {}});
let state;
try { state = {...initial(), ...JSON.parse(localStorage.getItem(KEY) || 'null')}; } catch { state = initial(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 隐私模式仅内存 */ } };

// ---------- 路由 ----------
function parse() { const raw = location.hash.replace(/^#/, '') || '/'; const [path, qs] = raw.split('?'); return {path, parts: path.split('/').filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs || ''))}; }
const go = path => { if (location.hash === '#' + path) render(); else location.hash = path; };
let timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, ms));

// ---------- 图标（24 网格，1.7 描边） ----------
const P = {
  back: 'M15 5l-7 7 7 7', left: 'M15 5l-7 7 7 7', right: 'm9 5 7 7-7 7', home: 'M3 10 12 3l9 7M5 9v12h14V9', folder: 'M3 7V4h6l3 3h9v13H3z',
  user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21c1-4 4-6 8-6s7 2 8 6', plus: 'M12 5v14M5 12h14', cube: 'm12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9', image: 'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5',
  link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1', check: 'm4 12 5 5L20 6', undo: 'M9 4 3 10l6 6M3 10h10a7 7 0 0 1 7 7', lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
  phone: 'M7 2h10v20H7zM11 18h2', clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', alert: 'M12 9v5M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  info: 'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6', file: 'M6 2h8l5 5v15H6zM14 2v5h5', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  sun: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0', moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  system: 'M3 4h18v12H3zM8 20h8M12 16v4', logout: 'M15 4h5v16h-5M10 8l-4 4 4 4M6 12h11', close: 'M5 5l14 14M19 5 5 19',
};
const icon = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`;

// ========== Components ==========
// 每个函数对应一个将来的 React 组件；参数即 props。
const Screen = (body, {cls = '', bar = '', after = ''} = {}) => `<div class="screen ${cls}">${bar}${body}${after}</div>`;
const ProtoButton = () => `<button class="proto-btn" data-act="review" aria-label="原型审阅导航">审阅</button>`;
function AppBar({back, backAct, title = '', overlay = false, brand = false, end = ProtoButton()} = {}) {
  const start = backAct ? `<button class="icon-btn" data-act="${backAct[0]}" data-v="${backAct[1]}" aria-label="${backAct[2]}">${icon('back', 20)}</button>` : back ? `<a class="icon-btn ${overlay ? 'icon-btn--media' : ''}" href="#${back}" aria-label="返回">${icon('back', 20)}</a>`
    : brand ? `<span class="brand-mark" aria-label="${esc(workspace.name)}标志（占位）">标志</span>` : '<span></span>';
  return `<header class="appbar ${overlay ? 'appbar--overlay' : ''}">${start}<b class="appbar__title">${esc(title)}</b><span class="appbar__end">${end}</span></header>`;
}
function TabBar(active) {
  const items = [['home', '/', '首页'], ['folder', '/projects', '项目'], ['user', '/me', '我的']];
  return `<nav class="tabbar" aria-label="主菜单">${items.map(([n, href, t]) => `<a class="tabbar__item" href="#${href}"${active === href ? ' aria-current="page"' : ''}>${icon(n, 22)}<span>${t}</span></a>`).join('')}
    <button class="tabbar__action" data-act="start" aria-label="提交方案需求"><i>${icon('plus', 26)}</i></button></nav>`;
}
const Button = (label, {act, v, href, kind = 'primary', block = false, grow = false, sm = false, disabled = false, lead = ''} = {}) => {
  const cls = `btn btn--${kind}${block ? ' btn--block' : ''}${grow ? ' btn--grow' : ''}${sm ? ' btn--sm' : ''}`;
  const inner = `${lead ? icon(lead, 17) : ''}<span>${label}</span>`;
  if (href && !disabled) return `<a class="${cls}" href="#${href}">${inner}</a>`;
  return `<button class="${cls}"${act ? ` data-act="${act}"` : ''}${v != null ? ` data-v="${esc(v)}"` : ''}${attr('disabled', disabled)}>${inner}</button>`;
};
const Section = (title, body, aside = '') => `<section class="section"><div class="section__head"><h2 class="section__title">${title}</h2>${aside ? `<span class="section__aside">${aside}</span>` : ''}</div>${body}</section>`;
const Group = rows => `<div class="group">${rows.join('')}</div>`;
const Row = (label, value, {stack = false} = {}) => `<div class="row${stack ? ' row--stack' : ''}"><span class="row__label">${label}</span><span class="row__value">${value}</span></div>`;
const LinkRow = ({href, act, v, ico, title, sub}) => {
  const inner = `<span class="row__icon">${icon(ico, 18)}</span><span class="row__main"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span><span class="row__chev">${icon('right', 16)}</span>`;
  return href ? `<a class="row" href="#${href}">${inner}</a>` : `<button class="row" data-act="${act}"${v ? ` data-v="${v}"` : ''}>${inner}</button>`;
};
const InfoRow = ({ico, title, sub}) => `<div class="row"><span class="row__icon">${icon(ico, 18)}</span><span class="row__main"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span></div>`;
const Alert = (kind, text, title = '') => `<div class="alert alert--${kind}"${kind === 'danger' ? ' role="alert"' : ''}>${icon(kind === 'info' ? 'info' : 'alert', 16)}<span>${title ? `<b>${title}</b>` : ''}${text}</span></div>`;
const Badge = (label, kind = 'wait') => `<span class="badge badge--${kind}">${label}</span>`;
const Chips = (opts, isOn, act, extra = '') => `<div class="chips">${opts.map(([v, t]) => `<button class="chip" data-act="${act}" data-v="${v}"${extra}${pressed(isOn(v))}>${t}</button>`).join('')}</div>`;
const Segmented = (opts, current, act, cls = '') => `<div class="segmented ${cls}">${opts.map(([v, t, ico]) => `<button data-act="${act}" data-v="${v}"${pressed(current === v)}>${ico ? icon(ico, 16) : ''}${t}</button>`).join('')}</div>`;
const Switch = (on, act, label) => `<button class="switch" role="switch" aria-checked="${!!on}" aria-label="${label}" data-act="${act}"></button>`;
const Timeline = items => `<ol class="timeline">${items.map(([t, s, small]) => `<li data-state="${s || 'todo'}"><i>${s === 'done' ? icon('check', 13) : ''}</i><div><b>${t}</b>${small ? `<small>${small}</small>` : ''}</div></li>`).join('')}</ol>`;
const Dock = html => `<div class="dock">${html}</div>`;
const ProtoOps = (label, act, v) => `<div class="proto-ops"><span>原型操作 · 模拟企业一侧</span><button data-act="${act}" data-v="${v}">${label}</button></div>`;
const Palette = (id, mod = '') => `<span class="palette ${mod}" aria-hidden="true">${Object.values(softById[id].palette).slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span>`;
const stoneImg = (id, size = 160) => `<img src="${swatchURL(stoneById[id].tex, size)}" alt="">`;
const StyleOptions = ({current, act, interactive = true}) => `<div class="styles">${softStyles.map(st => {
  const body = `${Palette(st.id, 'palette--tile')}<b>${st.name}</b><small>${st.line.split('、').slice(0, 2).join('、')}</small>`;
  return interactive ? `<button class="style-opt" data-act="${act}" data-v="${st.id}"${pressed(current === st.id)}>${body}</button>` : `<div class="style-opt">${body}</div>`;
}).join('')}</div>`;
const Swatches = ({current, act, rail = false, order = null, k}) => `<div class="swatches ${rail ? 'swatches--rail' : ''}">${stones.map(s => {
  const n = order ? order.indexOf(s.id) + 1 : 0, on = order ? n > 0 : current === s.id;
  return `<button class="swatch" data-act="${act}" data-v="${s.id}"${k ? ` data-k="${k}"` : ''}${pressed(on)}>${stoneImg(s.id)}${n ? `<i class="swatch__order">${n}</i>` : ''}${s.name}</button>`;
}).join('')}</div>`;
const Stepper = step => `<ol class="stepper" aria-label="第 ${step} 步，共 3 步">${['户型', '饰面', '石材与偏好'].map((n, i) => `<li data-state="${i + 1 === step ? 'now' : i + 1 < step ? 'done' : 'todo'}">${n}</li>`).join('')}</ol>`;
const floorLine = f => `${stoneById[f.stone].name} · ${f.size} · ${patternName[f.pattern]}${f.border ? ` · ${stoneById[f.border].name}波打线` : ''}`;
const finishValue = (s, f) => (f.kind === 'stair' ? `${stoneById[s.floor.stone].name} · 整板踏步` : f.kind === 'wall' ? `${stoneById[s.wall.stone].name} · ${s.wall.size} · ${patternName[s.wall.pattern]}` : floorLine(s.floor));

// ---------- 项目模型 ----------
const projectById = id => state.projects.find(p => p.id === id) || (id?.startsWith('share-') ? sharedPreview(id.slice(6)) : null);
const sharedPreview = token => ({id: 'share-' + token, name: shares[token].title, origin: 'shared', token, status: 'published', source: 'member', schemes: makeSchemes(), revisions: {A: 1, B: 1, C: 1}});
function newProject(fields) { const p = {id: 'p' + state.seq++, origin: 'self', revisions: {A: 1, B: 1, C: 1}, createdAt: today(), ...fields}; state.projects.unshift(p); return p; }
const ui = id => state.ui[id] ||= {scheme: 0, expanded: false, view: 'image'};
const STATUS = {converting: ['图纸转换中', 'wait', '正在读取图层、墙体与楼层'], generating: ['出图中', 'wait', '正在排版出图'], review: ['待审核', 'wait', '企业核对后发布'],
  assist: ['需协助转换', 'warn', '等待企业转换图纸'], published: ['已发布', 'ok', '3 个整体方案'], confirmed: ['已确认', 'ok', '']};
const shortName = p => p.name.split(' · ')[0];

// ========== Screens ==========
function HomeScreen() {
  const body = `<section class="home-hero"><img src="${images.schemes[0]}" alt="示例别墅一层客厅效果图（示意）">${AppBar({brand: true, overlay: true, title: workspace.name})}
      <div class="home-hero__copy"><h1>为你的家，<br>先做一遍硬装与软装</h1><p class="home-hero__caption">示例别墅一层客厅 · 效果图示意</p></div></section>
    <div class="home-body screen__body">
      <p class="lede">提交户型与石材偏好，1–2 分钟得到 3 个整体方案的效果图。${workspace.name}核对后发布，你可以换软装风格、换石材铺法，满意再确认。</p>
      <ol class="flow" aria-label="流程">${[['选户型', '示例或你的图纸'], ['选饰面与石材', '最多 3 款'], ['看 3 个方案', '可调整再确认']].map(([t, s]) => `<li>${t}<small>${s}</small></li>`).join('')}</ol>
      ${Section('三套软装风格', StyleOptions({interactive: false}), '示意')}
      ${Section('企业石材库', `<div class="stone-rail">${stones.map(s => `<figure>${stoneImg(s.id)}<figcaption>${s.name}</figcaption></figure>`).join('')}</div>`, '示意素材')}
      <div class="section">${Group([LinkRow({href: '/share/direct', ico: 'link', title: '收到企业分享的链接？', sub: '直接打开即可预览；调整和确认需手机号登录并绑定'})])}</div>
      <p class="fine-print">演示环境 · 数据、尺寸与效果图均为示意</p></div>`;
  return Screen(body, {cls: 'screen--tabs home', after: TabBar('/')});
}

const validPhone = p => /^1\d{10}$/.test(p);
function LoginScreen(q) {
  const L = state.login, now = Date.now(), next = q.next || '/projects', share = next.startsWith('/bind');
  const msg = {phone: '请输入 11 位中国大陆手机号。', nosend: '请先获取验证码。', wrong: `验证码不正确，还可尝试 ${L.attempts} 次。`, locked: '错误次数过多，此验证码已失效。请重新获取。',
    expired: '验证码已过期（5 分钟内有效）。请重新获取。', rate: '获取验证码过于频繁。为保护账号，请 60 分钟后再试。'}[L.error];
  const cooldown = Math.max(0, Math.ceil((L.cooldownUntil - now) / 1000));
  const sendLabel = L.error === 'rate' ? '暂不可获取' : cooldown ? `${cooldown} 秒后重发` : L.sent ? '重新获取' : '获取验证码';
  const body = `<main class="screen__body">
      <h1 class="page-title">手机号登录</h1><p class="lede">验证手机号即可，无需密码。首次登录会关联${workspace.name}，你提交和绑定的方案都保存在这个账号下。</p>
      ${share ? Alert('info', `登录后，分享给你的方案会按企业设定的方式绑定到你的账号。演示定向手机号：<b class="num">${spaced(demoPhone)}</b>`) : ''}
      ${Group([`<label class="field"><span class="field__label">手机号</span><span class="field__control"><span class="field__prefix">+86</span><input id="phone" inputmode="numeric" autocomplete="tel-national" maxlength="11" placeholder="11 位手机号" value="${esc(L.phone)}"></span></label>`,
        `<label class="field"><span class="field__label">验证码</span><span class="field__control"><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位验证码" value="${esc(L.input)}"><button class="field__action" data-act="send"${attr('disabled', cooldown || L.error === 'rate')}>${sendLabel}</button></span></label>`])}
      ${L.sent && L.code && !['locked', 'expired'].includes(L.error) ? `<div class="demo-code" role="status"><div><span class="caption">演示验证码 · 不发送短信 · 5 分钟内有效</span><strong>${L.code}</strong></div>${Button('填入', {act: 'fill', kind: 'secondary', sm: true})}</div>` : ''}
      ${msg ? Alert(['phone', 'nosend'].includes(L.error) ? 'hint' : 'danger', msg) : ''}
      <div class="btn-stack">${Button('登录', {act: 'login', block: true, disabled: ['locked', 'rate'].includes(L.error)})}</div>
      <p class="fine-print">登录即表示同意《用户协议》《隐私政策》（原型占位）</p></main>`;
  return {html: Screen(body, {bar: AppBar({back: share ? next.replace('/bind', '/share') : '/'})}), after(root) {
    root.querySelector('#phone').addEventListener('input', e => { L.phone = e.target.value.replace(/\D/g, ''); e.target.value = L.phone; save(); });
    root.querySelector('#code').addEventListener('input', e => { L.input = e.target.value.replace(/\D/g, ''); e.target.value = L.input; save(); });
    if (cooldown) { const t = setInterval(() => { const b = root.querySelector('[data-act=send]'), left = Math.ceil((L.cooldownUntil - Date.now()) / 1000); if (!b) return; if (left <= 0) { clearInterval(t); b.disabled = false; b.textContent = '重新获取'; } else b.textContent = `${left} 秒后重发`; }, 1000); return () => clearInterval(t); }
  }};
}
function sendCode() {
  const L = state.login, now = Date.now();
  if (!validPhone(L.phone)) { L.error = 'phone'; return; }
  L.sends = L.sends.filter(t => now - t < 3600e3);
  if (L.sends.length >= 5) { L.error = 'rate'; return; }
  L.sends.push(now);
  Object.assign(L, {sent: true, code: String(Math.floor(100000 + Math.random() * 900000)), expiresAt: now + 300e3, attempts: 5, cooldownUntil: now + 60e3, error: null, input: ''});
}
function doLogin(next) {
  const L = state.login;
  if (!validPhone(L.phone)) { L.error = 'phone'; return; }
  if (!L.sent) { L.error = 'nosend'; return; }
  if (Date.now() > L.expiresAt) { L.error = 'expired'; return; }
  if (L.attempts <= 0) { L.error = 'locked'; return; }
  if (L.input !== L.code) { L.attempts--; L.error = L.attempts ? 'wrong' : 'locked'; return; }
  state.session = L.phone; state.login = freshLogin(); go(next || '/projects');
}

// 提交方案需求：上传的图纸在提交后才转换（与服务端一致），所以上传时第 2 步只选大致范围。
function NewRequestScreen() {
  if (!state.session) { go('/login?next=/new'); return null; }
  const d = state.draft, upload = d.source === 'upload' && d.file, ready = d.source === 'sample' || upload;
  let body, dock;
  if (d.step === 1) {
    const f = d.file, dxf = f && /\.dxf$/i.test(f.name);
    body = `<h1 class="page-title">先选择户型</h1><p class="lede">用示例别墅体验完整流程，或上传你家的图纸。</p>
      <div class="section">
      <button class="option" data-act="source" data-v="sample"${pressed(d.source === 'sample')}><img class="option__media" src="${images.aerial}" alt=""><span class="option__body"><b>示例别墅（演示）</b><small>三层 · 5 处可铺贴饰面 · 尺寸为示意</small></span><span class="radio">${icon('check', 14)}</span></button>
      <div class="upload"${attr('data-on', d.source === 'upload')}><label class="option"${pressed(d.source === 'upload')}><input type="file" id="file" class="sr-only" accept=".dxf,.dwg,.pdf,image/*"><span class="option__media">${icon('upload', 22)}</span><span class="option__body"><b>上传我的图纸</b><small>DXF 提交后自动转换；PDF、图片、DWG 由企业协助转换</small></span><span class="radio">${icon('check', 14)}</span></label>
        ${f ? `<div class="upload__file">${icon('file', 16)}<b>${esc(f.name)}</b>${dxf ? Badge('提交后自动转换') : Badge('需企业协助转换', 'warn')}</div><p class="meta">${dxf ? '自动转换的结果需企业核对后才会发布。' : `这个格式不能自动识别，${workspace.name}会协助转换后再出方案。可以继续提交偏好。`}</p>` : ''}
        <p class="upload__demo">没有图纸？试试<button data-act="demofile" data-v="别墅平面图.dxf">别墅平面图.dxf</button><button data-act="demofile" data-v="别墅平面图.pdf">别墅平面图.pdf</button></p></div></div>`;
    dock = Button('下一步：选择饰面', {act: 'step', v: 2, block: true, disabled: !ready});
  } else if (d.step === 2) {
    body = upload ? `<h1 class="page-title">想铺石材的部位</h1><p class="lede">图纸转换后，企业会和你确认具体楼层与饰面。先告诉我们大致范围。</p>
        <div class="section">${Chips(SCOPES, v => d.scopes.includes(v), 'scope')}</div>`
      : `<h1 class="page-title">选择要铺石材的饰面</h1><p class="lede">饰面是建筑的一部分，不随家具移动。只为勾选的部位出方案。</p>
        ${Section('示例别墅 · 一层', `<div class="group">${finishes.map(f => `<button class="check" data-act="finish" data-v="${f.id}"${pressed(d.finishes.includes(f.id))}><span class="check__box">${icon('check', 14)}</span><span class="row__main"><b>${f.name}</b><small>${({floor: '地面', wall: '墙面', stair: '楼梯'})[f.kind]} · ${f.size}</small></span></button>`).join('')}</div>`, `已选 ${d.finishes.length} 处`)}`;
    const count = upload ? d.scopes.length : d.finishes.length;
    dock = `${Button('上一步', {act: 'step', v: 1, kind: 'secondary'})}${Button('下一步：挑选石材', {act: 'step', v: 3, grow: true, disabled: !count})}`;
  } else {
    body = `<h1 class="page-title">挑选石材与偏好</h1><p class="lede">最多 3 款，方案按选择顺序优先使用。软装风格出方案后可以切换。</p>
      ${Section('石材', Swatches({order: d.stones, act: 'stone'}), d.stones.length ? `已选 ${d.stones.length} / 3` : '未选时按企业推荐')}
      ${Section('整体色调', Chips(['浅色', '暖色', '深色', '不确定'].map(t => [t, t]), v => d.tone === v, 'tone'))}
      ${Section('铺法偏好', Chips(patterns, v => d.patterns.includes(v), 'pattern'), '可多选')}
      ${Section('波打线', Chips([['yes', '要'], ['no', '不要'], ['auto', '由方案决定']], v => d.border === v, 'border'))}
      ${Section('补充说明', Group([`<label class="field"><span class="sr-only">补充说明（选填）</span><textarea id="note" rows="3" maxlength="200" placeholder="选填。例如：客厅想更大气；家里有老人，楼梯要防滑。">${esc(d.note)}</textarea></label>`]), '选填')}
      <p class="fine-print">石材为示意素材</p>`;
    dock = `${Button('上一步', {act: 'step', v: 2, kind: 'secondary'})}${Button('提交方案需求', {act: 'submit', grow: true})}`;
  }
  return {html: Screen(`<main class="screen__body">${Stepper(d.step)}${body}</main>${Dock(dock)}`, {cls: 'screen--dock', bar: AppBar(d.step > 1 ? {backAct: ['step', d.step - 1, '上一步'], title: '提交方案需求'} : {back: '/', title: '提交方案需求'})}), after(root) {
    root.querySelector('#note')?.addEventListener('input', e => { d.note = e.target.value; save(); });
    root.querySelector('#file')?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) pickFile(f.name); });
  }};
}
function pickFile(name) { Object.assign(state.draft, {source: 'upload', file: {name}}); save(); render(); }
function submitDraft() {
  const d = state.draft, upload = d.source === 'upload', dxf = upload && /\.dxf$/i.test(d.file.name);
  const p = newProject({name: upload ? d.file.name.replace(/\.[^.]+$/, '') + ' · 我的方案需求' : '示例别墅 · 我的方案需求', source: d.source, fileName: d.file?.name,
    schemes: makeSchemes(), status: upload ? (dxf ? 'converting' : 'assist') : 'generating', next: upload ? 'review' : 'published', genStart: Date.now(),
    prefs: {tone: d.tone, stones: d.stones, patterns: d.patterns, border: d.border, note: d.note, scopes: upload ? d.scopes : null}});
  state.draft = freshDraft(); save(); go(`/project/${p.id}`);
}

// 状态页：标题 + 说明 + 进度节点 + 操作
function StatusScreen({back = '/projects', seal = '', title, sub, items = [], extra = ''}) {
  return Screen(`<main class="screen__body">${seal}<h1 class="page-title">${title}</h1><p class="lede">${sub}</p>${items.length ? Timeline(items) : ''}${extra}</main>`, {bar: AppBar({back})});
}
const CONVERT_MS = 2400, RENDER_MS = 5400;
function WaitScreen(p) {
  const converting = p.status === 'converting';
  const steps = [...(p.source === 'upload' ? ['转换图纸'] : []), '读取空间与饰面', '计算铺贴排版与切块', '渲染 3 张效果图', p.next === 'review' ? '提交企业审核' : '整理方案'];
  const body = `<main class="screen__body">
    <h1 class="page-title">${converting ? '正在转换图纸' : '正在排版出图'}</h1>
    <p class="lede">${converting ? `正在读取「${esc(p.fileName)}」的图层、墙体与楼层。` : '按你选择的饰面和石材计算整块与切块，再渲染效果图。'}每张约 1–2 分钟（原型加速），可以离开此页，完成后在「项目」里查看。</p>
    <div class="renders">${p.schemes.map((s, i) => `<div class="render-slot" data-i="${i}" data-state="todo"><img src="${images.schemes[s.img]}" alt=""><span>方案 ${s.id}</span></div>`).join('')}</div>
    <div class="bar" role="progressbar" aria-label="出图进度" aria-valuemin="0" aria-valuemax="100"><i id="bar"></i></div>
    <p class="meta num" id="pct" style="margin-top:8px">0%</p>
    ${Timeline(steps.map(t => [t]))}
    <div class="btn-stack">${Button('去我的项目', {href: '/projects', kind: 'secondary', block: true})}</div></main>`;
  return {html: Screen(body, {bar: AppBar({back: '/projects'})}), after(root) {
    let raf; const n = steps.length, conv = p.source === 'upload' ? 1 : 0;
    const tick = () => {
      if (p.status === 'converting' && Date.now() - p.genStart >= CONVERT_MS) { p.status = 'generating'; save(); render(); return; }
      const elapsed = Date.now() - p.genStart - (conv ? CONVERT_MS : 0);
      const k = p.status === 'converting' ? Math.min(.99, (Date.now() - p.genStart) / CONVERT_MS) / n : Math.min(1, (conv + Math.min(1, elapsed / RENDER_MS) * (n - conv)) / n);
      root.querySelector('#bar').style.width = `${k * 100}%`; root.querySelector('#pct').textContent = `${Math.round(k * 100)}%`;
      root.querySelector('.bar').setAttribute('aria-valuenow', Math.round(k * 100));
      root.querySelectorAll('.timeline li').forEach((li, i) => { li.dataset.state = k >= (i + 1) / n ? 'done' : k >= i / n ? 'now' : 'todo'; li.querySelector('i').innerHTML = li.dataset.state === 'done' ? icon('check', 13) : ''; });
      const r = p.status === 'converting' ? 0 : Math.min(1, elapsed / RENDER_MS);
      root.querySelectorAll('.render-slot').forEach((el, i) => { el.dataset.state = r >= .45 + i * .18 ? 'done' : r > 0 ? 'now' : 'todo'; });
      if (k >= 1) { p.status = p.next; save(); later(render, 500); return; }
      raf = requestAnimationFrame(tick);
    };
    tick(); return () => cancelAnimationFrame(raf);
  }};
}
const ReviewScreen = p => StatusScreen({title: '方案已生成，企业审核后发布', sub: `你的图纸由系统自动转换。为避免尺寸或饰面边界不准确的方案误导你，${workspace.name}会先核对，再发布给你。`,
  items: [['提交方案需求', 'done', p.createdAt], ['图纸转换与排版出图', 'done', '3 个整体方案'], ['企业审核', 'now', '核对尺寸与饰面边界'], ['发布方案']], extra: ProtoOps('模拟企业发布', 'publish', p.id)});
const AssistScreen = p => StatusScreen({title: '图纸需要企业协助转换', sub: `「${esc(p.fileName)}」不是 DXF，系统不能自动识别。${workspace.name}会协助转换图纸，与你确认楼层和饰面后再出方案。`,
  items: [['提交方案需求', 'done', p.createdAt], ['企业协助转换图纸', 'now', '通常 1–2 个工作日'], ['确认楼层与饰面'], ['排版出图并发布']], extra: ProtoOps('模拟企业完成并发布', 'publish', p.id)});

// 方案页：Stage（效果图 / 3D）+ Panel（方案切换、摘要、展开详情）
function SchemeStage(p, s, u, {busy = false, top = '', nav = true, bottom = ''} = {}) {
  const img = u.view === '3d' ? `<img class="stage__img" src="${images.aerial}" alt="整栋 3D 视图（原型以整栋图示意）">` : `<img class="stage__img" src="${images.schemes[s.img]}" alt="方案 ${s.id} 效果图（示意）">`;
  return `<div class="stage${busy ? ' stage--busy' : ''}" data-swipe>${img}${top ? `<div class="stage__top">${top}</div>` : ''}
    ${nav ? `<button class="icon-btn icon-btn--media stage__nav stage__nav--prev" data-act="prev" aria-label="上一个方案">${icon('left', 18)}</button><button class="icon-btn icon-btn--media stage__nav stage__nav--next" data-act="next" aria-label="下一个方案">${icon('right', 18)}</button>` : ''}
    ${bottom ? `<div class="stage__bottom">${bottom}</div>` : ''}${busy ? `<div class="stage__veil" role="status"><b>重新出图中</b><span>按你的调整重新排版、渲染 · 约 1–2 分钟</span><div class="progress"><i></i></div></div>` : ''}</div>`;
}
function SchemeScreen(p, {preview = false} = {}) {
  const u = ui(p.id), s = p.schemes[u.scheme], conf = p.status === 'confirmed' && p.confirmed, soft = softById[s.soft], c = checks(s.floor);
  const stale = conf && conf.scheme === s.id && conf.revision !== p.revisions[s.id];
  const tops = [preview ? `<span class="media-tag">${icon('eye', 14)}企业分享给你的方案 · 仅预览</span>` : '', u.view === '3d' ? `<span class="media-tag">${icon('cube', 14)}实时 3D · 以效果图为准（原型示意）</span>` : ''].join('');
  const bottom = `${Segmented([['image', '效果图', 'image'], ['3d', '3D', 'cube']], u.view, 'view', 'segmented--media')}<span class="media-tag num">${u.scheme + 1} / ${p.schemes.length}</span>`;
  const actions = preview ? `${Button('调整', {act: 'gate', kind: 'secondary', lead: 'lock'})}${Button('确认方案', {act: 'gate', grow: true, lead: 'lock'})}`
    : conf && !stale && conf.scheme === s.id ? `${Button('继续调整', {href: `/project/${p.id}/adjust`, kind: 'secondary'})}${Button('查看确认', {href: `/project/${p.id}/done`, grow: true})}`
      : `${Button('调整', {href: `/project/${p.id}/adjust`, kind: 'secondary'})}${Button(`确认方案 ${s.id}`, {href: `/project/${p.id}/confirm`, grow: true})}`;
  const details = `<p class="meta" style="margin-top:12px">${esc(s.line)}</p>
    ${Section(`软装 · ${soft.name}`, `<div class="summary">${Palette(s.soft)}<span class="row__main"><b>${soft.name}</b><small>${soft.line}</small></span></div>`, '示意')}
    ${Section('硬装', Group(finishes.map(f => Row(f.name, finishValue(s, f), {stack: true}))), `一层 · ${finishes.length} 处`)}
    ${Section('三个方案的差异', `<table class="compare"><thead><tr><th scope="col"><span class="sr-only">项目</span></th>${p.schemes.map((x, i) => `<th scope="col" class="${i === u.scheme ? 'is-current' : ''}">方案 ${x.id}<br>${x.name}</th>`).join('')}</tr></thead>
      <tbody>${[['软装', x => softById[x.soft].name], ['石材', x => stoneById[x.floor.stone].name], ['规格', x => x.floor.size], ['铺法', x => patternName[x.floor.pattern]], ['波打线', x => (x.floor.border ? '有' : '无')]].map(([k, fn]) => `<tr><th scope="row">${k}</th>${p.schemes.map((x, i) => `<td class="${i === u.scheme ? 'is-current' : ''}">${fn(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`, FLOOR)}
    ${c.map(h => Alert(h.level === 'conflict' ? 'danger' : 'hint', h.text, h.level === 'conflict' ? '冲突' : '提示')).join('')}`;
  const panel = `<section class="panel" aria-label="方案详情"><button class="panel__grip" data-act="expand" aria-expanded="${u.expanded}" aria-label="${u.expanded ? '收起详情' : '展开详情'}"></button>
    <div class="panel__scroll">
      ${Segmented(p.schemes.map((x, i) => [i, `${x.id} · ${x.name}`]), u.scheme, 'scheme')}
      <div class="panel__head" style="margin-top:16px"><div><h1 class="panel__title">方案 ${s.id} · ${s.name}</h1><p class="caption">修订 ${p.revisions[s.id]} · 左右滑动效果图也可切换</p></div><span class="style-tag">${Palette(s.soft, 'palette--dot')}${soft.name}</span></div>
      ${conf ? (stale ? Alert('hint', `你确认的是修订 ${conf.revision}，之后又调整过。企业看到的仍是修订 ${conf.revision}，如需以新修订为准，请重新确认。`) : conf.scheme === s.id ? `<p class="meta" style="margin-top:8px;color:var(--c-ok)">${icon('check', 14)} 你已确认这一版</p>` : '') : ''}
      <div class="summary">${stoneImg(s.floor.stone)}<span class="row__main"><b>${stoneById[s.floor.stone].name}</b><small>${FLOOR} · ${s.floor.size} · ${patternName[s.floor.pattern]}${s.floor.border ? ' · 波打线' : ''}</small></span></div>
      ${u.expanded ? details : `<button class="text-link" data-act="expand" style="margin-top:8px">查看软装、硬装清单与方案对比 ${icon('right', 14)}</button>`}
    </div><div class="panel__actions">${actions}</div></section>`;
  return Screen(`${SchemeStage(p, s, u, u.expanded ? {nav: false} : {top: tops, bottom})}${AppBar({back: preview ? '/' : '/projects', title: shortName(p), overlay: true})}${panel}`, {cls: `immersive${u.expanded ? ' is-expanded' : ''}`});
}

// 调整页：改动先累积在本地，点「重新出图」一次生成新修订（服务端需补批量提交接口，见设计文档）。
function AdjustScreen(p) {
  const u = ui(p.id); u.view = 'image'; const s = p.schemes[u.scheme];
  if (!p.work || p.work.scheme !== s.id) p.work = {scheme: s.id, soft: s.soft, floor: clone(s.floor), tab: 'soft', history: [], rendering: false, rendered: false};
  const w = p.work, pending = w.history.length, c = checks(w.floor), conflict = c.some(x => x.level === 'conflict'), rev = p.revisions[s.id];
  const tag = w.rendering ? '' : w.rendered && !pending ? `${icon('check', 14)}已生成修订 ${rev}` : pending ? `${icon('clock', 14)}${pending} 处修改未出图` : `当前修订 ${rev}`;
  const dock = w.rendering ? Button('重新出图中…', {block: true, disabled: true})
    : w.rendered && !pending ? `${Button('回到方案', {href: `/project/${p.id}`, kind: 'secondary'})}${Button(`确认修订 ${rev}`, {href: `/project/${p.id}/confirm`, grow: true})}`
      : `<button class="icon-btn icon-btn--outline" data-act="undo" aria-label="撤回上一处修改"${attr('disabled', !pending)}>${icon('undo', 20)}</button>${Button(conflict ? '有冲突，暂不能出图' : pending ? `重新出图 · 生成修订 ${rev + 1}` : '先选择要调整的选项', {act: 'rerender', grow: true, disabled: !pending || conflict})}`;
  const soft = `<p class="meta" style="margin-top:12px">换风格会改变全屋家具款式、布艺与配色；家具布局由方案确定。</p><div style="margin-top:12px">${StyleOptions({current: w.soft, act: 'soft'})}</div>`;
  const hard = `${Section(`${FLOOR} · 石材`, Swatches({current: w.floor.stone, act: 'set', k: 'stone', rail: true}), '示意素材')}
    ${Section('规格', `<div class="chips">${sizes.map(t => `<button class="chip num" data-act="set" data-k="size" data-v="${t}"${pressed(w.floor.size === t)}>${t}</button>`).join('')}</div>`, '毫米')}
    ${Section('铺法', `<div class="chips">${patterns.map(([v, t]) => `<button class="chip" data-act="set" data-k="pattern" data-v="${v}"${pressed(w.floor.pattern === v)}>${t}</button>`).join('')}</div>`)}
    <div class="group" style="margin-top:24px"><div class="row"><span class="row__main"><b>波打线</b><small>${w.floor.border ? '深色金脉石收边，宽 18 cm' : '石材直接铺到墙边'}</small></span><button class="switch" role="switch" aria-label="波打线" aria-checked="${!!w.floor.border}" data-act="set" data-k="border" data-v="${w.floor.border ? '' : 'gold'}"></button></div></div>
    ${c.filter(h => h.level !== 'conflict').map(h => Alert('hint', h.text, '提示 · 可以继续')).join('')}`;
  const notice = conflict && !w.rendering ? `<div class="panel__notice">${c.filter(h => h.level === 'conflict').map(h => Alert('danger', h.text, '冲突 · 不能出图')).join('')}</div>` : '';
  const panel = `<section class="panel" aria-label="调整选项"><span class="panel__grip" aria-hidden="true"></span><div class="panel__scroll">
      ${Segmented([['soft', '软装风格'], ['hard', '硬装石材']], w.tab, 'tab')}
      <fieldset${attr('disabled', w.rendering)}>${w.tab === 'soft' ? soft : hard}</fieldset>
      ${pending ? Section(`本次修改`, `<ol class="changes">${w.history.map(h => `<li>${h.label}</li>`).join('')}</ol>`, `${pending} 处`) : ''}
    </div>${notice}<div class="panel__actions">${dock}</div></section>`;
  return {html: Screen(`${SchemeStage(p, s, u, {busy: w.rendering, nav: false, top: tag ? `<span class="media-tag">${tag}</span>` : ''})}${AppBar({back: `/project/${p.id}`, title: `调整方案 ${s.id}`, overlay: true})}${panel}`, {cls: 'immersive adjust'}), after() {
    if (w.rendering) later(() => { s.soft = w.soft; s.floor = clone(w.floor); p.revisions[s.id]++; Object.assign(w, {rendering: false, rendered: true, history: []}); save(); render(); }, 2600);
  }};
}
function setOption(p, k, v) {
  const w = p.work, before = JSON.stringify(w.floor);
  const label = {stone: () => `${FLOOR}：${stoneById[w.floor.stone].name} → ${stoneById[v].name}`, size: () => `${FLOOR}：${w.floor.size} → ${v}`, pattern: () => `${FLOOR}：${patternName[w.floor.pattern]} → ${patternName[v]}`, border: () => `${FLOOR}：${w.floor.border ? '有' : '无'}波打线 → ${v ? '有' : '无'}波打线`}[k]();
  w.floor[k] = k === 'border' ? (v || null) : v;
  if (JSON.stringify(w.floor) !== before) { w.history.push({kind: 'floor', before: JSON.parse(before), label}); w.rendered = false; }
}

function ConfirmScreen(p) {
  const u = ui(p.id), s = p.schemes[u.scheme], c = p.confirmDraft ||= {message: '', contact: true, time: '下午'}, rev = p.revisions[s.id];
  const body = `<main class="screen__body"><h1 class="page-title">确认方案 ${s.id} · 修订 ${rev}</h1>
    <div class="confirm-hero"><img src="${images.schemes[s.img]}" alt="方案 ${s.id} 效果图（示意）"><div class="row__main"><b>${s.name} · ${softById[s.soft].name}</b><small>确认后，${workspace.name}会收到这一版整体方案。之后再调整，需要重新确认。</small></div></div>
    ${Section('方案内容', Group([Row('软装风格', softById[s.soft].name), ...finishes.map(f => Row(f.name, finishValue(s, f), {stack: true}))]))}
    ${Section('给企业留言', Group([`<label class="field"><span class="sr-only">给企业留言（选填）</span><textarea id="msg" rows="3" maxlength="300" placeholder="选填。例如：二层想再看看深色石材；希望周末看样品。">${esc(c.message)}</textarea></label>`]), '选填')}
    <div class="group" style="margin-top:12px"><div class="row"><span class="row__main"><b>请企业联系我</b><small class="num">${maskPhone(state.session)} · 登录手机号</small></span>${Switch(c.contact, 'contact', '请企业联系我')}</div>
      ${c.contact ? `<div class="row row--stack"><span class="row__label">方便联系的时间</span><div style="margin-top:8px">${Chips(['上午', '下午', '晚上', '都可以'].map(t => [t, t]), v => c.time === v, 'ctime')}</div></div>` : ''}</div></main>`;
  return {html: Screen(body + Dock(Button(`确认方案 ${s.id} · 修订 ${rev}`, {act: 'confirm', block: true})), {cls: 'screen--dock', bar: AppBar({back: `/project/${p.id}`, title: '确认方案'})}), after(root) { root.querySelector('#msg').addEventListener('input', e => { c.message = e.target.value; save(); }); }};
}
function DoneScreen(p) {
  const c = p.confirmed; if (!c) { go(`/project/${p.id}`); return null; }
  const stale = c.revision !== p.revisions[c.scheme];
  return StatusScreen({back: `/project/${p.id}`, seal: `<span class="seal">${icon('check', 28)}</span>`, title: `已确认 方案 ${c.scheme} · 修订 ${c.revision}`,
    sub: `${workspace.name}已收到你的确认${c.message ? '和留言' : ''}。${c.contact ? `企业会在${c.time === '都可以' ? '方便时' : c.time}联系 <span class="num">${maskPhone(state.session)}</span>。` : '你没有请求联系，可以随时回来留言。'}`,
    items: [['确认方案', 'done', c.at], ['企业跟进', 'now', c.contact ? '电话联系' : '查看留言'], ['看样与深化']],
    extra: `${stale ? Alert('hint', `确认之后方案又调整过，企业看到的仍是修订 ${c.revision}。如需以新修订为准，请重新确认。`) : ''}${c.message ? `<blockquote class="quote">${esc(c.message)}</blockquote>` : ''}
      <div class="btn-stack">${Button('我的项目', {href: '/projects', block: true})}${Button('回到方案', {href: `/project/${p.id}`, kind: 'secondary', block: true})}</div>`});
}

// 分享与绑定
function LinkFailScreen(share) {
  const revoked = share.status === 'revoked';
  return StatusScreen({back: '/', seal: `<span class="seal seal--warn">${icon('link', 26)}</span>`, title: revoked ? '这个分享链接已被撤销' : '这个分享链接已过期',
    sub: `${revoked ? `${workspace.name}已撤销这个链接，可能是发错了对象或已重新分享。` : `链接有效期至 <span class="num">${share.expires}</span>。`}请联系为你制作方案的企业成员获取新链接；已绑定的项目可在「项目」中继续查看。`,
    extra: `<div class="btn-stack">${Button('查看我的项目', {href: '/projects', kind: 'secondary', block: true})}</div>`});
}
function ShareScreen(token, q) {
  const share = shares[token]; if (!share) return LinkFailScreen({status: 'revoked'}); if (share.status !== 'active') return LinkFailScreen(share);
  const bound = state.projects.find(p => p.token === token); if (bound && state.binds[token]?.status === 'bound') { go(`/project/${bound.id}`); return null; }
  const p = sharedPreview(token); ui(p.id);
  return {html: SchemeScreen(p, {preview: true}), preview: p, after() { if (q.gate) openGate(token); }};
}
function openGate(token) {
  const share = shares[token];
  openSheet(`<h2 class="sheet__title">调整和确认需要登录</h2><p class="lede">分享链接只能预览。调整、确认或留言需要验证手机号，并把这个方案绑定到你的账号；转发出去的链接不能让别人修改你的方案。</p>
    ${Group([InfoRow({ico: 'phone', title: share.mode === 'phone' ? '企业指定了手机号' : '企业会单独告诉你绑定码', sub: share.mode === 'phone' ? '用该手机号登录即自动绑定' : '登录后输入 6 位一次性绑定码'}), InfoRow({ico: 'user', title: '都不满足？', sub: '可以提交绑定申请，由企业批准'})])}
    <div class="btn-stack">${Button('手机号登录', {act: 'gate-login', v: token, block: true})}${Button('继续预览', {act: 'sheet-close', kind: 'secondary', block: true})}</div>`);
}
function BindScreen(token, q) {
  const share = shares[token]; if (!share || share.status !== 'active') return LinkFailScreen(share || {status: 'revoked'});
  if (!state.session) { go(`/login?next=/bind/${token}`); return null; }
  const b = state.binds[token] ||= {status: 'none', tries: 5, error: null, code: ''}, back = `/share/${token}`;
  if (b.status === 'none' && share.mode === 'phone' && state.session === share.phone) bindNow(token);
  if (b.status === 'bound') { const p = state.projects.find(x => x.token === token);
    return StatusScreen({back: '/projects', seal: `<span class="seal">${icon('check', 28)}</span>`, title: '已绑定到你的账号',
      sub: `${b.how === 'phone' ? '你登录的手机号与企业分享时指定的一致，方案已自动绑定。' : b.how === 'code' ? '绑定码验证通过，方案已绑定；绑定码已失效。' : '企业已批准你的绑定申请。'}现在可以调整、确认和留言。`,
      extra: `${Group([Row('方案', esc(p.name)), Row('账号', `<span class="num">${maskPhone(state.session)}</span>`)])}<div class="btn-stack">${Button('查看并调整', {href: `/project/${p.id}`, block: true})}${Button('我的项目', {href: '/projects', kind: 'secondary', block: true})}</div>`}); }
  if (b.status === 'pending') return StatusScreen({back, title: '绑定申请已提交', sub: `${workspace.name}核对你的身份后会批准。批准前仍可预览；批准后方案会出现在「项目」中。`,
    items: [['提交绑定申请', 'done', `<span class="num">${maskPhone(state.session)}</span>${b.name ? ' · ' + esc(b.name) : ''}`], ['企业成员核对', 'now', '通常在 1 个工作日内'], ['绑定到你的账号']],
    extra: `<div class="btn-stack">${Button('继续预览方案', {href: back, kind: 'secondary', block: true})}</div>${ProtoOps('模拟企业批准', 'approve', token)}`});
  if (q.apply) return {html: Screen(`<main class="screen__body"><h1 class="page-title">提交绑定申请</h1><p class="lede">企业成员核对后批准，方案才会绑定到你的账号。请留下称呼，方便企业确认是你。</p>
      ${Group([Row('方案', esc(share.title)), Row('手机号', `<span class="num">${maskPhone(state.session)}</span>`)])}
      ${Group([`<label class="field"><span class="field__label">称呼</span><span class="field__control"><input id="aname" maxlength="20" placeholder="例如：王女士" value="${esc(b.name || '')}"></span></label>`,
        `<label class="field"><span class="field__label">说明（选填）</span><textarea id="anote" rows="2" maxlength="200" placeholder="例如：方案顾问上周来家里量过尺寸。">${esc(b.note || '')}</textarea></label>`])}</main>${Dock(Button('提交绑定申请', {act: 'apply', v: token, block: true}))}`,
    {cls: 'screen--dock', bar: AppBar({back: `/bind/${token}`})}), after(root) {
    root.querySelector('#aname').addEventListener('input', e => { b.name = e.target.value; save(); });
    root.querySelector('#anote').addEventListener('input', e => { b.note = e.target.value; save(); });
  }};
  if (share.mode === 'phone') return StatusScreen({back, seal: `<span class="seal seal--warn">${icon('phone', 26)}</span>`, title: '手机号与分享指定的不一致',
    sub: `这个方案是企业定向分享给另一个手机号的。为保护方案，用 <span class="num">${maskPhone(state.session)}</span> 登录不能直接绑定，转发的链接只能预览。`,
    extra: `<div class="section">${Group([LinkRow({act: 'relogin', v: token, ico: 'logout', title: '换一个手机号登录', sub: '如果企业分享时填写的是你的另一个号码'}), LinkRow({href: `/bind/${token}?apply=1`, ico: 'user', title: '提交绑定申请', sub: '由企业成员核对后批准'})])}</div>
      <div class="btn-stack">${Button('返回预览', {href: back, kind: 'secondary', block: true})}</div>`});
  const msg = {wrong: `绑定码不正确，请核对后重试。还可尝试 ${b.tries} 次。`, locked: '尝试次数过多，这个绑定码已锁定。请联系企业成员重新分享，或提交绑定申请。', format: '绑定码为 6 位字母或数字。'}[b.error];
  return {html: Screen(`<main class="screen__body"><h1 class="page-title">输入绑定码</h1><p class="lede">企业成员会通过电话、微信等方式单独告诉你 6 位绑定码。只能使用一次，48 小时内有效。</p>
      ${Group([`<label class="field field--code"><span class="field__label">绑定码</span><span class="field__control"><input id="bcode" maxlength="6" autocapitalize="characters" autocomplete="one-time-code" spellcheck="false" placeholder="6 位字母或数字" value="${esc(b.code)}"${attr('disabled', b.error === 'locked')}></span></label>`])}
      <div class="demo-code"><div><span class="caption">演示绑定码</span><strong>${share.code}</strong></div>${Button('填入', {act: 'bfill', v: token, kind: 'secondary', sm: true})}</div>
      ${msg ? Alert('danger', msg) : ''}
      <a class="text-link" href="#/bind/${token}?apply=1" style="margin-top:16px">没有绑定码？提交绑定申请 ${icon('right', 14)}</a></main>
      ${Dock(Button('绑定到我的账号', {act: 'bcode', v: token, block: true, disabled: b.error === 'locked'}))}`, {cls: 'screen--dock', bar: AppBar({back})}), after(root) {
    root.querySelector('#bcode').addEventListener('input', e => { b.code = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); e.target.value = b.code; save(); });
  }};
}
function bindNow(token, how = 'phone') {
  const b = state.binds[token]; Object.assign(b, {status: 'bound', how, error: null});
  if (!state.projects.some(p => p.token === token)) { const p = sharedPreview(token); p.id = 'shared-' + token; p.createdAt = today(); state.projects.push(p); }
  save();
}

// 项目 / 我的
function ProjectCard(p) {
  const [label, kind, line] = STATUS[p.status], hasImg = ['published', 'confirmed'].includes(p.status);
  const sub = p.status === 'confirmed' ? `已确认 方案 ${p.confirmed.scheme} · 修订 ${p.confirmed.revision}` : line;
  return `<a class="project" href="#/project/${p.id}"><span class="project__thumb">${hasImg ? `<img src="${images.schemes[p.schemes[ui(p.id).scheme].img]}" alt="">` : icon(p.status === 'assist' ? 'file' : 'clock', 24)}</span>
    <span class="project__main"><b>${esc(p.name)}</b>${Badge(label, kind)}<span class="caption">${sub}</span></span><span class="row__chev">${icon('right', 16)}</span></a>`;
}
function ProjectsScreen() {
  if (!state.session) { go('/login?next=/projects'); return null; }
  const mine = state.projects.filter(p => p.origin === 'self'), shared = state.projects.filter(p => p.origin === 'shared'), pending = Object.entries(state.binds).filter(([, b]) => b.status === 'pending');
  const empty = !mine.length && !shared.length && !pending.length;
  const body = empty ? `<div class="empty"><span class="seal seal--quiet">${icon('folder', 26)}</span><h2>还没有项目</h2><p>点下方 + 按钮提交户型和石材偏好，得到第一份整体方案；或打开企业发给你的分享链接。</p></div>`
    : `${Section('我提交的', mine.length ? mine.map(ProjectCard).join('') : '<p class="meta">还没有自己提交的方案需求。</p>', String(mine.length))}
      ${Section('企业分享给我的', shared.map(ProjectCard).join('') + pending.map(([token, b]) => `<a class="project" href="#/bind/${token}"><span class="project__thumb">${icon('lock', 24)}</span><span class="project__main"><b>${esc(shares[token].title)}</b>${Badge('待企业批准')}<span class="caption">绑定申请已提交${b.name ? ' · ' + esc(b.name) : ''}</span></span><span class="row__chev">${icon('right', 16)}</span></a>`).join('')
        + (!shared.length && !pending.length ? '<p class="meta">打开企业分享的链接并完成绑定后，方案会出现在这里。</p>' : ''), String(shared.length + pending.length))}`;
  return Screen(`<main class="screen__body"><h1 class="page-title">我的项目</h1>${body}</main>`, {cls: 'screen--tabs', bar: AppBar({brand: true}), after: TabBar('/projects')});
}
function MeScreen() {
  const body = `<main class="screen__body"><h1 class="page-title">我的</h1>
    <div class="section">${Group([`<div class="row"><span class="row__icon">${icon('user', 18)}</span><span class="row__main"><b class="num">${state.session ? maskPhone(state.session) : '未登录'}</b><small>${state.session ? `已关联 ${workspace.name}` : '登录后可提交需求、调整和确认方案'}</small></span>${state.session ? '' : Button('登录', {href: '/login?next=/me', sm: true})}</div>`])}</div>
    ${Section('显示', Segmented([['system', '跟随系统', 'system'], ['light', '浅色', 'sun'], ['dark', '深色', 'moon']], state.theme, 'theme'))}
    ${Section('关于', Group([Row('企业', workspace.name), Row('说明', '效果图与石材为示意素材'), Row('协议', '《用户协议》《隐私政策》（占位）')]))}
    ${state.session ? `<div class="btn-stack">${Button('退出登录', {act: 'logout', kind: 'secondary', block: true, lead: 'logout'})}</div>` : ''}</main>`;
  return Screen(body, {cls: 'screen--tabs', bar: AppBar({brand: true}), after: TabBar('/me')});
}
function ProjectRoute(id, sub) {
  const p = projectById(id);
  if (!p) return StatusScreen({title: '找不到这个项目', sub: '项目不存在，或没有绑定到你的账号。', extra: `<div class="btn-stack">${Button('查看我的项目', {href: '/projects', kind: 'secondary', block: true})}</div>`});
  if (!state.session) { go(`/login?next=/project/${id}${sub ? '/' + sub : ''}`); return null; }
  if (p.status === 'generating' || p.status === 'converting') return WaitScreen(p);
  if (p.status === 'review') return ReviewScreen(p);
  if (p.status === 'assist') return AssistScreen(p);
  if (sub === 'adjust') return AdjustScreen(p);
  if (sub === 'confirm') return ConfirmScreen(p);
  if (sub === 'done') return DoneScreen(p);
  return SchemeScreen(p);
}

// ---------- 弹层与提示 ----------
function openSheet(html) { const d = document.querySelector('#sheet'); d.innerHTML = `<div class="sheet__body" tabindex="-1" autofocus><span class="panel__grip" aria-hidden="true"></span>${html}</div>`; if (!d.open) d.showModal(); d.querySelector(".sheet__body").focus(); }
const closeSheet = () => { const d = document.querySelector('#sheet'); if (d.open) d.close(); };
let toastTimer;
function toast(t) { const el = document.querySelector('#toast'); el.textContent = t; el.classList.add('is-on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('is-on'), 2200); }

// ---------- 原型审阅导航（不属于产品界面） ----------
const sample = (status, extra = {}) => newProject({name: '示例别墅 · 我的方案需求', source: 'sample', schemes: makeSchemes(), status, next: 'published', genStart: Date.now(), ...extra});
const seed = ({login = true} = {}) => { const theme = state.theme; state = initial(); state.theme = theme; if (login) state.session = '13900139000'; };
const R = {
  'home': ['客户自助', '首页', () => { seed({login: false}); go('/'); }],
  'login': ['客户自助', '手机号登录', () => { seed({login: false}); go('/login?next=/new'); }],
  'login-sent': ['客户自助', '登录 · 演示验证码', () => { seed({login: false}); state.login.phone = '13900139000'; sendCode(); go('/login?next=/new'); }],
  'login-wrong': ['客户自助', '登录 · 验证码错误', () => { seed({login: false}); state.login.phone = '13900139000'; sendCode(); state.login.attempts = 3; state.login.error = 'wrong'; go('/login?next=/new'); }],
  'login-rate': ['客户自助', '登录 · 获取过于频繁', () => { seed({login: false}); state.login.phone = '13900139000'; state.login.sends = Array(5).fill(Date.now()); state.login.error = 'rate'; go('/login?next=/new'); }],
  'new-1': ['客户自助', '提交 · 选择户型', () => { seed(); go('/new'); }],
  'new-dxf': ['客户自助', '提交 · 已选 DXF 图纸', () => { seed(); Object.assign(state.draft, {source: 'upload', file: {name: '别墅平面图.dxf'}}); go('/new'); }],
  'new-assist': ['客户自助', '提交 · 其他格式需协助转换', () => { seed(); Object.assign(state.draft, {source: 'upload', file: {name: '别墅平面图.pdf'}}); go('/new'); }],
  'new-2': ['客户自助', '提交 · 选择饰面', () => { seed(); Object.assign(state.draft, {source: 'sample', step: 2}); go('/new'); }],
  'new-2-scope': ['客户自助', '提交 · 图纸只选范围', () => { seed(); Object.assign(state.draft, {source: 'upload', file: {name: '别墅平面图.dxf'}, step: 2}); go('/new'); }],
  'new-3': ['客户自助', '提交 · 石材与偏好', () => { seed(); Object.assign(state.draft, {source: 'sample', step: 3, stones: ['white', 'beige'], tone: '浅色'}); go('/new'); }],
  'converting': ['客户自助', '图纸转换中', () => { seed(); const p = sample('converting', {source: 'upload', fileName: '别墅平面图.dxf', next: 'review'}); go(`/project/${p.id}`); }],
  'wait': ['客户自助', '出图等待', () => { seed(); const p = sample('generating'); p.genStart = Date.now() - 2600; go(`/project/${p.id}`); }],
  'review': ['客户自助', '待审核', () => { seed(); const p = sample('review', {source: 'upload', fileName: '别墅平面图.dxf'}); go(`/project/${p.id}`); }],
  'assist': ['客户自助', '需协助转换', () => { seed(); const p = sample('assist', {source: 'upload', fileName: '别墅平面图.pdf'}); go(`/project/${p.id}`); }],
  'result': ['方案', '方案 · 效果图', () => { seed(); const p = sample('published'); go(`/project/${p.id}`); }],
  'result-open': ['方案', '方案 · 展开清单与对比', () => { seed(); const p = sample('published'); ui(p.id).expanded = true; go(`/project/${p.id}`); }],
  'result-3d': ['方案', '方案 · 3D 查看', () => { seed(); const p = sample('published'); ui(p.id).view = '3d'; go(`/project/${p.id}`); }],
  'adjust-soft': ['调整', '调整 · 软装风格', () => { seed(); const p = sample('published'); go(`/project/${p.id}/adjust`); }],
  'adjust-hard': ['调整', '调整 · 硬装石材', () => { seed(); const p = sample('published'); AdjustScreen(p); p.work.tab = 'hard'; go(`/project/${p.id}/adjust`); }],
  'adjust-pending': ['调整', '调整 · 两处修改待出图', () => { seed(); const p = sample('published'); AdjustScreen(p); p.work.tab = 'hard'; setOption(p, 'stone', 'beige'); setOption(p, 'pattern', 'diagonal'); go(`/project/${p.id}/adjust`); }],
  'adjust-conflict': ['调整', '调整 · 冲突', () => { seed(); const p = sample('published'); AdjustScreen(p); p.work.tab = 'hard'; setOption(p, 'pattern', 'herringbone'); go(`/project/${p.id}/adjust`); }],
  'adjust-rendering': ['调整', '调整 · 重新出图中', () => { seed(); const p = sample('published'); AdjustScreen(p); p.work.soft = 'chinese'; p.work.history.push({kind: 'soft', before: 'modern', label: '软装风格：现代简约 → 新中式'}); p.work.rendering = true; go(`/project/${p.id}/adjust`); }],
  'confirm': ['确认', '确认 · 留言与联系', () => { seed(); const p = sample('published'); p.confirmDraft = {message: '周末想看样品。', contact: true, time: '下午'}; go(`/project/${p.id}/confirm`); }],
  'done': ['确认', '已确认', () => { seed(); const p = sample('confirmed'); p.confirmed = {scheme: 'A', revision: 1, message: '周末想看样品。', contact: true, time: '下午', at: today()}; go(`/project/${p.id}/done`); }],
  'done-stale': ['确认', '已确认 · 之后又调整', () => { seed(); const p = sample('confirmed'); p.revisions.A = 2; p.confirmed = {scheme: 'A', revision: 1, contact: true, time: '下午', at: today()}; go(`/project/${p.id}/done`); }],
  'share': ['分享与绑定', '分享预览 · 未登录', () => { seed({login: false}); go('/share/direct'); }],
  'share-gate': ['分享与绑定', '点调整 · 要求登录', () => { seed({login: false}); go('/share/direct?gate=1'); }],
  'bind-auto': ['分享与绑定', '定向手机号 · 自动绑定', () => { seed({login: false}); state.session = demoPhone; go('/bind/direct'); }],
  'bind-mismatch': ['分享与绑定', '手机号不一致', () => { seed(); go('/bind/direct'); }],
  'bind-code': ['分享与绑定', '输入绑定码', () => { seed(); go('/bind/code'); }],
  'bind-code-wrong': ['分享与绑定', '绑定码错误', () => { seed(); state.binds.code = {status: 'none', tries: 4, error: 'wrong', code: 'K7M2Q8'}; go('/bind/code'); }],
  'bind-apply': ['分享与绑定', '提交绑定申请', () => { seed(); go('/bind/direct?apply=1'); }],
  'bind-pending': ['分享与绑定', '等待企业批准', () => { seed(); state.binds.direct = {status: 'pending', tries: 5, name: '王女士'}; go('/bind/direct'); }],
  'share-revoked': ['分享与绑定', '链接已撤销', () => { seed({login: false}); go('/share/revoked'); }],
  'share-expired': ['分享与绑定', '链接已过期', () => { seed({login: false}); go('/share/expired'); }],
  'projects': ['项目与我的', '我的项目', () => { seed(); sample('assist', {source: 'upload', fileName: '老宅改造.pdf', name: '老宅改造 · 我的方案需求'}); const c = sample('confirmed'); c.revisions.A = 2; c.confirmed = {scheme: 'A', revision: 2, contact: true, time: '下午', at: today()}; state.binds.code = {status: 'none', tries: 5}; bindNow('code', 'code'); state.binds.direct = {status: 'pending', name: '王女士'}; go('/projects'); }],
  'projects-empty': ['项目与我的', '我的项目 · 空', () => { seed(); go('/projects'); }],
  'me': ['项目与我的', '我的 · 主题切换', () => { seed(); go('/me'); }],
  'me-guest': ['项目与我的', '我的 · 未登录', () => { seed({login: false}); go('/me'); }],
};
function openReview() {
  const groups = {};
  for (const [id, [g, label]] of Object.entries(R)) (groups[g] ||= []).push(`<button class="row" data-act="jump" data-v="${id}"><span class="row__main">${label}</span><span class="row__chev">${icon('right', 14)}</span></button>`);
  openSheet(`<div class="sheet__head"><h2 class="sheet__title">原型审阅导航</h2><button class="icon-btn" data-act="sheet-close" aria-label="关闭">${icon('close', 20)}</button></div>
    <p class="meta">直接跳到任一页面或状态，跳转会重置演示数据。这个入口不属于产品界面。</p>${Object.entries(groups).map(([g, items]) => `<h3 class="sheet__group">${g}</h3>${Group(items)}`).join('')}
    <div class="btn-stack">${Button('清空演示数据并回到首页', {act: 'reset', kind: 'secondary', block: true})}</div>`);
}
window.__review = {ids: Object.keys(R), go: id => { closeSheet(); R[id][2](); save(); render(); }};

// ---------- 交互 ----------
let currentPreview = null;
const current = () => { const {parts} = parse(); return parts[0] === 'project' ? projectById(parts[1]) : parts[0] === 'share' ? currentPreview : null; };
const toggle = (a, v) => { const i = a.indexOf(v); i < 0 ? a.push(v) : a.splice(i, 1); };
const shift = d => { const p = current(), u = ui(p.id); u.scheme = (u.scheme + d + p.schemes.length) % p.schemes.length; };
const actions = {
  review: () => { openReview(); return false; }, 'sheet-close': () => { closeSheet(); return false; }, jump: el => { window.__review.go(el.dataset.v); return false; },
  reset: () => { closeSheet(); seed({login: false}); go('/'); },
  start: () => { state.draft = freshDraft(); go(state.session ? '/new' : '/login?next=/new'); return false; },
  send: () => sendCode(), fill: () => { state.login.input = state.login.code; }, login: () => doLogin(parse().q.next),
  source: el => { state.draft.source = el.dataset.v; state.draft.file = null; }, demofile: el => pickFile(el.dataset.v),
  step: el => { state.draft.step = +el.dataset.v; scrollTo(0, 0); },
  finish: el => toggle(state.draft.finishes, el.dataset.v), scope: el => toggle(state.draft.scopes, el.dataset.v),
  stone: el => { const a = state.draft.stones; if (a.includes(el.dataset.v) || a.length < 3) toggle(a, el.dataset.v); else toast('最多选择 3 款石材'); },
  tone: el => { state.draft.tone = el.dataset.v; }, pattern: el => toggle(state.draft.patterns, el.dataset.v),
  border: el => { state.draft.border = el.dataset.v; }, submit: submitDraft,
  publish: el => { projectById(el.dataset.v).status = 'published'; toast('原型操作：企业已发布方案'); },
  prev: () => shift(-1), next: () => shift(1), scheme: el => { ui(current().id).scheme = +el.dataset.v; },
  view: el => { ui(current().id).view = el.dataset.v; }, expand: () => { const u = ui(current().id); u.expanded = !u.expanded; },
  gate: () => { if (state.session) { go(`/bind/${currentPreview.token}`); return false; } openGate(currentPreview.token); return false; },
  'gate-login': el => { closeSheet(); go(`/login?next=/bind/${el.dataset.v}`); },
  tab: el => { current().work.tab = el.dataset.v; },
  soft: el => { const w = current().work; if (w.soft === el.dataset.v) return; w.history.push({kind: 'soft', before: w.soft, label: `软装风格：${softById[w.soft].name} → ${softById[el.dataset.v].name}`}); w.soft = el.dataset.v; w.rendered = false; },
  set: el => setOption(current(), el.dataset.k, el.dataset.v),
  undo: () => { const w = current().work, h = w.history.pop(); if (h) { if (h.kind === 'soft') w.soft = h.before; else w.floor = h.before; w.rendered = false; } },
  rerender: () => { current().work.rendering = true; },
  contact: () => { const c = current().confirmDraft; c.contact = !c.contact; }, ctime: el => { current().confirmDraft.time = el.dataset.v; },
  confirm: () => { const p = current(), s = p.schemes[ui(p.id).scheme]; p.confirmed = {scheme: s.id, revision: p.revisions[s.id], ...p.confirmDraft, at: today()}; p.status = 'confirmed'; save(); go(`/project/${p.id}/done`); },
  relogin: el => { state.session = null; state.login = freshLogin(); delete state.binds[el.dataset.v]; save(); go(`/login?next=/bind/${el.dataset.v}`); },
  apply: el => { const b = state.binds[el.dataset.v]; if (!b.name?.trim()) { toast('请填写称呼'); return false; } b.status = 'pending'; go(`/bind/${el.dataset.v}`); },
  approve: el => { bindNow(el.dataset.v, 'apply'); toast('原型操作：企业已批准绑定'); },
  bfill: el => { const b = state.binds[el.dataset.v]; b.code = shares[el.dataset.v].code; b.error = null; },
  bcode: el => { const t = el.dataset.v, b = state.binds[t]; if (!/^[A-Z0-9]{6}$/.test(b.code)) { b.error = 'format'; return; } if (b.code !== shares[t].code) { b.tries--; b.error = b.tries > 0 ? 'wrong' : 'locked'; return; } bindNow(t, 'code'); },
  theme: el => { state.theme = el.dataset.v; applyTheme(); },
  logout: () => { state.session = null; save(); go('/'); },
};
function applyTheme() {
  if (state.theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = state.theme;
}

// ---------- 渲染 ----------
let lastPath = null, cleanup = () => {};
function view() {
  const {parts, q} = parse(); currentPreview = null;
  switch (parts[0]) {
    case undefined: return HomeScreen();
    case 'login': return LoginScreen(q);
    case 'new': return NewRequestScreen();
    case 'projects': return ProjectsScreen();
    case 'me': return MeScreen();
    case 'project': return ProjectRoute(parts[1], parts[2]);
    case 'share': { const v = ShareScreen(parts[1], q); if (v?.preview) currentPreview = v.preview; return v; }
    case 'bind': return BindScreen(parts[1], q);
    default: return HomeScreen();
  }
}
function render() {
  timers.forEach(clearTimeout); timers = []; cleanup(); cleanup = () => {};
  const {path} = parse(), y = scrollY, panelY = document.querySelector('.panel__scroll')?.scrollTop || 0, prevImg = document.querySelector('.stage__img')?.getAttribute('src');
  const v = view(); if (v == null) return;
  const out = typeof v === 'string' ? {html: v} : v;
  const root = document.querySelector('#app'); root.innerHTML = out.html;
  const img = root.querySelector('.stage__img'); if (img && prevImg && img.getAttribute('src') !== prevImg) img.classList.add('stage__img--enter');
  if (path !== lastPath) { scrollTo(0, 0); document.title = `${workspace.name} · ${root.querySelector('h1, .appbar__title')?.textContent?.trim() || '客户端'}（原型）`; }
  else { scrollTo(0, y); const d = root.querySelector('.panel__scroll'); if (d) d.scrollTop = panelY; }
  lastPath = path;
  const off = out.after?.(root); if (typeof off === 'function') cleanup = off;
  save();
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const fn = actions[el.dataset.act]; if (!fn) return;
  e.preventDefault(); const r = fn(el, e); save(); if (r !== false) render();
});
let sx = null;
document.addEventListener('pointerdown', e => { sx = e.target.closest('[data-swipe]') && !e.target.closest('button') ? e.clientX : null; });
document.addEventListener('pointerup', e => { if (sx !== null && Math.abs(e.clientX - sx) > 40 && current() && !parse().parts[2]) { shift(e.clientX < sx ? 1 : -1); save(); render(); } sx = null; });
document.querySelector('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
addEventListener('hashchange', () => { closeSheet(); render(); });
applyTheme(); render();
