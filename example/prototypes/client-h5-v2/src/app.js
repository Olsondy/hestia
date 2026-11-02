// H5 客户端交互原型 v2（P03）：A 柔和中性配色 + ① 沉浸全屏布局，浅色 / 深色主题跟随系统。纯前端、演示数据、不接服务端。
import {swatchURL} from '../../client-h5/src/stone.js';
import {images, workspace, stones, stoneById, sizes, patterns, patternName, finishes, makeSchemes, checks, shares, demoPhone, maskPhone, spaced, softStyles} from './data.js';

const KEY = 'hestia.client-h5-v2';
const softById = Object.fromEntries(softStyles.map(s => [s.id, s]));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const clone = v => JSON.parse(JSON.stringify(v));
const freshLogin = () => ({phone: '', input: '', sent: false, code: '', expiresAt: 0, attempts: 5, sends: [], cooldownUntil: 0, error: null});
const freshDraft = () => ({step: 1, source: null, file: null, finishes: finishes.map(f => f.id), stones: [], tone: null, patterns: [], border: 'auto', note: ''});
const initial = () => ({session: null, theme: 'system', login: freshLogin(), draft: freshDraft(), projects: [], binds: {}, seq: 1, ui: {}});
let state;
try { state = {...initial(), ...JSON.parse(localStorage.getItem(KEY) || 'null')}; } catch { state = initial(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 隐私模式仅内存 */ } };

// ---------- 路由 ----------
function parse() { const raw = location.hash.replace(/^#/, '') || '/'; const [path, qs] = raw.split('?'); return {path, parts: path.split('/').filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs || ''))}; }
const go = path => { if (location.hash === '#' + path) render(); else location.hash = path; };
let timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, ms));

// ---------- 图标 ----------
const P = {
  back: 'M15 5l-7 7 7 7', arrow: 'M5 12h14m-6-6 6 6-6 6', left: 'M15 5l-7 7 7 7', right: 'm9 5 7 7-7 7', home: 'M3 10 12 3l9 7M5 9v12h14V9', folder: 'M3 7V4h6l3 3h9v13H3z',
  user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21c1-4 4-6 8-6s7 2 8 6', plus: 'M12 5v14M5 12h14', cube: 'm12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9', image: 'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5',
  link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1', check: 'm4 12 5 5L20 6', undo: 'M9 4 3 10l6 6M3 10h10a7 7 0 0 1 7 7', lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
  phone: 'M7 2h10v20H7zM11 18h2', clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', alert: 'M12 9v5M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  info: 'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6', file: 'M6 2h8l5 5v15H6zM14 2v5h5', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  sun: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0', moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  logout: 'M15 4h5v16h-5M10 8l-4 4 4 4M6 12h11', menu: 'M3 6h18M3 12h18M3 18h18', close: 'M5 5l14 14M19 5 5 19', chat: 'M4 4h16v12H8l-4 4z',
};
const icon = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`;
const pal = (id, cls = '') => `<span class="pal ${cls}">${Object.values(softById[id].palette).slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span>`;
const sw = (id, cls = 'sw') => `<img class="${cls}" src="${swatchURL(stoneById[id].tex, 120)}" alt="">`;
const floorLine = f => `${stoneById[f.stone].name} · ${f.size} · ${patternName[f.pattern]}${f.border ? ` · ${stoneById[f.border].name}波打线` : ''}`;
const today = () => { const d = new Date(); return `${d.getMonth() + 1} 月 ${d.getDate()} 日`; };

// ---------- 外壳 ----------
function topbar({back, title = workspace.name, over = false, right = ''} = {}) {
  return `<header class="topbar ${over ? 'over' : ''}">${back ? `<a class="round" href="#${back}" aria-label="返回">${icon('back', 18)}</a>` : `<span class="logo" aria-hidden="true">标志</span>`}
    <b class="title">${esc(title)}</b>${right || `<button class="round" data-act="review" aria-label="原型审阅导航">${icon('menu', 17)}</button>`}</header>`;
}
function tabbar(active) {
  return `<nav class="tabbar" aria-label="主菜单"><div class="tabs">${[['home', '/', '首页'], ['folder', '/projects', '项目'], ['user', '/me', '我的']].map(([n, href, t]) =>
    `<a href="#${href}" class="${active === href ? 'on' : ''}" ${active === href ? 'aria-current="page"' : ''}>${icon(n, 19)}<span>${t}</span></a>`).join('')}</div>
    <button class="plus" data-act="start" aria-label="提交方案需求">${icon('plus', 24)}<span>提需求</span></button></nav>`;
}
const page = (html, cls = '') => `<div class="view ${cls}">${html}</div>`;

// ---------- 项目 ----------
const projectById = id => state.projects.find(p => p.id === id) || (id?.startsWith('share-') ? sharedPreview(id.slice(6)) : null);
const sharedPreview = token => ({id: 'share-' + token, name: shares[token].title, origin: 'shared', token, status: 'published', source: 'member', schemes: makeSchemes(), revisions: {A: 1, B: 1, C: 1}});
function newProject(fields) { const p = {id: 'p' + state.seq++, origin: 'self', revisions: {A: 1, B: 1, C: 1}, createdAt: today(), ...fields}; state.projects.unshift(p); return p; }
const ui = id => state.ui[id] ||= {scheme: 0, drawer: false, view: 'image'};
const statusChip = p => ({generating: ['出图中', 'wait'], review: ['待审核', 'wait'], assist: ['需辅助转换', 'warn'], published: ['已发布', 'ok'], confirmed: ['已确认', 'ok']}[p.status]);

// ---------- 首页 ----------
function homeView() {
  return page(`<section class="hero"><img src="${images.schemes[0]}" alt="示例别墅一层客厅效果图（示意）"><div class="shade"></div>${topbar({over: true})}
      <div class="hero-copy"><span class="kicker">示例别墅 · 一层客厅 · 效果图示意</span><h1>为你的家，<br>先做一遍硬装与软装</h1></div></section>
    <section class="sheet">
      <p class="lede">提交户型与石材偏好，1–2 分钟得到 3 个整体方案的效果图。${workspace.name}核对后发布，你可以换软装风格、换石材铺法，满意再确认。</p>
      <div class="steps">${['选户型', '选饰面与石材', '得到 3 个方案'].map((t, i) => `<div><b>0${i + 1}</b><span>${t}</span></div>`).join('')}</div>
      <div class="row-title"><b>三套软装风格</b><span>示意</span></div>
      <div class="hscroll">${softStyles.map(st => `<div class="style-card">${pal(st.id, 'lg')}<b>${st.name}</b><small>${st.line.split('、').slice(0, 2).join('、')}</small></div>`).join('')}</div>
      <div class="row-title"><b>企业石材库</b><span>示意素材</span></div>
      <div class="hscroll">${stones.map(s => `<figure class="stone-fig">${sw(s.id, 'sq')}<figcaption>${s.name}</figcaption></figure>`).join('')}</div>
      <a class="card link-card" href="#/share/direct">${icon('link', 20)}<span><b>收到企业分享的链接？</b><small>直接打开即可预览；调整和确认需手机号登录并绑定</small></span>${icon('right', 16)}</a>
      <p class="fine">演示环境 · 数据、尺寸与效果图均为示意</p>
    </section>${tabbar('/')}`, 'home');
}

// ---------- 登录 ----------
const validPhone = p => /^1\d{10}$/.test(p);
function loginView(q) {
  const L = state.login, now = Date.now(), next = q.next || '/projects', share = next.startsWith('/bind');
  const msg = {phone: '请输入 11 位中国大陆手机号。', nosend: '请先获取验证码。', wrong: `验证码不正确，还可尝试 ${L.attempts} 次。`, locked: '错误次数过多，此验证码已失效。请重新获取。',
    expired: '验证码已过期（5 分钟内有效）。请重新获取。', rate: '获取验证码过于频繁。为保护账号，请 60 分钟后再试。'}[L.error];
  const cooldown = Math.max(0, Math.ceil((L.cooldownUntil - now) / 1000));
  const sendLabel = L.error === 'rate' ? '暂不可获取' : cooldown ? `${cooldown}s 后重发` : L.sent ? '重新获取' : '获取验证码';
  return {html: page(`${topbar({back: share ? next.replace('/bind', '/share') : '/', title: ''})}
    <section class="pad">
      <h1 class="h1">手机号登录</h1><p class="lede">验证手机号即可，无需密码。首次登录会关联${workspace.name}，你提交和绑定的方案都保存在这个账号下。</p>
      ${share ? `<div class="note">${icon('link', 16)}<span>登录后，分享给你的方案会按企业设定的方式绑定到你的账号。演示定向手机号：<b>${spaced(demoPhone)}</b></span></div>` : ''}
      <div class="form-card">
        <label class="field"><span>手机号</span><span class="input-row"><em>+86</em><input id="phone" inputmode="numeric" maxlength="11" placeholder="11 位手机号" value="${esc(L.phone)}"></span></label>
        <label class="field"><span>验证码</span><span class="input-row"><input id="code" inputmode="numeric" maxlength="6" placeholder="6 位验证码" value="${esc(L.input)}"><button class="send" data-act="send" ${cooldown || L.error === 'rate' ? 'disabled' : ''}>${sendLabel}</button></span></label>
      </div>
      ${L.sent && L.code && !['locked', 'expired'].includes(L.error) ? `<div class="demo-code" role="status"><div><small>演示验证码 · 不发送短信 · 5 分钟内有效</small><strong>${L.code}</strong></div><button data-act="fill">填入</button></div>` : ''}
      ${msg ? `<div class="alert ${['phone', 'nosend'].includes(L.error) ? 'hint' : 'danger'}" role="alert">${icon('alert', 16)}<span>${msg}</span></div>` : ''}
      <button class="cta" data-act="login" ${['locked', 'rate'].includes(L.error) ? 'disabled' : ''}>登录 <span>${icon('arrow', 18)}</span></button>
      <p class="fine">登录即表示同意《用户协议》（原型占位）</p>
    </section>`), after(root) {
    root.querySelector('#phone').addEventListener('input', e => { L.phone = e.target.value.replace(/\D/g, ''); e.target.value = L.phone; save(); });
    root.querySelector('#code').addEventListener('input', e => { L.input = e.target.value.replace(/\D/g, ''); e.target.value = L.input; save(); });
    if (cooldown) { const t = setInterval(() => { const b = root.querySelector('.send'), left = Math.ceil((L.cooldownUntil - Date.now()) / 1000); if (!b) return; if (left <= 0) { clearInterval(t); b.disabled = false; b.textContent = '重新获取'; } else b.textContent = `${left}s 后重发`; }, 1000); return () => clearInterval(t); }
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

// ---------- 提交方案需求 ----------
function newView() {
  if (!state.session) { go('/login?next=/new'); return null; }
  const d = state.draft, assist = d.source === 'upload' && d.file?.kind === 'other';
  const ready = d.source === 'sample' || (d.source === 'upload' && (d.file?.status === 'ready' || assist));
  const stepper = `<ol class="stepper">${['户型', '饰面', '石材与偏好'].map((n, i) => `<li class="${i + 1 === d.step ? 'on' : i + 1 < d.step ? 'done' : ''}"><i>${i + 1 < d.step ? icon('check', 12) : i + 1}</i>${n}</li>`).join('')}</ol>`;
  let body, dock;
  if (d.step === 1) {
    const f = d.file;
    body = `<h1 class="h1">先选择户型</h1>
      <button class="choice ${d.source === 'sample' ? 'on' : ''}" data-act="source" data-v="sample"><img src="${images.aerial}" alt=""><span class="choice-body"><b>示例别墅（演示）</b><small>三层 · 5 处可铺贴饰面 · 尺寸为示意</small></span><span class="radio">${d.source === 'sample' ? icon('check', 13) : ''}</span></button>
      <div class="choice upload ${d.source === 'upload' ? 'on' : ''}"><label class="choice-main"><input type="file" id="file" class="sr-only"><span class="up-icon">${icon('upload', 22)}</span><span class="choice-body"><b>上传我的图纸</b><small>DXF 自动转换；PDF、图片、DWG 需企业辅助转换</small></span><span class="radio">${d.source === 'upload' ? icon('check', 13) : ''}</span></label>
        ${f ? `<div class="file ${f.kind === 'other' ? 'warn' : ''}">${icon('file', 16)}<b>${esc(f.name)}</b><span>${f.status === 'converting' ? '自动转换中…' : f.status === 'ready' ? '已转换' : '需辅助转换'}</span>${f.status === 'converting' ? '<i class="bar"></i>' : ''}</div>
          <p class="small">${f.kind === 'other' ? `这个格式不能自动识别，${workspace.name}会协助转换后再出方案。可以继续提交偏好。` : f.status === 'ready' ? '识别出 3 层、10 处可铺贴饰面；自动转换的结果需企业核对后才会发布。' : '读取图层、墙体与楼层…'}</p>` : ''}
        <p class="demo-files">没有图纸？<button data-act="demofile" data-v="别墅平面图.dxf">别墅平面图.dxf</button><button data-act="demofile" data-v="别墅平面图.pdf">别墅平面图.pdf</button></p></div>`;
    dock = `<button class="cta" data-act="step" data-v="2" ${ready ? '' : 'disabled'}>下一步：选择饰面 <span>${icon('arrow', 18)}</span></button>`;
  } else if (d.step === 2) {
    body = assist ? `<h1 class="h1">想铺石材的部位</h1><p class="lede">图纸转换后，企业会和你确认具体楼层与饰面。先告诉我们大致范围。</p>
        <div class="chips big">${['各层地面', '背景墙', '楼梯踏面'].map(t => `<span class="chip on">${t}</span>`).join('')}</div>`
      : `<h1 class="h1">选择要铺石材的饰面</h1><p class="lede">饰面是建筑的一部分，不随家具移动。只为勾选的部位出方案。</p>
        <div class="list">${finishes.map(f => `<button class="check-row" data-act="finish" data-v="${f.id}"><span class="box ${d.finishes.includes(f.id) ? 'on' : ''}">${icon('check', 13)}</span><span class="grow"><b>${f.name}</b><small>${({floor: '地面', wall: '墙面', stair: '楼梯'})[f.kind]} · ${f.size}</small></span></button>`).join('')}</div>
        <p class="small">已选 ${d.finishes.length} 处饰面</p>`;
    dock = `<button class="ghost-btn" data-act="step" data-v="1">上一步</button><button class="cta small" data-act="step" data-v="3" ${assist || d.finishes.length ? '' : 'disabled'}>下一步：挑选石材</button>`;
  } else {
    body = `<h1 class="h1">挑选石材与偏好</h1><p class="lede">最多 3 款，方案按选择顺序优先使用。软装风格出方案后可以切换。</p>
      <div class="stone-grid">${stones.map(s => { const n = d.stones.indexOf(s.id) + 1; return `<button class="stone-pick ${n ? 'on' : ''}" data-act="stone" data-v="${s.id}">${sw(s.id, 'sq')}${n ? `<i>${n}</i>` : ''}<span>${s.name}</span></button>`; }).join('')}</div>
      <p class="small">${d.stones.length ? `已选 ${d.stones.map(id => stoneById[id].name).join('、')}` : '未选择时，按企业推荐出方案'} · 示意素材</p>
      <div class="row-title"><b>整体色调</b></div><div class="chips">${['浅色', '暖色', '深色', '不确定'].map(t => `<button class="chip ${d.tone === t ? 'on' : ''}" data-act="tone" data-v="${t}">${t}</button>`).join('')}</div>
      <div class="row-title"><b>铺法偏好</b><span>可多选</span></div><div class="chips">${patterns.map(([v, t]) => `<button class="chip ${d.patterns.includes(v) ? 'on' : ''}" data-act="pattern" data-v="${v}">${t}</button>`).join('')}</div>
      <div class="row-title"><b>波打线</b></div><div class="chips">${[['yes', '要'], ['no', '不要'], ['auto', '由方案决定']].map(([v, t]) => `<button class="chip ${d.border === v ? 'on' : ''}" data-act="border" data-v="${v}">${t}</button>`).join('')}</div>
      <label class="field solo"><span>补充说明（选填）</span><textarea id="note" rows="3" maxlength="200" placeholder="例如：客厅想更大气；家里有老人，楼梯要防滑。">${esc(d.note)}</textarea></label>`;
    dock = `<button class="ghost-btn" data-act="step" data-v="2">上一步</button><button class="cta small" data-act="submit">提交方案需求</button>`;
  }
  return {html: page(`${topbar({back: '/', title: '提交方案需求'})}<section class="pad">${stepper}${body}</section><div class="dock">${dock}</div>`, 'with-dock'), after(root) {
    root.querySelector('#note')?.addEventListener('input', e => { d.note = e.target.value; save(); });
    root.querySelector('#file')?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) pickFile(f.name); });
    if (d.file?.status === 'converting') later(() => { d.file.status = 'ready'; save(); render(); }, 2200);
  }};
}
function pickFile(name) { const dxf = /\.dxf$/i.test(name); Object.assign(state.draft, {source: 'upload', file: {name, kind: dxf ? 'dxf' : 'other', status: dxf ? 'converting' : 'assist'}}); save(); render(); }
function submitDraft() {
  const d = state.draft, assist = d.source === 'upload' && d.file.kind === 'other';
  const p = newProject({name: d.source === 'sample' ? '示例别墅 · 我的方案需求' : d.file.name.replace(/\.[^.]+$/, '') + ' · 我的方案需求', source: d.source, fileName: d.file?.name,
    schemes: makeSchemes(), status: assist ? 'assist' : 'generating', next: d.source === 'sample' ? 'published' : 'review', genStart: Date.now(), prefs: {tone: d.tone, stones: d.stones, note: d.note}});
  state.draft = freshDraft(); save(); go(`/project/${p.id}`);
}

// ---------- 状态页 ----------
function statusPage(p, {title, sub, chip, items, back = '/projects', extra = ''}) {
  return page(`${topbar({back, title: ''})}<section class="pad status">
    <span class="status-chip ${chip[1]}">${chip[0]}</span><h1 class="h1">${title}</h1><p class="lede">${sub}</p>
    <ol class="timeline">${items.map(([t, s, small]) => `<li class="${s}"><i>${s === 'done' ? icon('check', 12) : ''}</i><div><b>${t}</b>${small ? `<small>${small}</small>` : ''}</div></li>`).join('')}</ol>${extra}</section>`);
}
function waitView(p) {
  const total = 5200;
  return {html: page(`${topbar({back: '/projects', title: ''})}<section class="wait-screen"><img src="${images.schemes[0]}" alt=""><div class="wait-veil"></div>
      <div class="wait-card"><span class="status-chip wait">出图中</span><h1 class="h1">正在排版出图</h1><p class="lede">按你选择的饰面和石材计算整块与切块，再渲染 3 张效果图。每张约 1–2 分钟（原型加速），可以离开此页。</p>
        <div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52"/><circle id="arc" cx="60" cy="60" r="52"/></svg><b id="pct">0%</b></div>
        <ol class="steps-live" id="steps">${['读取空间与饰面', '计算铺贴排版与切块', '渲染效果图（3 张）', p.next === 'review' ? '提交企业审核' : '整理方案'].map((t, i) => `<li data-i="${i}">${t}</li>`).join('')}</ol>
        <a class="ghost-btn wide" href="#/projects">去我的项目</a></div></section>`, 'wait-page'), after(root) {
    let raf; const arc = root.querySelector('#arc'), C = 2 * Math.PI * 52;
    const tick = () => { const k = Math.min(1, (Date.now() - p.genStart) / total);
      arc.style.strokeDasharray = `${C * k} ${C}`; root.querySelector('#pct').textContent = `${Math.round(k * 100)}%`;
      root.querySelectorAll('#steps li').forEach(li => { const i = +li.dataset.i; li.className = k >= (i + 1) / 4 ? 'done' : k >= i / 4 ? 'now' : ''; });
      if (k >= 1) { p.status = p.next; save(); later(render, 300); return; } raf = requestAnimationFrame(tick); };
    tick(); return () => cancelAnimationFrame(raf);
  }};
}
const reviewView = p => statusPage(p, {title: '方案已生成，企业审核后发布', chip: ['待审核', 'wait'], sub: `你的图纸由系统自动转换。为避免尺寸或饰面边界不准确的方案误导你，${workspace.name}会先核对，再发布给你。`,
  items: [['提交方案需求', 'done', p.createdAt], ['图纸转换与排版出图', 'done', '3 个整体方案'], ['企业审核', 'now', '核对尺寸与饰面边界'], ['发布方案', '']],
  extra: `<div class="proto-op"><span>原型操作</span><button data-act="publish" data-v="${p.id}">模拟企业发布</button></div>`});
const assistView = p => statusPage(p, {title: '图纸需要辅助转换', chip: ['需辅助转换', 'warn'], sub: `「${esc(p.fileName)}」不是 DXF，系统不自动识别。${workspace.name}会协助转换图纸，与你确认楼层和饰面后再出方案。`,
  items: [['提交方案需求', 'done', p.createdAt], ['企业辅助转换图纸', 'now', '通常 1–2 个工作日'], ['确认楼层与饰面', ''], ['排版出图并发布', '']],
  extra: `<div class="proto-op"><span>原型操作</span><button data-act="publish" data-v="${p.id}">模拟企业完成并发布</button></div>`});

// ---------- 方案（沉浸全屏 + 底部抽屉） ----------
function resultView(p, {preview = false} = {}) {
  const u = ui(p.id), s = p.schemes[u.scheme], conf = p.status === 'confirmed' && p.confirmed;
  const soft = softById[s.soft], c = checks(s.floor);
  const stage = u.view === '3d'
    ? `<div class="stage" data-swipe><img src="${images.aerial}" alt="整栋 3D（示意）"><div class="shade top"></div><span class="badge-3d glass">${icon('cube', 14)} 实时 3D · 拖动旋转、双指缩放（原型以整栋图示意）</span></div>`
    : `<div class="stage" data-swipe><img src="${images.schemes[s.img]}" alt="方案 ${s.id} 效果图（示意）"><div class="shade top"></div></div>`;
  const actions = preview ? `<button class="ghost-btn" data-act="gate">${icon('lock', 15)} 调整</button><button class="cta small" data-act="gate">${icon('lock', 15)} 确认方案</button>`
    : conf ? `<a class="ghost-btn" href="#/project/${p.id}/adjust">继续调整</a><a class="cta small" href="#/project/${p.id}/done">查看确认</a>`
      : `<a class="ghost-btn" href="#/project/${p.id}/adjust">调整</a><a class="cta small" href="#/project/${p.id}/confirm">确认方案 ${s.id}</a>`;
  return page(`${stage}${topbar({back: preview ? '/' : '/projects', title: p.name.split(' · ')[0], over: true})}
    ${preview ? `<div class="preview-tag glass">${icon('eye', 14)} 企业分享给你的方案 · 仅预览</div>` : ''}
    <div class="pager">${p.schemes.map((x, i) => `<i class="${i === u.scheme ? 'on' : ''}"></i>`).join('')}</div>
    <div class="side">${[['image', '效果图'], ['3d', '3D']].map(([v, t]) => `<button class="fab ${u.view === v ? 'on' : ''}" data-act="view" data-v="${v}" aria-label="${t}">${icon(v === 'image' ? 'image' : 'cube', 18)}</button>`).join('')}</div>
    <button class="arrow l" data-act="prev" aria-label="上一个方案">${icon('left', 18)}</button><button class="arrow r" data-act="next" aria-label="下一个方案">${icon('right', 18)}</button>
    <section class="drawer ${u.drawer ? 'open' : ''}">
      <button class="handle" data-act="drawer" aria-label="${u.drawer ? '收起详情' : '展开详情'}"><i></i></button>
      <div class="drawer-head"><div><span class="kicker">方案 ${s.id} / 3 · 左右滑动切换 · 修订 ${p.revisions[s.id]}</span><b class="drawer-title">${s.name}</b></div><span class="tag">${pal(s.soft, 'xs')}${soft.name}</span></div>
      ${conf ? `<p class="ok-line">${icon('check', 14)} 你已确认 方案 ${conf.scheme} · 修订 ${conf.revision}</p>` : ''}
      <div class="quick card">${sw(s.floor.stone)}<span class="grow"><b>${stoneById[s.floor.stone].name}</b><small>客厅地面 · ${s.floor.size} · ${patternName[s.floor.pattern]}${s.floor.border ? ' · 波打线' : ''}</small></span></div>
      ${u.drawer ? `<p class="line">${esc(s.line)}</p>
        <div class="row-title"><b>软装 · ${soft.name}</b><span>示意</span></div><div class="card soft-card">${pal(s.soft, 'md')}<span class="grow"><b>${soft.name}</b><small>${soft.line}</small></span></div>
        <div class="row-title"><b>硬装</b><span>一层 · 5 处</span></div>
        <div class="list">${finishes.map(f => `<div class="row"><span>${f.name}</span><b>${f.kind === 'stair' ? `${stoneById[s.floor.stone].name} · 整板踏步` : f.kind === 'wall' ? `${stoneById[s.wall.stone].name} · ${s.wall.size} · ${patternName[s.wall.pattern]}` : floorLine(s.floor)}</b></div>`).join('')}</div>
        <div class="row-title"><b>三个方案的差异</b><span>客厅地面</span></div>
        <div class="diff">${[['软装', x => softById[x.soft].name], ['石材', x => stoneById[x.floor.stone].name], ['规格', x => x.floor.size], ['铺法', x => patternName[x.floor.pattern]], ['波打线', x => x.floor.border ? stoneById[x.floor.border].name : '无']].map(([k, fn]) => `<div class="drow"><span>${k}</span>${p.schemes.map((x, i) => `<b class="${i === u.scheme ? 'on' : ''}">${fn(x)}</b>`).join('')}</div>`).join('')}</div>
        ${c.map(h => `<div class="alert ${h.level === 'conflict' ? 'danger' : 'hint'}">${icon('info', 15)}<span><b>${h.level === 'conflict' ? '冲突' : '提示'}</b>${h.text}</span></div>`).join('')}` : `<button class="more" data-act="drawer">展开软装、硬装清单与方案对比 ${icon('right', 14)}</button>`}
      <div class="drawer-actions">${actions}</div>
    </section>`, 'immersive');
}

// ---------- 调整 ----------
function adjustView(p) {
  const u = ui(p.id), s = p.schemes[u.scheme];
  if (!p.work || p.work.scheme !== s.id) p.work = {scheme: s.id, soft: s.soft, floor: clone(s.floor), tab: 'soft', history: [], rendering: false, rendered: false};
  const w = p.work, pending = (w.soft !== s.soft ? 1 : 0) + (JSON.stringify(w.floor) !== JSON.stringify(s.floor) ? 1 : 0);
  const c = checks(w.floor), conflict = c.some(x => x.level === 'conflict');
  const tag = w.rendering ? `${icon('clock', 13)} 重新出图中…` : w.rendered && !pending ? `${icon('check', 13)} 已生成修订 ${p.revisions[s.id]}` : pending ? `${icon('clock', 13)} 修订 ${p.revisions[s.id]} → ${p.revisions[s.id] + 1} · ${pending} 处未出图` : `修订 ${p.revisions[s.id]}`;
  const dock = w.rendering ? '<button class="cta small" disabled>重新出图中…</button>'
    : w.rendered && !pending ? `<a class="ghost-btn" href="#/project/${p.id}">回到方案</a><a class="cta small" href="#/project/${p.id}/confirm">确认修订 ${p.revisions[s.id]}</a>`
      : `<button class="round-btn" data-act="undo" ${w.history.length ? '' : 'disabled'} aria-label="撤回">${icon('undo', 18)}</button><button class="cta small" data-act="rerender" ${pending && !conflict ? '' : 'disabled'}>${conflict ? '有冲突，暂不能出图' : pending ? '重新出图 · 约 1–2 分钟' : '选择要调整的选项'}</button>`;
  return {html: page(`<div class="stage ${w.rendering ? 'rendering' : ''}"><img src="${images.schemes[s.img]}" alt=""><div class="shade top"></div>${w.rendering ? '<div class="render-bar"><i></i></div>' : ''}</div>
    ${topbar({back: `/project/${p.id}`, title: `调整方案 ${s.id}`, over: true})}<span class="float-tag glass">${tag}</span>
    <section class="drawer open adjust">
      <span class="handle static"><i></i></span>
      <div class="seg">${[['soft', '软装风格'], ['hard', '硬装石材']].map(([k, t]) => `<button class="${w.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${t}</button>`).join('')}</div>
      <fieldset ${w.rendering ? 'disabled' : ''}>${w.tab === 'soft' ? `<p class="small">换风格会改变全屋家具款式、布艺与配色；家具布局由方案确定。</p>
        <div class="hscroll">${softStyles.map(st => `<button class="style-card ${w.soft === st.id ? 'on' : ''}" data-act="soft" data-v="${st.id}">${pal(st.id, 'lg')}<b>${st.name}</b><small>${st.line.split('、').slice(0, 2).join('、')}</small></button>`).join('')}</div>`
        : `<div class="row-title"><b>客厅地面 · 石材</b><span>示意素材</span></div>
        <div class="hscroll">${stones.map(st => `<button class="stone-pick ${w.floor.stone === st.id ? 'on' : ''}" data-act="set" data-k="stone" data-v="${st.id}">${sw(st.id, 'sq')}<span>${st.name}</span></button>`).join('')}</div>
        <div class="row-title"><b>规格</b><span>毫米</span></div><div class="chips">${sizes.map(t => `<button class="chip ${w.floor.size === t ? 'on' : ''}" data-act="set" data-k="size" data-v="${t}">${t}</button>`).join('')}</div>
        <div class="row-title"><b>铺法</b></div><div class="chips">${patterns.map(([v, t]) => `<button class="chip ${w.floor.pattern === v ? 'on' : ''}" data-act="set" data-k="pattern" data-v="${v}">${t}</button>`).join('')}</div>
        <div class="toggle-row"><span><b>波打线</b><small>${w.floor.border ? '开 · 深色金脉石收边，宽 18 cm' : '关 · 石材直接铺到墙边'}</small></span><button class="switch ${w.floor.border ? 'on' : ''}" data-act="set" data-k="border" data-v="${w.floor.border ? '' : 'gold'}" role="switch" aria-checked="${!!w.floor.border}"><i></i></button></div>
        ${c.map(h => `<div class="alert ${h.level === 'conflict' ? 'danger' : 'hint'}">${icon(h.level === 'conflict' ? 'alert' : 'info', 15)}<span><b>${h.level === 'conflict' ? '冲突 · 不能出图' : '提示 · 可以继续'}</b>${h.text}</span></div>`).join('')}`}</fieldset>
      ${w.history.length ? `<div class="row-title"><b>本次修改</b></div><ol class="changes">${w.history.map(h => `<li>${h.label}</li>`).join('')}</ol>` : ''}
      <div class="drawer-actions">${dock}</div>
    </section>`, 'immersive adjusting'), after() {
    if (w.rendering) later(() => { s.soft = w.soft; s.floor = clone(w.floor); p.revisions[s.id]++; w.rendering = false; w.rendered = true; save(); render(); }, 2600);
  }};
}
function setOption(p, k, v) {
  const w = p.work, before = JSON.stringify(w.floor);
  const label = {stone: () => `客厅地面：${stoneById[w.floor.stone].name} → ${stoneById[v].name}`, size: () => `客厅地面：${w.floor.size} → ${v}`, pattern: () => `客厅地面：${patternName[w.floor.pattern]} → ${patternName[v]}`, border: () => `客厅地面：${w.floor.border ? '有' : '无'}波打线 → ${v ? '有' : '无'}波打线`}[k]();
  w.floor[k] = k === 'border' ? (v || null) : v;
  if (JSON.stringify(w.floor) !== before) { w.history.push({kind: 'floor', before: JSON.parse(before), label}); w.rendered = false; }
}

// ---------- 确认与完成 ----------
function confirmView(p) {
  const u = ui(p.id), s = p.schemes[u.scheme], c = p.confirmDraft ||= {message: '', contact: true, time: '下午'};
  return {html: page(`<div class="half"><img src="${images.schemes[s.img]}" alt=""><div class="shade top"></div></div>${topbar({back: `/project/${p.id}`, title: '确认方案', over: true})}
    <section class="drawer open tall"><span class="handle static"><i></i></span>
      <span class="kicker">方案 ${s.id} · 修订 ${p.revisions[s.id]}</span><b class="drawer-title">${s.name} · ${softById[s.soft].name}</b>
      <p class="small">确认后，${workspace.name}会收到这一版整体方案。之后再调整，需要重新确认。</p>
      <div class="list"><div class="row"><span>软装风格</span><b>${softById[s.soft].name}</b></div>${finishes.slice(0, 4).map(f => `<div class="row"><span>${f.name}</span><b>${f.kind === 'wall' ? `${stoneById[s.wall.stone].name} · ${s.wall.size}` : floorLine(s.floor)}</b></div>`).join('')}</div>
      <label class="field solo"><span>给企业留言（选填）</span><textarea id="msg" rows="2" maxlength="300" placeholder="例如：二层想再看看深色石材；希望周末看样品。">${esc(c.message)}</textarea></label>
      <div class="toggle-row"><span><b>请企业联系我</b><small>${maskPhone(state.session)} · 登录手机号</small></span><button class="switch ${c.contact ? 'on' : ''}" data-act="contact" role="switch" aria-checked="${c.contact}"><i></i></button></div>
      ${c.contact ? `<div class="chips">${['上午', '下午', '晚上', '都可以'].map(t => `<button class="chip ${c.time === t ? 'on' : ''}" data-act="ctime" data-v="${t}">${t}</button>`).join('')}</div>` : ''}
      <div class="drawer-actions"><button class="cta small" data-act="confirm">确认方案 ${s.id} · 修订 ${p.revisions[s.id]}</button></div>
    </section>`, 'immersive'), after(root) { root.querySelector('#msg').addEventListener('input', e => { c.message = e.target.value; save(); }); }};
}
function doneView(p) {
  const c = p.confirmed; if (!c) { go(`/project/${p.id}`); return null; }
  return page(`${topbar({back: `/project/${p.id}`, title: ''})}<section class="pad status done">
    <span class="seal">${icon('check', 30)}</span><h1 class="h1">已确认 方案 ${c.scheme} · 修订 ${c.revision}</h1>
    <p class="lede">${workspace.name}已收到你的确认${c.message ? '和留言' : ''}。${c.contact ? `企业会在${c.time === '都可以' ? '方便时' : c.time}联系 ${maskPhone(state.session)}。` : '你没有请求联系，可以随时回来留言。'}</p>
    ${c.message ? `<blockquote class="quote">${esc(c.message)}</blockquote>` : ''}
    <ol class="timeline"><li class="done"><i>${icon('check', 12)}</i><div><b>确认方案</b><small>${c.at}</small></div></li><li class="now"><i></i><div><b>企业跟进</b><small>${c.contact ? '电话联系' : '查看留言'}</small></div></li><li><i></i><div><b>看样与深化</b></div></li></ol>
    <div class="stack"><a class="cta" href="#/projects">我的项目 <span>${icon('arrow', 18)}</span></a><a class="ghost-btn wide" href="#/project/${p.id}">回到方案</a></div></section>`);
}

// ---------- 分享与绑定 ----------
function linkFail(share) {
  const revoked = share.status === 'revoked';
  return statusPage({}, {back: '/', title: revoked ? '这个分享链接已被撤销' : '这个分享链接已过期', chip: ['链接失效', 'warn'],
    sub: `${revoked ? `${workspace.name}已撤销这个链接，可能是发错了对象或已重新分享。` : `链接有效期至 ${share.expires}。`}请联系为你制作方案的企业成员获取新链接；已绑定的项目可在「项目」中继续查看。`, items: []});
}
function shareView(token, q) {
  const share = shares[token]; if (!share) return linkFail({status: 'revoked'}); if (share.status !== 'active') return linkFail(share);
  const bound = state.projects.find(p => p.token === token); if (bound && state.binds[token]?.status === 'bound') { go(`/project/${bound.id}`); return null; }
  const p = sharedPreview(token); state.ui[p.id] ||= {scheme: 0, drawer: false, view: 'image'};
  return {html: resultView(p, {preview: true}), preview: p, after() { if (q.gate) openGate(token); }};
}
function openGate(token) {
  const share = shares[token];
  sheet(`<h2 class="sheet-title">调整和确认需要登录</h2><p>分享链接只能预览。调整、确认或留言需要验证手机号，并把这个方案绑定到你的账号；转发出去的链接不能让别人修改你的方案。</p>
    <div class="list"><div class="row left">${icon('phone', 18)}<span class="grow"><b>${share.mode === 'phone' ? '企业指定了手机号' : '企业会单独告诉你绑定码'}</b><small>${share.mode === 'phone' ? '用该手机号登录即自动绑定' : '登录后输入 6 位一次性绑定码'}</small></span></div>
      <div class="row left">${icon('user', 18)}<span class="grow"><b>都不满足？</b><small>可以提交绑定申请，由企业批准</small></span></div></div>
    <div class="stack"><button class="cta" data-act="gate-login" data-v="${token}">手机号登录 <span>${icon('arrow', 18)}</span></button><button class="ghost-btn wide" data-act="sheet-close">继续预览</button></div>`);
}
function bindView(token, q) {
  const share = shares[token]; if (!share || share.status !== 'active') return linkFail(share || {status: 'revoked'});
  if (!state.session) { go(`/login?next=/bind/${token}`); return null; }
  const b = state.binds[token] ||= {status: 'none', tries: 5, error: null, code: ''}, back = `/share/${token}`;
  if (b.status === 'none' && share.mode === 'phone' && state.session === share.phone) bindNow(token);
  if (b.status === 'bound') { const p = state.projects.find(x => x.token === token);
    return page(`${topbar({back: '/projects', title: ''})}<section class="pad status done"><span class="seal">${icon('check', 30)}</span><h1 class="h1">已绑定到你的账号</h1>
      <p class="lede">${b.how === 'phone' ? '你登录的手机号与企业分享时指定的一致，方案已自动绑定。' : b.how === 'code' ? '绑定码验证通过，方案已绑定；绑定码已失效。' : '企业已批准你的绑定申请。'}现在可以调整、确认和留言。</p>
      <div class="list"><div class="row"><span>方案</span><b>${esc(p.name)}</b></div><div class="row"><span>账号</span><b>${maskPhone(state.session)}</b></div></div>
      <div class="stack"><a class="cta" href="#/project/${p.id}">查看并调整 <span>${icon('arrow', 18)}</span></a><a class="ghost-btn wide" href="#/projects">我的项目</a></div></section>`); }
  if (b.status === 'pending') return statusPage({}, {back, title: '绑定申请已提交', chip: ['等待企业批准', 'wait'], sub: `${workspace.name}核对你的身份后会批准。批准前仍可预览；批准后方案会出现在「项目」中。`,
    items: [['提交绑定申请', 'done', `${maskPhone(state.session)}${b.name ? ' · ' + esc(b.name) : ''}`], ['企业成员核对', 'now', '通常在 1 个工作日内'], ['绑定到你的账号', '']],
    extra: `<div class="stack"><a class="ghost-btn wide" href="#${back}">继续预览方案</a></div><div class="proto-op"><span>原型操作</span><button data-act="approve" data-v="${token}">模拟企业批准</button></div>`});
  if (q.apply) return {html: page(`${topbar({back: `/bind/${token}`, title: ''})}<section class="pad"><h1 class="h1">提交绑定申请</h1><p class="lede">企业成员核对后批准，方案才会绑定到你的账号。请留下称呼，方便企业确认是你。</p>
      <div class="list"><div class="row"><span>方案</span><b>${esc(share.title)}</b></div><div class="row"><span>手机号</span><b>${maskPhone(state.session)}</b></div></div>
      <div class="form-card"><label class="field"><span>称呼</span><input id="aname" maxlength="20" placeholder="例如：王女士" value="${esc(b.name || '')}"></label>
      <label class="field"><span>说明（选填）</span><textarea rows="2" maxlength="200" placeholder="例如：方案顾问上周来家里量过尺寸。"></textarea></label></div></section>
      <div class="dock"><button class="cta small" data-act="apply" data-v="${token}">提交绑定申请</button></div>`, 'with-dock'), after(root) { root.querySelector('#aname').addEventListener('input', e => { b.name = e.target.value; save(); }); }};
  if (share.mode === 'phone') return page(`${topbar({back, title: ''})}<section class="pad status"><span class="seal warn">${icon('phone', 26)}</span><h1 class="h1">手机号与分享指定的不一致</h1>
      <p class="lede">这个方案是企业定向分享给另一个手机号的。为保护方案，用 ${maskPhone(state.session)} 登录不能直接绑定，转发的链接只能预览。</p>
      <div class="list"><button class="row left" data-act="relogin" data-v="${token}">${icon('logout', 18)}<span class="grow"><b>换一个手机号登录</b><small>如果企业分享时填写的是你的另一个号码</small></span>${icon('right', 15)}</button>
        <a class="row left" href="#/bind/${token}?apply=1">${icon('user', 18)}<span class="grow"><b>提交绑定申请</b><small>由企业成员核对后批准</small></span>${icon('right', 15)}</a></div>
      <div class="stack"><a class="ghost-btn wide" href="#${back}">返回预览</a></div></section>`);
  const msg = {wrong: `绑定码不正确，请核对后重试。还可尝试 ${b.tries} 次。`, locked: '尝试次数过多，这个绑定码已锁定。请联系企业成员重新分享，或提交绑定申请。', format: '绑定码为 6 位字母或数字。'}[b.error];
  return {html: page(`${topbar({back, title: ''})}<section class="pad"><h1 class="h1">输入绑定码</h1><p class="lede">企业成员会通过电话、微信等方式单独告诉你 6 位绑定码。只能使用一次，48 小时内有效。</p>
      <div class="form-card"><label class="field"><span>绑定码</span><input id="bcode" class="code-input" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="6 位绑定码" value="${esc(b.code)}" ${b.error === 'locked' ? 'disabled' : ''}></label></div>
      <p class="demo-inline">演示绑定码 <b>${share.code}</b> <button data-act="bfill" data-v="${token}">填入</button></p>
      ${msg ? `<div class="alert danger">${icon('alert', 16)}<span>${msg}</span></div>` : ''}
      <a class="text-link" href="#/bind/${token}?apply=1">没有绑定码？提交绑定申请 ${icon('right', 14)}</a></section>
      <div class="dock"><button class="cta small" data-act="bcode" data-v="${token}" ${b.error === 'locked' ? 'disabled' : ''}>绑定到我的账号</button></div>`, 'with-dock'), after(root) {
    root.querySelector('#bcode').addEventListener('input', e => { b.code = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); e.target.value = b.code; save(); });
  }};
}
function bindNow(token, how = 'phone') {
  const b = state.binds[token]; Object.assign(b, {status: 'bound', how, error: null});
  if (!state.projects.some(p => p.token === token)) { const p = sharedPreview(token); p.id = 'shared-' + token; p.createdAt = today(); state.projects.push(p); }
  save();
}

// ---------- 项目 / 我的 ----------
function projectsView() {
  if (!state.session) { go('/login?next=/projects'); return null; }
  const mine = state.projects.filter(p => p.origin === 'self'), shared = state.projects.filter(p => p.origin === 'shared'), pending = Object.entries(state.binds).filter(([, b]) => b.status === 'pending');
  const row = p => { const [t, k] = statusChip(p), hasImg = ['published', 'confirmed'].includes(p.status);
    return `<a class="proj" href="#/project/${p.id}"><span class="thumb">${hasImg ? `<img src="${images.schemes[p.schemes[ui(p.id).scheme].img]}" alt="">` : icon(p.status === 'assist' ? 'file' : 'clock', 22)}</span>
      <span class="grow"><b>${esc(p.name)}</b><small>${p.status === 'confirmed' ? `已确认 方案 ${p.confirmed.scheme} · 修订 ${p.confirmed.revision}` : p.status === 'published' ? '3 个整体方案' : p.status === 'review' ? '企业审核后发布' : p.status === 'assist' ? '等待企业转换图纸' : '正在排版出图'}</small></span><span class="status-chip ${k}">${t}</span></a>`; };
  const empty = !mine.length && !shared.length && !pending.length;
  return page(`${topbar({title: '我的项目'})}<section class="pad tabbed">
    ${empty ? `<div class="empty"><span class="seal soft">${icon('folder', 26)}</span><h2>还没有项目</h2><p>点右下角的 + 提交户型和石材偏好，得到第一份整体方案；或打开企业发给你的分享链接。</p></div>` : `
    <div class="row-title"><b>我提交的</b><span>${mine.length}</span></div>${mine.length ? `<div class="projs">${mine.map(row).join('')}</div>` : '<p class="small">还没有自己提交的方案需求。</p>'}
    <div class="row-title"><b>企业分享给我的</b><span>${shared.length + pending.length}</span></div>
    <div class="projs">${shared.map(row).join('')}${pending.map(([token, b]) => `<a class="proj" href="#/bind/${token}"><span class="thumb">${icon('lock', 22)}</span><span class="grow"><b>${esc(shares[token].title)}</b><small>绑定申请已提交${b.name ? ' · ' + esc(b.name) : ''}</small></span><span class="status-chip wait">待批准</span></a>`).join('')}</div>
    ${!shared.length && !pending.length ? '<p class="small">打开企业分享的链接并完成绑定后，方案会出现在这里。</p>' : ''}`}</section>${tabbar('/projects')}`);
}
function meView() {
  return page(`${topbar({title: '我的'})}<section class="pad tabbed">
    <div class="card account">${icon('user', 22)}<span class="grow"><b>${state.session ? maskPhone(state.session) : '未登录'}</b><small>${state.session ? `已关联 ${workspace.name}` : '登录后可提交需求、调整和确认方案'}</small></span>${state.session ? '' : '<a class="chip on" href="#/login?next=/me">登录</a>'}</div>
    <div class="row-title"><b>显示</b></div>
    <div class="seg theme">${[['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([v, t]) => `<button class="${state.theme === v ? 'on' : ''}" data-act="theme" data-v="${v}">${icon(v === 'dark' ? 'moon' : 'sun', 15)} ${t}</button>`).join('')}</div>
    <div class="row-title"><b>关于</b></div>
    <div class="list"><div class="row"><span>企业</span><b>${workspace.name}</b></div><div class="row"><span>说明</span><b>效果图与石材为示意素材</b></div><div class="row"><span>协议</span><b>《用户协议》《隐私政策》（占位）</b></div></div>
    ${state.session ? `<button class="ghost-btn wide" data-act="logout">${icon('logout', 16)} 退出登录</button>` : ''}
  </section>${tabbar('/me')}`);
}
function projectView(id, sub) {
  const p = projectById(id);
  if (!p) return statusPage({}, {back: '/projects', title: '找不到这个项目', chip: ['不可访问', 'warn'], sub: '项目不存在，或没有绑定到你的账号。', items: []});
  if (!state.session) { go(`/login?next=/project/${id}${sub ? '/' + sub : ''}`); return null; }
  if (p.status === 'generating') return waitView(p);
  if (p.status === 'review') return reviewView(p);
  if (p.status === 'assist') return assistView(p);
  if (sub === 'adjust') return adjustView(p);
  if (sub === 'confirm') return confirmView(p);
  if (sub === 'done') return doneView(p);
  return resultView(p);
}

// ---------- 弹层 ----------
function sheet(html) { const d = document.querySelector('#sheet'); d.innerHTML = `<div class="sheet-body"><span class="handle static"><i></i></span>${html}</div>`; if (!d.open) d.showModal(); }
const closeSheet = () => { const d = document.querySelector('#sheet'); if (d.open) d.close(); };
let toastTimer;
function toast(t) { const el = document.querySelector('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2200); }

// ---------- 原型审阅导航 ----------
const sample = (status, extra = {}) => newProject({name: '示例别墅 · 我的方案需求', source: 'sample', schemes: makeSchemes(), status, next: 'published', genStart: Date.now(), ...extra});
const seed = ({login = true} = {}) => { const theme = state.theme; state = initial(); state.theme = theme; if (login) state.session = '13900139000'; };
const R = {
  'home': ['客户自助', '首页', () => { seed({login: false}); go('/'); }],
  'login': ['客户自助', '手机号登录', () => { seed({login: false}); go('/login?next=/new'); }],
  'login-sent': ['客户自助', '登录 · 演示验证码', () => { seed({login: false}); state.login.phone = '13900139000'; sendCode(); go('/login?next=/new'); }],
  'login-wrong': ['客户自助', '登录 · 验证码错误', () => { seed({login: false}); state.login.phone = '13900139000'; sendCode(); state.login.attempts = 3; state.login.error = 'wrong'; go('/login?next=/new'); }],
  'login-rate': ['客户自助', '登录 · 获取过于频繁', () => { seed({login: false}); state.login.phone = '13900139000'; state.login.sends = Array(5).fill(Date.now()); state.login.error = 'rate'; go('/login?next=/new'); }],
  'new-1': ['客户自助', '提交 · 选择户型', () => { seed(); go('/new'); }],
  'new-dxf': ['客户自助', '提交 · DXF 转换中', () => { seed(); Object.assign(state.draft, {source: 'upload', file: {name: '别墅平面图.dxf', kind: 'dxf', status: 'converting'}}); go('/new'); }],
  'new-assist': ['客户自助', '提交 · 其他格式需辅助转换', () => { seed(); Object.assign(state.draft, {source: 'upload', file: {name: '别墅平面图.pdf', kind: 'other', status: 'assist'}}); go('/new'); }],
  'new-2': ['客户自助', '提交 · 选择饰面', () => { seed(); Object.assign(state.draft, {source: 'sample', step: 2}); go('/new'); }],
  'new-3': ['客户自助', '提交 · 石材与偏好', () => { seed(); Object.assign(state.draft, {source: 'sample', step: 3, stones: ['white', 'beige'], tone: '浅色'}); go('/new'); }],
  'wait': ['客户自助', '出图等待', () => { seed(); const p = sample('generating'); p.genStart = Date.now() - 2200; go(`/project/${p.id}`); }],
  'review': ['客户自助', '待审核', () => { seed(); const p = sample('review', {source: 'upload', fileName: '别墅平面图.dxf'}); go(`/project/${p.id}`); }],
  'assist': ['客户自助', '需辅助转换', () => { seed(); const p = sample('assist', {source: 'upload', fileName: '别墅平面图.pdf'}); go(`/project/${p.id}`); }],
  'result': ['方案', '方案 · 满屏效果图', () => { seed(); const p = sample('published'); go(`/project/${p.id}`); }],
  'result-open': ['方案', '方案 · 抽屉展开（清单与对比）', () => { seed(); const p = sample('published'); ui(p.id).drawer = true; go(`/project/${p.id}`); }],
  'result-3d': ['方案', '方案 · 3D 查看', () => { seed(); const p = sample('published'); ui(p.id).view = '3d'; go(`/project/${p.id}`); }],
  'adjust-soft': ['调整', '调整 · 软装风格', () => { seed(); const p = sample('published'); go(`/project/${p.id}/adjust`); }],
  'adjust-hard': ['调整', '调整 · 硬装石材', () => { seed(); const p = sample('published'); adjustView(p); p.work.tab = 'hard'; go(`/project/${p.id}/adjust`); }],
  'adjust-conflict': ['调整', '调整 · 冲突', () => { seed(); const p = sample('published'); adjustView(p); p.work.tab = 'hard'; setOption(p, 'pattern', 'herringbone'); go(`/project/${p.id}/adjust`); }],
  'adjust-rendering': ['调整', '调整 · 重新出图中', () => { seed(); const p = sample('published'); adjustView(p); p.work.soft = 'chinese'; p.work.history.push({kind: 'soft', before: 'modern', label: '软装风格：现代简约 → 新中式'}); p.work.rendering = true; go(`/project/${p.id}/adjust`); }],
  'confirm': ['确认', '确认 · 留言与联系', () => { seed(); const p = sample('published'); p.confirmDraft = {message: '周末想看样品。', contact: true, time: '下午'}; go(`/project/${p.id}/confirm`); }],
  'done': ['确认', '已确认', () => { seed(); const p = sample('confirmed'); p.confirmed = {scheme: 'A', revision: 1, message: '周末想看样品。', contact: true, time: '下午', at: today()}; go(`/project/${p.id}/done`); }],
  'share': ['分享与绑定', '分享预览 · 未登录', () => { seed({login: false}); go('/share/direct'); }],
  'share-gate': ['分享与绑定', '点调整 · 要求登录', () => { seed({login: false}); go('/share/direct?gate=1'); }],
  'bind-auto': ['分享与绑定', '定向手机号 · 自动绑定', () => { seed({login: false}); state.session = demoPhone; go('/bind/direct'); }],
  'bind-mismatch': ['分享与绑定', '手机号不一致', () => { seed(); go('/bind/direct'); }],
  'bind-code': ['分享与绑定', '输入绑定码', () => { seed(); go('/bind/code'); }],
  'bind-apply': ['分享与绑定', '提交绑定申请', () => { seed(); go('/bind/direct?apply=1'); }],
  'bind-pending': ['分享与绑定', '等待企业批准', () => { seed(); state.binds.direct = {status: 'pending', tries: 5, name: '王女士'}; go('/bind/direct'); }],
  'share-revoked': ['分享与绑定', '链接已撤销', () => { seed({login: false}); go('/share/revoked'); }],
  'projects': ['项目与我的', '我的项目', () => { seed(); sample('assist', {source: 'upload', fileName: '老宅改造.pdf', name: '老宅改造 · 我的方案需求'}); const c = sample('confirmed'); c.confirmed = {scheme: 'A', revision: 2, contact: true, time: '下午', at: today()}; state.binds.code = {status: 'none', tries: 5}; bindNow('code', 'code'); state.binds.direct = {status: 'pending', name: '王女士'}; go('/projects'); }],
  'projects-empty': ['项目与我的', '我的项目 · 空', () => { seed(); go('/projects'); }],
  'me': ['项目与我的', '我的 · 主题切换', () => { seed(); go('/me'); }],
};
function openReview() {
  const groups = {};
  for (const [id, [g, label]] of Object.entries(R)) (groups[g] ||= []).push(`<li><button data-act="jump" data-v="${id}">${label}${icon('right', 13)}</button></li>`);
  sheet(`<div class="review-head"><h2 class="sheet-title">原型审阅导航</h2><button class="round" data-act="sheet-close" aria-label="关闭">${icon('close', 18)}</button></div>
    <p>直接跳到任一页面或状态，跳转会重置演示数据。这个入口不属于产品界面。</p>${Object.entries(groups).map(([g, items]) => `<h3>${g}</h3><ul class="review-list">${items.join('')}</ul>`).join('')}
    <button class="ghost-btn wide" data-act="reset">清空演示数据并回到首页</button>`);
}
window.__review = {ids: Object.keys(R), go: id => { closeSheet(); R[id][2](); save(); render(); }};

// ---------- 交互 ----------
const current = () => { const {parts} = parse(); return parts[0] === 'project' ? projectById(parts[1]) : parts[0] === 'share' ? currentPreview : null; };
let currentPreview = null;
const actions = {
  review: () => { openReview(); return false; }, 'sheet-close': () => { closeSheet(); return false; }, jump: el => { window.__review.go(el.dataset.v); return false; },
  reset: () => { closeSheet(); seed({login: false}); go('/'); },
  start: () => { state.draft = freshDraft(); go(state.session ? '/new' : '/login?next=/new'); return false; },
  send: () => sendCode(), fill: () => { state.login.input = state.login.code; }, login: () => doLogin(parse().q.next),
  source: el => { state.draft.source = el.dataset.v; state.draft.file = null; }, demofile: el => pickFile(el.dataset.v),
  step: el => { state.draft.step = +el.dataset.v; scrollTo(0, 0); },
  finish: el => { const a = state.draft.finishes, i = a.indexOf(el.dataset.v); i < 0 ? a.push(el.dataset.v) : a.splice(i, 1); },
  stone: el => { const a = state.draft.stones, i = a.indexOf(el.dataset.v); if (i >= 0) a.splice(i, 1); else if (a.length < 3) a.push(el.dataset.v); else toast('最多选择 3 款石材'); },
  tone: el => { state.draft.tone = el.dataset.v; }, pattern: el => { const a = state.draft.patterns, i = a.indexOf(el.dataset.v); i < 0 ? a.push(el.dataset.v) : a.splice(i, 1); },
  border: el => { state.draft.border = el.dataset.v; }, submit: submitDraft,
  publish: el => { projectById(el.dataset.v).status = 'published'; toast('原型操作：企业已发布方案'); },
  prev: () => { const u = ui(current().id); u.scheme = (u.scheme + 2) % 3; }, next: () => { const u = ui(current().id); u.scheme = (u.scheme + 1) % 3; },
  view: el => { ui(current().id).view = el.dataset.v; }, drawer: () => { const u = ui(current().id); u.drawer = !u.drawer; },
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
function applyTheme() { if (state.theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = state.theme; }

// ---------- 渲染 ----------
let lastPath = null, cleanup = () => {};
function view() {
  const {parts, q} = parse(); currentPreview = null;
  switch (parts[0]) {
    case undefined: return homeView();
    case 'login': return loginView(q);
    case 'new': return newView();
    case 'projects': return projectsView();
    case 'me': return meView();
    case 'project': return projectView(parts[1], parts[2]);
    case 'share': { const v = shareView(parts[1], q); if (v?.preview) currentPreview = v.preview; return v; }
    case 'bind': return bindView(parts[1], q);
    default: return homeView();
  }
}
function render() {
  timers.forEach(clearTimeout); timers = []; cleanup(); cleanup = () => {};
  const {path} = parse(), y = scrollY, drawerY = document.querySelector('.drawer')?.scrollTop || 0;
  const v = view(); if (v == null) return;
  const out = typeof v === 'string' ? {html: v} : v;
  const root = document.querySelector('#app'); root.innerHTML = out.html;
  if (path !== lastPath) { scrollTo(0, 0); document.title = `${workspace.name} · ${root.querySelector('h1, .title')?.textContent?.trim() || '客户端'}（原型）`; }
  else { scrollTo(0, y); const d = root.querySelector('.drawer'); if (d) d.scrollTop = drawerY; }
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
document.addEventListener('pointerdown', e => { if (e.target.closest('[data-swipe]')) sx = e.clientX; });
document.addEventListener('pointerup', e => { if (sx !== null && Math.abs(e.clientX - sx) > 40 && current()) { const u = ui(current().id); u.scheme = (u.scheme + (e.clientX < sx ? 1 : 2)) % 3; save(); render(); } sx = null; });
document.querySelector('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
addEventListener('hashchange', () => { closeSheet(); render(); });
applyTheme(); render();
