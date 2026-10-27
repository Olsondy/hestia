// H5 客户端交互原型：纯前端、演示 fixture、不接服务端。仅供审阅交互与视觉，不作为生产代码基础。
import {icon, layoutGlyph} from './icons.js';
import {workspace, stones, stoneById, layouts, layoutName, floorSpecs, wallSpecs, specLabel, villa, facets, facetById, kindName,
  defaultFacets, makeSchemes, checkFinish, shares, sharedProject, demoPhone, maskPhone} from './data.js';
import {swatchURL} from './stone.js';
import {renderImage, mountViewer} from './render3d.js';

const KEY = 'hestia.client-h5.v1';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const clone = v => JSON.parse(JSON.stringify(v));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = 'cubic-bezier(.16,1,.3,1)';

const freshLogin = () => ({phone: '', input: '', sent: false, code: '', expiresAt: 0, attempts: 5, sends: [], cooldownUntil: 0, error: null});
const freshDraft = () => ({step: 1, source: null, file: null, floor: 'f1', facets: [...defaultFacets], kinds: ['floor', 'wall', 'stair'], stones: [], tone: null, layouts: [], border: 'auto', note: ''});
const initial = () => ({session: null, login: freshLogin(), draft: freshDraft(), projects: [], binds: {}, seq: 1});

let state;
try { state = {...initial(), ...JSON.parse(localStorage.getItem(KEY) || 'null')}; } catch { state = initial(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 隐私模式下仅内存保存 */ } };

// ---------- 路由 ----------
function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return {path, parts: path.split('/').filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs || ''))};
}
const go = path => { if (location.hash === '#' + path) render(); else location.hash = path; };
let lastPath = null, cleanup = () => {}, timers = [];
const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
function clearTimers() { timers.forEach(clearTimeout); timers = []; }

// ---------- 项目 ----------
const projectById = id => state.projects.find(p => p.id === id) || (id?.startsWith('share-') ? sharedPreview(id.slice(6)) : null);
function sharedPreview(token) {
  return {id: 'share-' + token, name: sharedProject.name, origin: 'shared', token, status: 'published', source: 'member',
    facets: [...defaultFacets], schemes: makeSchemes(defaultFacets, ['yudu', 'shaanna', 'huimu']), active: 'A', floor: 'f1',
    revisions: {A: 1, B: 1, C: 1}, member: sharedProject.member, createdAt: '2026-10-26'};
}
function newProject(fields) {
  const id = 'p' + state.seq++;
  const p = {id, origin: 'self', active: 'A', floor: 'f1', revisions: {A: 1, B: 1, C: 1}, createdAt: today(), ...fields};
  state.projects.unshift(p);
  return p;
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const floorsOf = p => villa.floors.filter(fl => p.facets.some(id => facetById[id]?.floor === fl.id));
const schemeOf = (p, id = p.active) => p.schemes.find(s => s.id === id);
function mainFacet(p, floorId) {
  const sc = villa.floors.find(f => f.id === floorId).scene;
  return p.facets.includes(sc.floor) ? sc.floor : p.facets.find(id => facetById[id].floor === floorId && facetById[id].kind === 'floor') || p.facets.find(id => facetById[id].floor === floorId);
}
const finishLine = (fid, fin) => {
  const f = facetById[fid];
  if (!fin) return '未铺石材';
  const s = stoneById[fin.stone].name;
  if (f.kind === 'stair') return `${s} · 整板踏步`;
  if (f.kind === 'wall') return `${s} · ${specLabel(fin.spec)} · ${layoutName[fin.layout]}`;
  return `${s} · ${specLabel(fin.spec)} · ${layoutName[fin.layout]}${fin.border ? ` · ${stoneById[fin.borderStone].name}波打线` : ''}`;
};
const statusInfo = {
  generating: ['出图中', 'wait'], review: ['待审核', 'review'], assist: ['需辅助转换', 'assist'], published: ['已发布', 'ok'], confirmed: ['已确认', 'ok'],
};
const chip = status => `<span class="status ${statusInfo[status][1]}">${statusInfo[status][0]}</span>`;

// ---------- 外壳 ----------
function shell(content, {back, title, dock = '', plain = false} = {}) {
  const who = state.session
    ? `<a class="bar-link" href="#/projects">${icon('folder', 17)}<span>我的项目</span></a>`
    : `<a class="bar-link" href="#/login?next=/projects">${icon('user', 17)}<span>登录</span></a>`;
  return `<header class="bar">
      ${back ? `<a class="bar-back" href="#${back}" aria-label="返回">${icon('back', 20)}</a>` : ''}
      <a class="brand" href="#/" aria-label="${workspace.name}首页"><span class="brand-mark" aria-hidden="true">标志</span><span class="brand-name">${title ? esc(title) : workspace.name}</span></a>
      <button class="demo-chip" data-act="review" aria-label="打开原型审阅导航">演示</button>
      ${who}
    </header>
    <main class="page${plain ? ' plain' : ''}" id="page">${content}</main>
    ${dock ? `<div class="dock">${dock}</div>` : ''}
    <footer class="colophon"><span>演示环境 · 数据、尺寸与效果图均为示意</span><button data-act="review">原型审阅导航 ${icon('menu', 14)}</button></footer>`;
}
const title2 = (a, b) => `${esc(a)}<em>${esc(b)}</em>`;

// ---------- 页面：企业入口首页 ----------
function homeView() {
  const scheme = makeSchemes(defaultFacets, ['yashi', 'shaanna', 'huimu'])[0];
  return {html: shell(`
    <section class="cover">
      <figure class="cover-plate"><img data-render="f1" data-scheme='${esc(JSON.stringify(scheme))}' alt="示例别墅一层客厅铺贴效果图（示意）"><figcaption><span>示例别墅 · 一层客厅</span><span>效果图 · 示意素材</span></figcaption></figure>
      <h1 class="display">为你的空间，<em>先铺一遍石材。</em></h1>
      <p class="lede">提交户型与石材偏好，得到 2–3 个铺贴方案的效果图。${workspace.name}审核后发布，你可以在给定选项内调整，再确认。</p>
      <div class="cover-actions">
        <button class="design-row" data-act="start">提交方案需求<span>${icon('arrow', 22)}</span></button>
        <a class="text-link" href="#/projects">查看我的项目 ${icon('chevron', 14)}</a>
      </div>
    </section>
    <section class="section">
      <h2 class="h2">从图纸到铺贴方案</h2>
      <ol class="flow">
        <li><b>示例别墅或上传图纸</b><span>DXF 自动转换；其他格式由企业协助转换。</span></li>
        <li><b>勾选要铺石材的饰面</b><span>各层地面、背景墙、楼梯踏面。</span></li>
        <li><b>挑选石材，得到 2–3 个方案</b><span>换石材、规格、铺法后重新出图，满意再确认。</span></li>
      </ol>
    </section>
    <section class="section">
      <div class="label-row"><h2 class="h2">企业石材库</h2><span class="tag">示意素材</span></div>
      <div class="peek">${stones.map(s => `<figure><img src="${swatchURL(s.id)}" alt=""><figcaption>${s.name}</figcaption></figure>`).join('')}</div>
    </section>
    <section class="section share-hint">
      <h2 class="h2">收到企业分享的链接？</h2>
      <p>直接打开即可预览企业为你做好的方案。调整和确认需要手机号登录，并把项目绑定到你的账号。</p>
      <a class="text-link" href="#/share/direct">打开演示分享链接 ${icon('chevron', 14)}</a>
    </section>`)};
}

// ---------- 页面：手机号登录 ----------
const validPhone = p => /^1\d{10}$/.test(p);
function loginView(q) {
  const L = state.login, now = Date.now();
  const next = q.next || '/projects', share = next.startsWith('/bind');
  const msg = {
    phone: ['请输入 11 位中国大陆手机号。', 'field'],
    nosend: ['请先获取验证码。', 'field'],
    wrong: [`验证码不正确，还可尝试 ${L.attempts} 次。`, 'danger'],
    locked: ['错误次数过多，此验证码已失效。请重新获取验证码。', 'danger'],
    expired: ['验证码已过期（5 分钟内有效）。请重新获取。', 'danger'],
    rate: ['获取验证码过于频繁。为保护账号，请 60 分钟后再试。', 'danger'],
  }[L.error];
  const cooldown = Math.max(0, Math.ceil((L.cooldownUntil - now) / 1000));
  const sendLabel = L.error === 'rate' ? '暂不可获取' : cooldown ? `${cooldown} 秒后重新获取` : L.sent ? '重新获取' : '获取验证码';
  return {html: shell(`
    <section class="form-page">
      <h1 class="title">手机号<em>登录</em></h1>
      <p class="lede">验证手机号即可登录，无需密码。首次登录会关联${workspace.name}，你提交和绑定的方案都保存在这个账号下。</p>
      ${share ? `<p class="note">${icon('link', 16)}<span>登录后，分享给你的项目会按企业设定的方式绑定到你的账号。演示定向手机号：<b>${demoPhone.replace(/(\d{3})(\d{4})(\d{4})/, '$1 $2 $3')}</b></span></p>` : ''}
      <label class="field"><span>手机号</span><span class="field-row"><span class="prefix">+86</span><input id="phone" inputmode="numeric" autocomplete="tel" maxlength="11" placeholder="11 位手机号" value="${esc(L.phone)}"></span></label>
      ${msg && msg[1] === 'field' && L.error === 'phone' ? `<p class="field-error">${msg[0]}</p>` : ''}
      <label class="field"><span>验证码</span><span class="field-row"><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位验证码" value="${esc(L.input)}"><button class="send" data-act="send" ${cooldown || L.error === 'rate' ? 'disabled' : ''}>${sendLabel}</button></span></label>
      ${msg && L.error === 'nosend' ? `<p class="field-error">${msg[0]}</p>` : ''}
      ${L.sent && L.code && !['locked', 'expired'].includes(L.error) ? `<div class="demo-code" role="status"><div><span>演示验证码</span><strong>${L.code}</strong></div><small>演示环境不发送短信，验证码只显示在这里 · 5 分钟内有效</small><button data-act="fill">填入</button></div>` : ''}
      ${msg && msg[1] === 'danger' ? `<div class="alert danger" role="alert">${icon('alert', 18)}<span>${msg[0]}</span></div>` : ''}
      <button class="btn primary wide" data-act="login" ${L.error === 'locked' || L.error === 'rate' ? 'disabled' : ''}>登录</button>
      <p class="fine">登录即表示同意《演示用户协议》（原型占位）。</p>
    </section>`, {back: share ? next.replace('/bind', '/share') : '/'}), after(root) {
    root.querySelector('#phone').addEventListener('input', e => { L.phone = e.target.value.replace(/\D/g, ''); e.target.value = L.phone; save(); });
    root.querySelector('#code').addEventListener('input', e => { L.input = e.target.value.replace(/\D/g, ''); e.target.value = L.input; save(); });
    if (cooldown) { const t = setInterval(() => { const b = root.querySelector('.send'); const left = Math.ceil((L.cooldownUntil - Date.now()) / 1000); if (!b) return; if (left <= 0) { clearInterval(t); b.disabled = false; b.textContent = '重新获取'; } else b.textContent = `${left} 秒后重新获取`; }, 1000); return () => clearInterval(t); }
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
  state.session = L.phone; state.login = freshLogin();
  go(next || '/projects');
}

// ---------- 页面：提交方案需求 ----------
function planSVG(floorId, selected, {small = false} = {}) {
  const fl = villa.floors.find(f => f.id === floorId);
  const [FW, FD] = fl.footprint, s = 100 / 12;
  const sel = new Set(selected.map(id => facetById[id]).filter(f => f.floor === floorId).map(f => f.kind === 'wall' ? f.room + ':wall' : f.room));
  const rooms = fl.rooms.map(r => {
    const [x, z, w, d] = r.rect;
    const on = sel.has(r.id);
    const steps = r.stair ? Array.from({length: 6}, (_, i) => `<line x1="${x * s}" x2="${(x + w) * s}" y1="${(z + .4 + i * (d - .8) / 5) * s}" y2="${(z + .4 + i * (d - .8) / 5) * s}"/>`).join('') : '';
    const wall = sel.has(r.id + ':wall') ? `<rect class="pl-wall" x="${(x + w / 2 - 2.1) * s}" y="${z * s}" width="${4.2 * s}" height="${.35 * s}"/>` : '';
    return `<g class="${on ? 'on' : ''}"><rect x="${x * s}" y="${z * s}" width="${w * s}" height="${d * s}"/>${steps}${wall}${small ? '' : `<text x="${(x + w / 2) * s}" y="${(z + d / 2) * s + 1.4}">${r.name}</text>`}</g>`;
  }).join('');
  return `<svg class="plan-svg" viewBox="-1 -1 ${FW * s + 2} ${FD * s + 2}" role="img" aria-label="${fl.name}平面示意">${rooms}</svg>`;
}
function stepper(step) {
  return `<ol class="stepper" aria-label="提交步骤">${['图纸', '饰面', '石材与偏好'].map((n, i) => `<li class="${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}" ${i + 1 === step ? 'aria-current="step"' : ''}><i>${i + 1}</i>${n}</li>`).join('')}</ol>`;
}
function newView() {
  if (!state.session) { go('/login?next=/new'); return null; }
  const d = state.draft;
  const assist = d.source === 'upload' && d.file?.kind === 'other';
  const ready = d.source === 'sample' || (d.source === 'upload' && (d.file?.status === 'ready' || assist));
  let body = '', dock = '';
  if (d.step === 1) {
    const f = d.file;
    const status = !f ? '' : f.status === 'converting'
      ? `<div class="upload-state" role="status"><div class="file-line">${icon('file', 18)}<b>${esc(f.name)}</b></div><p>自动转换中…读取图层、墙体与楼层</p><div class="bar-progress"><i style="animation-duration:2.4s"></i></div></div>`
      : f.status === 'ready'
        ? `<div class="upload-state ok" role="status"><div class="file-line">${icon('file', 18)}<b>${esc(f.name)}</b><span class="status ok">已转换</span></div><p>识别出 3 层、10 处可铺贴饰面。原型中使用示例别墅数据代替转换结果。</p><p class="small">自动转换的结果需企业核对后才会发布方案。</p></div>`
        : `<div class="upload-state assist" role="status"><div class="file-line">${icon('file', 18)}<b>${esc(f.name)}</b><span class="status assist">需辅助转换</span></div><p><b>需辅助转换，企业将协助处理。</b>这个格式不能自动识别，${workspace.name}会协助转换图纸，确认楼层和饰面后再出方案。</p><p class="small">你可以继续提交石材偏好。</p></div>`;
    body = `${stepper(1)}<h1 class="title">先选择<em>户型来源</em></h1>
      <div class="choices" role="radiogroup" aria-label="户型来源">
        <button class="choice" role="radio" aria-checked="${d.source === 'sample'}" data-act="source" data-v="sample">
          <span class="choice-plan">${planSVG('f1', [], {small: true})}</span>
          <span class="choice-text"><b>示例别墅（演示）</b><small>${villa.facts}</small></span><span class="radio" aria-hidden="true"></span>
        </button>
        <div class="choice upload ${d.source === 'upload' ? 'is-on' : ''}">
          <label class="choice-main"><input type="file" id="file" class="sr-only"><span class="choice-icon">${icon('upload', 22)}</span>
            <span class="choice-text"><b>上传我的图纸</b><small>DXF 自动转换；PDF、图片、DWG 等需企业辅助转换</small></span><span class="radio" aria-hidden="true"></span></label>
          ${status}
          <p class="demo-files">没有图纸文件？用演示文件：<button data-act="demofile" data-v="别墅平面图.dxf">别墅平面图.dxf</button><button data-act="demofile" data-v="别墅平面图.pdf">别墅平面图.pdf</button></p>
        </div>
      </div>`;
    dock = `<button class="btn primary wide" data-act="step" data-v="2" ${ready ? '' : 'disabled'}>下一步：选择饰面 ${icon('arrow', 18)}</button>`;
  } else if (d.step === 2) {
    if (assist) {
      body = `${stepper(2)}<h1 class="title">想铺石材的<em>部位</em></h1>
        <p class="lede">图纸转换后，企业会和你确认具体楼层与饰面。先告诉我们大致范围。</p>
        <div class="chips big" role="group" aria-label="饰面类型">${['floor', 'wall', 'stair'].map(k => `<button class="chip" data-act="kind" data-v="${k}" aria-pressed="${d.kinds.includes(k)}">${{floor: '各层地面', wall: '背景墙', stair: '楼梯踏面'}[k]}</button>`).join('')}</div>
        <div class="alert assist">${icon('info', 18)}<span>楼层与饰面将在企业完成辅助转换后确认。</span></div>`;
    } else {
      const floorFacets = facets.filter(f => f.floor === d.floor);
      const count = fl => d.facets.filter(id => facetById[id].floor === fl).length;
      body = `${stepper(2)}<h1 class="title">选择要铺石材的<em>饰面</em></h1>
        <p class="lede">饰面是建筑的一部分，不随家具移动。只为勾选的部位出方案。</p>
        <div class="seg" role="tablist" aria-label="楼层">${villa.floors.map(fl => `<button role="tab" aria-selected="${fl.id === d.floor}" data-act="dfloor" data-v="${fl.id}">${fl.name}<small>${count(fl.id)}</small></button>`).join('')}</div>
        <figure class="plan">${planSVG(d.floor, d.facets)}<figcaption>${villa.floors.find(f => f.id === d.floor).name}平面 · 示例尺寸</figcaption></figure>
        <ul class="facet-list">${floorFacets.map(f => `<li><button class="facet" data-act="facet" data-v="${f.id}" aria-pressed="${d.facets.includes(f.id)}"><span class="check">${icon('check', 14)}</span><span class="facet-text"><b>${f.name}</b><small>${kindName[f.kind]} · ${f.kind === 'stair' ? `${f.steps} 级踏步` : `${f.size[0].toFixed(1)} × ${f.size[1].toFixed(1)} m`}</small></span></button></li>`).join('')}</ul>
        <p class="tally">已选 ${d.facets.length} 处饰面 · ${villa.floors.map(fl => `${fl.name} ${count(fl.id)}`).join(' / ')}</p>`;
    }
    dock = `<button class="btn ghost" data-act="step" data-v="1">上一步</button><button class="btn primary grow" data-act="step" data-v="3" ${assist ? (d.kinds.length ? '' : 'disabled') : (d.facets.length ? '' : 'disabled')}>下一步：挑选石材 ${icon('arrow', 18)}</button>`;
  } else {
    body = `${stepper(3)}<h1 class="title">挑选石材与<em>偏好</em></h1>
      <p class="lede">来自${workspace.name}的石材库。最多选 3 款，方案会按选择顺序优先使用。</p>
      <div class="label-row"><h2 class="h3">石材库</h2><span class="tag">示意素材</span></div>
      <div class="stone-grid">${stones.map(s => { const n = d.stones.indexOf(s.id) + 1; return `<button class="stone" data-act="stone" data-v="${s.id}" aria-pressed="${n > 0}"><img src="${swatchURL(s.id)}" alt=""><span class="stone-name">${s.name}</span><small>${s.note}</small>${n ? `<i class="order">${n}</i>` : ''}</button>`; }).join('')}</div>
      <p class="tally">${d.stones.length ? `已选 ${d.stones.map(id => stoneById[id].name).join('、')}` : '未选择时，由企业按空间推荐'}</p>
      <h2 class="h3">整体色调</h2>
      <div class="chips" role="radiogroup" aria-label="整体色调">${['浅色', '暖色', '深色', '不确定'].map(t => `<button class="chip" role="radio" data-act="tone" data-v="${t}" aria-checked="${d.tone === t}">${t}</button>`).join('')}</div>
      <h2 class="h3">铺法偏好 <small>可多选</small></h2>
      <div class="chips glyphs" role="group" aria-label="铺法偏好">${layouts.map(l => `<button class="chip" data-act="layoutpref" data-v="${l.id}" aria-pressed="${d.layouts.includes(l.id)}">${layoutGlyph(l.id, 22)}${l.name}</button>`).join('')}</div>
      <h2 class="h3">波打线</h2>
      <div class="chips" role="radiogroup" aria-label="波打线">${[['yes', '要'], ['no', '不要'], ['auto', '由方案决定']].map(([v, t]) => `<button class="chip" role="radio" data-act="border" data-v="${v}" aria-checked="${d.border === v}">${t}</button>`).join('')}</div>
      <label class="field"><span>补充说明（选填）</span><textarea id="note" rows="3" maxlength="200" placeholder="例如：客厅想更大气；家里有老人，楼梯要防滑。">${esc(d.note)}</textarea></label>`;
    dock = `<button class="btn ghost" data-act="step" data-v="2">上一步</button><button class="btn primary grow" data-act="submit">提交方案需求</button>`;
  }
  return {html: shell(`<section class="wizard">${body}</section>`, {back: '/', dock}), after(root) {
    root.querySelector('#note')?.addEventListener('input', e => { d.note = e.target.value; save(); });
    root.querySelector('#file')?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) pickFile(f.name); });
    if (d.file?.status === 'converting') later(() => { d.file.status = 'ready'; save(); render(); }, 2400);
  }};
}
function pickFile(name) {
  const dxf = /\.dxf$/i.test(name);
  Object.assign(state.draft, {source: 'upload', file: {name, kind: dxf ? 'dxf' : 'other', status: dxf ? 'converting' : 'assist'}});
  save(); render();
}
function submitDraft() {
  const d = state.draft;
  const assist = d.source === 'upload' && d.file.kind === 'other';
  const facetIds = assist ? defaultFacets : d.facets;
  const p = newProject({
    name: d.source === 'sample' ? '示例别墅 · 我的方案需求' : d.file.name.replace(/\.[^.]+$/, '') + ' · 我的方案需求',
    source: d.source, fileName: d.file?.name, facets: facetIds, kinds: d.kinds, stones: d.stones, tone: d.tone, layoutsPref: d.layouts, border: d.border, note: d.note,
    schemes: makeSchemes(facetIds, d.stones), status: assist ? 'assist' : 'generating', next: d.source === 'sample' ? 'published' : 'review', genStart: Date.now(),
  });
  state.draft = freshDraft(); save(); go(`/project/${p.id}`);
}

// ---------- 页面：出图等待 / 待审核 / 需辅助转换 ----------
function requestSummary(p) {
  const rows = [
    ['户型', p.source === 'sample' ? '示例别墅（演示）' : esc(p.fileName)],
    ['饰面', p.status === 'assist' ? (p.kinds || []).map(k => ({floor: '各层地面', wall: '背景墙', stair: '楼梯踏面'}[k])).join('、') + '（待确认）' : `${p.facets.length} 处 · ${floorsOf(p).map(f => f.name).join('、')}`],
    ['石材', p.stones?.length ? p.stones.map(id => stoneById[id].name).join('、') : '由企业推荐'],
    ['偏好', [p.tone, (p.layoutsPref || []).map(l => layoutName[l]).join('、'), {yes: '要波打线', no: '不要波打线', auto: ''}[p.border]].filter(Boolean).join(' · ') || '未填写'],
  ];
  if (p.note) rows.push(['说明', esc(p.note)]);
  return `<dl class="summary">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}
function timeline(items) {
  return `<ol class="timeline">${items.map(([t, s, sub]) => `<li class="${s}"><i aria-hidden="true">${s === 'done' ? icon('check', 12) : ''}</i><div><b>${t}</b>${sub ? `<small>${sub}</small>` : ''}</div></li>`).join('')}</ol>`;
}
function waitView(p) {
  const total = 6000;
  return {html: shell(`
    <section class="status-page">
      ${chip('generating')}
      <h1 class="title">正在<em>排版出图</em></h1>
      <p class="lede">按你选择的 ${p.facets.length} 处饰面和石材，计算整块与切块，再渲染效果图。通常需要 1–3 分钟（原型中加速）。可以离开此页，完成后在「我的项目」查看。</p>
      <figure class="loom" aria-hidden="true"><svg viewBox="0 0 320 200">${Array.from({length: 9}, (_, i) => `<line class="lv" style="--d:${i * 90}ms" x1="${i * 40}" y1="0" x2="${i * 40}" y2="200"/>`).join('')}${Array.from({length: 6}, (_, i) => `<line class="lh" style="--d:${300 + i * 110}ms" x1="0" y1="${i * 40}" x2="320" y2="${i * 40}"/>`).join('')}</svg><span class="loom-pct" id="pct">0%</span></figure>
      <div class="bar-progress determinate"><i id="bar"></i></div>
      <ol class="steps-live" id="steps">${['读取空间与饰面', '计算铺贴排版与切块', '渲染效果图', p.next === 'review' ? '提交企业审核' : '整理方案'].map((t, i) => `<li data-i="${i}">${t}</li>`).join('')}</ol>
      <a class="btn ghost wide" href="#/projects">去我的项目</a>
    </section>`, {back: '/projects'}), after(root) {
    let raf;
    const tick = () => {
      const k = Math.min(1, (Date.now() - p.genStart) / total);
      root.querySelector('#bar').style.width = `${k * 100}%`;
      root.querySelector('#pct').textContent = `${Math.round(k * 100)}%`;
      root.querySelectorAll('#steps li').forEach(li => { const i = +li.dataset.i; li.className = k >= (i + 1) / 4 ? 'done' : k >= i / 4 ? 'now' : ''; });
      if (k >= 1) { p.status = p.next; save(); later(render, 350); return; }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }};
}
function reviewView(p) {
  return {html: shell(`
    <section class="status-page">
      ${chip('review')}
      <h1 class="title">方案已生成，<em>企业审核后发布</em></h1>
      <p class="lede">你的图纸由系统自动转换。为避免尺寸或饰面边界不准确的方案误导你，${workspace.name}会先核对，再发布给你。发布后会通知你，也可以在「我的项目」查看。</p>
      ${timeline([['提交方案需求', 'done', p.createdAt], ['图纸转换与排版出图', 'done', '3 个铺贴方案'], ['企业审核', 'now', '核对尺寸与饰面边界'], ['发布方案', '', '']])}
      <h2 class="h3">你的方案需求</h2>${requestSummary(p)}
      <div class="proto-op"><span>原型操作</span><button data-act="publish" data-v="${p.id}">模拟企业审核并发布</button></div>
    </section>`, {back: '/projects'})};
}
function assistView(p) {
  return {html: shell(`
    <section class="status-page">
      ${chip('assist')}
      <h1 class="title">图纸需要<em>辅助转换</em></h1>
      <p class="lede">「${esc(p.fileName)}」不是 DXF，系统不自动识别。${workspace.name}会协助转换图纸，与你确认楼层和饰面后，再出铺贴方案。</p>
      ${timeline([['提交方案需求', 'done', p.createdAt], ['企业辅助转换图纸', 'now', '通常 1–2 个工作日'], ['确认楼层与饰面', '', ''], ['排版出图并发布', '', '']])}
      <h2 class="h3">你的方案需求</h2>${requestSummary(p)}
      <div class="proto-op"><span>原型操作</span><button data-act="publish" data-v="${p.id}">模拟企业完成转换并发布</button></div>
    </section>`, {back: '/projects'})};
}

// ---------- 页面：方案结果（含分享预览） ----------
function resultView(p, {preview = false} = {}) {
  const floors = floorsOf(p);
  if (!floors.some(f => f.id === p.floor)) p.floor = floors[0].id;
  const fl = villa.floors.find(f => f.id === p.floor);
  const s = schemeOf(p), mf = mainFacet(p, p.floor);
  const view = p.view || 'image';
  const confirmed = p.status === 'confirmed' && p.confirmed;
  const roomName = fl.rooms.find(r => r.id === fl.scene.room).name;
  const rows = [['石材', fin => fin ? `<span class="sw" style="background-image:url(${swatchURL(fin.stone, 48)})"></span>${stoneById[fin.stone].name}` : '—'],
    ['规格', fin => fin?.spec ? specLabel(fin.spec) : '—'], ['铺法', fin => fin?.layout ? layoutName[fin.layout] : '—'],
    ['波打线', fin => !fin?.layout ? '—' : fin.border ? stoneById[fin.borderStone].name : '无']];
  const hints = p.facets.filter(id => facetById[id].floor === p.floor).flatMap(id => checkFinish(id, s.finishes[id]));
  const base = preview ? `/share/${p.token}` : `/project/${p.id}`;
  const dock = preview
    ? `<button class="btn ghost grow" data-act="gate">${icon('lock', 16)} 调整</button><button class="btn primary grow" data-act="gate">${icon('lock', 16)} 确认方案</button>`
    : confirmed
      ? `<a class="btn ghost grow" href="#/project/${p.id}/adjust">继续调整</a><a class="btn primary grow" href="#/project/${p.id}/done">查看确认</a>`
      : `<a class="btn ghost grow" href="#/project/${p.id}/adjust">调整</a><a class="btn primary grow" href="#/project/${p.id}/confirm">确认方案 ${s.id}</a>`;
  return {html: shell(`
    ${preview ? `<div class="preview-banner">${icon('eye', 18)}<div><b>${esc(p.member.split(' · ')[0])}分享给你的方案</b><span>${workspace.name} · 仅预览，登录并绑定后可调整和确认</span></div></div>` : ''}
    <section class="result">
      <div class="result-head">
        <h1 class="title small">${title2(...splitName(p.name))}</h1>
        <p class="meta">${chip(p.status)}<span>${p.schemes.length} 个铺贴方案 · ${p.facets.length} 处饰面</span></p>
        ${confirmed ? `<p class="confirmed-line">${icon('check', 16)} 你已确认 方案 ${p.confirmed.scheme} · 修订 ${p.confirmed.revision}</p>` : ''}
      </div>
      ${floors.length > 1 ? `<div class="seg" role="tablist" aria-label="楼层">${floors.map(f => `<button role="tab" aria-selected="${f.id === p.floor}" data-act="floor" data-v="${f.id}">${f.name}</button>`).join('')}</div>` : ''}
      <figure class="plate">
        <div class="plate-top"><span>${fl.name} · ${roomName}</span>
          <div class="toggle" role="group" aria-label="查看方式"><button data-act="view" data-v="image" aria-pressed="${view === 'image'}">${icon('image', 15)}效果图</button><button data-act="view" data-v="3d" aria-pressed="${view === '3d'}">${icon('cube', 15)}3D 查看</button></div></div>
        ${view === 'image' ? `<div class="plate-img"><img data-render="${p.floor}" data-pid="${p.id}" alt="方案 ${s.id} ${fl.name}${roomName}铺贴效果图（示意）"></div>`
          : `<div class="viewer" id="viewer"></div><div class="viewer-modes" role="group" aria-label="3D 范围"><button data-act="vmode" data-v="all" aria-pressed="${(p.vmode || 'all') === 'all'}">整栋</button><button data-act="vmode" data-v="floor" aria-pressed="${p.vmode === 'floor'}">${fl.name}</button></div>`}
        <figcaption><span>方案 ${s.id} · 修订 ${p.revisions[s.id]}</span><span>${view === 'image' ? '效果图' : '简化体块 · 拖动旋转'} · 示意素材</span></figcaption>
      </figure>
      <div class="rail" role="group" aria-label="切换铺贴方案">${p.schemes.map(x => { const fin = x.finishes[mf]; return `<button class="rail-item" data-act="scheme" data-v="${x.id}" aria-pressed="${x.id === s.id}"><span class="rail-name">${x.id}<b>${x.title}</b></span><small>${fin ? `${stoneById[fin.stone].name}<br>${fin.spec ? specLabel(fin.spec) : '整板'}<br>${layoutName[fin.layout] || ''}` : ''}</small></button>`; }).join('')}</div>
      <p class="scheme-line">${esc(s.line)}</p>
      <section class="compare">
        <h2 class="h3">${facetById[mf].name}：三个方案的差异</h2>
        <table><thead><tr><th scope="col"><span class="sr-only">项目</span></th>${p.schemes.map(x => `<th scope="col" class="${x.id === s.id ? 'on' : ''}">方案 ${x.id}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(([label, fn]) => { const vals = p.schemes.map(x => fn(x.finishes[mf])); const same = vals.every(v => v === vals[0]); return `<tr><th scope="row">${label}${same ? '<small>相同</small>' : ''}</th>${vals.map((v, i) => `<td class="${p.schemes[i].id === s.id ? 'on' : ''}${same ? ' same' : ''}">${v}</td>`).join('')}</tr>`; }).join('')}</tbody></table>
      </section>
      <section class="scheme-facets">
        <h2 class="h3">方案 ${s.id} · ${fl.name}饰面</h2>
        <ul>${p.facets.filter(id => facetById[id].floor === p.floor).map(id => { const fin = s.finishes[id]; return `<li><span class="sw big" style="background-image:url(${swatchURL(fin.stone, 64)})"></span><div><b>${facetById[id].name}</b><small>${finishLine(id, fin)}</small></div></li>`; }).join('')}</ul>
        ${hints.length ? `<div class="checks">${hints.map(h => `<p class="alert ${h.level === 'conflict' ? 'danger' : 'hint'}">${icon(h.level === 'conflict' ? 'alert' : 'info', 16)}<span><b>${h.level === 'conflict' ? '冲突' : '提示'}</b>${h.text}</span></p>`).join('')}</div>` : ''}
      </section>
    </section>`, {back: preview ? '/' : '/projects', dock}), after(root) {
    if (view === '3d') return mountViewer(root.querySelector('#viewer'), s, p.floor, p.vmode || 'all');
  }};
}
const splitName = name => { const i = name.indexOf(' · '); return i > 0 ? [name.slice(0, i + 3), name.slice(i + 3)] : [name, '']; };

// ---------- 页面：选项式调整 ----------
function adjustView(p) {
  const s = schemeOf(p);
  if (!p.work || p.work.scheme !== s.id) p.work = {scheme: s.id, finishes: clone(s.finishes), history: [], rendering: false, justRendered: false};
  const w = p.work;
  const floors = floorsOf(p);
  const fl = villa.floors.find(f => f.id === p.floor);
  const floorFacets = p.facets.filter(id => facetById[id].floor === p.floor);
  if (!floorFacets.includes(p.adj)) p.adj = mainFacet(p, p.floor);
  const fid = p.adj, f = facetById[fid], fin = w.finishes[fid];
  const pending = p.facets.filter(id => JSON.stringify(w.finishes[id]) !== JSON.stringify(s.finishes[id]));
  const checks = [...new Set([fid, ...pending])].flatMap(id => checkFinish(id, w.finishes[id]).map(c => ({...c, id})));
  const conflict = checks.some(c => c.level === 'conflict');
  const specs = f.kind === 'wall' ? wallSpecs : floorSpecs;
  const lays = f.kind === 'wall' ? layouts.filter(l => ['straight', 'running'].includes(l.id)) : layouts;
  const changes = w.history.map(h => h.label);
  const dock = w.rendering ? `<button class="btn primary wide" disabled>重新出图中…</button>`
    : w.justRendered && !pending.length ? `<a class="btn ghost grow" href="#/project/${p.id}">回到方案对比</a><a class="btn primary grow" href="#/project/${p.id}/confirm">确认修订 ${p.revisions[s.id]}</a>`
      : `<button class="btn primary wide" data-act="rerender" ${pending.length && !conflict ? '' : 'disabled'}>${conflict ? '有冲突，暂不能出图' : pending.length ? `重新出图（${pending.length} 处修改）` : '选择要调整的选项'}</button>`;
  return {html: shell(`
    <section class="adjust">
      <div class="adjust-head">
        <h1 class="title small">调整<em>方案 ${s.id} · ${s.title}</em></h1>
        <button class="btn ghost small" data-act="undo" ${w.history.length && !w.rendering ? '' : 'disabled'}>${icon('undo', 16)} 撤回${w.history.length ? ` ${w.history.length}` : ''}</button>
      </div>
      <p class="lede small">只能在给定选项内调整：换石材、规格、铺法和波打线。每次出图生成新的修订，原方案保留。</p>
      <figure class="plate compact ${w.rendering ? 'is-rendering' : ''}">
        <div class="plate-img"><img data-render="${p.floor}" data-pid="${p.id}" alt="当前修订效果图（示意）"></div>
        ${w.rendering ? `<div class="rendering" role="status"><b>重新出图中</b><span>按你的调整重新排版、渲染 · 约 20 秒（原型加速）</span><div class="bar-progress"><i style="animation-duration:2.6s"></i></div></div>` : ''}
        <figcaption><span>方案 ${s.id} · 修订 ${p.revisions[s.id]}${pending.length && !w.rendering ? ' · 有未出图的修改' : ''}</span><span>示意素材</span></figcaption>
      </figure>
      ${w.justRendered && !pending.length ? `<p class="alert ok" role="status">${icon('check', 16)}<span>已生成修订 ${p.revisions[s.id]}。可以确认，或继续调整。</span></p>` : ''}
      ${floors.length > 1 ? `<div class="seg" role="tablist" aria-label="楼层">${floors.map(x => `<button role="tab" aria-selected="${x.id === p.floor}" data-act="floor" data-v="${x.id}">${x.name}</button>`).join('')}</div>` : ''}
      <div class="facet-tabs" role="tablist" aria-label="${fl.name}饰面">${floorFacets.map(id => `<button role="tab" aria-selected="${id === fid}" data-act="adjfacet" data-v="${id}">${facetById[id].name.replace(/（.*）/, '')}${pending.includes(id) ? '<i class="dot" aria-label="已修改"></i>' : ''}</button>`).join('')}</div>
      <fieldset class="opt" ${w.rendering ? 'disabled' : ''}><legend class="h3">石材 <span class="tag">示意素材</span></legend>
        <div class="swatch-row">${stones.map(st => `<button class="swatch" data-act="set" data-k="stone" data-v="${st.id}" aria-pressed="${fin.stone === st.id}"><img src="${swatchURL(st.id, 96)}" alt=""><span>${st.name}</span></button>`).join('')}</div></fieldset>
      ${f.kind === 'stair' ? `<p class="small muted">楼梯踏面使用整板踏步，只调整石材。</p>` : `
      <fieldset class="opt" ${w.rendering ? 'disabled' : ''}><legend class="h3">规格 <small>毫米</small></legend>
        <div class="chips">${specs.map(sp => `<button class="chip" data-act="set" data-k="spec" data-v="${sp.id}" aria-pressed="${fin.spec === sp.id}">${specLabel(sp.id)}${sp.strip ? '<small>条板</small>' : ''}</button>`).join('')}</div></fieldset>
      <fieldset class="opt" ${w.rendering ? 'disabled' : ''}><legend class="h3">铺法</legend>
        <div class="chips glyphs">${lays.map(l => `<button class="chip" data-act="set" data-k="layout" data-v="${l.id}" aria-pressed="${fin.layout === l.id}">${layoutGlyph(l.id, 22)}${l.name}</button>`).join('')}</div></fieldset>
      ${f.kind === 'floor' ? `<fieldset class="opt" ${w.rendering ? 'disabled' : ''}><legend class="h3">波打线</legend>
        <div class="switch-row"><button class="switch" role="switch" aria-checked="${!!fin.border}" data-act="set" data-k="border" data-v="${!fin.border}"><i></i></button><span>${fin.border ? `开 · ${stoneById[fin.borderStone].name}收边，宽 20 cm` : '关 · 石材直接铺到墙边'}</span></div></fieldset>` : ''}`}
      ${checks.length ? `<section class="checks" aria-label="排版校验">${checks.map(c => `<p class="alert ${c.level === 'conflict' ? 'danger' : 'hint'}">${icon(c.level === 'conflict' ? 'alert' : 'info', 16)}<span><b>${c.level === 'conflict' ? '冲突 · 不能出图' : '提示 · 可以继续'}</b>${c.text}</span></p>`).join('')}</section>` : ''}
      ${changes.length ? `<section class="changes"><h2 class="h3">本次修改</h2><ol>${changes.map(t => `<li>${t}</li>`).join('')}</ol></section>` : ''}
    </section>`, {back: `/project/${p.id}`, dock}), after(root) {
    if (w.rendering) later(() => {
      const sc = schemeOf(p);
      sc.finishes = clone(w.finishes); p.revisions[sc.id]++; w.rendering = false; w.justRendered = true; save(); render();
    }, 2600);
  }};
}
function setOption(p, k, v) {
  const w = p.work, fid = p.adj, fin = w.finishes[fid], f = facetById[fid];
  const before = clone(fin);
  if (k === 'border') fin.border = v === 'true';
  else fin[k] = v;
  if (k === 'stone' && f.kind === 'floor') fin.borderStone = ['heijin', 'feiwang', 'huimu'].includes(v) ? 'yashi' : 'heijin';
  if (JSON.stringify(before) === JSON.stringify(fin)) return;
  const fmt = {stone: x => stoneById[x.stone].name, spec: x => specLabel(x.spec), layout: x => layoutName[x.layout], border: x => x.border ? '有波打线' : '无波打线'}[k];
  w.history.push({fid, before, label: `${f.name}：${fmt(before)} → ${fmt(fin)}`});
  w.justRendered = false;
}

// ---------- 页面：确认 + 留言 / 请求联系 ----------
function confirmView(p) {
  const s = schemeOf(p);
  const c = p.confirmDraft ||= {message: '', contact: true, time: '下午'};
  return {html: shell(`
    <section class="confirm">
      <h1 class="title">确认<em>方案 ${s.id} · 修订 ${p.revisions[s.id]}</em></h1>
      <p class="lede">确认后，${workspace.name}会收到这一版铺贴方案。之后如果再调整，需要重新确认。</p>
      <figure class="plate compact"><div class="plate-img"><img data-render="${p.floor}" data-pid="${p.id}" alt="确认的方案效果图（示意）"></div><figcaption><span>方案 ${s.id} · ${s.title}</span><span>示意素材</span></figcaption></figure>
      <details class="spec-list" open><summary class="h3">饰面清单 · ${p.facets.length} 处</summary>
        ${floorsOf(p).map(fl => `<h3>${fl.name}</h3><ul>${p.facets.filter(id => facetById[id].floor === fl.id).map(id => `<li><b>${facetById[id].name}</b><span>${finishLine(id, s.finishes[id])}</span></li>`).join('')}</ul>`).join('')}
      </details>
      <label class="field"><span>给企业留言（选填）</span><textarea id="msg" rows="3" maxlength="300" placeholder="例如：二层想再看看深色石材；希望周末看样品。">${esc(c.message)}</textarea></label>
      <div class="contact">
        <div class="switch-row"><button class="switch" role="switch" aria-checked="${c.contact}" data-act="contact"><i></i></button><span><b>请企业联系我</b></span></div>
        ${c.contact ? `<p class="small muted">联系电话 ${maskPhone(state.session)}（登录手机号）</p>
        <div class="chips" role="radiogroup" aria-label="方便联系的时间">${['上午', '下午', '晚上', '都可以'].map(t => `<button class="chip" role="radio" data-act="ctime" data-v="${t}" aria-checked="${c.time === t}">${t}</button>`).join('')}</div>` : ''}
      </div>
    </section>`, {back: `/project/${p.id}`, dock: `<button class="btn primary wide" data-act="confirm">确认方案 ${s.id} · 修订 ${p.revisions[s.id]}</button>`}), after(root) {
    root.querySelector('#msg').addEventListener('input', e => { c.message = e.target.value; save(); });
  }};
}
function doneView(p) {
  const c = p.confirmed;
  if (!c) { go(`/project/${p.id}`); return null; }
  return {html: shell(`
    <section class="status-page done">
      <span class="seal" aria-hidden="true">${icon('check', 30)}</span>
      <h1 class="title">已确认<em>方案 ${c.scheme} · 修订 ${c.revision}</em></h1>
      <p class="lede">${workspace.name}已收到你的确认${c.message ? '和留言' : ''}。${c.contact ? `企业成员会在${c.time === '都可以' ? '方便时' : c.time}联系 ${maskPhone(state.session)}。` : '你没有请求联系，可以随时回到这里留言。'}</p>
      ${c.message ? `<blockquote class="quote">${esc(c.message)}</blockquote>` : ''}
      ${timeline([['确认方案', 'done', c.at], ['企业跟进', 'now', c.contact ? '电话联系' : '查看留言'], ['看样与深化', '', '']])}
      <div class="stack"><a class="btn primary wide" href="#/projects">我的项目</a><a class="btn ghost wide" href="#/project/${p.id}">回到方案</a></div>
    </section>`, {back: `/project/${p.id}`})};
}

// ---------- 页面：分享与绑定 ----------
function linkFailView(share) {
  const revoked = share.status === 'revoked';
  return {html: shell(`
    <section class="status-page fail">
      <span class="seal danger" aria-hidden="true">${icon(revoked ? 'link' : 'clock', 28)}</span>
      <h1 class="title">${revoked ? '这个分享链接<em>已被撤销</em>' : '这个分享链接<em>已过期</em>'}</h1>
      <p class="lede">${revoked ? `${workspace.name}已撤销这个链接，可能是发错了对象或已重新分享。` : `链接有效期至 ${share.expires}。`}请联系为你制作方案的企业成员，获取新的分享链接。</p>
      <p class="small muted">如果项目已经绑定到你的账号，可以在「我的项目」继续查看。</p>
      <div class="stack"><a class="btn primary wide" href="#/">回到企业首页</a>${state.session ? `<a class="btn ghost wide" href="#/projects">我的项目</a>` : ''}</div>
    </section>`, {back: '/'})};
}
function shareView(token, q) {
  const share = shares[token];
  if (!share) return linkFailView({status: 'revoked'});
  if (share.status !== 'active') return linkFailView(share);
  const bound = state.projects.find(p => p.token === token);
  if (bound && state.binds[token]?.status === 'bound') { go(`/project/${bound.id}`); return null; }
  const p = sharedPreview(token);
  Object.assign(p, state.previewState?.[token] || {});
  const v = resultView(p, {preview: true});
  return {html: v.html, after(root) {
    const off = v.after?.(root);
    if (q.gate) openGate(token);
    return off;
  }, preview: p};
}
function openGate(token) {
  const share = shares[token];
  sheet(`<h2 class="sheet-title">调整和确认<em>需要登录</em></h2>
    <p>分享链接只能预览。调整、确认或留言需要验证手机号，并把这个项目绑定到你的账号；转发出去的链接不能让别人修改你的方案。</p>
    <ul class="sheet-list"><li>${icon('phone', 18)}<span><b>${share.mode === 'phone' ? '企业指定了手机号' : '企业会单独告诉你绑定码'}</b>${share.mode === 'phone' ? '用该手机号登录即自动绑定。' : '登录后输入 6 位一次性绑定码。'}</span></li><li>${icon('user', 18)}<span><b>都不满足？</b>可以提交绑定申请，由企业批准。</span></li></ul>
    <div class="stack"><button class="btn primary wide" data-act="gate-login" data-v="${token}">手机号登录</button><button class="btn ghost wide" data-act="sheet-close">继续预览</button></div>`);
}
function bindView(token, q) {
  const share = shares[token];
  if (!share || share.status !== 'active') return linkFailView(share || {status: 'revoked'});
  if (!state.session) { go(`/login?next=/bind/${token}`); return null; }
  const b = state.binds[token] ||= {status: 'none', tries: 5, error: null, code: ''};
  const back = `/share/${token}`;
  if (b.status === 'none' && share.mode === 'phone' && state.session === share.phone) bindNow(token);
  if (b.status === 'bound') {
    const p = state.projects.find(x => x.token === token);
    return {html: shell(`<section class="status-page ok">
      <span class="seal" aria-hidden="true">${icon('check', 30)}</span>
      <h1 class="title">已绑定到<em>你的账号</em></h1>
      <p class="lede">${b.how === 'phone' ? '你登录的手机号与企业分享时指定的一致，项目已自动绑定。' : b.how === 'code' ? '绑定码验证通过，项目已绑定。绑定码已失效，不能再次使用。' : '企业已批准你的绑定申请。'}现在可以调整、确认和留言。</p>
      <dl class="summary"><div><dt>项目</dt><dd>${esc(p.name)}</dd></div><div><dt>账号</dt><dd>${maskPhone(state.session)}</dd></div><div><dt>分享人</dt><dd>${esc(sharedProject.member)}</dd></div></dl>
      <div class="stack"><a class="btn primary wide" href="#/project/${p.id}">查看并调整方案</a><a class="btn ghost wide" href="#/projects">我的项目</a></div></section>`, {back: '/projects'})};
  }
  if (b.status === 'pending') {
    return {html: shell(`<section class="status-page">
      <span class="status review">等待企业批准</span>
      <h1 class="title">绑定申请<em>已提交</em></h1>
      <p class="lede">${workspace.name}核对你的身份后会批准绑定。批准前你仍可预览方案；批准后，项目会出现在「我的项目」中，可以调整和确认。</p>
      ${timeline([['提交绑定申请', 'done', `${maskPhone(state.session)}${b.name ? ' · ' + esc(b.name) : ''}`], ['企业成员核对', 'now', '通常在 1 个工作日内'], ['绑定到你的账号', '', ''],])}
      <div class="stack"><a class="btn ghost wide" href="#${back}">继续预览方案</a><a class="btn ghost wide" href="#/projects">我的项目</a></div>
      <div class="proto-op"><span>原型操作</span><button data-act="approve" data-v="${token}">模拟企业批准</button></div></section>`, {back})};
  }
  if (q.apply) {
    return {html: shell(`<section class="form-page">
      <h1 class="title">提交<em>绑定申请</em></h1>
      <p class="lede">企业成员核对后批准，项目才会绑定到你的账号。请留下称呼，方便企业确认是你。</p>
      <dl class="summary"><div><dt>项目</dt><dd>${esc(sharedProject.name)}</dd></div><div><dt>手机号</dt><dd>${maskPhone(state.session)}</dd></div></dl>
      <label class="field"><span>称呼</span><input id="aname" maxlength="20" placeholder="例如：王女士" value="${esc(b.name || '')}"></label>
      <label class="field"><span>说明（选填）</span><textarea id="anote" rows="3" maxlength="200" placeholder="例如：方案顾问上周来家里量过尺寸。"></textarea></label>
    </section>`, {back: `/bind/${token}`, dock: `<button class="btn primary wide" data-act="apply" data-v="${token}">提交绑定申请</button>`}), after(root) {
      root.querySelector('#aname').addEventListener('input', e => { b.name = e.target.value; save(); });
    }};
  }
  if (share.mode === 'phone') {
    return {html: shell(`<section class="status-page fail">
      <span class="seal danger" aria-hidden="true">${icon('phone', 26)}</span>
      <h1 class="title">手机号与分享<em>指定的不一致</em></h1>
      <p class="lede">这个项目是企业定向分享给另一个手机号的。为保护方案，用 ${maskPhone(state.session)} 登录不能直接绑定，转发的链接只能预览。</p>
      <div class="options">
        <button class="option" data-act="relogin" data-v="${token}">${icon('logout', 20)}<span><b>换一个手机号登录</b><small>如果企业分享时填写的是你的另一个号码</small></span>${icon('chevron', 16)}</button>
        <a class="option" href="#/bind/${token}?apply=1">${icon('user', 20)}<span><b>提交绑定申请</b><small>由企业成员核对后批准</small></span>${icon('chevron', 16)}</a>
      </div>
      <a class="btn ghost wide" href="#${back}">返回预览</a></section>`, {back})};
  }
  const msg = {wrong: `绑定码不正确，请核对后重试。还可尝试 ${b.tries} 次。`, locked: '尝试次数过多，这个绑定码已锁定。请联系企业成员重新生成，或提交绑定申请。', format: '绑定码为 6 位字母或数字。'}[b.error];
  return {html: shell(`<section class="form-page">
    <h1 class="title">输入<em>绑定码</em></h1>
    <p class="lede">企业成员会通过电话、微信等方式单独告诉你 6 位绑定码。绑定码只能使用一次，有效期至 ${share.expires}。</p>
    <label class="field"><span>绑定码</span><input id="bcode" class="code-input" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="6 位绑定码" value="${esc(b.code)}" ${b.error === 'locked' ? 'disabled' : ''}></label>
    <p class="demo-inline">演示绑定码 <b>${share.code}</b> <button data-act="bfill" data-v="${token}">填入</button></p>
    ${msg ? `<div class="alert danger" role="alert">${icon('alert', 18)}<span>${msg}</span></div>` : ''}
    <a class="text-link" href="#/bind/${token}?apply=1">没有绑定码？提交绑定申请 ${icon('chevron', 14)}</a>
  </section>`, {back, dock: `<button class="btn primary wide" data-act="bcode" data-v="${token}" ${b.error === 'locked' ? 'disabled' : ''}>绑定到我的账号</button>`}), after(root) {
    root.querySelector('#bcode').addEventListener('input', e => { b.code = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); e.target.value = b.code; save(); });
  }};
}
function bindNow(token, how = 'phone') {
  const b = state.binds[token];
  Object.assign(b, {status: 'bound', how, error: null});
  if (!state.projects.some(p => p.token === token)) {
    const p = sharedPreview(token);
    p.id = 'shared-' + token;
    state.projects.push(p);
  }
  save();
}

// ---------- 页面：我的项目 ----------
function projectsView() {
  if (!state.session) { go('/login?next=/projects'); return null; }
  const mine = state.projects.filter(p => p.origin === 'self');
  const shared = state.projects.filter(p => p.origin === 'shared');
  const pending = Object.entries(state.binds).filter(([, b]) => b.status === 'pending');
  const row = p => `<li><a class="proj" href="#/project/${p.id}">
      <span class="proj-thumb">${['published', 'confirmed'].includes(p.status) ? `<img data-render="${mainFacetFloor(p)}" data-pid="${p.id}" data-w="360" data-h="280" alt="">` : planSVG('f1', p.status === 'assist' ? [] : p.facets, {small: true})}</span>
      <span class="proj-text"><b>${esc(p.name)}</b>${chip(p.status)}<small>${p.status === 'assist' ? '等待企业转换图纸' : p.status === 'generating' ? '正在排版出图' : p.status === 'review' ? '企业审核后发布' : p.status === 'confirmed' ? `已确认 方案 ${p.confirmed.scheme} · 修订 ${p.confirmed.revision}` : `${p.schemes.length} 个方案 · ${p.facets.length} 处饰面`}</small></span>${icon('chevron', 16)}</a></li>`;
  return {html: shell(`
    <section class="projects">
      <h1 class="title">我的<em>项目</em></h1>
      <p class="account">${icon('phone', 16)}<span>${maskPhone(state.session)}</span><button data-act="logout">退出登录</button></p>
      <p class="lede small">只显示你自己提交的，以及已绑定到你账号的项目。</p>
      ${!mine.length && !shared.length && !pending.length ? `<div class="empty"><h2 class="h2">还没有项目</h2><p>提交户型和石材偏好，得到第一份铺贴方案；或打开企业发给你的分享链接。</p><button class="btn primary" data-act="start">提交方案需求</button></div>` : `
      <h2 class="h3 group">我提交的 <small>${mine.length}</small></h2>
      ${mine.length ? `<ul class="proj-list">${mine.map(row).join('')}</ul>` : `<p class="muted small none">还没有自己提交的方案需求。</p>`}
      <h2 class="h3 group">企业分享给我的 <small>${shared.length + pending.length}</small></h2>
      <ul class="proj-list">${shared.map(row).join('')}${pending.map(([token]) => `<li><a class="proj" href="#/bind/${token}"><span class="proj-thumb lock">${icon('lock', 22)}</span><span class="proj-text"><b>${esc(sharedProject.name)}</b><span class="status review">等待企业批准</span><small>绑定申请已提交，批准后可调整和确认</small></span>${icon('chevron', 16)}</a></li>`).join('')}</ul>
      ${!shared.length && !pending.length ? `<p class="muted small none">打开企业分享的链接并完成绑定后，项目会出现在这里。</p>` : ''}`}
    </section>`, {back: '/', dock: mine.length || shared.length ? `<button class="btn primary wide" data-act="start">${icon('plus', 18)} 提交新的方案需求</button>` : ''})};
}
const mainFacetFloor = p => floorsOf(p)[0]?.id || 'f1';

function projectView(id, sub) {
  const p = projectById(id);
  if (!p) return {html: shell(`<section class="status-page"><h1 class="title">找不到<em>这个项目</em></h1><p class="lede">项目不存在，或没有绑定到你的账号。</p><a class="btn primary wide" href="#/projects">我的项目</a></section>`)};
  if (!state.session) { go(`/login?next=/project/${id}${sub ? '/' + sub : ''}`); return null; }
  if (p.status === 'generating') return waitView(p);
  if (p.status === 'review') return reviewView(p);
  if (p.status === 'assist') return assistView(p);
  if (sub === 'adjust') return adjustView(p);
  if (sub === 'confirm') return confirmView(p);
  if (sub === 'done') return doneView(p);
  return resultView(p);
}

// ---------- 底部弹层 ----------
function sheet(html) {
  let d = document.querySelector('#sheet');
  d.innerHTML = `<div class="sheet-body" tabindex="-1" autofocus>${html}</div>`;
  if (!d.open) d.showModal();
  animate(d.querySelector('.sheet-body'), [{transform: 'translateY(40px)', opacity: 0}, {transform: 'none', opacity: 1}], 520);
}
function closeSheet() { const d = document.querySelector('#sheet'); if (d.open) d.close(); }

// ---------- 原型审阅导航 ----------
function sampleProject(status, extra = {}) {
  const p = newProject({name: '示例别墅 · 我的方案需求', source: 'sample', facets: [...defaultFacets], kinds: ['floor', 'wall', 'stair'], stones: ['yashi', 'shaanna', 'huimu'], tone: '浅色', layoutsPref: ['straight', 'diagonal'], border: 'auto', note: '',
    schemes: makeSchemes(defaultFacets, ['yashi', 'shaanna', 'huimu']), status, next: 'published', genStart: Date.now(), ...extra});
  return p;
}
function seed({login = true} = {}) {
  state = initial();
  if (login) state.session = '13900139000';
}
const R = {
  'home': ['客户自助', '企业入口首页', () => { seed({login: false}); go('/'); }],
  'login': ['客户自助', '手机号登录', () => { seed({login: false}); go('/login?next=/new'); }],
  'login-sent': ['客户自助', '登录 · 演示验证码', () => { seed({login: false}); state.login.phone = '13900139000'; sendCode(); go('/login?next=/new'); }],
  'login-wrong': ['客户自助', '登录 · 验证码错误', () => { seed({login: false}); state.login.phone = '13900139000'; sendCode(); state.login.input = '123456'; state.login.attempts = 3; state.login.error = 'wrong'; go('/login?next=/new'); }],
  'login-expired': ['客户自助', '登录 · 验证码过期', () => { seed({login: false}); state.login.phone = '13900139000'; sendCode(); state.login.cooldownUntil = 0; state.login.expiresAt = Date.now() - 1; state.login.input = state.login.code; state.login.error = 'expired'; go('/login?next=/new'); }],
  'login-locked': ['客户自助', '登录 · 错误次数过多', () => { seed({login: false}); state.login.phone = '13900139000'; sendCode(); state.login.cooldownUntil = 0; state.login.attempts = 0; state.login.input = '000000'; state.login.error = 'locked'; go('/login?next=/new'); }],
  'login-rate': ['客户自助', '登录 · 获取过于频繁', () => { seed({login: false}); state.login.phone = '13900139000'; state.login.sends = Array(5).fill(Date.now()); state.login.error = 'rate'; go('/login?next=/new'); }],
  'new-1': ['客户自助', '提交需求 · 选择户型', () => { seed(); go('/new'); }],
  'new-dxf': ['客户自助', '上传 DXF · 自动转换中', () => { seed(); Object.assign(state.draft, {source: 'upload', file: {name: '别墅平面图.dxf', kind: 'dxf', status: 'converting'}}); go('/new'); }],
  'new-dxf-ready': ['客户自助', '上传 DXF · 转换完成', () => { seed(); Object.assign(state.draft, {source: 'upload', file: {name: '别墅平面图.dxf', kind: 'dxf', status: 'ready'}}); go('/new'); }],
  'new-assist': ['客户自助', '上传其他格式 · 需辅助转换', () => { seed(); Object.assign(state.draft, {source: 'upload', file: {name: '别墅平面图.pdf', kind: 'other', status: 'assist'}}); go('/new'); }],
  'new-2': ['客户自助', '提交需求 · 选择饰面', () => { seed(); Object.assign(state.draft, {source: 'sample', step: 2}); go('/new'); }],
  'new-3': ['客户自助', '提交需求 · 石材与偏好', () => { seed(); Object.assign(state.draft, {source: 'sample', step: 3, stones: ['yashi', 'shaanna'], tone: '浅色', layouts: ['straight', 'diagonal'], border: 'auto'}); go('/new'); }],
  'wait': ['客户自助', '出图等待', () => { seed(); const p = sampleProject('generating'); p.genStart = Date.now() - 2600; go(`/project/${p.id}`); }],
  'review': ['客户自助', '待审核 · 企业审核后发布', () => { seed(); const p = sampleProject('review', {source: 'upload', fileName: '别墅平面图.dxf', name: '别墅平面图 · 我的方案需求'}); go(`/project/${p.id}`); }],
  'assist': ['客户自助', '已提交 · 需辅助转换', () => { seed(); const p = sampleProject('assist', {source: 'upload', fileName: '别墅平面图.pdf', name: '别墅平面图 · 我的方案需求', stones: ['shaanna']}); go(`/project/${p.id}`); }],
  'result': ['客户自助', '方案结果 · 效果图', () => { seed(); const p = sampleProject('published'); go(`/project/${p.id}`); }],
  'result-b': ['客户自助', '方案结果 · 切换方案 B', () => { seed(); const p = sampleProject('published'); p.active = 'B'; go(`/project/${p.id}`); }],
  'result-f2': ['客户自助', '方案结果 · 二层', () => { seed(); const p = sampleProject('published'); p.floor = 'f2'; p.active = 'C'; go(`/project/${p.id}`); }],
  'result-3d': ['客户自助', '方案结果 · 3D 查看', () => { seed(); const p = sampleProject('published'); p.view = '3d'; go(`/project/${p.id}`); }],
  'adjust': ['客户自助', '选项式调整', () => { seed(); const p = sampleProject('published'); p.active = 'B'; go(`/project/${p.id}/adjust`); }],
  'adjust-hint': ['客户自助', '调整 · 窄条提示', () => { seed(); const p = sampleProject('published'); p.active = 'B'; p.adj = 'f1-living'; adjustView(p); setOption(p, 'layout', 'straight'); go(`/project/${p.id}/adjust`); }],
  'adjust-conflict': ['客户自助', '调整 · 冲突', () => { seed(); const p = sampleProject('published'); p.active = 'B'; p.adj = 'f1-living'; adjustView(p); setOption(p, 'stone', 'huimu'); setOption(p, 'layout', 'herringbone'); go(`/project/${p.id}/adjust`); }],
  'adjust-rendering': ['客户自助', '调整 · 重新出图中', () => { seed(); const p = sampleProject('published'); p.active = 'B'; p.adj = 'f1-living'; adjustView(p); setOption(p, 'stone', 'yudu'); p.work.rendering = true; go(`/project/${p.id}/adjust`); }],
  'adjust-done': ['客户自助', '调整 · 新修订已出图', () => { seed(); const p = sampleProject('published'); p.active = 'B'; p.adj = 'f1-living'; adjustView(p); setOption(p, 'stone', 'yudu'); schemeOf(p).finishes = clone(p.work.finishes); p.revisions.B = 2; p.work.justRendered = true; go(`/project/${p.id}/adjust`); }],
  'confirm': ['客户自助', '确认方案 · 留言与联系', () => { seed(); const p = sampleProject('published'); p.revisions.A = 2; p.confirmDraft = {message: '二层想再看看深色石材，希望周末看样品。', contact: true, time: '下午'}; go(`/project/${p.id}/confirm`); }],
  'done': ['客户自助', '已确认', () => { seed(); const p = sampleProject('confirmed'); p.revisions.A = 2; p.confirmed = {scheme: 'A', revision: 2, message: '二层想再看看深色石材，希望周末看样品。', contact: true, time: '下午', at: today()}; go(`/project/${p.id}/done`); }],
  'share': ['分享与绑定', '分享预览 · 未登录', () => { seed({login: false}); go('/share/direct'); }],
  'share-gate': ['分享与绑定', '点调整 / 确认 · 要求登录', () => { seed({login: false}); go('/share/direct?gate=1'); }],
  'share-login': ['分享与绑定', '分享流程 · 手机号登录', () => { seed({login: false}); state.login.phone = demoPhone; sendCode(); go('/login?next=/bind/direct'); }],
  'bind-auto': ['分享与绑定', '定向手机号 · 自动绑定成功', () => { seed({login: false}); state.session = demoPhone; go('/bind/direct'); }],
  'bind-mismatch': ['分享与绑定', '手机号不匹配', () => { seed(); go('/bind/direct'); }],
  'bind-code': ['分享与绑定', '输入一次性绑定码', () => { seed(); go('/bind/code'); }],
  'bind-code-wrong': ['分享与绑定', '绑定码错误', () => { seed(); state.binds.code = {status: 'none', tries: 4, error: 'wrong', code: 'K7M2Q8'}; go('/bind/code'); }],
  'bind-code-ok': ['分享与绑定', '绑定码验证成功', () => { seed(); state.binds.code = {status: 'none', tries: 5, error: null, code: ''}; bindNow('code', 'code'); go('/bind/code'); }],
  'bind-apply': ['分享与绑定', '提交绑定申请', () => { seed(); go('/bind/direct?apply=1'); }],
  'bind-pending': ['分享与绑定', '等待企业批准', () => { seed(); state.binds.direct = {status: 'pending', tries: 5, error: null, code: '', name: '王女士'}; go('/bind/direct'); }],
  'share-revoked': ['分享与绑定', '链接已撤销', () => { seed({login: false}); go('/share/revoked'); }],
  'share-expired': ['分享与绑定', '链接已过期', () => { seed({login: false}); go('/share/expired'); }],
  'projects': ['我的项目', '我的项目 · 有内容', () => {
    seed();
    sampleProject('assist', {source: 'upload', fileName: '老宅改造.pdf', name: '老宅改造 · 我的方案需求'});
    sampleProject('review', {source: 'upload', fileName: '别墅平面图.dxf', name: '别墅平面图 · 我的方案需求'});
    const c = sampleProject('confirmed'); c.confirmed = {scheme: 'A', revision: 2, contact: true, time: '下午', at: today()}; c.revisions.A = 2;
    state.binds.code = {status: 'none', tries: 5}; bindNow('code', 'code');
    state.binds.direct = {status: 'pending', name: '王女士'};
    go('/projects');
  }],
  'projects-empty': ['我的项目', '我的项目 · 空', () => { seed(); go('/projects'); }],
};
function openReview() {
  const groups = {};
  for (const [id, [g, label]] of Object.entries(R)) (groups[g] ||= []).push(`<li><button data-act="jump" data-v="${id}">${label}${icon('chevron', 14)}</button></li>`);
  sheet(`<div class="review-head"><h2 class="sheet-title">原型<em>审阅导航</em></h2><button class="icon-btn" data-act="sheet-close" aria-label="关闭">${icon('close', 20)}</button></div>
    <p>审阅用：直接跳到任一页面或状态。跳转会重置演示数据。这个入口不属于产品界面。</p>
    ${Object.entries(groups).map(([g, items]) => `<h3>${g}</h3><ul class="review-list">${items.join('')}</ul>`).join('')}
    <button class="btn ghost wide" data-act="reset">清空演示数据并回到首页</button>`);
}
window.__review = {ids: Object.keys(R), go: id => { closeSheet(); R[id][2](); save(); render(); }};

// ---------- 交互 ----------
function currentProject() {
  const {parts} = parse();
  if (parts[0] === 'project') return projectById(parts[1]);
  if (parts[0] === 'share') return currentPreview;
  return null;
}
let currentPreview = null;
const actions = {
  review: () => { openReview(); return false; },
  'sheet-close': () => { closeSheet(); return false; },
  jump: el => { window.__review.go(el.dataset.v); return false; },
  reset: () => { closeSheet(); state = initial(); save(); go('/'); },
  start: () => { state.draft = freshDraft(); save(); go(state.session ? '/new' : '/login?next=/new'); },
  send: () => { sendCode(); },
  fill: () => { state.login.input = state.login.code; },
  login: () => doLogin(parse().q.next),
  source: el => { state.draft.source = el.dataset.v; state.draft.file = null; },
  demofile: el => pickFile(el.dataset.v),
  step: el => { state.draft.step = +el.dataset.v; scrollTo(0, 0); },
  dfloor: el => { state.draft.floor = el.dataset.v; },
  facet: el => { const a = state.draft.facets, i = a.indexOf(el.dataset.v); i < 0 ? a.push(el.dataset.v) : a.splice(i, 1); },
  kind: el => { const a = state.draft.kinds, i = a.indexOf(el.dataset.v); i < 0 ? a.push(el.dataset.v) : a.splice(i, 1); },
  stone: el => { const a = state.draft.stones, i = a.indexOf(el.dataset.v); if (i >= 0) a.splice(i, 1); else if (a.length < 3) a.push(el.dataset.v); else toast('最多选择 3 款石材'); },
  tone: el => { state.draft.tone = el.dataset.v; },
  layoutpref: el => { const a = state.draft.layouts, i = a.indexOf(el.dataset.v); i < 0 ? a.push(el.dataset.v) : a.splice(i, 1); },
  border: el => { state.draft.border = el.dataset.v; },
  submit: submitDraft,
  publish: el => { const p = projectById(el.dataset.v); p.status = 'published'; toast('原型操作：企业已发布方案'); },
  floor: el => { const p = currentProject(); p.floor = el.dataset.v; keep(p); },
  view: el => { const p = currentProject(); p.view = el.dataset.v; keep(p); },
  vmode: el => { const p = currentProject(); p.vmode = el.dataset.v; keep(p); },
  scheme: el => { const p = currentProject(); if (p.active === el.dataset.v) return; p.active = el.dataset.v; keep(p); turn = true; },
  gate: () => { if (state.session) { go(`/bind/${currentPreview.token}`); return false; } openGate(currentPreview.token); return false; },
  'gate-login': el => { closeSheet(); go(`/login?next=/bind/${el.dataset.v}`); },
  adjfacet: el => { currentProject().adj = el.dataset.v; },
  set: el => setOption(currentProject(), el.dataset.k, el.dataset.v),
  undo: () => { const w = currentProject().work, h = w.history.pop(); if (h) { w.finishes[h.fid] = h.before; currentProject().adj = h.fid; w.justRendered = false; } },
  rerender: () => { currentProject().work.rendering = true; },
  contact: () => { const c = currentProject().confirmDraft; c.contact = !c.contact; },
  ctime: el => { currentProject().confirmDraft.time = el.dataset.v; },
  confirm: () => { const p = currentProject(), s = schemeOf(p); p.confirmed = {scheme: s.id, revision: p.revisions[s.id], ...p.confirmDraft, at: today()}; p.status = 'confirmed'; save(); go(`/project/${p.id}/done`); },
  relogin: el => { state.session = null; state.login = freshLogin(); delete state.binds[el.dataset.v]; save(); go(`/login?next=/bind/${el.dataset.v}`); },
  apply: el => { const b = state.binds[el.dataset.v]; if (!b.name?.trim()) { toast('请填写称呼'); return; } b.status = 'pending'; scrollTo(0, 0); go(`/bind/${el.dataset.v}`); },
  approve: el => { bindNow(el.dataset.v, 'apply'); toast('原型操作：企业已批准绑定'); },
  bfill: el => { state.binds[el.dataset.v].code = shares[el.dataset.v].code; state.binds[el.dataset.v].error = null; },
  bcode: el => {
    const t = el.dataset.v, b = state.binds[t];
    if (!/^[A-Z0-9]{6}$/.test(b.code)) { b.error = 'format'; return; }
    if (b.code !== shares[t].code) { b.tries--; b.error = b.tries > 0 ? 'wrong' : 'locked'; return; }
    bindNow(t, 'code');
  },
  logout: () => { state.session = null; save(); go('/'); },
};
// 分享预览的界面状态（楼层、方案、视图）只存本地，不影响绑定。
function keep(p) {
  if (p.id.startsWith('share-')) { state.previewState ||= {}; state.previewState[p.token] = {floor: p.floor, active: p.active, view: p.view, vmode: p.vmode}; }
}
let turn = false;

let toastTimer;
function toast(text) {
  const t = document.querySelector('#toast'); t.textContent = text; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
}
function animate(el, frames, duration = 700, delay = 0) {
  if (el && !reduced()) return el.animate(frames, {duration, delay, easing: ease, fill: 'backwards'});
}

// 效果图异步填充，避免阻塞首屏。
function fillRenders(root, turning) {
  const imgs = [...root.querySelectorAll('img[data-render]')];
  if (!imgs.length) return;
  imgs.forEach(img => img.closest('.plate-img, .cover-plate, .proj-thumb')?.classList.add('loading'));
  let i = 0;
  const step = () => {
    const img = imgs[i++];
    if (!img) return;
    let scheme;
    if (img.dataset.scheme) scheme = JSON.parse(img.dataset.scheme);
    else {
      const p = img.dataset.pid?.startsWith('share-') ? currentPreview : projectById(img.dataset.pid);
      scheme = schemeOf(p);
    }
    const url = renderImage(img.dataset.render, scheme, +(img.dataset.w || 960), +(img.dataset.h || 760));
    const box = img.closest('.plate-img, .cover-plate, .proj-thumb');
    if (url) {
      if (turning && box?.classList.contains('plate-img') && box.dataset.prev) {
        const old = new Image(); old.src = box.dataset.prev; old.className = 'turn-under'; box.prepend(old);
        img.src = url;
        const a = animate(img, [{clipPath: 'inset(0 100% 0 0)'}, {clipPath: 'inset(0 0 0 0)'}], 850);
        if (a) a.finished.then(() => old.remove()); else old.remove();
      } else img.src = url;
      box?.classList.remove('loading');
      if (box?.classList.contains('plate-img')) lastPlate = url;
    } else box?.classList.add('no-webgl');
    setTimeout(step, 0);
  };
  setTimeout(step, 30);
}
let lastPlate = null;

// ---------- 渲染 ----------
function view() {
  const {parts, q} = parse();
  currentPreview = null;
  switch (parts[0]) {
    case undefined: return homeView();
    case 'login': return loginView(q);
    case 'new': return newView();
    case 'projects': return projectsView();
    case 'project': return projectView(parts[1], parts[2]);
    case 'share': { const v = shareView(parts[1], q); if (v?.preview) currentPreview = v.preview; return v; }
    case 'bind': return bindView(parts[1], q);
    default: return homeView();
  }
}
function render() {
  const {path} = parse();
  const routeChanged = path !== lastPath;
  cleanup(); cleanup = () => {}; clearTimers();
  const y = scrollY;
  const prevPlate = lastPlate;
  const v = view();
  if (!v) return;
  const root = document.querySelector('#app');
  root.innerHTML = v.html;
  lastPath = path;
  const plateBox = root.querySelector('.plate-img');
  if (plateBox && prevPlate && !routeChanged) plateBox.dataset.prev = prevPlate;
  if (!routeChanged) { scrollTo(0, y); }
  else {
    scrollTo(0, 0);
    const kids = [...root.querySelectorAll('#page > section > *, #page > div, .dock')].slice(0, 9);
    kids.forEach((el, i) => animate(el, [{opacity: 0, transform: 'translateY(14px)'}, {opacity: 1, transform: 'none'}], 700, 40 + i * 55));
    document.title = `${workspace.name} · ${root.querySelector('h1')?.textContent || '客户端'}（原型）`;
  }
  const off = v.after?.(root);
  if (typeof off === 'function') cleanup = off;
  fillRenders(root, turn);
  turn = false;
  save();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  const result = fn(el, e);
  save();
  if (result !== false) render();
});
document.querySelector('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
addEventListener('hashchange', () => { closeSheet(); render(); });
render();
