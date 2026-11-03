// 企业工作台交互原型（P02）：柔和中性 B 悬浮，浅色 / 深色两套主题。电脑端、演示数据、不接服务端。
// 规则见 docs/design/WEB_UI_DESIGN.md；按将来的 React 组件拆分：Components → Screens → 路由与状态。
import {icon} from '../../client-h5/src/icons.js';
import {stones, stoneById, layoutName, specLabel, villa, facets, facetById, kindName, makeSchemes, checkFinish, maskPhone, softStyles, softById} from '../../client-h5/src/data.js';
import {swatchURL} from '../../client-h5/src/stone.js';
import {renderImage, mountViewer} from '../../client-h5/src/render3d.js';
import {member, followName, followOrder, statusInfo, seedLeads, lastEvent, needsAction} from './data.js';

const KEY = 'hestia.enterprise-workbench.v2';
const XP = {search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M21 21l-5-5', spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z',
  panel: 'M3 4h18v16H3zM9 4v16', sun: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0', moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'};
const ic = (n, s = 18) => XP[n] ? `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${XP[n]}"/></svg>` : icon(n, s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = () => matchMedia('(max-width: 1180px)').matches;
const freshDraft = () => ({name: '', note: '', floor: 'f1', facets: ['f1-living', 'f1-dining', 'f1-wall', 's12'], stones: ['yashi', 'shaanna']});
const fresh = () => ({session: true, theme: 'system', leads: seedLeads(), seq: 8, ui: {}, draft: freshDraft(), login: {email: member.email, error: null}});
let state;
try { state = JSON.parse(localStorage.getItem(KEY) || 'null') || fresh(); } catch { state = fresh(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 隐私模式仅内存 */ } };

// ---------- 路由 ----------
function parse() { const raw = location.hash.replace(/^#/, '') || '/'; const [path, qs] = raw.split('?'); return {path, parts: path.split('/').filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs || ''))}; }
const go = path => { if (location.hash === '#' + path) render(); else location.hash = path; };
let timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, ms));

// ---------- 小工具 ----------
const leadById = id => state.leads.find(l => l.id === id);
const when = t => { const m = Math.round((Date.now() - t) / 60e3); if (m < 1) return '刚刚'; if (m < 60) return `${m} 分钟前`; const h = Math.round(m / 60); if (h < 24) return `${h} 小时前`; const d = new Date(t); return `${d.getMonth() + 1} 月 ${d.getDate()} 日`; };
const clock = t => { const d = new Date(t); return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const spacedPhone = p => p.replace(/(\d{3})(\d{4})(\d{4})/, '$1 $2 $3');
const who = l => l.customer ? `${esc(l.customer.name || '客户')} · ${maskPhone(l.customer.phone)}` : '未绑定客户';
const sourceName = l => l.source === 'sample' ? '示例别墅' : l.source === 'dxf' ? `DXF 图纸 · ${esc(l.fileName)}` : `${esc(l.fileName)} · 需辅助转换`;
const confirmed = l => l.events.filter(e => e.kind === 'confirm').at(-1);
const floorsOf = l => villa.floors.filter(fl => l.facets.some(id => facetById[id]?.floor === fl.id));
const finishLine = (fid, fin) => { const f = facetById[fid]; if (!fin) return '未铺石材'; const s = stoneById[fin.stone].name; return f.kind === 'stair' ? `${s} · 整板踏步` : `${s} · ${specLabel(fin.spec)} · ${layoutName[fin.layout]}${fin.border ? ` · ${stoneById[fin.borderStone].name}波打线` : ''}`; };
const kinds = l => (l.kinds || []).map(k => ({floor: '各层地面', wall: '背景墙', stair: '楼梯踏面'}[k])).join('、');
function planSVG(floorId, selected) {
  const fl = villa.floors.find(f => f.id === floorId), s = 100 / 12;
  const sel = new Set(selected.map(id => facetById[id]).filter(f => f && f.floor === floorId).map(f => f.kind === 'wall' ? f.room + ':wall' : f.room));
  return `<svg class="plan-svg" viewBox="-1 -1 ${fl.footprint[0] * s + 2} ${fl.footprint[1] * s + 2}" role="img" aria-label="${fl.name}平面示意">${fl.rooms.map(r => {
    const [x, z, w, d] = r.rect, on = sel.has(r.id);
    const steps = r.stair ? Array.from({length: 6}, (_, i) => `<line x1="${x * s}" x2="${(x + w) * s}" y1="${(z + .4 + i * (d - .8) / 5) * s}" y2="${(z + .4 + i * (d - .8) / 5) * s}"/>`).join('') : '';
    const wall = sel.has(r.id + ':wall') ? `<rect class="pl-wall" x="${(x + w / 2 - 2.1) * s}" y="${z * s}" width="${4.2 * s}" height="${.35 * s}"/>` : '';
    return `<g class="${on ? 'on' : ''}"><rect x="${x * s}" y="${z * s}" width="${w * s}" height="${d * s}"/>${steps}${wall}<text x="${(x + w / 2) * s}" y="${(z + d / 2) * s + 1.3}">${r.name}</text></g>`;
  }).join('')}</svg>`;
}

// ========== Components ==========
// 状态标签：中性底 + 文字；只有需要成员处理的状态用强调色（准则 C4 / C5）
const Tag = (text, act = false) => `<span class="tag${act ? ' tag--act' : ''}">${text}</span>`;
const StatusTag = st => Tag(statusInfo[st][0], ['review', 'assist', 'drafting'].includes(st));
const Note = (kind, title, text) => `<p class="note note--${kind}"${kind === 'danger' ? ' role="alert"' : ''}>${icon(kind === 'danger' ? 'alert' : kind === 'ok' ? 'check' : 'info', 16)}<span><b>${title}</b>${text}</span></p>`;
const Btn = (label, {kind = 'primary', act, k, v, href, sm, grow, lead, disabled, attrs = ''} = {}) => {
  const cls = `btn btn--${kind}${sm ? ' btn--sm' : ''}${grow ? ' btn--grow' : ''}`, inner = `${lead ? ic(lead, sm ? 14 : 16) : ''}${label}`;
  return href && !disabled ? `<a class="${cls}" href="#${href}">${inner}</a>` : `<button class="${cls}"${act ? ` data-act="${act}"` : ''}${k ? ` data-k="${k}"` : ''}${v != null ? ` data-v="${esc(v)}"` : ''}${disabled ? ' disabled' : ''} ${attrs}>${inner}</button>`;
};
const ActionBar = (hint, actions) => `<div class="action-bar"><span class="hint">${hint}</span>${actions}</div>`;
const Steps = (labels, at) => `<ol class="steps-row">${labels.map((t, i) => `<li data-s="${i < at ? 'done' : i === at ? 'now' : 'todo'}"><i>${i < at ? icon('check', 12) : ''}</i>${t}</li>`).join('')}</ol>`;
const isDark = () => document.documentElement.dataset.theme === 'dark' || (state.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
function TopBar(nav) {
  const counts = state.leads.reduce((n, l) => { const a = needsAction(l); return n + (a.review || a.assist || a.contact || a.apply ? 1 : 0); }, 0), dark = isDark();
  return `<header class="topbar"><a class="brand" href="#/"><span class="brand-mark" aria-label="演示家装企业标志（占位）">标志</span><b>演示家装企业</b></a>
    ${nav === false ? '' : `<nav class="topnav" aria-label="工作台">${[['today', '/', '今日', counts], ['leads', '/leads', '线索'], ['new', '/new', '预置方案'], ['stones', '/stones', '石材与软装']].map(([k, href, t, n]) => `<a href="#${href}"${nav === k ? ' aria-current="page"' : ''}>${t}${n ? `<span class="count">${n}</span>` : ''}</a>`).join('')}</nav>`}
    <div class="topbar__end">${nav === false ? '' : `<label class="search">${ic('search', 15)}<input id="gsearch" placeholder="搜索客户或项目"></label>`}
      <button class="icon-btn" data-act="theme" aria-label="${dark ? '切换到浅色' : '切换到深色'}">${ic(dark ? 'sun' : 'moon', 17)}</button>
      ${state.session && nav !== false ? `<span class="member"><span class="member__name">${member.name}</span><span class="avatar" title="${member.name}">顾</span></span><button class="icon-btn" data-act="logout" aria-label="退出登录">${icon('logout', 16)}</button>` : ''}
      <button class="proto-btn" data-act="review">审阅</button></div></header>`;
}
const Shell = (content, nav) => `${TopBar(nav)}<main id="page">${content}</main>`;

// ========== Screens ==========
// 登录 / 无权访问：效果图铺底，登录面板悬浮
function LoginScreen() {
  const L = state.login;
  return Shell(`<section class="auth"><img data-render="f1" data-demo="1" data-w="1600" data-h="900" alt="">
    <form class="panel" data-form="login"><h1>登录企业工作台</h1><p class="muted" style="margin-top:6px">使用企业邀请时设置的邮箱和密码。工作台不开放注册。</p>
      <label class="field"><span>邮箱</span><input class="input" name="email" type="email" autocomplete="username" value="${esc(L.email)}"></label>
      <label class="field"><span>密码</span><input class="input" name="password" type="password" autocomplete="current-password" placeholder="演示密码：${member.password}"></label>
      ${L.error ? Note('danger', L.error === 'wrong' ? '登录失败' : '无权访问', L.error === 'wrong' ? '邮箱或密码不正确，请检查后重试。' : '这个账号不是本企业的成员。') : ''}
      <button class="btn btn--primary" type="submit">登录</button>
      <p class="muted small" style="margin-top:14px">客户请从企业的 H5 入口用手机号登录。</p></form>
    <span class="auth__caption">示例别墅一层客厅 · 效果图示意</span></section>`, false);
}
function DeniedScreen() {
  return Shell(`<section class="auth"><img data-render="f1" data-demo="1" data-w="1600" data-h="900" alt="">
    <div class="panel"><h1>这个账号不是本企业成员</h1><p class="muted" style="margin-top:8px">企业工作台只对企业成员开放。客户请使用企业的 H5 入口；如需成为成员，请联系企业管理员邀请。</p>
      ${Btn('换一个账号登录', {kind: 'secondary', act: 'logout'})}</div></section>`, false);
}

// 今日
function TodayScreen() {
  const act = state.leads.map(l => [l, needsAction(l)]), n = pred => act.filter(([, a]) => pred(a)).length;
  const list = (pred, line) => { const items = act.filter(([, a]) => pred(a)).map(([l]) => l); return items.length ? `<ul class="todo">${items.map(l => `<li><a href="#/lead/${l.id}"><b>${esc(l.title)}</b><small>${line(l)}</small></a></li>`).join('')}</ul>` : '<p class="todo none">暂无</p>'; };
  const col = (title, count, body) => `<section class="panel"><header class="panel__head"><h2 class="panel__title">${title}</h2><span class="muted small num">${count}</span></header><div class="panel__body">${body}</div></section>`;
  const recent = state.leads.flatMap(l => l.events.map(e => ({...e, l}))).sort((a, b) => b.at - a.at).slice(0, 7);
  return Shell(`<div class="page"><header class="page__head"><div><h1 class="page__title">今日</h1><p class="page__sub">${n(a => a.review || a.assist || a.contact || a.apply)} 件需要处理：客户请求联系的先回电，自动转换的图纸核对后再发布，绑定申请核对身份后批准。</p></div>
      <div class="chips">${Btn('全部线索', {kind: 'secondary', href: '/leads'})}${Btn('预置方案', {href: '/new', lead: 'plus'})}</div></header>
    <div class="page__grid today">
      ${col('请求联系', n(a => a.contact), list(a => a.contact, l => `${who(l)} · ${esc(l.events.find(e => e.kind === 'contact').text.split(' · ')[1] || '')} · ${when(lastEvent(l).at)}`))}
      ${col('待审核与辅助转换', n(a => a.review || a.assist), list(a => a.review || a.assist, l => `${l.status === 'review' ? 'DXF 已自动转换，待核对' : '非 DXF 图纸，需导入户型'} · ${when(l.createdAt)}`))}
      ${col('待批准绑定', n(a => a.apply), list(a => a.apply, l => { const a = l.applications.find(x => x.status === 'pending'); return `${maskPhone(a.phone)} · ${esc(a.note.split('：')[0])} · ${when(a.at)}`; }))}
    </div>
    <section class="panel recent" style="margin-top:16px"><header class="panel__head"><h2 class="panel__title">最近动态</h2><a class="text-link" href="#/leads">全部线索</a></header>
      <div class="panel__body"><ol class="feed">${recent.map(e => `<li><time>${when(e.at)}</time><span><a class="strong" href="#/lead/${e.l.id}">${esc(e.l.title)}</a> · ${esc(e.text)}</span></li>`).join('')}</ol></div></section></div>`, 'today');
}

// 线索列表
const stageOf = l => ['assist', 'review', 'drafting'].includes(l.status) ? 'review' : l.status === 'confirmed' ? 'confirmed' : 'published';
function LeadsScreen(q) {
  const s = q.s || 'all', f = q.f || '', text = (q.t || '').trim();
  let rows = state.leads.filter(l => s === 'all' || stageOf(l) === s);
  if (f === 'contact') rows = rows.filter(l => needsAction(l).contact);
  else if (f === 'apply') rows = rows.filter(l => needsAction(l).apply);
  else if (f === 'todo') rows = rows.filter(l => needsAction(l).review || needsAction(l).assist);
  else if (followOrder.includes(f)) rows = rows.filter(l => l.follow === f);
  if (text) rows = rows.filter(l => (l.customer?.phone || '').includes(text) || (l.customer?.name || '').includes(text) || l.title.includes(text));
  rows.sort((a, b) => lastEvent(b).at - lastEvent(a).at);
  const count = v => state.leads.filter(l => v === 'all' || stageOf(l) === v).length;
  const link = patch => '#/leads?' + new URLSearchParams(Object.entries({s, f, t: text, ...patch}).filter(([, v]) => v && v !== 'all')).toString();
  const quick = [['contact', '请求联系', 'phone', l => needsAction(l).contact], ['todo', '待审核 / 辅助转换', 'file', l => needsAction(l).review || needsAction(l).assist], ['apply', '待批准绑定', 'link', l => needsAction(l).apply]];
  return Shell(`<div class="page"><header class="page__head"><div><h1 class="page__title">线索</h1><p class="page__sub">客户自助提交的需求，以及企业为客户预置并分享的方案。跟进状态只有企业成员能看到。</p></div>${Btn('预置方案', {href: '/new', lead: 'plus'})}</header>
    <div class="quick">${quick.map(([v, t, i, pred]) => `<button class="quick__item" aria-pressed="${f === v}" data-act="nav" data-v="${link({f: f === v ? '' : v})}">${icon(i, 20)}<span><b>${state.leads.filter(pred).length}</b><small>${t}</small></span></button>`).join('')}</div>
    <div class="list-tools"><div class="segmented" role="group" aria-label="状态">${[['all', '全部'], ['review', '待审核'], ['published', '已发布'], ['confirmed', '客户已确认']].map(([v, t]) => `<button aria-pressed="${s === v}" data-act="nav" data-v="${link({s: v})}">${t}<small>${count(v)}</small></button>`).join('')}</div>
      <div class="chips" role="group" aria-label="跟进">${followOrder.map(k => `<button class="chip" aria-pressed="${f === k}" data-act="nav" data-v="${link({f: f === k ? '' : k})}">${followName[k]}</button>`).join('')}</div>
      <label class="search">${ic('search', 15)}<input id="search" placeholder="手机号、称呼或项目名" value="${esc(text)}"></label></div>
    ${rows.length ? `<div class="table" role="table" aria-label="线索列表"><div class="table__head" role="row"><span></span><span>项目 / 客户</span><span>状态</span><span>跟进</span><span>最近动作</span><span></span></div>
      ${rows.map(l => { const a = needsAction(l), e = lastEvent(l); return `<a class="table__row" role="row" href="#/lead/${l.id}">
        <span class="thumb">${l.schemes ? `<img data-render="f1" data-lead="${l.id}" data-w="240" data-h="160" alt="">` : icon('file', 20)}</span>
        <span class="cell-main"><b>${esc(l.title)}</b><small>${who(l)} · ${l.origin === 'member' ? '企业预置' : '客户自助'}</small>${a.contact ? `<em class="flag">${icon('phone', 13)} 请求联系</em>` : ''}${a.apply ? `<em class="flag">${icon('link', 13)} 绑定申请待批准</em>` : ''}</span>
        <span>${StatusTag(l.status)}</span><span class="follow follow--${l.follow}">${followName[l.follow]}</span>
        <span class="cell-event">${esc(e.text)}<small>${when(e.at)}</small></span><span class="chev">${icon('chevron', 16)}</span></a>`; }).join('')}</div>`
      : `<div class="panel" style="margin-top:16px"><div class="empty"><b>没有符合条件的线索</b>换一个筛选条件，或 <a class="text-link" href="#/leads">清空筛选</a></div></div>`}</div>`, 'leads');
}

// 线索详情 = 方案工作台：画面铺满，左侧方案与客户面板、右侧 Agent 助手
const candidateOf = l => l.agent?.candidate || null;
const schemesOf = l => [...(l.schemes || []), ...(candidateOf(l) ? [{...candidateOf(l), candidate: true}] : [])];
const uiOf = l => { const u = state.ui[l.id] ||= {}; return Object.assign(u, {scheme: u.scheme || confirmed(l)?.text.match(/方案 (\w)/)?.[1] || 'A', floor: u.floor || 'f1', view: u.view || 'image', tab: u.tab || 'scheme', left: u.left ?? true, agent: u.agent ?? false}); };
function WorkspaceScreen(l) {
  const ui = uiOf(l), list = schemesOf(l), floors = list.length ? floorsOf(l) : [];
  if (narrow() && ui.left && ui.agent) ui.left = false;
  if (floors.length && !floors.some(f => f.id === ui.floor)) ui.floor = floors[0].id;
  if (list.length && !list.some(x => x.id === ui.scheme)) ui.scheme = list[0].id;
  const s = list.find(x => x.id === ui.scheme), conf = confirmed(l), a = needsAction(l), confId = conf?.text.match(/方案 (\w)/)?.[1];
  const floorName = villa.floors.find(f => f.id === ui.floor).name, view = s ? ui.view : (l.source === 'sample' ? '3d' : 'plan');
  const blocked = l.status === 'assist' ? '图纸完成辅助转换后，才能让 Agent 出方案。' : '';
  const hidden = s && (s.candidate || s.pending);
  // 画面
  const media = view === 'image' ? `<img class="stage__img" data-render="${ui.floor}" data-lead="${l.id}" data-scheme="${s.id}"${s.candidate ? ` data-cand="${l.id}"` : ''} data-w="1600" data-h="900" alt="方案 ${s.id} 效果图（示意）">`
    : view === '3d' ? `<div class="stage__3d" data-viewer="${l.id}" data-floor="${ui.floor}" aria-label="${floorName} 3D 视图，拖动旋转"></div>`
      : `<div class="stage__plan">${l.status === 'review' ? `<div class="levels">${villa.floors.map(fl => `<figure><div class="plan-box">${planSVG(fl.id, l.facets)}</div><figcaption>${fl.name}</figcaption></figure>`).join('')}</div><p>自动转换的户型 · 核对后生成待审方案</p>` : '<p>图纸需要辅助转换，导入户型并生成方案后在这里显示</p>'}</div>`;
  const caption = `<div class="caption"><b>${s ? `${s.candidate ? 'Agent 候选' : '方案'} ${s.id} · ${esc(s.title)}` : '还没有方案'}</b><span>${s ? `${hidden ? '客户不可见' : `修订 ${l.revisions?.[s.id] || 1}${s.id === confId ? ' · 客户已确认' : ''}`} · ${floorName} · ${view === 'image' ? '效果图示意' : '拖动旋转'}` : view === '3d' ? '示例别墅 · 未铺石材 · 拖动旋转' : '平面示意'}</span></div>`;
  const toolbar = `<div class="toolbar" role="toolbar" aria-label="画面">
    <button class="tool" aria-pressed="${ui.left}" data-act="left" aria-label="${ui.left ? '收起方案面板' : '打开方案面板'}">${ic('panel', 18)}</button>
    ${floors.length > 1 ? `<span class="toolbar__sep"></span><div class="segmented segmented--bare">${floors.map(f => `<button aria-pressed="${ui.floor === f.id}" data-act="floor" data-v="${f.id}">${f.name}</button>`).join('')}</div>` : ''}
    ${s ? `<span class="toolbar__sep"></span><div class="segmented segmented--bare">${[['image', '效果图', 'image'], ['3d', '3D', 'cube']].map(([v, t, i]) => `<button aria-pressed="${ui.view === v}" data-act="view" data-v="${v}">${ic(i, 15)}${t}</button>`).join('')}</div>` : ''}
    <span class="toolbar__sep"></span><button class="tool tool--label" aria-pressed="${ui.agent && !blocked}" data-act="agent"${blocked ? ` disabled title="${blocked}"` : ''}>${ic('spark', 16)} Agent</button></div>`;
  // 左侧面板
  const facetsHere = s ? l.facets.filter(id => facetById[id].floor === ui.floor && s.finishes[id]) : [];
  const soft = s && softById[s.soft];
  const schemeTab = list.length ? `<ul class="schemes">${list.map(x => { const fid = l.facets.find(id => x.finishes[id]); return `<li><button class="scheme${x.candidate ? ' scheme--cand' : ''}" aria-pressed="${x.id === s.id}" data-act="scheme" data-v="${x.id}">
        <img class="scheme__thumb" data-render="f1" data-lead="${l.id}" data-scheme="${x.id}"${x.candidate ? ` data-cand="${l.id}"` : ''} data-w="200" data-h="140" alt="">
        <span class="scheme__main"><b>${x.id} · ${esc(x.title)}</b><small>${softById[x.soft]?.name || '—'} · ${fid ? stoneById[x.finishes[fid].stone].name : '—'}</small></span>
        <span class="scheme__meta">${x.id === confId ? '客户已确认' : x.candidate ? Tag('候选', true) : x.pending ? Tag('待审', true) : `修订 ${l.revisions?.[x.id] || 1}`}</span></button></li>`; }).join('')}</ul>
      <section class="sect" style="margin-top:22px"><h3 class="sect__title">${floorName}硬装<small>${s.candidate ? 'Agent 候选' : `方案 ${s.id}`}</small></h3>${facetsHere.map(id => `<div class="kv"><span>${facetById[id].name}</span><b><i class="sw" style="background-image:url(${swatchURL(s.finishes[id].stone, 32)})"></i>${finishLine(id, s.finishes[id])}</b></div>`).join('') || '<p class="muted small">本层没有铺贴饰面</p>'}</section>
      ${soft ? `<section class="sect"><h3 class="sect__title">软装 · ${soft.name}</h3><p class="muted small">${esc(soft.line)}</p>${villa.floors.find(f => f.id === ui.floor).rooms.map(r => r.name).filter(n => soft.rooms[n]).map(n => `<div class="kv"><span>${n}</span><b>${esc(soft.rooms[n])}</b></div>`).join('')}<div class="palette">${Object.values(soft.palette).map(c => `<i style="background:${c}"></i>`).join('')}</div></section>` : ''}`
    : `<p class="muted">${l.status === 'review' ? '图纸已自动转换，核对后生成待审方案。' : l.status === 'assist' ? '图纸不能自动识别，需要导入整理好的户型。' : '还没有方案。可以打开 Agent 助手，让它在企业目录内出整体方案。'}</p>`;
  const clientTab = `<section class="sect"><div class="kv"><span>客户</span>${l.customer ? `<b class="phone-full">${spacedPhone(l.customer.phone)}</b><small class="muted">${esc(l.customer.name || '未留称呼')} · 已验证手机号</small>` : '<b class="muted">尚未绑定</b>'}</div>
      <div class="kv"><span>户型</span><b>${sourceName(l)}</b></div><div class="kv"><span>饰面</span><b>${l.facets.length ? `${l.facets.length} 处 · ${floorsOf(l).map(f => f.name).join('、')}` : `${kinds(l)}（待确认）`}</b></div>
      <div class="kv"><span>石材</span><b>${l.stones.map(id => stoneById[id].name).join('、')}</b></div><div class="kv"><span>偏好</span><b>${esc(l.prefs)}</b></div>${l.note ? `<div class="kv"><span>说明</span><b>${esc(l.note)}</b></div>` : ''}</section>
    <section class="sect"><h3 class="sect__title">跟进<small>仅企业成员可见</small></h3><div class="segmented segmented--wrap" role="radiogroup" aria-label="跟进状态">${followOrder.map(k => `<button role="radio" aria-checked="${l.follow === k}" data-act="follow" data-v="${k}">${followName[k]}</button>`).join('')}</div>
      <form data-form="note" style="margin-top:10px"><textarea class="input" name="note" rows="2" maxlength="500" placeholder="内部备注，例如：已约周六到店看样。"></textarea><div style="margin-top:8px">${Btn('添加备注', {kind: 'secondary', sm: true, attrs: 'type="submit"'})}</div></form>
      ${l.notes.length ? `<ol class="feed" style="margin-top:8px">${[...l.notes].reverse().map(n => `<li><time>${clock(n.at)}</time><span>${esc(n.text)}<small class="muted">${esc(n.by)}</small></span></li>`).join('')}</ol>` : ''}</section>
    <section class="sect"><h3 class="sect__title">客户动作</h3><ol class="feed">${[...l.events].reverse().map(e => `<li><time>${clock(e.at)}</time><span${e.kind === 'contact' ? ' class="strong"' : ''}>${esc(e.text)}${e.message ? `<q>${esc(e.message)}</q>` : ''}</span></li>`).join('')}</ol></section>`;
  const shareTab = l.origin === 'customer' ? '<p class="muted">客户自助提交的项目属于客户本人，不需要分享与绑定。</p>' : `
    ${l.customer ? `<div class="share"><div class="share__head"><b>主客户 · ${esc(l.customer.name || '客户')}</b>${Btn('解绑', {kind: 'danger', sm: true, act: 'confirm', k: 'unbind', v: l.id})}</div><p class="num">${spacedPhone(l.customer.phone)} · 解绑后客户不能再打开这个项目，可以重新分享给其他人。</p></div>` : ''}
    ${l.applications.filter(x => x.status === 'pending').map(x => `<div class="share"><div class="share__head"><b>绑定申请 · <span class="num">${maskPhone(x.phone)}</span></b>${Tag('待批准', true)}</div><p>${esc(x.note)} · ${when(x.at)}</p>
      <div class="row-actions">${Btn('核对无误，批准绑定', {sm: true, act: 'confirm', k: 'approve', v: `${l.id}:${x.id}`})}${Btn('拒绝', {kind: 'danger', sm: true, act: 'confirm', k: 'reject', v: `${l.id}:${x.id}`})}</div></div>`).join('')}
    ${l.shares.map(sh => `<div class="share"><div class="share__head"><b>${sh.mode === 'phone' ? `定向分享 · <span class="num">${maskPhone(sh.phone)}</span>` : '绑定码分享'}</b>${Tag(sh.status === 'active' ? '有效' : '已撤销')}</div>
      <p>${sh.mode === 'phone' ? '客户用该手机号登录即自动绑定；其他号码只能预览或提交申请。' : `一次性绑定码，${sh.codeExpires ? `有效至 ${sh.codeExpires}` : '48 小时内有效'}。`}链接有效至 <span class="num">${sh.expires}</span>。</p>
      ${sh.status === 'active' ? `<div class="row-actions">${Btn('撤销链接', {kind: 'secondary', sm: true, act: 'confirm', k: 'revoke', v: `${l.id}:${sh.id}`})}</div>` : ''}</div>`).join('')}
    ${!l.shares.length && !l.customer ? '<p class="muted small">还没有分享。</p>' : ''}
    ${l.schemes && l.status === 'published' ? `<div style="margin-top:12px">${Btn('新建分享', {kind: 'secondary', sm: true, act: 'share', v: l.id, lead: 'plus'})}</div>` : ''}
    ${l.history.length ? `<section class="sect"><h3 class="sect__title">记录</h3><ol class="feed">${[...l.history].reverse().map(h => `<li><time>${clock(h.at)}</time><span>${esc(h.text)}</span></li>`).join('')}</ol></section>` : ''}`;
  const foot = s?.candidate ? `<span class="hint">候选客户看不到。采用后成为待审方案 D，核对后再发布。</span>${Btn('放弃候选', {kind: 'secondary', act: 'agent-discard'})}${Btn('采用为待审方案', {grow: true, act: 'confirm', k: 'adopt', v: l.id})}`
    : s?.pending ? `<span class="hint">待审方案 ${s.id} 客户看不到。核对效果图与清单后发布。</span>${Btn(`发布方案 ${s.id}`, {grow: true, act: 'confirm', k: 'publishD', v: `${l.id}:${s.id}`})}`
      : l.status === 'review' ? `<span class="hint">图纸自动转换的结果需要核对后才能发布给客户。</span>${Btn('审核并发布', {grow: true, href: `/lead/${l.id}/review`})}`
        : l.status === 'assist' ? `<span class="hint">这份图纸不能自动识别，需要导入整理好的户型。</span>${Btn('辅助转换', {grow: true, href: `/lead/${l.id}/assist`})}`
          : l.origin === 'member' ? (l.schemes ? `<span class="hint">${l.customer ? `已绑定 ${maskPhone(l.customer.phone)}` : '还没有绑定客户。'}</span>${Btn('分享给客户', {grow: true, act: 'share', v: l.id, lead: 'link'})}` : '<span class="hint">让 Agent 出方案，采用并发布后才能分享。</span>')
            : a.contact ? `<span class="hint">客户确认后请求联系，方便时间：下午。</span>${Btn('已回电，标记为已联系', {grow: true, act: 'follow', v: 'contacted'})}` : '';
  const tabs = [['scheme', '方案'], ['client', '客户与跟进'], ['share', '分享与绑定']];
  const left = ui.left ? `<aside class="float float--left" aria-label="方案与客户">
      <header class="float__head"><a class="back" href="#/leads">${icon('back', 16)} 线索</a><h1 class="lead-title">${esc(l.title)}</h1>
        <p class="muted">${StatusTag(l.status)} ${l.origin === 'member' ? '企业预置' : '客户自助'} · ${when(l.createdAt)}${a.contact ? ` · ${Tag('请求联系', true)}` : ''}${a.apply ? ` · ${Tag('绑定申请', true)}` : ''}</p>
        <div class="segmented">${tabs.map(([k, t]) => `<button aria-pressed="${ui.tab === k}" data-act="tab" data-v="${k}">${t}</button>`).join('')}</div></header>
      <div class="float__body">${ui.tab === 'scheme' ? schemeTab : ui.tab === 'client' ? clientTab : shareTab}</div>${foot ? `<footer class="float__foot">${foot}</footer>` : ''}</aside>` : '';
  const agent = ui.agent && !blocked ? AgentPanel(l, s) : '';
  return Shell(`<section class="canvas${ui.left ? ' has-left' : ''}${agent ? ' has-right' : ''}"><div class="stage">${media}</div>${caption}${left}${agent}${toolbar}</section>`, 'leads');
}

// Agent 助手：辅助面板，以当前方案为起点，结果作为候选进入同一画面
const prompts = ['客厅大气一点，二层主卧做新中式', '整体换成轻奢风，地面保持浅色', '客厅地面用爵士白大板'];
function agentPlan(text) {
  if (/爵士白/.test(text)) return {rejected: '企业石材库中没有「爵士白」。可选的浅色石材：雅士白、鱼肚白。要改用鱼肚白大板吗？'};
  const lux = /轻奢/.test(text);
  return {soft: lux ? 'luxury' : 'chinese', stones: lux ? ['yudu', 'heijin'] : ['feiwang', 'yashi'], title: lux ? '浅色轻奢' : '雅致新中式', theme: lux ? 0 : 1,
    steps: ['读取 9 处饰面与企业目录（石材 6 款、软装风格 3 套）', lux ? '硬装：客厅、餐厅地面 鱼肚白 750×1500 直铺，黑金花波打线' : '硬装：客厅、餐厅地面 雅士白 800×800 斜铺，黑金花波打线；背景墙 啡网纹工字铺',
      lux ? '软装：轻奢（弧形丝绒沙发、大理石金属茶几、浅色长毛地毯）' : '软装：客厅新中式（圈椅、长条茶几、屏风），二层主卧实木架子床', '排版与家具碰撞校验：通过，1 条窄条提示', '出图：客厅、起居厅、茶室']};
}
function AgentPanel(l, s) {
  const A = l.agent ||= {status: 'idle', messages: [], candidate: null}, st = A.status;
  const base = s && !s.candidate ? `方案 ${s.id} · ${esc(s.title)}` : s?.candidate ? '当前候选' : '空白户型';
  const msgs = A.messages.map(m => m.role === 'user' ? `<div class="msg msg--me">${esc(m.text)}</div>`
    : `<div class="msg msg--ai">${m.steps ? `<ol class="steps">${m.steps.map((t, i) => `<li class="${i < (m.done ?? m.steps.length) ? 'done' : i === m.done ? 'now' : ''}">${esc(t)}</li>`).join('')}</ol>` : ''}${m.text ? `<p>${esc(m.text)}</p>` : ''}${m.view && candidateOf(l) ? Btn('在画面中查看', {kind: 'secondary', sm: true, act: 'scheme', v: 'D'}) : ''}${m.fallback ? Btn('打开预先出好的演示方案', {kind: 'secondary', sm: true, act: 'agent-fallback', v: l.id}) : ''}</div>`).join('');
  return `<aside class="float float--right" aria-label="Agent 助手">
    <header class="float__head row"><div><b class="float__title">${ic('spark', 16)} Agent 助手</b><p class="muted">以「${base}」为起点 · 结果先作为候选</p></div><button class="icon-btn" data-act="agent" aria-label="收起 Agent 助手">${icon('close', 16)}</button></header>
    <div class="float__body chat" id="agent-log">${msgs || '<p class="agent-intro">说出客户的要求，Agent 在企业石材库与软装目录内出整体方案（硬装 + 软装）。候选会出现在画面和方案列表里，客户看不到，由你决定是否采用。</p>'}
      ${st !== 'running' && !candidateOf(l) ? `<div class="agent-prompts">${prompts.map(t => `<button class="chip" data-act="agent-say" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}</div>
    <form class="composer" data-form="agent"><textarea name="text" rows="2" maxlength="300" placeholder="${candidateOf(l) ? '继续调整候选，例如：主卧换成轻奢' : '描述客户的要求，例如：二层主卧换成轻奢风'}"${st === 'running' ? ' disabled' : ''}></textarea><button class="btn btn--primary btn--icon" type="submit" aria-label="发送"${st === 'running' ? ' disabled' : ''}>${icon('send', 16)}</button></form></aside>`;
}
function agentRun(l, text) {
  const A = l.agent ||= {status: 'idle', messages: [], candidate: null};
  A.messages.push({role: 'user', text});
  if (A.forceNoModel) { A.status = 'nomodel'; A.messages.push({role: 'ai', text: '没有可用的模型（未配置或网络不可用），这次请求没有执行，不会模拟结果。', fallback: true}); return; }
  const plan = agentPlan(text);
  if (plan.rejected) { A.messages.push({role: 'ai', text: plan.rejected}); return; }
  const m = {role: 'ai', steps: plan.steps, done: 0}; A.messages.push(m); A.status = 'running';
  const tick = () => { m.done++; if (m.done < plan.steps.length) { save(); render(); setTimeout(tick, 700); return; }
    const base = makeSchemes(l.facets.length ? l.facets : ['f1-living', 'f1-dining', 'f1-wall', 's12'], plan.stones)[plan.theme];
    A.candidate = {...base, id: 'D', title: plan.title, soft: plan.soft};
    Object.assign(m, {text: `候选「${plan.title}」已放到画面里：硬装与软装都通过校验，客户看不到。可以继续调整，或在左侧采用为待审方案。`, view: true}); A.status = 'ready';
    Object.assign(uiOf(l), {scheme: 'D', view: 'image', tab: 'scheme'}); if (!narrow()) uiOf(l).left = true;
    save(); render(); };
  setTimeout(tick, 700);
}

// 审核发布（DXF 待审核）
function ReviewScreen(l) {
  const stage = l.stage || 'converted', at = {converted: 1, generating: 1, ready: 2}[stage];
  let body;
  if (stage === 'converted') body = `<section class="panel"><header class="panel__head"><h2 class="panel__title">自动转换结果</h2><span class="muted small">${l.convert.levels} 层 · ${l.convert.finishes} 处可铺贴饰面 · ${l.convert.scale}</span></header>
      <div class="panel__body"><div class="levels">${villa.floors.map(fl => `<figure><div class="plan-box">${planSVG(fl.id, l.facets)}</div><figcaption>${fl.name} · 深色为派生的铺贴饰面</figcaption></figure>`).join('')}</div>
      ${l.convert.hints.map(h => Note('hint', '请核对', esc(h))).join('')}<p class="muted small" style="margin-top:12px">核对无误后生成待审方案：系统按房间派生地面与楼梯饰面，用客户选择的石材按规则生成 3 个方案并出图。客户在发布前看不到这些方案。</p></div></section>`;
  else if (stage === 'generating') body = `<section class="panel"><div class="empty"><b>正在生成待审方案</b>排版、校验并后台出图 · 每张约 1–2 分钟（原型中加速）<div class="bar-progress" style="max-width:360px;margin:16px auto 0"><i></i></div></div></section>`;
  else { const hints = l.schemes.map(sc => Object.entries(sc.finishes).flatMap(([id, fin]) => checkFinish(id, fin)));
    body = `<div class="page__head" style="margin-bottom:12px"><h2 class="panel__title">待审方案 <span class="muted small">只有企业成员可见</span></h2>${Btn('重新生成', {kind: 'secondary', sm: true, act: 'regen', v: l.id})}</div>
      <div class="review-grid">${l.schemes.map((sc, i) => `<article class="panel review-card"><img data-render="f1" data-lead="${l.id}" data-scheme="${sc.id}" data-w="720" data-h="540" alt="方案 ${sc.id} 效果图（示意）">
        <div class="panel__body"><b>${sc.id} · ${esc(sc.title)}</b><p>${esc(sc.line)}</p><ul class="hint-lines">${hints[i].length ? hints[i].map(h => `<li class="hint-line hint-line--${h.level === 'conflict' ? 'danger' : 'hint'}">${icon(h.level === 'conflict' ? 'alert' : 'info', 14)}<span><b>${h.level === 'conflict' ? '冲突' : '提示'}</b>${esc(h.text)}</span></li>`).join('') : `<li class="hint-line">${icon('check', 14)}<span><b>排版校验通过</b></span></li>`}</ul></div></article>`).join('')}</div>`; }
  return Shell(`<div class="page"><a class="back" href="#/lead/${l.id}">${icon('back', 16)} 返回方案工作台</a>
    <header class="page__head" style="margin-top:12px"><div><h1 class="page__title">审核 ${esc(l.fileName)}</h1><p class="page__sub">${l.reviewReason}。为避免尺寸或饰面边界不准确的方案误导客户，核对后再发布。</p></div></header>
    <div class="flow"><aside class="panel"><div class="panel__body" style="padding-top:16px">${Steps(['图纸已转换', '生成待审方案', '核对效果图与提示', '发布给客户'], at)}
      <section class="sect"><div class="kv"><span>客户</span><b>${who(l)}</b></div><div class="kv"><span>石材</span><b>${l.stones.map(id => stoneById[id].name).join('、')}</b></div><div class="kv"><span>偏好</span><b>${esc(l.prefs)}</b></div></section></div></aside>
      <div>${body}</div></div></div>
    ${ActionBar(stage === 'converted' ? '转换结果有误时，可改为辅助转换：导入整理好的户型。' : stage === 'generating' ? '出图完成后可以发布。' : '只发布通过排版校验的方案；有「提示」的方案可以发布。',
      stage === 'converted' ? `${Btn('改为辅助转换', {kind: 'secondary', href: `/lead/${l.id}/assist`})}${Btn('生成待审方案', {act: 'generate', v: l.id})}` : stage === 'generating' ? Btn('发布给客户', {disabled: true}) : Btn('发布给客户', {act: 'confirm', k: 'publish', v: l.id}))}`, 'leads');
}

// 辅助转换
function AssistScreen(l) {
  const st = l.assistStage || 'waiting', at = {waiting: 2, validating: 2, invalid: 2, valid: 3}[st];
  const drop = st === 'waiting' ? `<div class="drop">${icon('upload', 24)}<b>拖入或选择户型文件</b><span class="small">HouseSpec（JSON，单位毫米），包含楼层、墙体、门窗与楼梯；导入后先校验，再派生铺贴饰面</span>
      <div class="row-actions">${Btn('使用演示户型文件', {kind: 'secondary', sm: true, act: 'assist', v: 'ok'})}${Btn('演示校验失败', {kind: 'secondary', sm: true, act: 'assist', v: 'bad'})}</div></div>`
    : st === 'validating' ? `<div class="drop"><b>正在校验户型…</b><div class="bar-progress" style="width:300px"><i></i></div></div>`
      : st === 'invalid' ? `${Note('danger', '户型未通过校验', '二层楼梯开洞与楼梯位置不一致；三层外墙未闭合（东北角缺 0.4 m）。修正后重新导入。')}<div style="margin-top:12px">${Btn('重新导入', {kind: 'secondary', sm: true, act: 'assist', v: 'reset'})}</div>`
        : `${Note('ok', '户型校验通过', '3 层 · 墙体闭合 · 楼梯与开洞对齐 · 派生 8 处地面与楼梯饰面')}<div class="levels" style="margin-top:14px">${villa.floors.map(fl => `<figure><div class="plan-box">${planSVG(fl.id, ['f1-living', 'f1-dining', 'f1-foyer', 's12', 'f2-lounge', 's23', 'f3-tea', 'f3-hall'])}</div><figcaption>${fl.name}</figcaption></figure>`).join('')}</div>`;
  return Shell(`<div class="page"><a class="back" href="#/lead/${l.id}">${icon('back', 16)} 返回方案工作台</a>
    <header class="page__head" style="margin-top:12px"><div><h1 class="page__title">辅助转换图纸</h1><p class="page__sub">「${esc(l.fileName)}」不能自动识别。由企业按图纸整理户型（墙体、门窗、楼层与楼梯），导入后再按同样的规则出方案。</p></div></header>
    <div class="flow"><aside class="panel"><div class="panel__body" style="padding-top:16px">${Steps(['下载客户图纸', '整理户型', '导入户型', '生成待审方案'], at)}
      <section class="sect"><div class="kv"><span>客户</span><b>${who(l)}</b></div><div class="kv"><span>范围</span><b>${kinds(l)}</b></div><div class="kv"><span>说明</span><b>${esc(l.note || '—')}</b></div></section></div></aside>
      <div class="page__grid" style="margin-top:0">
        <section class="panel"><header class="panel__head"><h2 class="panel__title">客户图纸</h2></header><div class="panel__body" style="display:flex;align-items:center;gap:12px">${icon('file', 20)}<b style="font-weight:500">${esc(l.fileName)}</b>${Btn('下载原图', {kind: 'secondary', sm: true, act: 'toast', v: '原型操作：下载客户上传的原始图纸'})}</div></section>
        <section class="panel"><header class="panel__head"><h2 class="panel__title">导入整理好的户型</h2></header><div class="panel__body">${drop}</div></section></div></div></div>
    ${ActionBar('生成后进入审核：核对效果图，再发布给客户。', Btn('生成待审方案', {act: 'assist-generate', v: l.id, disabled: st !== 'valid'}))}`, 'leads');
}

// 预置方案
function NewScreen() {
  const d = state.draft, floorFacets = facets.filter(f => f.floor === d.floor), count = fl => d.facets.filter(id => facetById[id].floor === fl).length;
  return Shell(`<div class="page"><header class="page__head"><div><h1 class="page__title">预置方案</h1><p class="page__sub">在示例别墅上选择饰面和石材，按规则生成 3 个方案，或交给 Agent 出整体方案。生成后分享给客户：指定手机号，或给一次性绑定码。</p></div></header>
    <div class="compose"><aside class="panel"><div class="panel__body" style="padding-top:4px">
        <label class="field"><span>方案名称</span><input class="input" id="dname" maxlength="40" placeholder="例如：临水别墅 · 企业预置方案" value="${esc(d.name)}"></label>
        <label class="field"><span>内部说明（选填）</span><textarea class="input" id="dnote" rows="3" maxlength="200" placeholder="例如：客户上周到店，偏好暖色。">${esc(d.note)}</textarea></label></div></aside>
      <div class="page__grid" style="margin-top:0">
        <section class="panel"><header class="panel__head"><h2 class="panel__title">饰面 <span class="muted small num">已选 ${d.facets.length} 处</span></h2>
          <div class="segmented" role="group" aria-label="楼层">${villa.floors.map(fl => `<button aria-pressed="${fl.id === d.floor}" data-act="dfloor" data-v="${fl.id}">${fl.name}<small>${count(fl.id)}</small></button>`).join('')}</div></header>
          <div class="panel__body facet-pick"><div class="plan-box">${planSVG(d.floor, d.facets)}</div>
            <div>${floorFacets.map(f => `<button class="facet" aria-pressed="${d.facets.includes(f.id)}" data-act="dfacet" data-v="${f.id}"><span class="check">${icon('check', 13)}</span><span><b>${f.name}</b><small>${kindName[f.kind]} · ${f.kind === 'stair' ? `${f.steps} 级踏步` : `${f.size[0]} × ${f.size[1]} m`}</small></span></button>`).join('')}</div></div></section>
        <section class="panel"><header class="panel__head"><h2 class="panel__title">石材 <span class="muted small">最多 3 款，按顺序优先使用</span></h2><span class="muted small">示意素材</span></header>
          <div class="panel__body"><div class="stone-grid">${stones.map(s => { const n = d.stones.indexOf(s.id) + 1; return `<button class="stone-pick" aria-pressed="${n > 0}" data-act="dstone" data-v="${s.id}"><img src="${swatchURL(s.id, 240)}" alt="">${s.name}${n ? `<i>${n}</i>` : ''}</button>`; }).join('')}</div></div></section></div></div></div>
    ${ActionBar('生成后先在方案工作台查看效果图，再分享。', `${Btn('交给 Agent 出方案', {kind: 'secondary', act: 'create', k: 'agent', lead: 'spark', disabled: !d.facets.length})}${Btn('按规则生成方案', {act: 'create', disabled: !(d.facets.length && d.stones.length)})}`)}`, 'new');
}

// 石材与软装
function StonesScreen() {
  const meta = {yashi: ['抛光', '600–1500', 1], yudu: ['抛光', '600–1500', 1], shaanna: ['抛光', '300–1200', 2], huimu: ['哑光', '200–1200', 1], feiwang: ['抛光', '300–1200', 1], heijin: ['抛光', '200–800', 1]};
  return Shell(`<div class="page"><header class="page__head"><div><h1 class="page__title">石材与软装</h1><p class="page__sub">客户在 H5 只能从这里的石材与软装风格中选择，Agent 也只在这个范围内出方案。贴图与家具均为示意素材；下架的版本不再出现在客户的选择里，已用它的方案保留原样。</p></div></header>
    <h2 class="panel__title" style="margin-top:28px">石材 <span class="muted small">${stones.length} 款在售</span></h2>
    <div class="catalog" style="margin-top:12px">${[...stones, {id: 'shaanna', name: '莎安娜米黄', retired: true}].map(s => { const [surface, size, v] = meta[s.id]; return `<article class="panel cat-card${s.retired ? ' retired' : ''}"><img src="${swatchURL(s.id, 240)}" alt=""><div><b>${s.name}</b> ${s.retired ? Tag('已下架 · 版本 1') : ''}
      <dl><dt>表面</dt><dd>${surface}</dd><dt>规格</dt><dd class="num">${size} mm</dd><dt>纹理</dt><dd>${esc(stoneById[s.id].note || '—')}</dd><dt>版本</dt><dd>${s.retired ? '1' : `${v} · 在售`}</dd></dl></div></article>`; }).join('')}</div>
    <h2 class="panel__title" style="margin-top:32px">软装风格 <span class="muted small">按房间给出家具组合与配色 · 版本 1 · 示意素材</span></h2>
    <div class="catalog" style="margin-top:12px">${softStyles.map(st => `<article class="panel cat-card"><div class="soft-swatch">${Object.values(st.palette).slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</div><div><b>${st.name}</b><p class="muted small" style="margin-top:2px">${esc(st.line)}</p>
      <dl>${Object.entries(st.rooms).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div></article>`).join('')}</div></div>`, 'stones');
}

// ---------- 弹层 ----------
const modal = () => document.querySelector('#modal');
function openModal(html) { const m = modal(); m.innerHTML = `<div class="modal-body" tabindex="-1">${html}</div>`; if (!m.open) m.showModal(); m.querySelector('.modal-body').focus(); }
const closeModal = () => { if (modal().open) modal().close(); };
function shareModal(id, mode = 'phone', days = 30) {
  openModal(`<h2>分享给客户</h2><p>分享链接只能预览。客户要调整和确认，需要用手机号登录并按下面的方式绑定。</p>
    <h3>绑定方式</h3><div class="segmented" role="radiogroup">${[['phone', '定向手机号（推荐）'], ['code', '一次性绑定码']].map(([v, t]) => `<button role="radio" aria-checked="${mode === v}" data-act="share-mode" data-v="${id}:${v}:${days}">${t}</button>`).join('')}</div>
    ${mode === 'phone' ? `<label class="field"><span>客户手机号</span><input class="input num" id="sphone" inputmode="numeric" maxlength="11" placeholder="11 位手机号"></label><p class="muted small" style="margin-top:8px">客户用这个号码登录即自动绑定；其他号码打开只能预览，可以提交绑定申请。</p>`
      : '<p class="muted small" style="margin-top:12px">生成 6 位绑定码，48 小时内有效、只能使用一次、错误 5 次锁定。请通过电话或微信单独告诉客户。</p>'}
    <h3>链接有效期</h3><div class="chips">${[30, 60, 90].map(n => `<button class="chip" aria-pressed="${days === n}" data-act="share-mode" data-v="${id}:${mode}:${n}">${n} 天</button>`).join('')}</div>
    <div class="modal-actions">${Btn('取消', {kind: 'secondary', act: 'close'})}${Btn('生成分享', {act: 'share-create', v: `${id}:${mode}:${days}`})}</div>`);
}
function onceModal(link, code, phone) {
  openModal(`<h2>分享已生成</h2><p>链接${code ? '和绑定码' : ''}只显示这一次，关闭后不能再查看。请现在复制，${code ? '绑定码通过电话或微信单独告诉客户。' : `发给 ${maskPhone(phone)}。`}</p>
    <dl class="once"><div><dt>链接</dt><code>${link}</code>${Btn('复制', {kind: 'secondary', sm: true, act: 'copy', v: link})}</div>${code ? `<div><dt>绑定码</dt><span class="code">${code}</span>${Btn('复制', {kind: 'secondary', sm: true, act: 'copy', v: code})}</div>` : ''}</dl>
    <div class="modal-actions">${Btn('我已复制', {act: 'close'})}</div>`);
}
const confirms = {
  publish: ['发布给客户？', '客户会在 H5 看到通过校验的方案，可以调整和确认。发布后不能撤回为待审核。', '发布'],
  publishD: ['发布这个方案？', '客户会在 H5 看到这个方案，可以调整和确认。发布后不能撤回为待审核。', '发布'],
  revoke: ['撤销这个分享链接？', '撤销后链接立即失效：未绑定的人不能再预览或绑定；已绑定的客户仍可通过自己的账号访问。', '撤销链接'],
  unbind: ['解绑这位客户？', '解绑后客户不能再打开这个项目，绑定与解绑都会留下记录。可以重新分享给其他人。', '解绑'],
  approve: ['批准绑定？', '项目会绑定到申请人的账号，申请人可以调整和确认。其他待审申请同时作废。', '批准绑定'],
  reject: ['拒绝这个申请？', '申请人仍可预览，但不能调整或确认。', '拒绝'],
  adopt: ['采用为待审方案？', '候选会加入这条线索的方案，状态为待审；核对效果图后再发布给客户。', '采用'],
};
function confirmModal(kind, v) { const [t, p, ok] = confirms[kind]; openModal(`<h2>${t}</h2><p>${p}</p><div class="modal-actions">${Btn('取消', {kind: 'secondary', act: 'close'})}${Btn(ok, {kind: ['revoke', 'unbind', 'reject'].includes(kind) ? 'danger' : 'primary', act: 'do', k: kind, v})}</div>`); }
let toastTimer;
function toast(text) { const t = document.querySelector('#toast'); t.textContent = text; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400); }

// ---------- 原型审阅导航（不属于产品界面） ----------
const reset = () => { const theme = state.theme; state = fresh(); state.theme = theme; };
const agentDemo = l => ({status: 'ready', messages: [{role: 'user', text: prompts[0]}, {role: 'ai', steps: agentPlan(prompts[0]).steps, done: 5, text: '候选「雅致新中式」已放到画面里：硬装与软装都通过校验，客户看不到。', view: true}], candidate: {...makeSchemes(l.facets, ['feiwang', 'yashi'])[1], id: 'D', title: '雅致新中式', soft: 'chinese'}});
const R = {
  'login': ['入口', '登录', () => { reset(); state.session = false; go('/login'); }],
  'login-wrong': ['入口', '登录 · 密码错误', () => { reset(); state.session = false; state.login.error = 'wrong'; go('/login'); }],
  'denied': ['入口', '无权访问（非企业成员）', () => { reset(); go('/denied'); }],
  'today': ['工作台', '今日', () => { reset(); go('/'); }],
  'leads': ['工作台', '线索列表', () => { reset(); go('/leads'); }],
  'leads-contact': ['工作台', '线索 · 请求联系', () => { reset(); go('/leads?f=contact'); }],
  'leads-empty': ['工作台', '线索 · 无结果', () => { reset(); go('/leads?t=00000'); }],
  'detail-confirmed': ['方案工作台', '客户已确认并请求联系', () => { reset(); go('/lead/L1'); }],
  'detail-client': ['方案工作台', '客户与跟进', () => { reset(); state.ui.L1 = {tab: 'client'}; go('/lead/L1'); }],
  'detail-member': ['方案工作台', '企业预置 · 已绑定（分享）', () => { reset(); state.ui.L2 = {tab: 'share'}; go('/lead/L2'); }],
  'detail-apply': ['方案工作台', '企业预置 · 绑定申请待批准', () => { reset(); state.ui.L5 = {tab: 'share'}; go('/lead/L5'); }],
  'detail-3d': ['方案工作台', '3D 查看', () => { reset(); state.ui.L1 = {view: '3d'}; go('/lead/L1'); }],
  'detail-review': ['方案工作台', 'DXF 待审核', () => { reset(); go('/lead/L3'); }],
  'detail-assist': ['方案工作台', '需辅助转换', () => { reset(); go('/lead/L4'); }],
  'agent': ['Agent 助手', '打开助手 · 快捷提示', () => { reset(); state.ui.L1 = {agent: true}; go('/lead/L1'); }],
  'agent-ready': ['Agent 助手', '候选方案在画面中', () => { reset(); const l = leadById('L1'); l.agent = agentDemo(l); state.ui.L1 = {scheme: 'D', agent: true}; go('/lead/L1'); }],
  'agent-3d': ['Agent 助手', '候选 · 3D 查看', () => { reset(); const l = leadById('L1'); l.agent = agentDemo(l); state.ui.L1 = {scheme: 'D', view: '3d', agent: true}; go('/lead/L1'); }],
  'agent-rejected': ['Agent 助手', '超出企业目录被拒', () => { reset(); leadById('L1').agent = {status: 'idle', messages: [{role: 'user', text: prompts[2]}, {role: 'ai', text: agentPlan(prompts[2]).rejected}], candidate: null}; state.ui.L1 = {agent: true}; go('/lead/L1'); }],
  'agent-nomodel': ['Agent 助手', '未配置模型 / 无网络', () => { reset(); leadById('L1').agent = {status: 'nomodel', forceNoModel: true, messages: [{role: 'user', text: prompts[0]}, {role: 'ai', text: '没有可用的模型（未配置或网络不可用），这次请求没有执行，不会模拟结果。', fallback: true}], candidate: null}; state.ui.L1 = {agent: true}; go('/lead/L1'); }],
  'agent-pending': ['Agent 助手', '已采用 · 待审方案 D', () => { reset(); const l = leadById('L1'); l.schemes = [...l.schemes, {...agentDemo(l).candidate, pending: true}]; l.revisions.D = 1; state.ui.L1 = {scheme: 'D'}; go('/lead/L1'); }],
  'agent-new': ['Agent 助手', '预置方案交给 Agent（空白户型）', () => { reset(); actions.create({dataset: {k: 'agent'}}); }],
  'review': ['审核与转换', '审核 · 转换结果', () => { reset(); go('/lead/L3/review'); }],
  'review-ready': ['审核与转换', '审核 · 待审方案', () => { reset(); const l = leadById('L3'); l.stage = 'ready'; l.schemes = makeSchemes(l.facets, l.stones); go('/lead/L3/review'); }],
  'assist': ['审核与转换', '辅助转换 · 导入户型', () => { reset(); go('/lead/L4/assist'); }],
  'assist-bad': ['审核与转换', '辅助转换 · 校验失败', () => { reset(); leadById('L4').assistStage = 'invalid'; go('/lead/L4/assist'); }],
  'assist-ok': ['审核与转换', '辅助转换 · 校验通过', () => { reset(); leadById('L4').assistStage = 'valid'; go('/lead/L4/assist'); }],
  'new': ['方案与分享', '预置方案', () => { reset(); go('/new'); }],
  'share': ['方案与分享', '分享 · 选择方式', () => { reset(); go('/lead/L5'); setTimeout(() => shareModal('L5'), 250); }],
  'share-once': ['方案与分享', '分享 · 链接与绑定码（只显示一次）', () => { reset(); go('/lead/L5'); setTimeout(() => onceModal('https://demo-home.example/s/Qm8x…V2Lk', 'K7M2Q9'), 250); }],
  'confirm-revoke': ['方案与分享', '撤销链接确认', () => { reset(); state.ui.L2 = {tab: 'share'}; go('/lead/L2'); setTimeout(() => confirmModal('revoke', 'L2:S1'), 250); }],
  'stones': ['目录', '石材与软装风格', () => { reset(); go('/stones'); }],
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
const current = () => leadById(parse().parts[1]);
const log = (l, text) => l.history.push({at: Date.now(), text});
const token = () => Array.from({length: 4}, () => Math.random().toString(36).slice(2, 6)).join('');
const actions = {
  review: () => { openReview(); return false; }, close: () => { closeModal(); return false; }, jump: el => { window.__review.go(el.dataset.v); return false; },
  reset: () => { closeModal(); reset(); go('/'); },
  logout: () => { state.session = false; state.login = {email: member.email, error: null}; go('/login'); },
  theme: () => { state.theme = isDark() ? 'light' : 'dark'; applyTheme(); },
  nav: el => { go(el.dataset.v.replace(/^#/, '')); return false; },
  toast: el => { toast(el.dataset.v); return false; },
  follow: el => { const l = current(); if (l.follow !== el.dataset.v) { l.follow = el.dataset.v; l.notes.push({by: member.name, at: Date.now(), text: `跟进状态改为「${followName[l.follow]}」`}); toast(`已标记为${followName[l.follow]}`); } },
  scheme: el => { uiOf(current()).scheme = el.dataset.v; }, floor: el => { uiOf(current()).floor = el.dataset.v; }, view: el => { uiOf(current()).view = el.dataset.v; }, tab: el => { uiOf(current()).tab = el.dataset.v; },
  left: () => { const u = uiOf(current()); u.left = !u.left; if (u.left && narrow()) u.agent = false; },
  agent: () => { const u = uiOf(current()); u.agent = !u.agent; if (u.agent && narrow()) u.left = false; },
  'agent-say': el => { agentRun(current(), el.dataset.v); },
  'agent-discard': () => { const l = current(); l.agent.candidate = null; l.agent.status = 'idle'; l.agent.messages.push({role: 'ai', text: '已放弃这个候选。'}); uiOf(l).scheme = l.schemes?.[0]?.id || 'A'; toast('已放弃候选'); },
  'agent-fallback': el => { const l = leadById(el.dataset.v), demo = agentDemo(l); l.agent = {status: 'ready', forceNoModel: true, candidate: {...demo.candidate, title: '雅致新中式（预先生成）'}, messages: [...l.agent.messages.map(m => ({...m, fallback: false})), {role: 'ai', text: '已打开预先出好的演示方案（演示数据，非本次生成），放在画面里。', view: true}]}; Object.assign(uiOf(l), {scheme: 'D', view: 'image'}); },
  share: el => { shareModal(el.dataset.v); return false; },
  'share-mode': el => { const [id, mode, days] = el.dataset.v.split(':'); shareModal(id, mode, +days); return false; },
  'share-create': el => {
    const [id, mode, days] = el.dataset.v.split(':'), l = leadById(id);
    const phone = mode === 'phone' ? (document.querySelector('#sphone')?.value || '').replace(/\D/g, '') : null;
    if (mode === 'phone' && !/^1\d{10}$/.test(phone)) { toast('请输入 11 位手机号'); return false; }
    const code = mode === 'code' ? Array.from({length: 6}, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('') : null;
    const exp = new Date(Date.now() + days * 864e5);
    l.shares.push({id: 'S' + state.seq++, mode, phone, createdAt: Date.now(), expires: `${exp.getFullYear()}-${String(exp.getMonth() + 1).padStart(2, '0')}-${String(exp.getDate()).padStart(2, '0')}`, status: 'active'});
    log(l, mode === 'phone' ? `定向分享给 ${maskPhone(phone)}` : '绑定码分享（一次性绑定码，48 小时有效）');
    uiOf(l).tab = 'share'; save(); render(); onceModal(`https://demo-home.example/s/${token()}`, code, phone); return false;
  },
  copy: el => { navigator.clipboard?.writeText(el.dataset.v).catch(() => {}); toast('已复制'); return false; },
  confirm: el => { confirmModal(el.dataset.k, el.dataset.v); return false; },
  do: el => {
    const kind = el.dataset.k, [id, sub] = el.dataset.v.split(':'), l = leadById(id);
    closeModal();
    if (kind === 'publish') { l.status = 'published'; l.stage = null; l.events.push({kind: 'publish', at: Date.now(), text: '企业审核后发布 3 个方案'}); toast('已发布，客户可以在 H5 查看'); go(`/lead/${id}`); return false; }
    if (kind === 'publishD') { const x = l.schemes.find(y => y.id === sub); x.pending = false; if (l.status === 'drafting') l.status = 'published'; l.events.push({kind: 'publish', at: Date.now(), text: `企业核对后发布方案 ${sub}「${x.title}」`}); toast(`方案 ${sub} 已发布，客户可以在 H5 查看`); }
    if (kind === 'revoke') { l.shares.find(s => s.id === sub).status = 'revoked'; log(l, '撤销分享链接'); toast('链接已撤销'); }
    if (kind === 'unbind') { log(l, `解绑客户 ${maskPhone(l.customer.phone)}`); l.customer = null; toast('已解绑'); }
    if (kind === 'approve') { const a = l.applications.find(x => x.id === sub); a.status = 'approved'; l.customer = {phone: a.phone, name: a.note.split('：')[0]}; log(l, `批准绑定申请，绑定 ${maskPhone(a.phone)}`); l.events.push({kind: 'bind', at: Date.now(), text: `企业批准绑定：${maskPhone(a.phone)}`}); toast('已批准，项目绑定到申请人'); }
    if (kind === 'reject') { l.applications.find(x => x.id === sub).status = 'rejected'; log(l, '拒绝绑定申请'); toast('已拒绝'); }
    if (kind === 'adopt') { const c = {...l.agent.candidate, pending: true}; l.schemes = [...(l.schemes || []).filter(x => x.id !== 'D'), c]; l.revisions = {...l.revisions, D: 1};
      l.agent = {...l.agent, status: 'idle', candidate: null, messages: [...l.agent.messages, {role: 'ai', text: '已采用为待审方案 D。核对效果图后再发布给客户。'}]}; l.events.push({kind: 'agent', at: Date.now(), text: `采用 Agent 候选「${c.title}」为待审方案 D`}); uiOf(l).scheme = 'D'; toast('已采用为待审方案 D，核对后发布'); }
  },
  generate: el => { const l = leadById(el.dataset.v); l.stage = 'generating'; save(); render(); later(() => { l.stage = 'ready'; l.schemes = makeSchemes(l.facets, l.stones); save(); render(); }, 2600); return false; },
  regen: el => actions.generate(el),
  assist: el => { const l = current(), v = el.dataset.v; if (v === 'reset') { l.assistStage = 'waiting'; return; } l.assistStage = 'validating'; save(); render(); later(() => { l.assistStage = v === 'ok' ? 'valid' : 'invalid'; save(); render(); }, 1600); return false; },
  'assist-generate': el => { const l = leadById(el.dataset.v); Object.assign(l, {status: 'review', source: 'other', facets: ['f1-living', 'f1-dining', 'f1-foyer', 's12', 'f2-lounge', 's23', 'f3-tea', 'f3-hall'], convert: {levels: 3, finishes: 8, scale: '按导入户型尺寸', hints: []}, reviewReason: '辅助转换的户型需企业核对', stage: 'generating'}); l.events.push({kind: 'convert', at: Date.now(), text: '企业完成辅助转换：3 层、8 处饰面'}); save(); go(`/lead/${l.id}/review`); later(() => { l.stage = 'ready'; l.schemes = makeSchemes(l.facets, l.stones); save(); render(); }, 2600); return false; },
  dfloor: el => { state.draft.floor = el.dataset.v; },
  dfacet: el => { const a = state.draft.facets, i = a.indexOf(el.dataset.v); i < 0 ? a.push(el.dataset.v) : a.splice(i, 1); },
  dstone: el => { const a = state.draft.stones, i = a.indexOf(el.dataset.v); if (i >= 0) a.splice(i, 1); else if (a.length < 3) a.push(el.dataset.v); else toast('最多选择 3 款石材'); },
  create: el => {
    const d = state.draft, id = 'L' + state.seq++, viaAgent = el?.dataset?.k === 'agent';
    state.leads.unshift({id, title: d.name.trim() || '示例别墅 · 企业预置方案', origin: 'member', source: 'sample', status: viaAgent ? 'drafting' : 'published', customer: null, createdAt: Date.now(), facets: [...d.facets], stones: [...d.stones], prefs: '—', note: d.note,
      schemes: viaAgent ? null : makeSchemes(d.facets, d.stones), revisions: {A: 1, B: 1, C: 1}, events: [{kind: 'create', at: Date.now(), text: viaAgent ? '企业新建预置方案，交给 Agent 出整体方案' : '企业预置 3 个方案（全部通过排版校验，已发布）'}], follow: 'new', notes: [], shares: [], applications: [], history: []});
    state.draft = freshDraft(); state.ui[id] = viaAgent ? {view: '3d', agent: true, left: !narrow()} : {};
    save(); go(`/lead/${id}`); if (!viaAgent) setTimeout(() => shareModal(id), 250); return false;
  },
};
function applyTheme() { if (state.theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = state.theme; }

// ---------- 渲染 ----------
const demoScheme = makeSchemes(['f1-living', 'f1-dining', 'f1-wall', 's12'], ['yudu', 'shaanna'])[0];
function fillRenders(root) {
  const imgs = [...root.querySelectorAll('img[data-render]')];
  let i = 0;
  const step = () => { const img = imgs[i++]; if (!img) return;
    const l = leadById(img.dataset.lead || img.dataset.cand);
    const sc = img.dataset.demo ? demoScheme : img.dataset.cand ? candidateOf(l) : l?.schemes?.find(s => s.id === (img.dataset.scheme || 'A')) || l?.schemes?.[0];
    if (sc) { const url = renderImage(img.dataset.render, sc, +(img.dataset.w || 960), +(img.dataset.h || 600)); if (url) img.src = url; }
    setTimeout(step, 0); };
  setTimeout(step, 20);
}
let unmount = [];
function mountViewers(root) { root.querySelectorAll('[data-viewer]').forEach(host => { const l = leadById(host.dataset.viewer), sc = schemesOf(l).find(x => x.id === uiOf(l).scheme) || {finishes: {}}; unmount.push(mountViewer(host, sc, host.dataset.floor, 'floor')); }); }
function view() {
  const {parts, q} = parse();
  if (!state.session && parts[0] !== 'login') { go('/login'); return null; }
  switch (parts[0]) {
    case 'login': return LoginScreen();
    case 'denied': return DeniedScreen();
    case 'leads': return LeadsScreen(q);
    case 'lead': { const l = leadById(parts[1]); if (!l) return LeadsScreen({});
      if (parts[2] === 'review' && l.status === 'review') return ReviewScreen(l);
      if (parts[2] === 'assist' && l.status === 'assist') return AssistScreen(l);
      if (parts[2] === 'agent') { uiOf(l).agent = true; go(`/lead/${l.id}`); return null; }
      return WorkspaceScreen(l); }
    case 'new': return NewScreen();
    case 'stones': return StonesScreen();
    default: return TodayScreen();
  }
}
let lastPath = null;
function render() {
  timers.forEach(clearTimeout); timers = []; unmount.forEach(f => f()); unmount = [];
  const {path} = parse(), y = scrollY, html = view();
  if (html == null) return;
  const root = document.querySelector('#app'); root.innerHTML = html;
  if (path !== lastPath) {
    scrollTo(0, 0);
    if (!reduced()) [...root.querySelectorAll('.page > *, .float')].slice(0, 8).forEach((el, i) => el.animate([{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'none'}], {duration: 360, delay: i * 30, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards'}));
    document.title = `演示家装企业 · ${root.querySelector('h1')?.textContent || '企业工作台'}（原型）`;
  } else scrollTo(0, y);
  lastPath = path;
  root.querySelector('#search')?.addEventListener('change', e => { const {q} = parse(); go('/leads?' + new URLSearchParams({...q, t: e.target.value.trim()}).toString()); });
  root.querySelector('#gsearch')?.addEventListener('change', e => go('/leads?t=' + encodeURIComponent(e.target.value.trim())));
  root.querySelector('#dname')?.addEventListener('input', e => { state.draft.name = e.target.value; save(); });
  root.querySelector('#dnote')?.addEventListener('input', e => { state.draft.note = e.target.value; save(); });
  const log = root.querySelector('#agent-log'); if (log) log.scrollTop = log.scrollHeight;
  fillRenders(root); mountViewers(root); save();
}
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
    if (data.email.trim().toLowerCase() !== member.email || data.password !== member.password) { state.login = {email: data.email, error: data.email.includes('@') && data.password === member.password ? 'denied' : 'wrong'}; save(); render(); return; }
    state.session = true; state.login.error = null; save(); go('/');
  }
  if (form.dataset.form === 'agent') { const t = (data.text || '').trim(); if (!t) return; agentRun(current(), t); save(); render(); return; }
  if (form.dataset.form === 'note') { const t = (data.note || '').trim(); if (!t) return; current().notes.push({by: member.name, at: Date.now(), text: t}); save(); render(); toast('备注已添加'); }
});
document.querySelector('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
addEventListener('hashchange', () => { closeModal(); render(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.theme === 'system') render(); });
applyTheme(); render();
