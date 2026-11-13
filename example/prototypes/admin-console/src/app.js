// 平台管理后台交互原型（AM-P，ADR-0018）：平台管理员登记模型、运行接入检查、给企业分配模型与额度、看用量与审计记录。
// 电脑端、演示数据、不接服务端。视觉沿用企业工作台定稿的柔和中性 B 悬浮（docs/design/WEB_UI_DESIGN.md），样式与图标共用。
import {icon} from '../../client-h5/src/icons.js';
import {admin, protocols, checkItems, seedServices, seedModels, seedWorkspaces, months, usage, seedAudit, pingOutcome, fetchOutcome} from './data.js';

const KEY = 'hestia.admin-console.v4';
const XP = {sun: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0', moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  download: 'M12 3v13m-5-5 5 5 5-5M4 21h16', minus: 'M5 12h14', dot: 'M12 12h.01'};
const ic = (n, s = 18) => XP[n] ? `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${XP[n]}"/></svg>` : icon(n, s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fresh = () => ({session: true, super: true, theme: 'system', services: seedServices(), models: seedModels(), addId: '', workspaces: seedWorkspaces(), audit: seedAudit(), seq: 6, drafts: {}, login: {error: null}, notFound: false});
let state;
try { state = JSON.parse(localStorage.getItem(KEY) || 'null') || fresh(); } catch { state = fresh(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 隐私模式仅内存 */ } };

// ---------- 路由 ----------
function parse() { const raw = location.hash.replace(/^#/, '') || '/models'; const [path, qs] = raw.split('?'); return {path, parts: path.split('/').filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs || ''))}; }
const go = path => { if (location.hash === '#' + path) render(); else location.hash = path; };

// ---------- 小工具 ----------
const yuan = cents => `¥${(cents / 100).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const price = cents => (cents / 100).toFixed(2);
const quotaText = q => q == null ? '不限' : yuan(q);
const quotaFull = w => w.quota != null && w.used >= w.quota;
const int = n => n.toLocaleString('zh-CN');
const tokens = n => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
const stamp = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const date = t => stamp(t).slice(0, 10);
const modelById = id => state.models.find(m => m.id === id);
const svcById = id => state.services.find(s => s.id === id);
const svcOf = m => svcById(m.service);
const modelsOf = s => state.models.filter(m => m.service === s.id);
const wsBySlug = slug => state.workspaces.find(w => w.slug === slug);
const currentPrice = m => m.prices.at(-1);
const grantable = m => m.state === 'admitted' && !!m.prices.length;
const grantedTo = m => state.workspaces.filter(w => w.grants[m.id]);
const stateInfo = {draft: ['待检查', true], checking: ['检查中', false], admitted: ['已准入', false], failed: ['检查未通过', true], stale: ['需重新检查', true], disabled: ['已停用', false]};
const isDark = () => document.documentElement.dataset.theme === 'dark' || (state.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

// ========== Components ==========
const Tag = (text, act = false) => `<span class="tag${act ? ' tag--act' : ''}">${text}</span>`;
const StateTag = m => Tag(...stateInfo[m.state]);
const Note = (kind, title, text) => `<p class="note note--${kind}"${kind === 'danger' ? ' role="alert"' : ''}>${icon(kind === 'danger' ? 'alert' : kind === 'ok' ? 'check' : 'info', 16)}<span><b>${title}</b>${text}</span></p>`;
const Btn = (label, {kind = 'primary', act, k, v, href, sm, lead, disabled, attrs = ''} = {}) => {
  const cls = `btn btn--${kind}${sm ? ' btn--sm' : ''}`, inner = `${lead ? ic(lead, sm ? 14 : 16) : ''}${label}`;
  return href && !disabled ? `<a class="${cls}" href="#${href}">${inner}</a>` : `<button class="${cls}"${act ? ` data-act="${act}"` : ''}${k ? ` data-k="${k}"` : ''}${v != null ? ` data-v="${esc(v)}"` : ''}${disabled ? ' disabled' : ''} ${attrs}>${inner}</button>`;
};
const Switch = (on, act, v, label, disabled = false) => `<button class="switch" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-act="${act}" data-v="${esc(v)}"${disabled ? ' disabled' : ''}><i></i></button>`;
const Seg = (options, value, act, k, label) => `<div class="segmented segmented--fit" role="radiogroup" aria-label="${esc(label)}">${options.map(([v, t]) => `<button role="radio" aria-checked="${v === value}" data-act="${act}" data-k="${k}" data-v="${v}">${t}</button>`).join('')}</div>`;
const Meter = (used, quota) => { const pct = quota ? Math.min(100, Math.round(used / quota * 100)) : 0; return `<span class="meter${quota && used >= quota ? ' meter--full' : ''}" role="img" aria-label="已用 ${pct}%"><i style="width:${pct}%"></i></span>`; };
const Field = (label, control, hint = '') => `<label class="field"><span>${label}</span>${control}${hint ? `<small class="field__hint">${hint}</small>` : ''}</label>`;
const Input = (name, value, {type = 'text', suffix, placeholder = '', mono} = {}) => {
  const input = `<input class="input${mono ? ' input--mono' : ''}" data-draft="${name}" name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}"${type === 'number' ? ' inputmode="decimal"' : ''}>`;
  return suffix ? `<span class="input-group">${input}<em>${suffix}</em></span>` : input;
};

function TopBar(nav) {
  const dark = isDark();
  return `<header class="topbar"><a class="brand" href="#/models"><b>Hestia</b><span class="muted">平台管理</span></a>
    ${nav === false ? '' : `<nav class="topnav" aria-label="平台管理">${[['models', '/models', '模型服务'], ['workspaces', '/workspaces', '企业'], ['usage', '/usage', '用量'], ['audit', '/audit', '审计记录']].map(([k, href, t]) => `<a href="#${href}"${nav === k ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`}
    <div class="topbar__end"><button class="icon-btn" data-act="theme" aria-label="${dark ? '切换到浅色' : '切换到深色'}">${ic(dark ? 'sun' : 'moon', 17)}</button>
      ${state.session && nav !== false ? `<span class="member"><span class="member__name">${admin.name} · ${state.super ? '超级管理员' : '平台管理员'}</span><span class="avatar">运</span></span><button class="icon-btn" data-act="logout" aria-label="退出登录">${icon('logout', 16)}</button>` : ''}
      <button class="proto-btn" data-act="review">审阅</button></div></header>`;
}
const Shell = (content, nav) => `${TopBar(nav)}<main id="page">${content}</main>`;

// ========== Screens ==========
function LoginScreen() {
  const e = state.login.error;
  return Shell(`<section class="auth auth--plain"><form class="panel" data-form="login" novalidate>
    <h1>平台管理</h1><p class="muted" style="margin-top:6px">只有平台管理员可以登录。企业成员请从企业工作台登录。</p>
    ${Field('邮箱', `<input class="input" name="email" type="email" autocomplete="username" value="${esc(admin.email)}">`)}
    ${Field('密码', '<input class="input" name="password" type="password" autocomplete="current-password" value="">')}
    ${e === 'wrong' ? Note('danger', '登录失败', '邮箱或密码不正确，请检查后重试。') : e === 'denied' ? Note('danger', '不是平台管理员', '这个账号没有平台管理权限。权限只能在服务器上授予。') : ''}
    <button class="btn btn--primary" type="submit">登录</button>
    <p class="muted small" style="margin-top:14px">演示：${admin.email} / ${admin.password}</p></form></section>`, false);
}
function NotFoundScreen() {
  return `<main class="notfound"><b>页面不存在</b><p class="muted">请检查地址是否正确。</p><p class="proto-aside">原型说明：在企业域名（如 a.hestia.example）上访问 /admin 时就是这一页，与任何不存在的地址相同，不透露管理后台的存在。<button class="text-link" data-act="leave404">回到平台域名</button></p></main>`;
}

// ---------- 模型服务列表 ----------
const when = t => { const d = new Date(t), now = new Date(); return d.toDateString() === now.toDateString() ? `今天 ${stamp(t).slice(11)}` : date(t); };
function PingCell(s) {
  const p = s.ping, testing = s.pinging;
  const result = testing ? '<span class="ping ping--now"><i></i>测试中…</span>'
    : !p ? '<span class="ping ping--none muted">未测试</span>'
    : p.ok ? `<span class="ping ping--ok"><i></i>连通正常 · <span class="num">${int(p.ms)} ms</span></span>`
    : `<span class="ping ping--fail" title="${esc(p.reason)}"><i></i>连通失败 · ${esc(p.code)}</span>`;
  return `<span class="ping-cell"><span class="ping-cell__res">${result}${p && !testing ? `<small class="muted">${when(p.at)}</small>` : ''}</span>
    ${Btn('测试连通', {kind: 'secondary', sm: true, act: 'ping', v: s.id, disabled: testing})}</span>`;
}
function ServicesScreen() {
  const any = state.services.some(s => s.pinging), failed = state.services.filter(s => s.ping && !s.ping.ok && !s.pinging);
  const cards = state.services.map(s => {
    const ms = modelsOf(s), on = ms.filter(m => m.state !== 'disabled');
    const rows = ms.map(m => { const pr = currentPrice(m), n = grantedTo(m).length;
      return `<a class="table__row" href="#/models/${m.id}"><span class="cell-main"><b>${esc(m.name)}</b><small class="mono">${esc(m.modelId)}</small></span><span>${StateTag(m)}</span>
        <span class="num small">${pr ? `${price(pr.input)} / ${price(pr.output)}` : '<span class="muted">未定价</span>'}</span>
        <span class="small">${n ? `${n} 家企业` : '<span class="muted">未分配</span>'}</span><span class="small muted num">${m.check ? date(m.check.at) : '—'}</span><span class="chev">${icon('chevron', 16)}</span></a>`; }).join('');
    const c = s.catalog, foot = s.fetching ? '正在获取模型列表…' : !c ? '还没有获取模型列表' : c.unsupported ? '这个服务不提供模型列表，模型 ID 为手动添加' : `${when(c.at)} 获取到 ${c.ids.length} 个模型 ID`;
    return `<section class="panel svc"><div class="svc__head">
        <div class="svc__id"><h2 class="panel__title"><a href="#/services/${s.id}">${esc(s.name)}</a></h2><small>${protocols[s.protocol].short} · <span class="mono">${esc(s.baseUrl)}</span> · 密钥 <span class="mono">••••${esc(s.keyTail)}</span></small><small>${foot} · 已启用 ${on.length} 个</small></div>
        ${PingCell(s)}${Btn('管理', {kind: 'secondary', sm: true, href: '/services/' + s.id})}</div>
      ${ms.length ? `<div class="table table--svc-models"><div class="table__head"><span>已启用的模型 ID</span><span>状态</span><span>单价（输入 / 输出）</span><span>分配</span><span>最近接入检查</span><span></span></div>${rows}</div>` : '<p class="svc__empty small muted">还没有启用模型 ID。进入「管理」获取模型列表后启用。</p>'}
      </section>`; }).join('');
  const alert = failed.length ? Note('danger', `${failed.length} 个模型服务连通失败`, failed.map(s => { const n = modelsOf(s).filter(m => grantedTo(m).length).length;
    return `「${esc(s.name)}」${esc(s.ping.reason)}${n ? `，其下 ${n} 个模型正在被企业使用` : ''}`; }).join('；') + '。连通失败不改变准入状态；企业成员调用时会看到“模型服务暂时无响应”。') : '';
  return Shell(`<div class="page"><div class="page__head"><div><h1 class="page__title">模型服务</h1>
      <p class="page__sub">一个服务是一组接口地址与密钥，从中获取并启用模型 ID。企业只能使用启用、并通过接入检查的模型。代码里不预置任何供应商。</p></div>
      <div class="row-gap">${Btn(any ? '测试中…' : '全部测试连通', {kind: 'secondary', act: 'ping-all', disabled: any})}${Btn('登记模型服务', {href: '/services/new', lead: 'plus'})}</div></div>
    ${alert ? `<div style="margin-top:20px">${alert}</div>` : ''}
    <div class="svc-list">${cards}</div>
    <p class="small muted" style="margin-top:12px">测试连通：用已存密钥发一次最小请求，只看能否连上、鉴权是否通过和响应耗时，不计入任何企业的额度，也不改变准入状态。要验证工具调用与 Hestia 协议，进入模型运行接入检查。</p></div>`, 'models');
}

// ---------- 草稿 ----------
const svcCompatDefaults = {chat: {usageInStream: true, maxTokensField: 'max_tokens', thinkingParam: 'enable_thinking'}, responses: {store: false}, anthropic: {apiVersion: '2023-06-01'}};
const paramDefaults = {chat: {thinking: 'unset'}, responses: {reasoning: 'unset'}, anthropic: {thinking: false, thinkingBudget: 4000}};
const svcBlank = () => ({id: null, name: '', protocol: 'chat', baseUrl: '', keyTail: '', timeout: 60, concurrency: 8, compat: structuredClone(svcCompatDefaults.chat), ping: null, catalog: null});
const SVC_FIELDS = ['name', 'protocol', 'baseUrl', 'timeout', 'concurrency'], MODEL_FIELDS = ['name', 'description', 'maxOutput'];
function svcDraft(id) {
  const k = 'svc:' + id;
  if (!state.drafts[k]) { const x = id === 'new' ? svcBlank() : svcById(id); state.drafts[k] = {...Object.fromEntries(SVC_FIELDS.map(f => [f, x[f]])), compat: structuredClone(x.compat), key: '', replacingKey: false}; }
  return state.drafts[k];
}
function svcDirty(id) {
  if (id === 'new') return true;
  const d = state.drafts['svc:' + id], s = svcById(id); if (!d) return false;
  return SVC_FIELDS.some(k => String(d[k]) !== String(s[k])) || JSON.stringify(d.compat) !== JSON.stringify(s.compat) || !!d.key;
}
const svcRecheck = (d, s) => s && (d.protocol !== s.protocol || d.baseUrl !== s.baseUrl || JSON.stringify(d.compat) !== JSON.stringify(s.compat));
function draftOf(id) {
  if (!state.drafts[id]) { const m = modelById(id), p = currentPrice(m); state.drafts[id] = {...Object.fromEntries(MODEL_FIELDS.map(f => [f, m[f]])), params: structuredClone(m.params), priceInput: p ? price(p.input) : '', priceOutput: p ? price(p.output) : ''}; }
  return state.drafts[id];
}
const priceChanged = (d, m) => { const p = currentPrice(m); return d.priceInput !== (p ? price(p.input) : '') || d.priceOutput !== (p ? price(p.output) : ''); };
function dirtyOf(id) {
  const d = state.drafts[id], m = modelById(id); if (!d || !m) return false;
  return MODEL_FIELDS.some(k => String(d[k]) !== String(m[k])) || JSON.stringify(d.params) !== JSON.stringify(m.params) || priceChanged(d, m);
}
const needsRecheck = (d, m) => m && JSON.stringify(d.params) !== JSON.stringify(m.params);
// 当前页面的草稿（服务页或模型页）
const route = () => { const {parts} = parse(); return parts[0] === 'services' ? {kind: 'svc', id: parts[1], d: svcDraft(parts[1])} : {kind: 'model', id: parts[1], d: draftOf(parts[1])}; };
const curDirty = () => { const r = route(); return r.kind === 'svc' ? svcDirty(r.id) + '|' + svcRecheck(r.d, svcById(r.id)) : dirtyOf(r.id) + '|' + needsRecheck(r.d, modelById(r.id)); };

// ---------- 模型服务（登记 / 管理） ----------
function SvcCompat(d) {
  const c = d.compat;
  if (d.protocol === 'chat') return `
    <div class="setting"><div><b>流式输出时返回用量</b><small>发送 stream_options.include_usage。服务商不支持时关闭，用量改按预占额计入并标为未核对。</small></div>${Switch(!!c.usageInStream, 'compat-toggle', 'usageInStream', '流式输出时返回用量')}</div>
    <div class="setting"><div><b>最大输出的字段名</b><small>多数服务用 max_tokens；部分新接口要求 max_completion_tokens。</small></div>${Seg([['max_tokens', 'max_tokens'], ['max_completion_tokens', 'max_completion_tokens']], c.maxTokensField, 'compat', 'maxTokensField', '最大输出的字段名')}</div>
    <div class="setting"><div><b>思考参数写法</b><small>模型开启或关闭思考时用这种写法发送。按服务商文档选择，接入检查会验证是否生效。</small></div>${Seg([['enable_thinking', 'enable_thinking'], ['thinking.type', 'thinking.type'], ['reasoning_effort', 'reasoning_effort']], c.thinkingParam, 'compat', 'thinkingParam', '思考参数写法')}</div>`;
  if (d.protocol === 'responses') return `
    <div class="setting"><div><b>在服务商侧保存会话</b><small>默认关闭：对话由 Hestia 自己保存，不留在服务商。</small></div>${Switch(!!c.store, 'compat-toggle', 'store', '在服务商侧保存会话')}</div>`;
  return `<div class="setting"><div><b>API 版本</b><small>请求头 anthropic-version。</small></div><input class="input input--mono input--sm" data-compat="apiVersion" value="${esc(c.apiVersion)}"></div>`;
}
function IdsPanel(s) {
  const ms = modelsOf(s), byId = new Map(ms.map(m => [m.modelId, m])), c = s.catalog, listed = c?.ids || [];
  const ids = [...new Set([...listed, ...ms.map(m => m.modelId)])], added = new Set(c?.added || []);
  const rows = ids.map(mid => { const m = byId.get(mid), on = !!m && m.state !== 'disabled';
    const tags = `${added.has(mid) ? Tag('新', true) : ''}${m?.manual ? Tag('手动添加') : ''}${m && !m.manual && c && !c.unsupported && !listed.includes(mid) ? Tag('列表中已没有', true) : ''}`;
    return `<li class="id-row">${Switch(on, 'id-toggle', mid, `启用 ${mid}`, !!s.fetching)}<span class="id-row__id"><span class="mono">${esc(mid)}</span>${tags}</span>
      ${m ? `<a class="id-row__model" href="#/models/${m.id}"><span>${esc(m.name)}</span>${StateTag(m)}${icon('chevron', 14)}</a>` : '<span class="small muted">未启用</span>'}</li>`; }).join('');
  const head = s.fetching ? '正在从服务获取模型列表…' : !c ? '还没有获取。保存服务后自动获取一次。' : c.unsupported ? '' : `${when(c.at)} 获取 · 服务返回 ${listed.length} 个模型 ID${added.size ? `，其中 ${added.size} 个是新出现的` : ''}`;
  return `<section class="panel"><div class="panel__head"><h2 class="panel__title">模型 ID</h2>${Btn(s.fetching ? '获取中…' : c ? '重新获取' : '获取模型列表', {kind: 'secondary', sm: true, act: 'fetch', v: s.id, disabled: !!s.fetching || svcDirty(s.id)})}</div>
    <div class="panel__body">${head ? `<p class="small muted">${head}</p>` : ''}
      ${c?.unsupported && !s.fetching ? Note('hint', `获取失败（${esc(c.code)}）`, '这个服务不提供模型列表接口。请按服务商文档手动添加模型 ID。') : ''}
      ${ids.length ? `<ul class="id-list">${rows}</ul>` : ''}
      <div class="id-add"><input class="input input--mono input--sm" data-plain="addId" value="${esc(state.addId)}" placeholder="手动添加模型 ID">${Btn('添加并启用', {kind: 'secondary', sm: true, act: 'id-add', v: s.id})}</div>
      <p class="small muted" style="margin-top:12px">打开开关即启用这个模型 ID，然后为它填写显示名称与单价、运行接入检查；通过后才能分配给企业，企业成员在 Agent 里按显示名称选择。同一个服务可以启用多个模型 ID。获取列表只读取服务商的模型清单，不计入额度。</p></div></section>`;
}
function ServiceScreen(id) {
  const s = id === 'new' ? null : svcById(id); if (id !== 'new' && !s) return ServicesScreen();
  const d = svcDraft(id), p = protocols[d.protocol], dirty = svcDirty(id), recheck = svcRecheck(d, s);
  const keyField = !s ? Field('API 密钥', Input('key', d.key, {type: 'password', placeholder: '粘贴服务商提供的密钥', mono: true}), '保存后加密存储，之后只显示末四位，任何人都不能再查看完整密钥。')
    : d.replacingKey ? Field('新的 API 密钥', `<span class="row-gap">${Input('key', d.key, {type: 'password', placeholder: '粘贴新的密钥', mono: true})}${Btn('取消', {kind: 'secondary', sm: true, act: 'key-cancel'})}</span>`, '保存后旧密钥立即作废，并自动测试一次连通。')
      : `<div class="field"><span>API 密钥</span><div class="keyline"><span class="mono">•••• •••• ${esc(s.keyTail)}</span>${Btn('更换密钥', {kind: 'secondary', sm: true, act: 'key-replace'})}</div><small class="field__hint">完整密钥不回显、不进日志、不下发浏览器。</small></div>`;
  const admitted = s ? modelsOf(s).filter(m => m.state === 'admitted').length : 0;
  const hint = !dirty ? '' : !s ? '保存后自动测试连通并获取模型列表' : recheck ? `修改了接口或兼容设置：保存后这个服务下 ${admitted} 个已准入的模型需要重新通过接入检查` : d.key ? '保存后旧密钥立即作废，并自动测试连通' : '有未保存的修改';
  const pingPanel = s ? `<section class="panel"><div class="panel__head"><h2 class="panel__title">连通</h2></div><div class="panel__body">${PingCell(s)}
      ${s.ping && !s.ping.ok && !s.pinging ? `<p class="small" style="margin-top:10px;color:var(--c-danger)">${esc(s.ping.reason)}</p>` : ''}
      <p class="small muted" style="margin-top:10px">用已存密钥发一次最小请求，只验证连通、鉴权与耗时。</p></div></section>` : '';
  return Shell(`<div class="page"><a class="back" href="#/models">${icon('back', 14)}模型服务</a>
    <div class="page__head" style="margin-top:12px"><div><h1 class="page__title">${s ? esc(s.name) : '登记模型服务'}</h1>
      <p class="page__sub">${s ? `${p.name} · <span class="mono">${esc(s.baseUrl)}</span>` : '填写服务商提供的接口地址与密钥。保存后获取模型列表，再启用需要的模型 ID。'}</p></div></div>
    <div class="split">
      <div class="split__main">
        <section class="panel"><div class="panel__head"><h2 class="panel__title">接口</h2></div><div class="panel__body">
          <div class="form-grid"><div class="span-2">${Field('服务名称', Input('name', d.name, {placeholder: '例如：供应商名称，只用于后台识别'}), '成员看不到这个名称。')}</div></div>
          <div class="field"><span>协议</span>${Seg(Object.entries(protocols).map(([k, x]) => [k, x.short]), d.protocol, 'protocol', '', '协议')}<small class="field__hint">${p.hint}。请求路径 <span class="mono">${p.path}</span>，模型列表 <span class="mono">${d.protocol === 'anthropic' ? '/v1/models' : '/models'}</span>。</small></div>
          <div class="form-grid">
            <div class="span-2">${Field('接口地址', Input('baseUrl', d.baseUrl, {placeholder: d.protocol === 'anthropic' ? 'https://…（不含 /v1/messages）' : 'https://…/v1', mono: true}), '生产环境只接受 https。')}</div>
            <div class="span-2">${keyField}</div></div></div></section>
        <section class="panel"><div class="panel__head"><h2 class="panel__title">兼容设置</h2><span class="small muted">${p.short} · 对这个服务下所有模型生效</span></div><div class="panel__body settings">${SvcCompat(d)}</div></section>
        <section class="panel"><div class="panel__head"><h2 class="panel__title">限制</h2></div><div class="panel__body"><div class="form-grid">
          ${Field('超时', Input('timeout', d.timeout, {type: 'number', suffix: '秒'}))}
          ${Field('总并发上限', Input('concurrency', d.concurrency, {type: 'number', suffix: '个调用'}), '这个密钥下所有模型、所有企业共用；达到上限时排队。')}</div></div></section>
        ${s ? IdsPanel(s) : ''}
      </div>
      <aside class="split__side">${pingPanel}${!s ? `<section class="panel"><div class="panel__head"><h2 class="panel__title">接下来</h2></div><div class="panel__body"><ol class="steps small"><li>保存服务，自动测试连通并获取模型列表</li><li>启用需要的模型 ID，填写显示名称与单价</li><li>为每个模型运行接入检查</li><li>在「企业」页分配给企业</li></ol></div></section>` : ''}</aside></div></div>
    ${dirty ? `<div class="action-bar"><span class="hint">${hint}</span>${Btn(s ? '放弃修改' : '取消', {kind: 'secondary', act: 'discard', v: 'svc:' + id})}${Btn('保存', {act: 'save-svc', v: id})}</div>` : ''}`, 'models');
}

// ---------- 模型（服务里启用的一个模型 ID） ----------
function ModelParams(d, s) {
  const c = d.params;
  if (s.protocol === 'chat') return `<div class="setting"><div><b>思考模式</b><small>“不设置”时不发送思考参数，按服务商默认；写法见所在服务的兼容设置（<span class="mono">${esc(s.compat.thinkingParam)}</span>）。</small></div>${Seg([['unset', '不设置'], ['on', '开启'], ['off', '关闭']], c.thinking, 'param', 'thinking', '思考模式')}</div>`;
  if (s.protocol === 'responses') return `<div class="setting"><div><b>推理强度</b><small>发送 reasoning.effort；“不设置”时按服务商默认。</small></div>${Seg([['unset', '不设置'], ['low', '低'], ['medium', '中'], ['high', '高']], c.reasoning, 'param', 'reasoning', '推理强度')}</div>`;
  return `<div class="setting"><div><b>扩展思考</b><small>开启后按下方预算发送 thinking 参数。</small></div>${Switch(!!c.thinking, 'param-toggle', 'thinking', '扩展思考')}</div>
    ${c.thinking ? `<div class="setting"><div><b>思考预算</b><small>每次调用最多用于思考的 token，计入额度预占。</small></div><span class="input-group input-group--sm"><input class="input" data-param="thinkingBudget" type="number" value="${esc(c.thinkingBudget)}" inputmode="numeric"><em>token</em></span></div>` : ''}`;
}
function CheckPanel(m) {
  const ck = m.check, running = m.state === 'checking', res = running ? m.running : ck?.results;
  const sym = {ok: ['check', '通过'], fail: ['alert', '未通过'], unsupported: ['minus', '不支持'], todo: ['dot', '未检查'], now: ['dot', '检查中']};
  const items = checkItems.map(([k, t]) => { const r = res?.[k] || 'todo', [g, label] = sym[r]; return `<li data-r="${r}"><i>${ic(g, 14)}</i><span>${t}</span><small>${label}</small></li>`; }).join('');
  const head = running ? '正在用合成样本真实调用这个模型…' : ck ? `${stamp(ck.at)} · ${esc(ck.by)} · 用时 ${ck.seconds} 秒` : '还没有运行过。';
  const verdict = running ? '' : m.state === 'admitted' ? Note('ok', '已准入', m.prices.length ? '可以分配给企业。改调用参数或所在服务的接口、兼容设置后需要重新检查。' : '还没有填写单价，填写后才能分配给企业。')
    : m.state === 'failed' ? Note('danger', '未通过', `${esc(ck.failure)} 未通过的模型不能分配给企业。`)
    : m.state === 'stale' ? Note('hint', '需重新检查', '调用参数或所在服务的接口已修改，之前的检查结果失效。重新通过前，已分配的企业不能再用它发起新调用。')
    : m.state === 'disabled' ? Note('hint', '已停用', '新任务不能再选这个模型。重新启用前需要再通过一次接入检查。') : '';
  const unsupported = res?.usage === 'unsupported' && !running ? `<p class="hint-line hint-line--hint">${icon('info', 14)}<span><b>不返回用量</b>这个模型的调用按预占额计入额度，并在用量里标为未核对。</span></p>` : '';
  return `<section class="panel"><div class="panel__head"><h2 class="panel__title">接入检查</h2>${!running && m.state !== 'disabled' ? Btn(ck ? '重新检查' : '运行接入检查', {kind: ck ? 'secondary' : 'primary', sm: true, act: 'check', v: m.id, disabled: dirtyOf(m.id)}) : ''}</div>
    <div class="panel__body"><p class="small muted">${head}</p><ul class="checklist">${items}</ul>${unsupported}${verdict}
    ${dirtyOf(m.id) && !running ? '<p class="small muted" style="margin-top:12px">有未保存的修改，保存后再检查。</p>' : ''}</div></section>`;
}
function ModelScreen(id) {
  const m = modelById(id); if (!m) return ServicesScreen();
  const s = svcOf(m), d = draftOf(id), dirty = dirtyOf(id), granted = grantedTo(m), recheck = needsRecheck(d, m), pc = priceChanged(d, m);
  const hist = m.prices.slice().reverse().map((x, i) => `<li><span class="num">${price(x.input)} / ${price(x.output)}</span><span class="muted">${date(x.from)} 起${i === 0 ? ' · 当前' : ''}</span></li>`).join('');
  const hint = !dirty ? '' : recheck ? '修改了调用参数：保存后需要重新通过接入检查' : pc ? (m.prices.length ? '新单价从下一次调用起生效，历史用量不重算' : '填写单价后，通过接入检查即可分配给企业') : '有未保存的修改';
  return Shell(`<div class="page"><a class="back" href="#/services/${s.id}">${icon('back', 14)}${esc(s.name)}</a>
    <div class="page__head" style="margin-top:12px"><div><h1 class="page__title">${esc(m.name)}</h1>
      <p class="page__sub">${StateTag(m)} <span class="mono">${esc(m.modelId)}</span> <span class="muted">· ${esc(s.name)} · ${protocols[s.protocol].short}</span></p></div>
      ${m.state !== 'disabled' ? Btn('停用', {kind: 'danger', act: 'confirm', k: 'disable', v: m.id}) : Btn('重新启用', {kind: 'secondary', act: 'enable', v: m.id})}</div>
    <div class="split">
      <div class="split__main">
        <section class="panel"><div class="panel__head"><h2 class="panel__title">成员看到的信息</h2></div><div class="panel__body form-grid">
          ${Field('显示名称', Input('name', d.name, {placeholder: '例如：深度设计'}), '成员在 Agent 里按这个名称选择；默认是模型 ID。')}
          ${Field('模型 ID', `<span class="input input--mono input--ro">${esc(m.modelId)}</span>`, '来自服务的模型列表，不能修改。')}
          <div class="span-2">${Field('说明', Input('description', d.description, {placeholder: '一句话说明适合做什么，例如：整套方案时用，速度较慢'}))}</div></div></section>
        <section class="panel"><div class="panel__head"><h2 class="panel__title">调用参数</h2><span class="small muted">只对这个模型生效</span></div><div class="panel__body">
          <div class="form-grid">${Field('单次最大输出', Input('maxOutput', d.maxOutput, {type: 'number', suffix: 'token'}), '额度预占按“输入估算 + 最大输出”计算。')}</div>
          <div class="settings" style="margin-top:8px">${ModelParams(d, s)}</div></div></section>
        <section class="panel"><div class="panel__head"><h2 class="panel__title">单价</h2><span class="small muted">元 / 百万 token</span></div><div class="panel__body">
          <div class="form-grid">${Field('输入单价', Input('priceInput', d.priceInput, {type: 'number', suffix: '元 / 百万 token', placeholder: '0.00'}))}${Field('输出单价', Input('priceOutput', d.priceOutput, {type: 'number', suffix: '元 / 百万 token', placeholder: '0.00'}))}</div>
          ${m.prices.length ? `<div class="price-hist"><span class="small muted">单价记录</span><ul>${hist}</ul></div>` : Note('hint', '未定价', '没有单价的模型无法折算金额，不能分配给企业。')}</div></section>
      </div>
      <aside class="split__side">${CheckPanel(m)}
        <section class="panel"><div class="panel__head"><h2 class="panel__title">分配给</h2></div><div class="panel__body">${granted.length ? `<ul class="plain-list">${granted.map(w => `<li><a href="#/workspaces/${w.slug}">${esc(w.name)}</a><small class="muted">${w.grants[m.id].enabled ? (w.grants[m.id].default ? '企业已启用 · 默认' : '企业已启用') : '企业未启用'}</small></li>`).join('')}</ul>` : `<p class="small muted">还没有分配给任何企业。${grantable(m) ? '在「企业」页分配。' : '通过接入检查并填写单价后才能分配。'}</p>`}</div></section>
      </aside></div></div>
    ${dirty ? `<div class="action-bar"><span class="hint">${hint}</span>${Btn('放弃修改', {kind: 'secondary', act: 'discard', v: id})}${Btn('保存', {act: 'save-model', v: id})}</div>` : ''}`, 'models');
}

// 企业列表 / 详情
function WorkspacesScreen() {
  const rows = state.workspaces.map(w => { const names = Object.keys(w.grants).map(id => modelById(id)?.name).filter(Boolean);
    const status = !names.length ? Tag('未开通') : quotaFull(w) ? Tag('本月额度已用完', true) : '';
    return `<a class="table__row" href="#/workspaces/${w.slug}">
      <span class="cell-main"><b>${esc(w.name)}</b><small class="mono">${esc(w.domain)}</small></span>
      <span class="small">${names.length ? names.map(esc).join('、') : '<span class="muted">—</span>'}</span>
      <span class="usage-cell">${w.quota === null ? `<span class="num small">${yuan(w.used)} / 不限</span>` : w.quota ? `<span class="num small">${yuan(w.used)} / ${yuan(w.quota)}</span>${Meter(w.used, w.quota)}` : '<span class="small muted">未设额度</span>'}</span>
      <span class="num small">${w.concurrency}</span><span>${status}</span><span class="chev">${icon('chevron', 16)}</span></a>`; }).join('');
  return Shell(`<div class="page"><div class="page__head"><div><h1 class="page__title">企业</h1><p class="page__sub">为每家企业指定可用模型、月度额度与同时运行的 Agent 任务数。月份按北京时间自然月计算。</p></div></div>
    <div class="table table--ws"><div class="table__head"><span>企业</span><span>可用模型</span><span>本月用量 / 额度</span><span>并发上限</span><span>状态</span><span></span></div>${rows}</div></div>`, 'workspaces');
}
function WorkspaceScreen(slug) {
  const w = wsBySlug(slug); if (!w) return WorkspacesScreen();
  const d = state.drafts['ws:' + slug] ||= {grants: Object.keys(w.grants), free: w.quota === null, quota: w.quota === null ? '' : price(w.quota), concurrency: w.concurrency};
  const dirty = JSON.stringify(d.grants.slice().sort()) !== JSON.stringify(Object.keys(w.grants).sort()) || d.free !== (w.quota === null) || (!d.free && d.quota !== (w.quota === null ? '' : price(w.quota))) || String(d.concurrency) !== String(w.concurrency);
  const item = m => { const on = d.grants.includes(m.id), ok = grantable(m), g = w.grants[m.id];
    const side = !ok ? `<small class="muted">${m.state === 'admitted' ? '未定价' : stateInfo[m.state][0]}，不能分配</small>` : g ? `<small class="muted">${g.enabled ? (g.default ? '企业已启用 · 默认' : '企业已启用') : '企业未启用'}</small>` : on ? '<small class="muted">保存后企业管理员可启用</small>' : '';
    return `<li><button class="facet" aria-pressed="${on}" data-act="grant" data-v="${m.id}"${!ok && !on ? ' disabled' : ''}><span class="check">${icon('check', 13)}</span><span><b>${esc(m.name)} <span class="mono muted">${esc(m.modelId)}</span></b><small>${esc(m.description)}${m.prices.length ? ` · 单价 ${price(currentPrice(m).input)} / ${price(currentPrice(m).output)}` : ''}</small></span></button>${side}</li>`; };
  const items = state.services.map(s => { const ms = modelsOf(s); return ms.length ? `<li class="grant-group">${esc(s.name)}<small class="muted">${protocols[s.protocol].short}</small></li>${ms.map(item).join('')}` : ''; }).join('');
  const quota = d.free ? null : Math.round(parseFloat(d.quota || '0') * 100) || 0, left = quota === null ? Infinity : quota - w.used - w.reserved;
  return Shell(`<div class="page"><a class="back" href="#/workspaces">${icon('back', 14)}企业</a>
    <div class="page__head" style="margin-top:12px"><div><h1 class="page__title">${esc(w.name)}</h1><p class="page__sub mono">${esc(w.domain)}</p></div>
      ${state.super ? `<div>${Btn('进入工作台（只读）', {kind: 'secondary', act: 'enter-ws', v: slug, attrs: `title="在 ${esc(w.domain)} 上用自己的邮箱登录，只读查看，进入记入审计与企业访问记录"`})}</div>` : ''}</div>
    <div class="split">
      <div class="split__main"><section class="panel"><div class="panel__head"><h2 class="panel__title">可用模型</h2><span class="small muted">只能分配已准入、已定价的模型</span></div>
        <div class="panel__body"><ul class="grant-list">${items}</ul>
        ${d.grants.length ? '' : Note('hint', '未开通', '不分配任何模型时，这家企业的 Agent 入口显示“未开通”，不会模拟结果。')}
        <p class="small muted" style="margin-top:12px">企业管理员只能在这些模型里启用、停用和设默认，看不到密钥、地址与单价。取消分配后，正在用它的任务在当前调用结束后停止。</p></div></section></div>
      <aside class="split__side"><section class="panel"><div class="panel__head"><h2 class="panel__title">额度与并发</h2></div><div class="panel__body">
        <div class="field"><span>月度额度</span>${Seg([['cap', '设上限'], ['none', '不限']], d.free ? 'none' : 'cap', 'wsfree', 'free', '月度额度')}
          ${d.free ? '<small class="field__hint">只统计用量，不因额度停止。独立部署或按实际用量结算的企业可以选这个。</small>' : `<span class="input-group" style="margin-top:8px"><input class="input" data-wsdraft="quota" type="number" inputmode="decimal" value="${esc(d.quota)}" aria-label="月度额度（元）"><em>元</em></span><small class="field__hint">用尽即停：新的调用不会发出，任务暂停可恢复，已有成果保留。</small>`}</div>
        ${Field('同时运行的 Agent 任务', `<span class="input-group"><input class="input" data-wsdraft="concurrency" type="number" inputmode="numeric" value="${esc(d.concurrency)}"><em>个</em></span>`, '超过时新任务排队，不拒绝。')}
        <dl class="ledger"><div><dt>本月已用</dt><dd class="num">${yuan(w.used)}</dd></div><div><dt>预占中</dt><dd class="num">${yuan(w.reserved)}</dd></div><div><dt>剩余</dt><dd class="num${left <= 0 ? ' danger' : ''}">${quota === null ? '不限' : yuan(Math.max(0, left))}</dd></div></dl>
        ${quota === null ? '' : Meter(w.used + w.reserved, quota)}
        ${quota && quota < w.used ? Note('hint', '低于本月已用', '保存后本月新的调用会被拒绝，进行中的调用不受影响。') : ''}</div></section></aside></div></div>
    ${dirty ? `<div class="action-bar"><span class="hint">调整立即生效，并写入审计记录</span>${Btn('放弃修改', {kind: 'secondary', act: 'discard', v: 'ws:' + slug})}${Btn('保存', {act: 'save-ws', v: slug})}</div>` : ''}`, 'workspaces');
}

// 用量
function UsageScreen(q) {
  const month = q.m || months[0], by = q.by || 'workspace', rows = usage[month] || [];
  const key = r => by === 'workspace' ? r.ws : r.model, groups = new Map();
  for (const r of rows) { const g = groups.get(key(r)) || {calls: 0, input: 0, output: 0, cost: 0, unknown: 0}; for (const f of ['calls', 'input', 'output', 'cost', 'unknown']) g[f] += r[f]; groups.set(key(r), g); }
  const name = k => by === 'workspace' ? wsBySlug(k)?.name : (m => m && `${m.name} · ${m.modelId}`)(modelById(k)), total = [...groups.values()].reduce((a, g) => ({calls: a.calls + g.calls, cost: a.cost + g.cost, input: a.input + g.input, output: a.output + g.output, unknown: a.unknown + g.unknown}), {calls: 0, cost: 0, input: 0, output: 0, unknown: 0});
  const line = (label, g, cls = '') => `<div class="table__row ${cls}"><span class="cell-main"><b>${label}</b></span><span class="num">${int(g.calls)}</span><span class="num">${tokens(g.input)}</span><span class="num">${tokens(g.output)}</span><span class="num">${g.unknown ? `<span class="tag tag--act">${g.unknown} 次</span>` : '<span class="muted">—</span>'}</span><span class="num strong">${yuan(g.cost)}</span></div>`;
  const body = groups.size ? [...groups.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([k, g]) => line(esc(name(k) || k), g)).join('') + line('合计', total, 'table__total') : '<div class="empty"><b>这个月没有调用</b>选择其他月份查看。</div>';
  return Shell(`<div class="page"><div class="page__head"><div><h1 class="page__title">用量</h1><p class="page__sub">${month.replace('-', ' 年 ')} 月 · ${int(total.calls)} 次调用 · <span class="num">${yuan(total.cost)}</span></p></div>
      ${Btn('导出 CSV', {kind: 'secondary', lead: 'download', act: 'toast', v: '已导出（原型不生成文件）', disabled: !groups.size})}</div>
    <div class="list-tools">${Seg(months.map(m => [m, m.replace('-', ' 年 ') + ' 月']), month, 'usage', 'm', '月份')}${Seg([['workspace', '按企业'], ['model', '按模型']], by, 'usage', 'by', '汇总方式')}</div>
    <div class="table table--usage"><div class="table__head"><span>${by === 'workspace' ? '企业' : '模型'}</span><span>调用次数</span><span>输入 token</span><span>输出 token</span><span>未核对</span><span>金额</span></div>${body}</div>
    <p class="small muted" style="margin-top:12px">金额按每次调用当时的单价折算。未核对：服务商没有返回用量的调用，按预占额计入。</p></div>`, 'usage');
}

// 审计记录
function AuditScreen() {
  return Shell(`<div class="page"><div class="page__head"><div><h1 class="page__title">审计记录</h1><p class="page__sub">平台管理员的每次改动、超级管理员每次进入企业工作台都记在这里，不能修改或删除。密钥只记“已更换”。</p></div></div>
    <div class="table table--audit"><div class="table__head"><span>时间</span><span>操作者</span><span>动作</span><span>对象</span><span>内容</span></div>
    ${state.audit.map(a => `<div class="table__row table__row--static"><span class="num small muted">${stamp(a.at)}</span><span class="small">${esc(a.who)}</span><span class="small strong">${esc(a.action)}</span><span class="small">${esc(a.target)}</span><span class="small">${esc(a.text)}</span></div>`).join('')}</div></div>`, 'audit');
}

// ---------- 弹层 ----------
const modal = () => document.querySelector('#modal');
const closeModal = () => { if (modal().open) modal().close(); };
function openModal(html) { const m = modal(); m.innerHTML = `<div class="modal-body" tabindex="-1">${html}</div>`; if (!m.open) m.showModal(); m.querySelector('.modal-body').focus(); }
function disableModal(id) {
  const m = modelById(id), ws = grantedTo(m);
  openModal(`<h2>停用「${esc(m.name)}」？</h2><p>新任务不能再选这个模型；正在用它的任务会在当前调用结束后停止并告知成员，已有成果保留。不会自动换成其他模型。</p>
    ${ws.length ? `<h3>受影响的企业</h3><ul class="plain-list">${ws.map(w => `<li>${esc(w.name)}<small class="muted">${w.grants[id].default ? '这是该企业的默认模型' : ''}</small></li>`).join('')}</ul>` : ''}
    <div class="modal-actions">${Btn('取消', {kind: 'secondary', act: 'close'})}${Btn('停用', {kind: 'danger', act: 'do-disable', v: id})}</div>`);
}
let toastTimer;
function toast(text) { const t = document.querySelector('#toast'); t.textContent = text; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400); }
const logAudit = (action, target, text) => state.audit.unshift({at: Date.now(), who: admin.name, action, target, text});

// ---------- 原型审阅导航（不属于产品界面） ----------
const reset = () => { const theme = state.theme; state = fresh(); state.theme = theme; };
const R = {
  'login': ['入口', '登录', () => { reset(); state.session = false; go('/login'); }],
  'login-denied': ['入口', '登录 · 不是平台管理员', () => { reset(); state.session = false; state.login.error = 'denied'; go('/login'); }],
  'notfound': ['入口', '企业域名上访问（显示不存在）', () => { reset(); state.notFound = true; go('/models'); }],
  'models': ['模型服务', '模型服务列表', () => { reset(); go('/models'); }],
  'models-ping': ['模型服务', '列表 · 全部测试连通中', () => { reset(); runPing(state.services.map(s => s.id)); go('/models'); }],
  'models-ping-fail': ['模型服务', '列表 · 有服务连通失败', () => { reset(); svcById('s2').ping = {at: Date.now(), ...pingOutcome.s2}; go('/models'); }],
  'svc-new': ['模型服务', '登记模型服务（空白）', () => { reset(); go('/services/new'); }],
  'svc': ['模型服务', '管理服务 · 已获取模型列表', () => { reset(); go('/services/s1'); }],
  'svc-fetching': ['模型服务', '获取模型列表中', () => { reset(); runFetch('s2'); go('/services/s2'); }],
  'svc-fetched': ['模型服务', '重新获取后出现新的模型 ID', () => { reset(); applyFetch('s1'); go('/services/s1'); }],
  'svc-unsupported': ['模型服务', '服务不提供模型列表（手动添加）', () => { reset(); go('/services/s3'); }],
  'svc-stale': ['模型服务', '改了接口地址 · 需重新检查', () => { reset(); svcDraft('s1').baseUrl = 'https://api.vendor-a.example/v2'; go('/services/s1'); }],
  'svc-key': ['模型服务', '更换密钥', () => { reset(); svcDraft('s1').replacingKey = true; go('/services/s1'); }],
  'model-ok': ['模型', '已准入 · Chat Completions', () => { reset(); go('/models/m1'); }],
  'model-anthropic': ['模型', '已准入 · Anthropic Messages', () => { reset(); go('/models/m3'); }],
  'model-new-id': ['模型', '刚启用的模型 ID（待填写、待检查）', () => { reset(); go('/models/' + enableId(svcById('s1'), 'vision-plus').id); }],
  'model-failed': ['模型', '检查未通过 · Responses', () => { reset(); go('/models/m4'); }],
  'model-checking': ['模型', '接入检查进行中', () => { reset(); runCheck('m4'); go('/models/m4'); }],
  'model-param': ['模型', '改调用参数 · 需重新检查', () => { reset(); draftOf('m2').params.thinking = 'on'; go('/models/m2'); }],
  'model-price': ['模型', '改单价 · 待保存', () => { reset(); draftOf('m1').priceInput = '2.80'; go('/models/m1'); }],
  'model-disable': ['模型', '停用确认', () => { reset(); go('/models/m1'); setTimeout(() => disableModal('m1'), 200); }],
  'model-disabled': ['模型', '已停用', () => { reset(); go('/models/m5'); }],
  'workspaces': ['企业', '企业列表', () => { reset(); go('/workspaces'); }],
  'ws': ['企业', '分配与额度', () => { reset(); go('/workspaces/demo-home'); }],
  'ws-full': ['企业', '本月额度已用完', () => { reset(); go('/workspaces/demo-home-b'); }],
  'ws-none': ['企业', '未开通（没有分配模型）', () => { reset(); go('/workspaces/demo-home-c'); }],
  'ws-unlimited': ['企业', '月度额度不限', () => { reset(); wsBySlug('demo-home').quota = null; go('/workspaces/demo-home'); }],
  'ws-plain': ['企业', '普通平台管理员（没有进入工作台）', () => { reset(); state.super = false; go('/workspaces/demo-home'); }],
  'usage': ['用量与审计', '用量 · 按企业', () => { reset(); go('/usage'); }],
  'usage-model': ['用量与审计', '用量 · 按模型（上月）', () => { reset(); go('/usage?m=2026-10&by=model'); }],
  'usage-empty': ['用量与审计', '用量 · 没有调用的月份', () => { reset(); go('/usage?m=2026-09'); }],
  'audit': ['用量与审计', '审计记录', () => { reset(); go('/audit'); }],
};
function openReview() {
  const groups = {};
  for (const [id, [g, label]] of Object.entries(R)) (groups[g] ||= []).push(`<li><button data-act="jump" data-v="${id}">${label}${icon('chevron', 13)}</button></li>`);
  openModal(`<h2>原型审阅导航</h2><p>直接跳到任一页面或状态，跳转会重置演示数据。这个入口不属于产品界面。</p>
    <div class="review-cols">${Object.entries(groups).map(([g, items]) => `<div><h3>${g}</h3><ul class="review-list">${items.join('')}</ul></div>`).join('')}</div>
    <div class="modal-actions">${Btn('清空演示数据', {kind: 'secondary', act: 'reset'})}${Btn('关闭', {act: 'close'})}</div>`);
}
window.__review = {ids: Object.keys(R), go: id => { closeModal(); R[id][2](); save(); render(); }, theme: t => { state.theme = t; applyTheme(); save(); render(); }};

// ---------- 交互 ----------
function runCheck(id) { startCheck(id); const tick = () => { stepCheck(id); if (modelById(id)?.state === 'checking') setTimeout(tick, 650); }; setTimeout(tick, 650); }
// 测试连通：各服务并行，按演示耗时返回
function runPing(ids) {
  for (const id of ids) { const s = svcById(id); if (!s || s.pinging) continue; s.pinging = true;
    const o = pingOutcome[id] || {ok: true, ms: 500};
    setTimeout(() => { const x = svcById(id); if (!x) return; delete x.pinging; x.ping = {at: Date.now(), ...o}; if (ids.length === 1) toast(o.ok ? `「${x.name}」连通正常 · ${o.ms} ms` : `「${x.name}」连通失败：${o.code}`); save(); render(); }, o.ok ? Math.max(500, o.ms * 1.4) : 1600);
  }
}
// 获取模型列表
function applyFetch(id) {
  const s = svcById(id), o = fetchOutcome[id] || {ids: []}, prev = s.catalog && !s.catalog.unsupported ? s.catalog.ids : [];
  delete s.fetching;
  s.catalog = o.unsupported ? {at: Date.now(), unsupported: true, code: o.code, ids: []} : {at: Date.now(), ids: o.ids, added: s.catalog ? o.ids.filter(x => !prev.includes(x)) : []};
  logAudit('获取模型列表', s.name, o.unsupported ? `失败：${o.code}` : `${o.ids.length} 个模型 ID`);
  return s.catalog;
}
function runFetch(id) { const s = svcById(id); if (!s || s.fetching) return; s.fetching = true;
  setTimeout(() => { if (!svcById(id)?.fetching) return; const c = applyFetch(id); toast(c.unsupported ? '这个服务不提供模型列表，请手动添加' : c.added?.length ? `获取到 ${c.ids.length} 个模型 ID，${c.added.length} 个是新的` : `获取到 ${c.ids.length} 个模型 ID`); save(); render(); }, 1300); }
function enableId(s, mid, manual = false) {
  const m = {id: 'm' + state.seq++, service: s.id, modelId: mid, ...(manual ? {manual: true} : {}), name: mid, description: '', maxOutput: 4000, params: structuredClone(paramDefaults[s.protocol]), prices: [], state: 'draft', check: null};
  state.models.push(m); logAudit('启用模型 ID', s.name, mid); return m;
}
function startCheck(id) {
  const m = modelById(id); m.state = 'checking'; m.running = Object.fromEntries(checkItems.map(([k], i) => [k, i === 0 ? 'now' : 'todo']));
}
function stepCheck(id) {
  const m = modelById(id); if (!m || m.state !== 'checking') return;
  const keys = checkItems.map(([k]) => k), i = keys.findIndex(k => m.running[k] === 'now');
  const outcome = m.id === 'm4' ? {connect: 'ok', stream: 'ok', tools: 'fail'} : null;
  const r = outcome ? outcome[keys[i]] || 'ok' : 'ok'; m.running[keys[i]] = r;
  if (r === 'fail' || i === keys.length - 1) {
    const results = Object.fromEntries(keys.map(k => [k, m.running[k] === 'now' ? 'todo' : m.running[k]]));
    m.check = {at: Date.now(), by: admin.name, seconds: 6 + i * 3, results, failure: r === 'fail' ? '工具调用：模型没有返回工具调用（结束原因为 stop），Hestia 的 Agent 无法使用这个模型。' : null};
    m.state = r === 'fail' ? 'failed' : 'admitted'; delete m.running;
    logAudit('接入检查', m.name, r === 'fail' ? '未通过：工具调用' : '通过'); toast(r === 'fail' ? '接入检查未通过' : '接入检查通过，可以分配给企业');
  } else m.running[keys[i + 1]] = 'now';
  save(); render();
}
const actions = {
  review: () => { openReview(); return false; }, close: () => { closeModal(); return false; }, jump: el => { window.__review.go(el.dataset.v); return false; },
  reset: () => { closeModal(); reset(); go('/models'); },
  logout: () => { state.session = false; state.login = {error: null}; go('/login'); },
  leave404: () => { state.notFound = false; },
  theme: () => { state.theme = isDark() ? 'light' : 'dark'; applyTheme(); },
  toast: el => { toast(el.dataset.v); return false; },
  protocol: el => { const d = route().d; if (d.protocol !== el.dataset.v) { d.protocol = el.dataset.v; d.compat = structuredClone(svcCompatDefaults[d.protocol]); } },
  compat: el => { route().d.compat[el.dataset.k] = el.dataset.v; },
  'compat-toggle': el => { const c = route().d.compat; c[el.dataset.v] = !c[el.dataset.v]; },
  param: el => { route().d.params[el.dataset.k] = el.dataset.v; },
  'param-toggle': el => { const c = route().d.params; c[el.dataset.v] = !c[el.dataset.v]; },
  'key-replace': () => { route().d.replacingKey = true; },
  'key-cancel': () => { const d = route().d; d.replacingKey = false; d.key = ''; },
  discard: el => { const id = el.dataset.v; delete state.drafts[id]; if (id === 'svc:new') go('/models'); },
  'save-svc': el => {
    const id = el.dataset.v, d = svcDraft(id);
    if (!d.name.trim() || !d.baseUrl.trim() || (id === 'new' && !d.key)) { toast('请填写服务名称、接口地址与密钥'); return false; }
    if (!/^https:\/\//.test(d.baseUrl.trim())) { toast('接口地址必须以 https:// 开头'); return false; }
    if (id === 'new') {
      const s = {id: 's' + state.seq++, name: d.name, protocol: d.protocol, baseUrl: d.baseUrl.trim(), keyTail: d.key.slice(-4), timeout: +d.timeout, concurrency: +d.concurrency, compat: structuredClone(d.compat), ping: null, catalog: null};
      state.services.push(s); delete state.drafts['svc:new']; logAudit('登记模型服务', s.name, `${protocols[s.protocol].name} · ${s.baseUrl}`);
      runPing([s.id]); runFetch(s.id); toast('已保存，正在测试连通并获取模型列表'); go('/services/' + s.id); return false;
    }
    const s = svcById(id), recheck = svcRecheck(d, s);
    for (const k of ['name', 'protocol', 'baseUrl']) s[k] = d[k];
    s.timeout = +d.timeout; s.concurrency = +d.concurrency; s.compat = structuredClone(d.compat);
    if (recheck) { const hit = modelsOf(s).filter(m => m.state === 'admitted'); hit.forEach(m => { m.state = 'stale'; }); logAudit('修改接口', s.name, `${hit.length} 个模型准入失效，待重新检查`); }
    if (d.key) { s.keyTail = d.key.slice(-4); logAudit('更换密钥', s.name, `密钥已更换（末四位 ${s.keyTail}）`); runPing([s.id]); }
    delete state.drafts['svc:' + id]; toast(recheck ? '已保存，这个服务下的模型需要重新检查' : d.key ? '已保存，正在测试连通' : '已保存');
  },
  fetch: el => { runFetch(el.dataset.v); },
  'id-toggle': el => {
    const s = svcById(parse().parts[1]), mid = el.dataset.v, m = modelsOf(s).find(x => x.modelId === mid);
    if (!m) { enableId(s, mid); toast(`已启用 ${mid}：填写显示名称与单价，再运行接入检查`); return; }
    if (m.state === 'disabled') { m.state = 'stale'; logAudit('重新启用', m.name, '待重新检查'); toast('已重新启用，通过接入检查后可再分配'); return; }
    if (grantedTo(m).length) { disableModal(m.id); return false; }
    m.state = 'disabled'; logAudit('停用模型', m.name, '未分配给企业'); toast(`已停用 ${mid}`);
  },
  'id-add': el => {
    const s = svcById(el.dataset.v), mid = state.addId.trim();
    if (!mid) { toast('请填写模型 ID'); return false; }
    if (modelsOf(s).some(m => m.modelId === mid)) { toast('这个模型 ID 已启用'); return false; }
    enableId(s, mid, !(s.catalog?.ids || []).includes(mid)); state.addId = ''; toast(`已启用 ${mid}：填写显示名称与单价，再运行接入检查`);
  },
  'save-model': el => {
    const id = el.dataset.v, d = draftOf(id), m = modelById(id);
    if (!d.name.trim()) { toast('请填写显示名称'); return false; }
    const num = v => Math.round(parseFloat(v || '0') * 100) || 0, recheck = needsRecheck(d, m);
    if (priceChanged(d, m)) { if (d.priceInput === '' || d.priceOutput === '') { toast('请同时填写输入与输出单价'); return false; }
      m.prices.push({from: Date.now(), input: num(d.priceInput), output: num(d.priceOutput)}); logAudit(m.prices.length > 1 ? '修改单价' : '设置单价', m.name, `输入 ${d.priceInput}、输出 ${d.priceOutput}（元 / 百万 token），从下一次调用起生效`); }
    for (const k of ['name', 'description']) m[k] = d[k];
    m.maxOutput = +d.maxOutput; m.params = structuredClone(d.params);
    if (recheck && m.state === 'admitted') { m.state = 'stale'; logAudit('修改调用参数', m.name, '准入失效，待重新检查'); }
    delete state.drafts[id]; toast(recheck ? '已保存，需要重新运行接入检查' : '已保存');
  },
  check: el => { runCheck(el.dataset.v); },
  ping: el => { runPing([el.dataset.v]); },
  'ping-all': () => { runPing(state.services.map(s => s.id)); },
  confirm: el => { if (el.dataset.k === 'disable') disableModal(el.dataset.v); return false; },
  'do-disable': el => { const m = modelById(el.dataset.v); m.state = 'disabled'; closeModal(); logAudit('停用模型', m.name, `${grantedTo(m).length} 家企业受影响`); toast('已停用'); },
  enable: el => { const m = modelById(el.dataset.v); m.state = 'stale'; logAudit('重新启用', m.name, '待重新检查'); toast('已重新启用，通过接入检查后可再分配'); },
  grant: el => { const slug = parse().parts[1], d = state.drafts['ws:' + slug], i = d.grants.indexOf(el.dataset.v); i < 0 ? d.grants.push(el.dataset.v) : d.grants.splice(i, 1); },
  'save-ws': el => {
    const w = wsBySlug(el.dataset.v), d = state.drafts['ws:' + w.slug], before = Object.keys(w.grants), quota = d.free ? null : Math.round(parseFloat(d.quota || '0') * 100) || 0;
    const added = d.grants.filter(id => !before.includes(id)), removed = before.filter(id => !d.grants.includes(id));
    w.grants = Object.fromEntries(d.grants.map(id => [id, w.grants[id] || {enabled: false}]));
    if (added.length || removed.length) logAudit('分配模型', w.name, [added.length && `新增：${added.map(id => modelById(id).name).join('、')}`, removed.length && `取消：${removed.map(id => modelById(id).name).join('、')}`].filter(Boolean).join('；'));
    if (quota !== w.quota) logAudit('调整额度', w.name, `月度额度 ${quotaText(w.quota)} → ${quotaText(quota)}`);
    if (+d.concurrency !== w.concurrency) logAudit('调整并发', w.name, `同时运行的 Agent 任务 ${w.concurrency} → ${d.concurrency}`);
    w.quota = quota; w.concurrency = +d.concurrency; delete state.drafts['ws:' + w.slug]; toast('已保存，立即生效');
  },
  wsfree: el => { state.drafts['ws:' + parse().parts[1]].free = el.dataset.v === 'none'; },
  // 原型：真实产品打开企业域名的工作台，由超级管理员在那里登录；这里打开企业工作台原型的只读支持模式
  'enter-ws': el => { const w = wsBySlug(el.dataset.v); logAudit('进入企业工作台', w.name, `只读 · ${w.domain}`); open('../enterprise-workbench/index.html?as=support#/', '_blank', 'noopener'); toast(`已在新窗口打开「${w.name}」的工作台（只读）`); },
  usage: el => { const {q} = parse(); go('/usage?' + new URLSearchParams({...q, [el.dataset.k]: el.dataset.v}).toString()); return false; },
};
function applyTheme() { if (state.theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = state.theme; }

// ---------- 渲染 ----------
function view() {
  const {parts, q} = parse();
  if (state.notFound) return NotFoundScreen();
  if (!state.session && parts[0] !== 'login') { go('/login'); return null; }
  switch (parts[0]) {
    case 'login': return LoginScreen();
    case 'models': return parts[1] ? ModelScreen(parts[1]) : ServicesScreen();
    case 'services': return parts[1] ? ServiceScreen(parts[1]) : ServicesScreen();
    case 'workspaces': return parts[1] ? WorkspaceScreen(parts[1]) : WorkspacesScreen();
    case 'usage': return UsageScreen(q);
    case 'audit': return AuditScreen();
    default: return ServicesScreen();
  }
}
let lastPath = null;
function render() {
  const {path} = parse(), y = scrollY, html = view();
  if (html == null) return;
  const root = document.querySelector('#app'), ds = document.activeElement?.dataset || {}, focusName = ds.draft || ds.compat || ds.param || ds.wsdraft || ds.plain;
  root.innerHTML = html;
  if (path !== lastPath) {
    scrollTo(0, 0);
    if (!reduced()) [...root.querySelectorAll('.page > *')].slice(0, 6).forEach((el, i) => el.animate([{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'none'}], {duration: 320, delay: i * 30, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards'}));
    document.title = `Hestia 平台管理 · ${root.querySelector('h1')?.textContent || ''}（原型）`;
  } else scrollTo(0, y);
  lastPath = path;
  if (focusName) { const el = root.querySelector(`[data-draft="${focusName}"],[data-compat="${focusName}"],[data-param="${focusName}"],[data-wsdraft="${focusName}"],[data-plain="${focusName}"]`); if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch { /* number inputs */ } } }
  save();
}
// 表单输入：写回草稿；只在“是否有修改”或提示变化时重绘，避免打字时丢焦点
document.addEventListener('input', e => {
  const t = e.target, id = parse().parts[1];
  if (t.dataset.plain) { state[t.dataset.plain] = t.value; save(); return; }
  if (t.dataset.draft) { const was = curDirty(); route().d[t.dataset.draft] = t.value; if (was !== curDirty()) render(); else save(); }
  if (t.dataset.compat) { route().d.compat[t.dataset.compat] = t.value; render(); }
  if (t.dataset.param) { route().d.params[t.dataset.param] = t.value; render(); }
  if (t.dataset.wsdraft) { state.drafts['ws:' + id][t.dataset.wsdraft] = t.value; render(); }
});
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const fn = actions[el.dataset.act]; if (!fn) return;
  e.preventDefault(); const r = fn(el, e); save(); if (r !== false) render();
});
document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]'); if (!form) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (form.dataset.form === 'login') {
    if (data.email.trim().toLowerCase() !== admin.email || data.password !== admin.password) { state.login = {error: 'wrong'}; save(); render(); return; }
    state.session = true; state.login.error = null; save(); go('/models');
  }
});
document.querySelector('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
addEventListener('hashchange', () => { closeModal(); render(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.theme === 'system') render(); });
// 刷新页面时，进行中的检查继续推进
for (const m of state.models) if (m.state === 'checking') { const tick = () => { stepCheck(m.id); if (modelById(m.id)?.state === 'checking') setTimeout(tick, 650); }; setTimeout(tick, 650); }
for (const x of state.services) { if (x.pinging) { delete x.pinging; runPing([x.id]); } if (x.fetching) { delete x.fetching; runFetch(x.id); } }
applyTheme(); render();
