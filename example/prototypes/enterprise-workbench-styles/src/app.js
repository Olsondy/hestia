// 企业工作台风格对比稿：方案工作台 + 线索列表 × 三个方向（A 停靠 / B 悬浮 / C 画框），每个方向都有浅色与深色主题。演示数据，只用于选方向。
import {icon} from '../../client-h5/src/icons.js';
import {stoneById, layoutName, specLabel, villa, facetById, maskPhone, softById, makeSchemes} from '../../client-h5/src/data.js';
import {swatchURL} from '../../client-h5/src/stone.js';
import {renderImage, mountViewer} from '../../client-h5/src/render3d.js';
import {followName, followOrder, statusInfo, seedLeads, lastEvent, needsAction} from '../../enterprise-workbench/src/data.js';

const XP = {search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M21 21l-5-5', spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z',
  panel: 'M3 4h18v16H3zM9 4v16', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'};
const ic = (n, s = 18) => XP[n] ? `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${XP[n]}"/></svg>` : icon(n, s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const when = t => { const m = Math.round((Date.now() - t) / 60e3); if (m < 60) return `${m} 分钟前`; const h = Math.round(m / 60); if (h < 24) return `${h} 小时前`; const d = new Date(t); return `${d.getMonth() + 1} 月 ${d.getDate()} 日`; };
const clock = t => { const d = new Date(t); return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const finishLine = (fid, fin) => { const f = facetById[fid]; if (!fin) return '—'; const s = stoneById[fin.stone].name; return f.kind === 'stair' ? `${s} · 整板踏步` : `${s} · ${specLabel(fin.spec)} · ${layoutName[fin.layout]}${fin.border ? ' · 波打线' : ''}`; };
const badge = st => `<span class="tag${['review', 'assist'].includes(st) ? ' tag--act' : ''}">${statusInfo[st][0]}</span>`;

// 状态：对比稿只在内存里
const leads = seedLeads();
const L1 = leads[0];
L1.agent = {candidate: {...makeSchemes(L1.facets, ['feiwang', 'yashi'])[1], id: 'D', title: '雅致新中式', soft: 'chinese', candidate: true}};
const S = {dir: 'a', theme: 'light', page: 'ws', scheme: 'D', view: 'image', floor: 'f1', tab: 'scheme', agent: true, left: true, status: 'all', follow: ''};
const schemes = () => [...L1.schemes, L1.agent.candidate];
// 状态标签：中性底 + 文字；只有需要成员处理的状态用强调色（准则 C4 / C5）
const tag = (text, act = false) => `<span class="tag${act ? ' tag--act' : ''}">${text}</span>`;

// ---------- 共用外壳 ----------
function TopBar(active) {
  return `<header class="topbar"><a class="brand"><span class="brand-mark">标志</span><b>演示家装企业</b></a>
    <nav class="topnav">${[['today', '今日', 4], ['leads', '线索'], ['new', '预置方案'], ['catalog', '石材与软装']].map(([k, t, n]) => `<a class="topnav__item" ${active === k ? 'aria-current="page"' : ''}>${t}${n ? `<span class="count num">${n}</span>` : ''}</a>`).join('')}</nav>
    <div class="topbar__end"><label class="search search--top">${ic('search', 16)}<input placeholder="搜索客户、手机号或项目"></label><span class="avatar" title="演示方案顾问">顾</span></div></header>`;
}

// ---------- 方案工作台：画面为中心，方案面板 + Agent 助手 ----------
function Workspace() {
  const list = schemes(), s = list.find(x => x.id === S.scheme), conf = 'A';
  const floors = villa.floors, floorName = floors.find(f => f.id === S.floor).name;
  const media = S.view === 'image' ? `<img class="stage__img" data-render="${S.floor}" alt="方案 ${s.id} 效果图（示意）">` : `<div class="stage__3d" data-viewer aria-label="${floorName} 3D 视图"></div>`;
  const facetsHere = L1.facets.filter(id => facetById[id].floor === S.floor && s.finishes[id]);
  const soft = softById[s.soft];
  const tabs = [['scheme', '方案'], ['client', '客户与跟进'], ['share', '分享']];
  const schemeTab = `<ul class="schemes">${list.map(x => { const fid = L1.facets.find(id => x.finishes[id]); return `<li><button class="scheme${x.candidate ? ' scheme--cand' : ''}" aria-pressed="${x.id === s.id}" data-act="scheme" data-v="${x.id}">
      <img class="scheme__thumb" data-render="f1" data-scheme="${x.id}" data-w="200" data-h="140" alt="">
      <span class="scheme__main"><b>${x.id} · ${esc(x.title)}</b><small>${softById[x.soft].name} · ${stoneById[x.finishes[fid].stone].name}</small></span>
      <span class="scheme__meta">${x.id === conf ? '客户已确认' : x.candidate ? tag('候选', true) : `修订 ${L1.revisions[x.id]}`}</span></button></li>`; }).join('')}</ul>
    <section class="sect"><h3 class="sect__title">${floorName}硬装</h3>${facetsHere.map(id => `<div class="kv"><span>${facetById[id].name}</span><b><i class="sw" style="background-image:url(${swatchURL(s.finishes[id].stone, 32)})"></i>${finishLine(id, s.finishes[id])}</b></div>`).join('')}</section>
    <section class="sect"><h3 class="sect__title">软装 · ${soft.name}</h3><p class="muted">${esc(soft.line)}</p><div class="palette">${Object.values(soft.palette).map(c => `<i style="background:${c}"></i>`).join('')}</div></section>`;
  const clientTab = `<section class="sect"><div class="kv"><span>客户</span><b class="num">139 0013 9000 · 王女士</b></div><div class="kv"><span>偏好</span><b>${esc(L1.prefs)}</b></div><div class="kv"><span>说明</span><b>${esc(L1.note)}</b></div></section>
    <section class="sect"><h3 class="sect__title">跟进状态</h3><div class="segmented segmented--wrap">${followOrder.map(k => `<button aria-pressed="${L1.follow === k}">${followName[k]}</button>`).join('')}</div>
      <textarea class="input" rows="2" placeholder="内部备注，例如：已约周六到店看样。"></textarea></section>
    <section class="sect"><h3 class="sect__title">客户动作</h3><ol class="feed">${[...L1.events].reverse().map(e => `<li><time class="num">${clock(e.at)}</time><span>${esc(e.text)}${e.message ? `<q>${esc(e.message)}</q>` : ''}</span></li>`).join('')}</ol></section>`;
  const shareTab = `<section class="sect"><p class="muted">客户自助提交的项目属于客户本人，不需要分享与绑定。企业预置的方案在这里创建分享、审批绑定申请。</p></section>`;
  const left = S.left ? `<aside class="panel panel--left" aria-label="方案与客户">
      <header class="panel__head"><a class="back">${icon('back', 16)} 线索</a><h1 class="lead-title">示例别墅 · 方案需求</h1><p class="muted">客户自助 · 客户已确认 · ${tag('请求联系', true)}</p>
        <div class="segmented">${tabs.map(([k, t]) => `<button aria-pressed="${S.tab === k}" data-act="tab" data-v="${k}">${t}</button>`).join('')}</div></header>
      <div class="panel__body">${S.tab === 'scheme' ? schemeTab : S.tab === 'client' ? clientTab : shareTab}</div>
      <footer class="panel__foot">${s.candidate ? `<button class="btn btn--secondary">放弃候选</button><button class="btn btn--primary btn--grow">采用为待审方案</button>` : `<button class="btn btn--primary btn--grow">已回电，标记为已联系</button>`}</footer></aside>` : '';
  const agent = S.agent ? `<aside class="panel panel--right" aria-label="Agent 助手">
      <header class="panel__head row"><div><b class="panel__title">${ic('spark', 16)} Agent 助手</b><p class="muted">以「方案 A · 留白」为起点 · 结果先作为候选</p></div><button class="icon-btn" data-act="agent" aria-label="收起">${icon('close', 16)}</button></header>
      <div class="panel__body chat">
        <div class="msg msg--me">客厅大气一点，二层主卧做新中式</div>
        <div class="msg msg--ai"><ol class="steps">${['读取 9 处饰面与企业目录', '硬装：客厅、餐厅地面 雅士白 800×800 斜铺，黑金花波打线', '软装：客厅新中式，二层主卧实木架子床', '排版与家具碰撞校验通过，1 条窄条提示', '出图：客厅、起居厅、茶室'].map(t => `<li>${t}</li>`).join('')}</ol>
          <p>候选「雅致新中式」已放到画面里，客户看不到。</p><button class="btn btn--secondary btn--sm" data-act="scheme" data-v="D">在画面中查看</button></div>
      </div>
      <form class="composer"><textarea rows="2" placeholder="继续调整，例如：主卧换成轻奢"></textarea><button class="btn btn--primary btn--icon" type="button" aria-label="发送">${icon('send', 16)}</button></form></aside>` : '';
  const toolbar = `<div class="toolbar">
      <button class="tool" aria-pressed="${S.left}" data-act="left" aria-label="方案面板">${ic('panel', 18)}</button><span class="toolbar__sep"></span>
      <div class="segmented segmented--bare">${floors.map(f => `<button aria-pressed="${S.floor === f.id}" data-act="floor" data-v="${f.id}">${f.name}</button>`).join('')}</div><span class="toolbar__sep"></span>
      <div class="segmented segmented--bare">${[['image', '效果图', 'image'], ['3d', '3D', 'cube']].map(([v, t, i]) => `<button aria-pressed="${S.view === v}" data-act="view" data-v="${v}">${ic(i, 15)}${t}</button>`).join('')}</div><span class="toolbar__sep"></span>
      <button class="tool tool--label" aria-pressed="${S.agent}" data-act="agent">${ic('spark', 16)} Agent</button></div>`;
  const caption = `<div class="caption"><b>${s.candidate ? 'Agent 候选' : '方案'} ${s.id} · ${esc(s.title)}</b><span>${s.candidate ? '客户不可见' : `修订 ${L1.revisions[s.id]}${s.id === conf ? ' · 客户已确认' : ''}`} · ${floorName} · ${S.view === 'image' ? '效果图示意' : '拖动旋转'}</span></div>`;
  return `<div class="app app--ws">${TopBar('leads')}<main class="canvas${S.left ? ' has-left' : ''}${S.agent ? ' has-right' : ''}">${left}<section class="stage"><div class="stage__frame">${media}</div>${caption}${toolbar}</section>${agent}</main></div>`;
}

// ---------- 线索列表 ----------
function LeadList() {
  const stage = l => ['assist', 'review', 'drafting'].includes(l.status) ? 'review' : l.status === 'confirmed' ? 'confirmed' : 'published';
  let rows = leads.filter(l => S.status === 'all' || stage(l) === S.status);
  if (S.follow) rows = rows.filter(l => l.follow === S.follow);
  rows.sort((a, b) => lastEvent(b).at - lastEvent(a).at);
  const count = v => leads.filter(l => v === 'all' || stage(l) === v).length;
  const quick = [['请求联系', leads.filter(l => needsAction(l).contact).length, 'phone'], ['待审核 / 辅助转换', leads.filter(l => needsAction(l).review || needsAction(l).assist).length, 'file'], ['待批准绑定', leads.filter(l => needsAction(l).apply).length, 'link']];
  return `<div class="app app--list">${TopBar('leads')}<main class="page">
    <div class="page__head"><div><h1 class="page__title">线索</h1><p class="muted">客户自助提交的需求，以及企业为客户预置并分享的方案。</p></div><button class="btn btn--primary">${icon('plus', 16)} 预置方案</button></div>
    <div class="quick">${quick.map(([t, n, i]) => `<button class="quick__item"><span class="quick__icon">${icon(i, 18)}</span><span><b class="num">${n}</b><small>${t}</small></span></button>`).join('')}</div>
    <div class="list-tools"><div class="segmented">${[['all', '全部'], ['review', '待审核'], ['published', '已发布'], ['confirmed', '客户已确认']].map(([v, t]) => `<button aria-pressed="${S.status === v}" data-act="status" data-v="${v}">${t}<small class="num">${count(v)}</small></button>`).join('')}</div>
      <div class="chips">${followOrder.map(k => `<button class="chip" aria-pressed="${S.follow === k}" data-act="follow" data-v="${k}">${followName[k]}</button>`).join('')}</div>
      <label class="search">${ic('search', 16)}<input placeholder="手机号、称呼或项目名"></label></div>
    <div class="table" role="table">
      <div class="table__head" role="row"><span></span><span>项目 / 客户</span><span>状态</span><span>跟进</span><span>最近动作</span><span></span></div>
      ${rows.map(l => { const a = needsAction(l), e = lastEvent(l); return `<a class="table__row" role="row" data-act="open">
        <span class="thumb">${l.schemes ? `<img data-render="f1" data-lead="${l.id}" data-w="240" data-h="160" alt="">` : icon('file', 20)}</span>
        <span class="cell-main"><b>${esc(l.title)}</b><small>${l.customer ? `${esc(l.customer.name || '客户')} · ${maskPhone(l.customer.phone)}` : '未绑定客户'} · ${l.origin === 'member' ? '企业预置' : '客户自助'}</small>
          ${a.contact ? `<em class="flag">${icon('phone', 13)} 请求联系</em>` : ''}${a.apply ? `<em class="flag">${icon('link', 13)} 绑定申请待批准</em>` : ''}</span>
        <span>${badge(l.status)}</span><span class="follow follow--${l.follow}">${followName[l.follow]}</span>
        <span class="cell-event">${esc(e.text)}<small>${when(e.at)}</small></span><span class="chev">${icon('chevron', 16)}</span></a>`; }).join('')}
    </div></main></div>`;
}

// ---------- 对比稿外壳 ----------
function Board() {
  const seg = (k, opts) => `<div class="board-seg">${opts.map(([v, t]) => `<button aria-pressed="${S[k] === v}" data-act="${k}" data-v="${v}">${t}</button>`).join('')}</div>`;
  return `<div class="board-bar" role="toolbar" aria-label="对比稿切换（不属于产品界面）"><b>企业工作台风格对比稿</b>
    ${seg('page', [['ws', '方案工作台'], ['list', '线索列表']])}${seg('dir', [['a', 'A 停靠'], ['b', 'B 悬浮'], ['c', 'C 画框']])}${seg('theme', [['light', '浅色'], ['dark', '深色']])}
    <span class="board-note">演示数据 · 效果图与 3D 为示意</span></div>`;
}

let unmount = [];
function fill(root) {
  const imgs = [...root.querySelectorAll('img[data-render]')];
  let i = 0;
  const step = () => { const img = imgs[i++]; if (!img) return;
    const l = img.dataset.lead ? leads.find(x => x.id === img.dataset.lead) : L1;
    const sc = img.dataset.lead ? l.schemes[0] : schemes().find(x => x.id === (img.dataset.scheme || S.scheme));
    const w = +(img.dataset.w || 1600), h = +(img.dataset.h || 900);
    const url = renderImage(img.dataset.render, sc, w, h); if (url) img.src = url; setTimeout(step, 0); };
  setTimeout(step, 20);
  root.querySelectorAll('[data-viewer]').forEach(host => unmount.push(mountViewer(host, schemes().find(x => x.id === S.scheme), S.floor, 'floor')));
}
function render() {
  unmount.forEach(f => f()); unmount = [];
  document.documentElement.dataset.dir = S.dir; document.documentElement.dataset.theme = S.theme;
  const root = document.querySelector('#app');
  root.innerHTML = Board() + (S.page === 'ws' ? Workspace() : LeadList());
  fill(root);
}
const actions = {
  page: v => { S.page = v; }, dir: v => { S.dir = v; }, theme: v => { S.theme = v; }, scheme: v => { S.scheme = v; }, view: v => { S.view = v; }, floor: v => { S.floor = v; },
  tab: v => { S.tab = v; }, agent: () => { S.agent = !S.agent; }, left: () => { S.left = !S.left; },
  status: v => { S.status = v; }, follow: v => { S.follow = S.follow === v ? '' : v; }, open: () => { S.page = 'ws'; },
};
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (!el) return; e.preventDefault(); actions[el.dataset.act]?.(el.dataset.v); render(); });
window.__board = {set: patch => { Object.assign(S, patch); render(); }};
render();
