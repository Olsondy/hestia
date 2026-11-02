// 企业工作台交互原型（P02）：电脑端、演示数据、不接服务端。仅供审阅交互与视觉，不作为生产代码基础。
import {icon} from '../../client-h5/src/icons.js';
import {stones, stoneById, layoutName, specLabel, villa, facets, facetById, kindName, makeSchemes, checkFinish, maskPhone, softStyles, softById} from '../../client-h5/src/data.js';
import {swatchURL} from '../../client-h5/src/stone.js';
import {renderImage} from '../../client-h5/src/render3d.js';
import {member, followName, followOrder, statusInfo, seedLeads, lastEvent, needsAction} from './data.js';

const KEY = 'hestia.enterprise-workbench.v1';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fresh = () => ({session: true, leads: seedLeads(), seq: 8, ui: {}, draft: freshDraft(), login: {email: member.email, password: '', error: null}});
const freshDraft = () => ({name: '', note: '', floor: 'f1', facets: ['f1-living', 'f1-dining', 'f1-wall', 's12'], stones: ['yashi', 'shaanna']});
let state;
try { state = JSON.parse(localStorage.getItem(KEY) || 'null') || fresh(); } catch { state = fresh(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 隐私模式仅内存 */ } };

// ---------- 路由 ----------
function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return {path, parts: path.split('/').filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs || ''))};
}
const go = path => { if (location.hash === '#' + path) render(); else location.hash = path; };
let timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, ms));

// ---------- 小工具 ----------
const leadById = id => state.leads.find(l => l.id === id);
const when = t => {
  const m = Math.round((Date.now() - t) / 60e3);
  if (m < 1) return '刚刚'; if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60); if (h < 24) return `${h} 小时前`;
  const d = new Date(t); return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};
const clock = t => { const d = new Date(t); return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const chip = s => `<span class="status ${statusInfo[s][1]}">${statusInfo[s][0]}</span>`;
const follow = f => `<span class="follow ${f}"><i></i>${followName[f]}</span>`;
const who = l => l.customer ? `${esc(l.customer.name || '客户')} · ${maskPhone(l.customer.phone)}` : '未绑定客户';
const sourceName = l => l.source === 'sample' ? '示例别墅' : l.source === 'dxf' ? `DXF 图纸 · ${esc(l.fileName)}` : `${esc(l.fileName)} · 需辅助转换`;
const confirmed = l => l.events.filter(e => e.kind === 'confirm').at(-1);
const floorsOf = l => villa.floors.filter(fl => l.facets.some(id => facetById[id]?.floor === fl.id));
const finishLine = (fid, fin) => {
  const f = facetById[fid]; if (!fin) return '未铺石材';
  const s = stoneById[fin.stone].name;
  if (f.kind === 'stair') return `${s} · 整板踏步`;
  return `${s} · ${specLabel(fin.spec)} · ${layoutName[fin.layout]}${fin.border ? ` · ${stoneById[fin.borderStone].name}波打线` : ''}`;
};
const title2 = (a, b) => b ? `${esc(a.replace(/ · $/, ''))}<br><em>${esc(b)}</em>` : esc(a);
const split = name => { const i = name.indexOf(' · '); return i > 0 ? [name.slice(0, i + 3), name.slice(i + 3)] : [name, '']; };
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

// ---------- 外壳 ----------
function shell(content, {nav = ''} = {}) {
  const counts = state.leads.reduce((n, l) => { const a = needsAction(l); return n + (a.review || a.assist || a.contact || a.apply ? 1 : 0); }, 0);
  return `<header class="top">
      <a class="brand" href="#/"><span class="brand-mark" aria-hidden="true">标志</span><span><b>演示家装企业</b><small>企业工作台</small></span></a>
      <nav class="nav" aria-label="工作台">
        <a href="#/" ${nav === 'today' ? 'aria-current="page"' : ''}>今日${counts ? `<span class="count">${counts}</span>` : ''}</a>
        <a href="#/leads" ${nav === 'leads' ? 'aria-current="page"' : ''}>线索</a>
        <a href="#/new" ${nav === 'new' ? 'aria-current="page"' : ''}>预置方案</a>
        <a href="#/stones" ${nav === 'stones' ? 'aria-current="page"' : ''}>石材与软装</a>
      </nav>
      <div class="who"><span>${member.name}</span><button data-act="logout">退出</button><button class="demo-chip" data-act="review">演示</button></div>
    </header>
    <main class="main" id="page">${content}</main>
    <footer class="foot"><span>演示环境 · 数据、尺寸与效果图均为示意 · 客户手机号仅企业成员可见</span><button data-act="review">原型审阅导航 ${icon('menu', 13)}</button></footer>`;
}

// ---------- 登录 / 无权访问 ----------
function loginView() {
  const L = state.login;
  return `<header class="top"><a class="brand" href="#/login"><span class="brand-mark" aria-hidden="true">标志</span><span><b>演示家装企业</b><small>企业工作台</small></span></a><div class="who"><button class="demo-chip" data-act="review">演示</button></div></header>
    <main class="auth">
      <section class="story"><span class="kicker">企业成员</span><h1 class="display">每一条线索，<br><em>都有一个具体的家。</em></h1>
        <p class="lede">客户在 H5 提交的需求、确认的方案和留言都汇总在这里。用 Agent 出硬装 + 软装的整体方案，核对后发布给客户，跟进到成交。</p>
        <span class="rule"></span><p class="small muted">工作台不开放注册。成员账号由企业管理员邀请开通。</p></section>
      <form class="auth-form" data-form="login"><h2>登录工作台</h2><p class="small muted">使用企业邀请时设置的邮箱和密码。</p>
        <label class="field"><span>邮箱</span><input name="email" type="email" autocomplete="username" value="${esc(L.email)}"></label>
        <label class="field"><span>密码</span><input name="password" type="password" autocomplete="current-password" placeholder="演示密码：${member.password}"></label>
        ${L.error ? `<div class="alert danger" role="alert">${icon('alert', 16)}<span>${L.error === 'wrong' ? '邮箱或密码不正确，请检查后重试。' : '这个账号不是本企业的成员，不能进入企业工作台。'}</span></div>` : ''}
        <button class="btn primary" type="submit">登录 ${icon('arrow', 18)}</button>
        <p class="small muted" style="margin-top:16px">客户请从企业的 H5 入口用手机号登录。</p></form>
    </main><footer class="foot"><span>演示环境 · 数据均为示意</span></footer>`;
}
function deniedView() {
  return shell(`<section class="spread"><div class="story"><span class="kicker">无权访问</span><h1 class="display md">这个账号<br><em>不是本企业成员</em></h1>
    <p class="lede">企业工作台只对企业成员开放。客户账号请使用企业的 H5 入口；如需成为成员，请联系企业管理员邀请。</p></div>
    <div class="work"><button class="btn ghost" data-act="logout">换一个账号登录</button></div></section>`);
}

// ---------- 今日 ----------
function todayView() {
  const L = state.leads, act = L.map(l => [l, needsAction(l)]);
  const list = (pred, line) => { const items = act.filter(([, a]) => pred(a)).map(([l]) => l); return items.length ? `<ul>${items.map(l => `<li><a href="#/lead/${l.id}"><b>${esc(l.title)}</b><small>${line(l)}</small></a></li>`).join('')}</ul>` : '<p class="none">暂无</p>'; };
  const n = pred => act.filter(([, a]) => pred(a)).length;
  const week = L.filter(l => Date.now() - l.createdAt < 7 * 864e5).length;
  return shell(`<section class="spread">
    <div class="story"><span class="kicker">今日</span><h1 class="display">${n(a => a.review || a.assist || a.contact || a.apply)} 件<br><em>需要处理</em></h1>
      <p class="lede">客户请求联系的先回电；自动转换的图纸核对后再发布；绑定申请核对身份后批准。</p>
      <span class="rule"></span>
      <div class="story-foot"><a class="design-row" href="#/leads">查看全部线索<span>${icon('arrow', 18)}</span></a><a class="design-row" href="#/new">为客户预置方案<span>${icon('plus', 18)}</span></a></div></div>
    <div class="work">
      <div class="today-figures">
        <a class="figure hot" href="#/leads?f=contact"><b>${n(a => a.contact)}</b><span>请求联系</span><small>客户确认后希望回电</small></a>
        <a class="figure hot" href="#/leads?s=review"><b>${n(a => a.review || a.assist)}</b><span>待审核 / 辅助转换</span><small>图纸需求等待企业处理</small></a>
        <a class="figure hot" href="#/leads?f=apply"><b>${n(a => a.apply)}</b><span>待批准绑定</span><small>分享链接收到的申请</small></a>
        <a class="figure" href="#/leads"><b>${week}</b><span>本周新线索</span><small>共 ${L.length} 条线索</small></a>
      </div>
      <div class="todo-cols">
        <section class="todo"><h3>请求联系<small>按时间</small></h3>${list(a => a.contact, l => `${who(l)} · ${esc(l.events.find(e => e.kind === 'contact').text.split(' · ')[1] || '')} · ${when(lastEvent(l).at)}`)}</section>
        <section class="todo"><h3>待审核与辅助转换<small>图纸需求</small></h3>${list(a => a.review || a.assist, l => `${l.status === 'review' ? 'DXF 已自动转换，待核对' : '非 DXF 图纸，需企业导入户型'} · ${when(l.createdAt)}`)}</section>
        <section class="todo"><h3>待批准绑定<small>分享链接</small></h3>${list(a => a.apply, l => { const a = l.applications.find(x => x.status === 'pending'); return `${maskPhone(a.phone)} · ${esc(a.note.split('：')[0])} · ${when(a.at)}`; })}</section>
      </div>
      <section class="section"><div class="section-head"><h2 class="h3">最近动态</h2><a class="text-link" href="#/leads">全部线索 ${icon('chevron', 13)}</a></div>
        <ol class="timeline">${L.flatMap(l => l.events.map(e => ({...e, l}))).sort((a, b) => b.at - a.at).slice(0, 6).map(e => `<li><time>${when(e.at)}</time><div><a href="#/lead/${e.l.id}"><b style="font-weight:500">${esc(e.l.title)}</b></a> · ${esc(e.text)}</div></li>`).join('')}</ol></section>
    </div></section>`, {nav: 'today'});
}

// ---------- 线索列表 ----------
const stageOf = l => l.status === 'assist' || l.status === 'review' ? 'review' : l.status === 'confirmed' ? 'confirmed' : 'published';
function leadsView(q) {
  const s = q.s || 'all', f = q.f || '', text = (q.t || '').trim();
  let rows = state.leads.filter(l => s === 'all' || stageOf(l) === s);
  if (f === 'contact') rows = rows.filter(l => needsAction(l).contact);
  else if (f === 'apply') rows = rows.filter(l => needsAction(l).apply);
  else if (followOrder.includes(f)) rows = rows.filter(l => l.follow === f);
  if (text) rows = rows.filter(l => (l.customer?.phone || '').includes(text) || (l.customer?.name || '').includes(text) || l.title.includes(text));
  rows.sort((a, b) => lastEvent(b).at - lastEvent(a).at);
  const count = v => state.leads.filter(l => v === 'all' || stageOf(l) === v).length;
  const link = patch => '#/leads?' + new URLSearchParams(Object.entries({s, f, t: text, ...patch}).filter(([, v]) => v && v !== 'all')).toString();
  return shell(`<section class="spread">
    <div class="story"><span class="kicker">线索</span><h1 class="display md">${state.leads.length} 条<br><em>线索</em></h1>
      <p class="lede">客户自助提交的需求，以及企业为客户预置并分享的方案。跟进状态只有企业成员能看到。</p>
      <span class="rule"></span>
      <dl class="facts">${followOrder.map(k => `<div><dt>${followName[k]}</dt><dd>${state.leads.filter(l => l.follow === k).length} 条</dd></div>`).join('')}</dl></div>
    <div class="work">
      <div class="filters">
        <div class="seg" role="group" aria-label="状态">${[['all', '全部'], ['review', '待审核'], ['published', '已发布'], ['confirmed', '客户已确认']].map(([v, t]) => `<button aria-pressed="${s === v}" data-act="nav" data-v="${link({s: v})}">${t}<small>${count(v)}</small></button>`).join('')}</div>
        <div class="chips" role="group" aria-label="跟进">${[['contact', '请求联系'], ['apply', '待批准绑定'], ...followOrder.map(k => [k, followName[k]])].map(([v, t]) => `<button class="chip" aria-pressed="${f === v}" data-act="nav" data-v="${link({f: f === v ? '' : v})}">${t}</button>`).join('')}</div>
        <label class="search">${icon('user', 15)}<input id="search" placeholder="手机号、称呼或项目名" value="${esc(text)}"></label>
      </div>
      ${rows.length ? `<table class="lead-table"><thead><tr><th style="width:118px"><span class="sr-only">缩略图</span></th><th>项目 / 客户</th><th class="col-src">来源</th><th>状态</th><th>跟进</th><th>最近动作</th></tr></thead><tbody>
        ${rows.map(l => { const e = lastEvent(l), a = needsAction(l); return `<tr class="link" data-act="nav" data-v="#/lead/${l.id}">
          <td><div class="thumb">${l.schemes ? `<img data-render="f1" data-lead="${l.id}" data-w="320" data-h="210" alt="">` : icon('file', 22)}</div></td>
          <td><b>${esc(l.title)}</b><small>${who(l)}</small>${a.contact ? `<span class="flag">${icon('phone', 12)} 请求联系</span>` : ''}${a.apply ? `<span class="flag">${icon('link', 12)} 绑定申请待批准</span>` : ''}</td>
          <td class="col-src">${l.origin === 'member' ? '企业预置' : '客户自助'}<small>${sourceName(l)}</small></td>
          <td>${chip(l.status)}</td><td>${follow(l.follow)}</td>
          <td>${esc(e.text)}<small>${when(e.at)}</small></td></tr>`; }).join('')}</tbody></table>`
        : `<div class="empty"><h2 class="h2">没有符合条件的线索</h2><p>换一个筛选条件，或清空搜索。</p><p style="margin-top:14px"><a class="text-link" href="#/leads">清空筛选 ${icon('chevron', 13)}</a></p></div>`}
    </div></section>`, {nav: 'leads'});
}

// ---------- 线索详情 ----------
function detailView(l) {
  const ui = state.ui[l.id] ||= {scheme: confirmed(l)?.text.match(/方案 (\w)/)?.[1] || 'A', floor: 'f1'};
  const floors = l.schemes ? floorsOf(l) : [];
  if (floors.length && !floors.some(f => f.id === ui.floor)) ui.floor = floors[0].id;
  const s = l.schemes?.find(x => x.id === ui.scheme), conf = confirmed(l);
  const a = needsAction(l);
  const facetsHere = l.facets.filter(id => facetById[id].floor === ui.floor);
  const agentBtn = l.schemes || l.status === 'review' ? `<a class="btn ghost" href="#/lead/${l.id}/agent">${icon('chat', 16)} Agent 出方案</a>` : '';
  const bar = l.status === 'review' ? `<span class="hint">图纸自动转换的结果需要核对后才能发布给客户。</span>${agentBtn}<a class="btn primary" href="#/lead/${l.id}/review">审核并发布 ${icon('arrow', 16)}</a>`
    : l.status === 'assist' ? `<span class="hint">这份图纸不能自动识别，需要企业导入整理好的户型。</span><a class="btn primary" href="#/lead/${l.id}/assist">辅助转换 ${icon('arrow', 16)}</a>`
      : l.origin === 'member' ? `<span class="hint">${l.customer ? `已绑定 ${maskPhone(l.customer.phone)}` : '还没有绑定客户。分享后，客户按企业设定的方式绑定。'}</span>${agentBtn}<button class="btn primary" data-act="share" data-v="${l.id}">${icon('link', 16)} 分享给客户</button>`
        : `<span class="hint">客户自己提交的项目属于客户本人，无须分享绑定。</span>${agentBtn}${a.contact ? `<button class="btn primary" data-act="follow" data-v="contacted">已回电，标记为已联系</button>` : ''}`;
  const sharing = l.origin === 'customer' ? '<p class="small muted" style="margin-top:12px">客户自助提交，项目属于客户本人，不需要分享与绑定。</p>' : `
    ${l.customer ? `<div class="share-card"><div class="head"><span><b>主客户</b> · ${esc(l.customer.name || '客户')} ${l.customer.phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1 $2 $3')}</span><button class="btn danger small" data-act="confirm" data-k="unbind" data-v="${l.id}">解绑</button></div><p>解绑后客户不能再打开这个项目，可以重新分享给其他人。</p></div>` : ''}
    ${l.applications.filter(x => x.status === 'pending').map(x => `<div class="apply"><b>绑定申请 · ${maskPhone(x.phone)}</b><span class="small muted"> · ${when(x.at)}</span><p>${esc(x.note)}</p>
      <div class="row-actions"><button class="btn primary small" data-act="confirm" data-k="approve" data-v="${l.id}:${x.id}">核对无误，批准绑定</button><button class="btn danger small" data-act="confirm" data-k="reject" data-v="${l.id}:${x.id}">拒绝</button></div></div>`).join('')}
    ${l.shares.map(sh => `<div class="share-card"><div class="head"><span><b>${sh.mode === 'phone' ? `定向分享 · ${maskPhone(sh.phone)}` : '绑定码分享'}</b></span>${sh.status === 'active' ? `<span class="status ok">有效</span>` : '<span class="status assist">已撤销</span>'}</div>
      <p>${sh.mode === 'phone' ? '客户用该手机号登录即自动绑定；其他号码只能预览或提交申请。' : `一次性绑定码，${sh.codeExpires ? `有效至 ${sh.codeExpires}` : '48 小时内有效'}。链接与绑定码只在创建时显示。`} 链接有效至 ${sh.expires}。</p>
      ${sh.status === 'active' ? `<div class="row-actions"><button class="btn ghost small" data-act="confirm" data-k="revoke" data-v="${l.id}:${sh.id}">撤销链接</button></div>` : ''}</div>`).join('')}
    ${!l.shares.length ? '<p class="small muted" style="margin-top:12px">还没有分享。</p>' : ''}
    ${l.history.length ? `<h3 class="h3" style="margin-top:22px">记录</h3><ol class="timeline">${[...l.history].reverse().map(h => `<li><time>${clock(h.at)}</time><div>${esc(h.text)}</div></li>`).join('')}</ol>` : ''}`;
  return shell(`<section class="spread">
    <div class="story">
      <a class="text-link" href="#/leads" style="align-self:flex-start;border:0">${icon('back', 15)} 线索</a>
      <h1 class="display sm" style="margin-top:14px">${title2(...split(l.title))}</h1>
      <p style="margin-top:14px;display:flex;gap:10px;align-items:center">${chip(l.status)}<span class="small muted">${l.origin === 'member' ? '企业预置' : '客户自助'} · ${when(l.createdAt)}</span></p>
      <dl class="facts">
        <div><dt>客户</dt><dd>${l.customer ? `<span class="phone-full">${l.customer.phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1 $2 $3')}</span><small class="muted">${esc(l.customer.name || '未留称呼')} · 已验证手机号</small>` : '<span class="muted">尚未绑定</span>'}</dd></div>
        <div><dt>户型</dt><dd>${sourceName(l)}</dd></div>
        <div><dt>饰面</dt><dd>${l.facets.length ? `${l.facets.length} 处 · ${floorsOf(l).map(f => f.name).join('、')}` : `${(l.kinds || []).map(k => ({floor: '各层地面', wall: '背景墙', stair: '楼梯踏面'}[k])).join('、')}（待确认）`}</dd></div>
        <div><dt>石材</dt><dd>${l.stones.map(id => stoneById[id].name).join('、')}</dd></div>
        <div><dt>偏好</dt><dd>${esc(l.prefs)}</dd></div>
        ${l.note ? `<div><dt>说明</dt><dd>${esc(l.note)}</dd></div>` : ''}
      </dl>
      <h2 class="h3" style="margin-top:28px">跟进 <small>仅企业成员可见</small></h2>
      <div class="select" role="radiogroup" aria-label="跟进状态">${followOrder.map(k => `<button class="chip" role="radio" aria-checked="${l.follow === k}" data-act="follow" data-v="${k}">${followName[k]}</button>`).join('')}</div>
      <form class="note-form" data-form="note"><textarea name="note" rows="3" maxlength="500" placeholder="内部备注，例如：已约周六到店看样。"></textarea><button class="btn ghost small" type="submit" style="justify-self:start">添加备注</button></form>
      <ul class="notes">${[...l.notes].reverse().map(n => `<li>${esc(n.text)}<small>${esc(n.by)} · ${clock(n.at)}</small></li>`).join('')}</ul>
    </div>
    <div class="work flush">
      ${s ? `<figure class="plate">
        <div class="plate-top"><span>${villa.floors.find(f => f.id === ui.floor).name} · 方案 ${s.id} ${s.title} · 修订 ${l.revisions[s.id]}</span>${floors.length > 1 ? `<div class="seg" style="background:var(--paper);border:0">${floors.map(f => `<button aria-pressed="${f.id === ui.floor}" data-act="floor" data-v="${f.id}" style="color:var(--ink)">${f.name}</button>`).join('')}</div>` : ''}</div>
        <div class="plate-img"><img data-render="${ui.floor}" data-lead="${l.id}" data-scheme="${s.id}" data-w="1280" data-h="720" alt="方案 ${s.id} 效果图（示意）"></div>
        <figcaption><span>${conf ? `客户已确认：${esc(conf.text.replace('确认 ', ''))}` : '客户尚未确认'}</span><span>效果图 · 示意素材</span></figcaption></figure>
      <div class="rail" role="group" aria-label="方案">${l.schemes.map(x => { const fin = x.finishes[facetsHere[0]]; return `<button class="rail-item" aria-pressed="${x.id === s.id}" data-act="scheme" data-v="${x.id}"><b>${x.id} · ${x.title}</b><small>硬装：${fin ? finishLine(facetsHere[0], fin) : '—'}<br>软装：${softById[x.soft]?.name || '—'} · 修订 ${l.revisions[x.id] || 1}</small>${conf?.text.includes(`方案 ${x.id}`) ? `<span class="badge">${icon('check', 13)} 已确认</span>` : ''}${x.id === 'D' ? '<span class="badge" style="color:var(--accent)">待审 · 客户不可见</span>' : ''}</button>`; }).join('')}</div>` :
        `<div class="plate"><div class="plate-img" style="display:grid;place-items:center;color:#5a4a41;font-size:13px">${l.status === 'assist' ? '图纸需要辅助转换，转换并生成方案后在这里显示' : '方案生成并核对后在这里显示'}</div></div>`}
      <div class="detail-body"><div class="cols">
        <section><div class="section-head"><h2 class="h3">客户动作</h2></div>
          <ol class="timeline">${[...l.events].reverse().map(e => `<li class="ev-${e.kind}"><time>${clock(e.at)}</time><div>${e.kind === 'contact' ? `<b>${esc(e.text)}</b>` : esc(e.text)}${e.message ? `<blockquote>${esc(e.message)}</blockquote>` : ''}</div></li>`).join('')}</ol>
          ${s ? `<div class="section-head" style="margin-top:28px"><h2 class="h3">方案 ${s.id} · ${villa.floors.find(f => f.id === ui.floor).name}硬装</h2></div>
          <ul class="finish-list">${facetsHere.map(id => `<li><b>${facetById[id].name}</b><span><span class="sw" style="background-image:url(${swatchURL(s.finishes[id].stone, 32)})"></span>${finishLine(id, s.finishes[id])}</span></li>`).join('')}</ul>
          ${softBlock(s, ui.floor)}` : ''}
        </section>
        <section><div class="section-head"><h2 class="h3">分享与绑定</h2>${l.origin === 'member' && l.status === 'published' ? `<button class="btn ghost small" data-act="share" data-v="${l.id}">${icon('plus', 14)} 新建分享</button>` : ''}</div>${sharing}</section>
      </div></div>
      <div class="action-bar">${bar}</div>
    </div></section>`, {nav: 'leads'});
}

// ---------- 审核发布（DXF 待审核） ----------
function reviewView(l) {
  const stage = l.stage || 'converted';
  const steps = ['图纸已转换', '生成待审方案', '核对效果图与提示', '发布给客户'];
  const at = {converted: 1, generating: 1, ready: 2}[stage];
  let body;
  if (stage === 'converted') {
    body = `<div class="section-head"><h2 class="h3">自动转换结果 <small>${l.convert.levels} 层 · ${l.convert.finishes} 处可铺贴饰面 · ${l.convert.scale}</small></h2></div>
      <div class="levels" style="margin-top:16px">${villa.floors.map(fl => `<figure><div class="plan-box" style="margin:0">${planSVG(fl.id, l.facets)}</div><figcaption>${fl.name} · 高亮为派生的铺贴饰面</figcaption></figure>`).join('')}</div>
      ${l.convert.hints.map(h => `<p class="alert hint">${icon('info', 16)}<span><b>请核对</b>${esc(h)}</span></p>`).join('')}
      <p class="small muted" style="margin-top:14px">核对无误后生成待审方案：系统按房间派生地面与楼梯饰面，用客户选择的石材按规则生成 3 个方案并出图。客户在发布前看不到这些方案。</p>`;
  } else if (stage === 'generating') {
    body = `<div class="plan-box" style="text-align:center;padding:60px 20px"><b class="h3" style="justify-content:center">正在生成待审方案</b><p class="small muted">排版、校验并后台出图 · 每张约 1–2 分钟（原型中加速）</p><div class="bar-progress" style="max-width:360px;margin:16px auto 0"><i></i></div></div>`;
  } else {
    const hints = l.schemes.map(sc => Object.entries(sc.finishes).flatMap(([id, fin]) => checkFinish(id, fin)));
    body = `<div class="section-head"><h2 class="h3">待审方案 <small>只有企业成员可见</small></h2><button class="btn ghost small" data-act="regen" data-v="${l.id}">重新生成</button></div>
      <div class="review-grid">${l.schemes.map((sc, i) => `<article class="review-card"><div class="plate-img"><img data-render="f1" data-lead="${l.id}" data-scheme="${sc.id}" data-w="720" data-h="540" alt=""></div>
        <div class="body"><b>${sc.id} · ${sc.title}</b><p>${esc(sc.line)}</p>${hints[i].length ? hints[i].map(h => `<p class="alert ${h.level === 'conflict' ? 'danger' : 'hint'}" style="margin-top:8px">${icon(h.level === 'conflict' ? 'alert' : 'info', 14)}<span><b>${h.level === 'conflict' ? '冲突' : '提示'}</b>${esc(h.text)}</span></p>`).join('') : `<p class="alert ok" style="margin-top:8px">${icon('check', 14)}<span>排版校验通过</span></p>`}</div></article>`).join('')}</div>`;
  }
  return shell(`<section class="spread">
    <div class="story"><a class="text-link" href="#/lead/${l.id}" style="align-self:flex-start;border:0">${icon('back', 15)} 线索详情</a>
      <h1 class="display md" style="margin-top:14px">审核<br><em>${esc(l.fileName)}</em></h1>
      <p class="lede">${l.reviewReason}。为避免尺寸或饰面边界不准确的方案误导客户，核对后再发布。</p>
      <ol class="steps" style="margin-top:28px">${steps.map((t, i) => `<li class="${i === at ? 'on' : i < at ? 'done' : ''}">${t}</li>`).join('')}</ol>
      <dl class="facts"><div><dt>客户</dt><dd>${who(l)}</dd></div><div><dt>石材</dt><dd>${l.stones.map(id => stoneById[id].name).join('、')}</dd></div><div><dt>偏好</dt><dd>${esc(l.prefs)}</dd></div></dl></div>
    <div class="work">${body}</div></section>
    <div class="action-bar" style="position:fixed;left:0;right:0;bottom:0">${stage === 'converted' ? `<span class="hint">转换结果有误时，可改为辅助转换：导入整理好的户型。</span><a class="btn ghost" href="#/lead/${l.id}/assist">改为辅助转换</a><button class="btn primary" data-act="generate" data-v="${l.id}">生成待审方案 ${icon('arrow', 16)}</button>`
      : stage === 'generating' ? '<span class="hint">出图完成后可以发布。</span><button class="btn primary" disabled>发布给客户</button>'
        : `<span class="hint">只发布通过排版校验的方案；有“提示”的方案可以发布。</span><button class="btn primary" data-act="confirm" data-k="publish" data-v="${l.id}">发布给客户 ${icon('arrow', 16)}</button>`}</div>`, {nav: 'leads'});
}

// ---------- 辅助转换 ----------
function assistView(l) {
  const st = l.assistStage || 'waiting';
  const steps = ['下载客户图纸', '整理户型', '导入户型', '生成待审方案'];
  const at = {waiting: 2, validating: 2, invalid: 2, valid: 3}[st];
  return shell(`<section class="spread">
    <div class="story"><a class="text-link" href="#/lead/${l.id}" style="align-self:flex-start;border:0">${icon('back', 15)} 线索详情</a>
      <h1 class="display md" style="margin-top:14px">辅助<br><em>转换图纸</em></h1>
      <p class="lede">「${esc(l.fileName)}」不能自动识别。由企业按图纸整理户型（墙体、门窗、楼层与楼梯），导入后再按同样的规则出方案。</p>
      <ol class="steps" style="margin-top:28px">${steps.map((t, i) => `<li class="${i === at ? 'on' : i < at ? 'done' : ''}">${t}</li>`).join('')}</ol>
      <dl class="facts"><div><dt>客户</dt><dd>${who(l)}</dd></div><div><dt>范围</dt><dd>${(l.kinds || []).map(k => ({floor: '各层地面', wall: '背景墙', stair: '楼梯踏面'}[k])).join('、')}</dd></div><div><dt>说明</dt><dd>${esc(l.note || '—')}</dd></div></dl></div>
    <div class="work">
      <div class="section-head"><h2 class="h3">1 · 客户图纸</h2></div>
      <p style="margin-top:12px;display:flex;align-items:center;gap:12px">${icon('file', 20)} <b style="font-weight:500">${esc(l.fileName)}</b><button class="text-link" data-act="toast" data-v="原型操作：下载客户上传的原始图纸">下载原图</button></p>
      <div class="section-head" style="margin-top:30px"><h2 class="h3">2 · 导入整理好的户型 <small>HouseSpec（JSON，单位毫米）</small></h2></div>
      ${st === 'waiting' ? `<div class="drop">${icon('upload', 24)}<b>拖入或选择户型文件</b><small>包含楼层、墙体、门窗与楼梯；导入后先校验，再派生铺贴饰面</small>
        <div class="row-actions" style="justify-content:center;margin-top:16px"><button class="btn ghost small" data-act="assist" data-v="ok">使用演示户型文件</button><button class="btn ghost small" data-act="assist" data-v="bad">演示校验失败</button></div></div>`
        : st === 'validating' ? `<div class="drop"><b>正在校验户型…</b><div class="bar-progress" style="max-width:300px;margin:14px auto 0"><i></i></div></div>`
          : st === 'invalid' ? `<div class="alert danger">${icon('alert', 16)}<span><b>户型未通过校验</b>二层楼梯开洞与楼梯位置不一致；三层外墙未闭合（东北角缺 0.4 m）。修正后重新导入。</span></div><div class="row-actions" style="margin-top:14px"><button class="btn ghost small" data-act="assist" data-v="reset">重新导入</button></div>`
            : `<div class="alert ok">${icon('check', 16)}<span><b>户型校验通过</b>3 层 · 墙体闭合 · 楼梯与开洞对齐 · 派生 8 处地面与楼梯饰面</span></div>
              <div class="levels" style="margin-top:16px">${villa.floors.map(fl => `<figure><div class="plan-box" style="margin:0">${planSVG(fl.id, ['f1-living', 'f1-dining', 'f1-foyer', 's12', 'f2-lounge', 's23', 'f3-tea', 'f3-hall'])}</div><figcaption>${fl.name}</figcaption></figure>`).join('')}</div>`}
    </div></section>
    <div class="action-bar" style="position:fixed;left:0;right:0;bottom:0"><span class="hint">生成后进入审核：核对效果图，再发布给客户。</span><button class="btn primary" data-act="assist-generate" data-v="${l.id}" ${st === 'valid' ? '' : 'disabled'}>生成待审方案 ${icon('arrow', 16)}</button></div>`, {nav: 'leads'});
}

function softBlock(s, floorId) {
  const st = softById[s.soft]; if (!st) return '';
  const rooms = villa.floors.find(f => f.id === floorId).rooms.map(r => r.name).filter(n => st.rooms[n]);
  return `<div class="section-head" style="margin-top:28px"><h2 class="h3">软装 · ${st.name} <small>${esc(st.line)}</small></h2><span class="palette">${Object.values(st.palette).slice(0, 5).map(c => `<i style="background:${c}"></i>`).join('')}</span></div>
    <ul class="finish-list">${rooms.length ? rooms.map(n => `<li><b>${n}</b><span>${esc(st.rooms[n])}</span></li>`).join('') : '<li><b>本层</b><span>沿用整体风格</span></li>'}</ul>`;
}

// ---------- Agent 出方案（企业内部使用，需联网调用模型） ----------
const prompts = ['客厅大气一点，二层主卧做新中式', '整体换成轻奢风，地面保持浅色', '客厅地面用爵士白大板'];
function agentPlan(text) {
  if (/爵士白/.test(text)) return {rejected: '企业石材库中没有「爵士白」。可选的浅色石材：雅士白、鱼肚白。要改用鱼肚白大板吗？'};
  const lux = /轻奢/.test(text);
  return {soft: lux ? 'luxury' : 'chinese', stones: lux ? ['yudu', 'heijin'] : ['feiwang', 'yashi'], title: lux ? 'Agent · 浅色轻奢' : 'Agent · 雅致新中式', theme: lux ? 0 : 1,
    steps: ['读取 9 处饰面与企业目录（石材 6 款、软装风格 3 套）', lux ? '硬装：客厅、餐厅地面 鱼肚白 750×1500 直铺，黑金花波打线' : '硬装：客厅、餐厅地面 雅士白 800×800 斜铺，黑金花波打线；背景墙 啡网纹工字铺',
      lux ? '软装：轻奢（弧形丝绒沙发、大理石金属茶几、浅色长毛地毯）' : '软装：客厅新中式（圈椅、长条茶几、屏风），二层主卧实木架子床', '排版与家具碰撞校验：通过，1 条窄条提示', '出图 3 张（客厅、起居厅、茶室）']};
}
function agentView(l) {
  const A = l.agent ||= {status: 'idle', messages: [], candidate: null};
  const st = A.status, c = A.candidate;
  const msgs = A.messages.map(m => m.role === 'user' ? `<div class="msg me">${esc(m.text)}</div>`
    : `<div class="msg ai">${m.steps ? `<ol class="agent-steps">${m.steps.map((t, i) => `<li class="${i < (m.done ?? m.steps.length) ? 'done' : i === m.done ? 'now' : ''}">${esc(t)}</li>`).join('')}</ol>` : ''}${m.text ? `<p>${esc(m.text)}</p>` : ''}</div>`).join('');
  let right;
  if (st === 'nomodel') right = `<div class="empty" style="text-align:left;padding:40px 0"><h2 class="h2">未配置模型</h2><p>Agent 需要联网调用模型。当前环境没有配置（或网络不可用），不会模拟结果。</p><div class="row-actions" style="margin-top:16px"><button class="btn primary" data-act="agent-fallback" data-v="${l.id}">打开预先出好的演示方案</button></div></div>`;
  else if (!c) right = `<div class="empty" style="text-align:left;padding:30px 0"><h2 class="h2">${st === 'running' ? '正在出方案…' : '告诉 Agent 你想要什么'}</h2><p>${st === 'running' ? '读取饰面与企业目录，选择石材与软装风格，排版校验后出图。可以离开此页，完成后在线索里查看。' : 'Agent 只在企业的石材库与软装风格目录内出方案，所有结果先作为候选，由你核对后才发布给客户。'}</p>${st === 'running' ? '<div class="bar-progress" style="max-width:360px"><i></i></div>' : ''}</div>`;
  else {
    const hints = Object.entries(c.finishes).flatMap(([id, fin]) => checkFinish(id, fin)).slice(0, 2);
    right = `<figure class="plate"><div class="plate-top"><span>候选 · ${esc(c.title)} · 一层客厅</span><span class="tag" style="background:var(--paper)">候选 · 客户不可见</span></div>
      <div class="plate-img"><img data-render="f1" data-cand="${l.id}" data-w="1280" data-h="720" alt="候选方案效果图（示意）"></div><figcaption><span>硬装 + 软装 · ${softById[c.soft].name}</span><span>效果图 · 示意素材</span></figcaption></figure>
      <div class="detail-body" style="padding:24px 0 0"><div class="cols">
        <section><div class="section-head"><h2 class="h3">硬装</h2></div><ul class="finish-list">${Object.keys(c.finishes).filter(id => facetById[id].floor === 'f1').map(id => `<li><b>${facetById[id].name}</b><span><span class="sw" style="background-image:url(${swatchURL(c.finishes[id].stone, 32)})"></span>${finishLine(id, c.finishes[id])}</span></li>`).join('')}</ul></section>
        <section>${softBlock(c, 'f1').replace('margin-top:28px', 'margin-top:0')}${hints.map(h => `<p class="alert hint">${icon('info', 14)}<span><b>提示</b>${esc(h.text)}</span></p>`).join('')}<p class="alert ok">${icon('check', 14)}<span>排版与家具碰撞校验通过</span></p></section>
      </div></div>`;
  }
  return shell(`<section class="spread agent">
    <div class="story chat"><a class="text-link" href="#/lead/${l.id}" style="align-self:flex-start;border:0">${icon('back', 15)} ${esc(l.title)}</a>
      <h1 class="display sm" style="margin-top:12px">Agent<br><em>出整体方案</em></h1>
      <p class="small muted" style="margin-top:8px">硬装 + 软装 · 企业内部使用 · 需联网</p>
      <div class="msgs">${msgs || '<p class="small muted">例如：</p>'}</div>
      ${st !== 'running' ? `<div class="chips" style="margin-top:10px">${prompts.map(t => `<button class="chip" data-act="agent-say" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      <form class="note-form" data-form="agent"><textarea name="text" rows="3" maxlength="300" placeholder="描述客户的要求，例如：二层主卧换成轻奢风" ${st === 'running' ? 'disabled' : ''}></textarea><button class="btn primary small" type="submit" style="justify-self:start" ${st === 'running' ? 'disabled' : ''}>发送</button></form>
    </div>
    <div class="work">${right}</div></section>
    <div class="action-bar" style="position:fixed;left:0;right:0;bottom:0"><span class="hint">${c ? '采用后成为待审方案，核对后再发布给客户。' : '结果先作为候选，客户看不到。'}</span>${c ? `<button class="btn ghost" data-act="agent-say" data-v="主卧再换成轻奢风">继续调整</button><button class="btn primary" data-act="confirm" data-k="adopt" data-v="${l.id}">采用为待审方案 ${icon('arrow', 16)}</button>` : ''}</div>`, {nav: 'leads'});
}
function agentRun(l, text) {
  const A = l.agent ||= {status: 'idle', messages: [], candidate: null};
  A.messages.push({role: 'user', text});
  if (A.forceNoModel) { A.status = 'nomodel'; A.messages.push({role: 'ai', text: '没有可用的模型（未配置或网络不可用），这次请求没有执行。'}); return; }
  const plan = agentPlan(text);
  if (plan.rejected) { A.messages.push({role: 'ai', text: plan.rejected}); return; }
  const m = {role: 'ai', steps: plan.steps, done: 0}; A.messages.push(m); A.status = 'running';
  const tick = () => { m.done++; if (m.done < plan.steps.length) { save(); render(); setTimeout(tick, 700); return; }
    const base = makeSchemes(l.facets.length ? l.facets : ['f1-living', 'f1-dining', 'f1-wall', 's12'], plan.stones)[plan.theme];
    A.candidate = {...base, id: 'D', title: plan.title, soft: plan.soft, line: plan.steps[1].replace('硬装：', '')};
    m.text = `已出好候选「${plan.title}」：硬装与软装都通过校验。可以继续调整，或采用为待审方案。`; A.status = 'ready'; save(); render(); };
  setTimeout(tick, 700);
}

// ---------- 预置方案 ----------
function newView() {
  const d = state.draft;
  const floorFacets = facets.filter(f => f.floor === d.floor);
  const count = fl => d.facets.filter(id => facetById[id].floor === fl).length;
  return shell(`<section class="spread">
    <div class="story"><span class="kicker">预置方案</span><h1 class="display md">先替客户<br><em>铺一遍</em></h1>
      <p class="lede">在示例别墅上选择饰面和石材，按规则生成 3 个铺贴方案。生成后分享给客户：指定手机号，或给一次性绑定码。</p>
      <span class="rule"></span>
      <label class="field"><span>方案名称</span><input id="dname" maxlength="40" placeholder="例如：临水别墅 · 企业预置方案" value="${esc(d.name)}"></label>
      <label class="field"><span>内部说明（选填）</span><textarea id="dnote" rows="3" maxlength="200" placeholder="例如：客户上周到店，偏好暖色。">${esc(d.note)}</textarea></label></div>
    <div class="work">
      <div class="section-head"><h2 class="h3">饰面 <small>已选 ${d.facets.length} 处</small></h2>
        <div class="seg" role="tablist">${villa.floors.map(fl => `<button role="tab" aria-pressed="${fl.id === d.floor}" data-act="dfloor" data-v="${fl.id}">${fl.name}<small>${count(fl.id)}</small></button>`).join('')}</div></div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:28px;margin-top:16px">
        <div class="plan-box" style="margin:0">${planSVG(d.floor, d.facets)}</div>
        <div>${floorFacets.map(f => `<button class="facet" aria-pressed="${d.facets.includes(f.id)}" data-act="dfacet" data-v="${f.id}"><span class="check">${icon('check', 13)}</span><span><b>${f.name}</b><small>${kindName[f.kind]} · ${f.kind === 'stair' ? `${f.steps} 级踏步` : `${f.size[0]} × ${f.size[1]} m`}</small></span></button>`).join('')}</div>
      </div>
      <div class="section-head" style="margin-top:34px"><h2 class="h3">石材 <small>最多 3 款，按顺序优先使用</small></h2><span class="tag">示意素材</span></div>
      <div class="stone-grid" style="margin-top:16px">${stones.map(s => { const n = d.stones.indexOf(s.id) + 1; return `<button class="stone-pick" aria-pressed="${n > 0}" data-act="dstone" data-v="${s.id}"><img src="${swatchURL(s.id, 240)}" alt=""><span>${s.name}</span>${n ? `<i>${n}</i>` : ''}</button>`; }).join('')}</div>
    </div></section>
    <div class="action-bar" style="position:fixed;left:0;right:0;bottom:0"><span class="hint">生成后可以先在线索详情里查看效果图，再分享。</span><button class="btn ghost" data-act="create" data-agent="1" ${d.facets.length ? '' : 'disabled'}>${icon('chat', 16)} 让 Agent 出方案</button><button class="btn primary" data-act="create" ${d.facets.length && d.stones.length ? '' : 'disabled'}>按规则生成方案 ${icon('arrow', 16)}</button></div>`, {nav: 'new'});
}

// ---------- 石材与软装 ----------
function stonesView() {
  return stonesHtml();
}
function stonesHtml() {
  const meta = {yashi: ['抛光', '600–1500', 1], yudu: ['抛光', '600–1500', 1], shaanna: ['抛光', '300–1200', 2], huimu: ['哑光', '200–1200', 1], feiwang: ['抛光', '300–1200', 1], heijin: ['抛光', '200–800', 1]};
  return shell(`<section class="spread">
    <div class="story"><span class="kicker">石材与软装</span><h1 class="display md">${stones.length} 款石材<br><em>${softStyles.length} 套软装</em></h1>
      <p class="lede">客户在 H5 只能从这里的石材与软装风格中选择，Agent 也只在这个范围内出方案。贴图与家具均为示意素材；上传企业真实素材在后续版本提供。</p>
      <span class="rule"></span><p class="small muted">下架的版本不再出现在客户的选择里，已用它的方案保留原样。</p></div>
    <div class="work"><div class="catalog">${[...stones, {id: 'shaanna', name: '莎安娜米黄', retired: true}].map(s => { const [surface, size, v] = meta[s.id]; return `<article class="stone-card ${s.retired ? 'retired' : ''}"><img src="${swatchURL(s.id, 240)}" alt=""><div><b>${s.name}</b>${s.retired ? '<span class="tag" style="margin-left:8px">已下架 · 版本 1</span>' : '<span class="tag" style="margin-left:8px">示意素材</span>'}
      <dl><dt>表面</dt><dd>${surface}</dd><dt>规格</dt><dd>${size} mm</dd><dt>纹理</dt><dd>${esc(s.note || '—')}</dd><dt>版本</dt><dd>${s.retired ? 1 : v}${s.retired ? '' : ' · 在售'}</dd></dl></div></article>`; }).join('')}</div>
    <div class="section-head" style="margin-top:40px"><h2 class="h3">软装风格 <small>按房间给出家具组合与配色 · 版本 1</small></h2><span class="tag">示意素材</span></div>
    <div class="catalog" style="margin-top:18px">${softStyles.map(st => `<article class="stone-card soft"><div class="soft-swatch">${Object.values(st.palette).map(c => `<i style="background:${c}"></i>`).join('')}</div><div><b>${st.name}</b><p class="small muted" style="margin-top:4px">${esc(st.line)}</p>
      <dl>${Object.entries(st.rooms).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div></article>`).join('')}</div></div></section>`, {nav: 'stones'});
}

// ---------- 弹层 ----------
const modal = () => document.querySelector('#modal');
function openModal(html) {
  const m = modal(); m.innerHTML = `<div class="modal-body">${html}</div>`; if (!m.open) m.showModal();
  if (!reduced()) m.querySelector('.modal-body').animate([{opacity: 0, transform: 'translateY(16px)'}, {opacity: 1, transform: 'none'}], {duration: 420, easing: 'cubic-bezier(.16,1,.3,1)'});
}
const closeModal = () => { if (modal().open) modal().close(); };
function shareModal(id, mode = 'phone', days = 30) {
  openModal(`<h2>分享<em>给客户</em></h2><p>分享链接只能预览。客户要调整和确认，需要用手机号登录并按下面的方式绑定。</p>
    <h3>绑定方式</h3><div class="chips" role="radiogroup">${[['phone', '定向手机号（推荐）'], ['code', '一次性绑定码']].map(([v, t]) => `<button class="chip" role="radio" aria-checked="${mode === v}" data-act="share-mode" data-v="${id}:${v}:${days}">${t}</button>`).join('')}</div>
    ${mode === 'phone' ? `<label class="field"><span>客户手机号</span><input id="sphone" inputmode="numeric" maxlength="11" placeholder="11 位手机号"></label><p class="small muted" style="margin-top:8px">客户用这个号码登录即自动绑定；其他号码打开只能预览，可以提交绑定申请。</p>`
      : '<p class="small muted" style="margin-top:12px">生成 6 位绑定码，48 小时内有效、只能使用一次、错误 5 次锁定。请通过电话或微信单独告诉客户。</p>'}
    <h3>链接有效期</h3><div class="chips">${[30, 60, 90].map(n => `<button class="chip" aria-pressed="${days === n}" data-act="share-mode" data-v="${id}:${mode}:${n}">${n} 天</button>`).join('')}</div>
    <div class="modal-actions"><button class="btn ghost" data-act="close">取消</button><button class="btn primary" data-act="share-create" data-v="${id}:${mode}:${days}">生成分享</button></div>`);
}
function onceModal(link, code, phone) {
  openModal(`<h2>分享<em>已生成</em></h2><p>链接${code ? '和绑定码' : ''}只显示这一次，关闭后不能再查看。请现在复制，${code ? '绑定码通过电话或微信单独告诉客户。' : `发给 ${maskPhone(phone)}。`}</p>
    <dl class="once"><div><dt>链接</dt><code>${link}</code><button class="btn ghost small" data-act="copy" data-v="${link}">复制</button></div>
      ${code ? `<div><dt>绑定码</dt><span class="code">${code}</span><button class="btn ghost small" data-act="copy" data-v="${code}">复制</button></div>` : ''}</dl>
    <div class="modal-actions"><button class="btn primary" data-act="close">我已复制</button></div>`);
}
const confirms = {
  publish: ['发布给客户？', '客户会在 H5 看到通过校验的方案，可以调整和确认。发布后不能撤回为待审核。', '发布'],
  revoke: ['撤销这个分享链接？', '撤销后链接立即失效：未绑定的人不能再预览或绑定；已绑定的客户仍可通过自己的账号访问。', '撤销链接'],
  unbind: ['解绑这位客户？', '解绑后客户不能再打开这个项目，绑定与解绑都会留下记录。可以重新分享给其他人。', '解绑'],
  approve: ['批准绑定？', '项目会绑定到申请人的账号，申请人可以调整和确认。其他待审申请同时作废。', '批准绑定'],
  reject: ['拒绝这个申请？', '申请人仍可预览，但不能调整或确认。', '拒绝'],
  adopt: ['采用为待审方案？', '候选会加入这条线索的方案，状态为待审核；核对效果图后再发布给客户。', '采用'],
};

// ---------- 原型审阅导航 ----------
const R = {
  'login': ['入口', '登录', () => { state = fresh(); state.session = false; go('/login'); }],
  'login-wrong': ['入口', '登录 · 密码错误', () => { state = fresh(); state.session = false; state.login.error = 'wrong'; go('/login'); }],
  'denied': ['入口', '无权访问（非企业成员）', () => { state = fresh(); go('/denied'); }],
  'today': ['工作台', '今日', () => { state = fresh(); go('/'); }],
  'leads': ['工作台', '线索列表', () => { state = fresh(); go('/leads'); }],
  'leads-contact': ['工作台', '线索 · 请求联系', () => { state = fresh(); go('/leads?f=contact'); }],
  'leads-empty': ['工作台', '线索 · 无结果', () => { state = fresh(); go('/leads?t=00000'); }],
  'detail-confirmed': ['线索详情', '客户已确认并请求联系', () => { state = fresh(); go('/lead/L1'); }],
  'detail-member': ['线索详情', '企业预置 · 已绑定', () => { state = fresh(); go('/lead/L2'); }],
  'detail-apply': ['线索详情', '企业预置 · 绑定申请待批准', () => { state = fresh(); go('/lead/L5'); }],
  'detail-review': ['线索详情', 'DXF 待审核', () => { state = fresh(); go('/lead/L3'); }],
  'review': ['审核与转换', '审核 · 转换结果', () => { state = fresh(); go('/lead/L3/review'); }],
  'review-ready': ['审核与转换', '审核 · 待审方案', () => { state = fresh(); const l = leadById('L3'); l.stage = 'ready'; l.schemes = makeSchemes(l.facets, l.stones); go('/lead/L3/review'); }],
  'assist': ['审核与转换', '辅助转换 · 导入户型', () => { state = fresh(); go('/lead/L4/assist'); }],
  'assist-bad': ['审核与转换', '辅助转换 · 校验失败', () => { state = fresh(); leadById('L4').assistStage = 'invalid'; go('/lead/L4/assist'); }],
  'assist-ok': ['审核与转换', '辅助转换 · 校验通过', () => { state = fresh(); leadById('L4').assistStage = 'valid'; go('/lead/L4/assist'); }],
  'new': ['方案与分享', '预置方案', () => { state = fresh(); go('/new'); }],
  'share': ['方案与分享', '分享 · 选择方式', () => { state = fresh(); go('/lead/L5'); setTimeout(() => shareModal('L5'), 250); }],
  'share-once': ['方案与分享', '分享 · 链接与绑定码（只显示一次）', () => { state = fresh(); go('/lead/L5'); setTimeout(() => onceModal('https://demo-home.example/s/Qm8x…V2Lk', 'K7M2Q9'), 250); }],
  'confirm-revoke': ['方案与分享', '撤销链接确认', () => { state = fresh(); go('/lead/L2'); setTimeout(() => confirmModal('revoke', 'L2:S1'), 250); }],
  'agent': ['Agent 出方案', '空白 · 快捷提示', () => { state = fresh(); go('/lead/L1/agent'); }],
  'agent-ready': ['Agent 出方案', '候选方案（硬装 + 软装）', () => { state = fresh(); const l = leadById('L1'); l.agent = {status: 'ready', messages: [{role: 'user', text: prompts[0]}, {role: 'ai', steps: agentPlan(prompts[0]).steps, done: 5, text: '已出好候选「Agent · 雅致新中式」：硬装与软装都通过校验。可以继续调整，或采用为待审方案。'}], candidate: {...makeSchemes(l.facets, ['feiwang', 'yashi'])[1], id: 'D', title: 'Agent · 雅致新中式', soft: 'chinese'}}; go('/lead/L1/agent'); }],
  'agent-rejected': ['Agent 出方案', '超出企业目录被拒', () => { state = fresh(); const l = leadById('L1'); l.agent = {status: 'idle', messages: [{role: 'user', text: prompts[2]}, {role: 'ai', text: agentPlan(prompts[2]).rejected}], candidate: null}; go('/lead/L1/agent'); }],
  'agent-nomodel': ['Agent 出方案', '未配置模型 / 无网络', () => { state = fresh(); const l = leadById('L1'); l.agent = {status: 'nomodel', forceNoModel: true, messages: [{role: 'user', text: prompts[0]}, {role: 'ai', text: '没有可用的模型（未配置或网络不可用），这次请求没有执行。'}], candidate: null}; go('/lead/L1/agent'); }],
  'stones': ['目录', '石材与软装风格', () => { state = fresh(); go('/stones'); }],
};
function openReview() {
  const groups = {};
  for (const [id, [g, label]] of Object.entries(R)) (groups[g] ||= []).push(`<li><button data-act="jump" data-v="${id}">${label}${icon('chevron', 13)}</button></li>`);
  openModal(`<h2>原型<em>审阅导航</em></h2><p>审阅用：直接跳到任一页面或状态，跳转会重置演示数据。这个入口不属于产品界面。</p>
    <div class="review-cols">${Object.entries(groups).map(([g, items]) => `<div><h3>${g}</h3><ul class="review-list">${items.join('')}</ul></div>`).join('')}</div>
    <div class="modal-actions"><button class="btn ghost" data-act="reset">清空演示数据</button><button class="btn primary" data-act="close">关闭</button></div>`);
}
window.__review = {ids: Object.keys(R), go: id => { closeModal(); R[id][2](); save(); render(); }};
function confirmModal(kind, v) {
  const [t, p, ok] = confirms[kind];
  openModal(`<h2>${t}</h2><p>${p}</p><div class="modal-actions"><button class="btn ghost" data-act="close">取消</button><button class="btn ${['revoke', 'unbind', 'reject'].includes(kind) ? 'danger' : 'primary'}" data-act="do" data-k="${kind}" data-v="${v}">${ok}</button></div>`);
}

// ---------- 交互 ----------
const current = () => leadById(parse().parts[1]);
const log = (l, text) => l.history.push({at: Date.now(), text});
let toastTimer;
function toast(text) { const t = document.querySelector('#toast'); t.textContent = text; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400); }
const token = () => Array.from({length: 4}, () => Math.random().toString(36).slice(2, 6)).join('');
const actions = {
  review: () => { openReview(); return false; }, close: () => { closeModal(); return false; },
  jump: el => { window.__review.go(el.dataset.v); return false; },
  reset: () => { closeModal(); state = fresh(); go('/'); },
  logout: () => { state.session = false; state.login = fresh().login; go('/login'); },
  nav: el => { go(el.dataset.v.replace(/^#/, '')); return false; },
  toast: el => { toast(el.dataset.v); return false; },
  follow: el => { const l = current(); if (l.follow !== el.dataset.v) { l.follow = el.dataset.v; l.notes.push({by: member.name, at: Date.now(), text: `跟进状态改为「${followName[l.follow]}」`}); toast(`已标记为${followName[l.follow]}`); } },
  scheme: el => { state.ui[current().id].scheme = el.dataset.v; },
  floor: el => { state.ui[current().id].floor = el.dataset.v; },
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
    save(); render(); onceModal(`https://demo-home.example/s/${token()}`, code, phone); return false;
  },
  copy: el => { navigator.clipboard?.writeText(el.dataset.v).catch(() => {}); toast('已复制'); return false; },
  confirm: el => { confirmModal(el.dataset.k, el.dataset.v); return false; },
  do: el => {
    const kind = el.dataset.k, [id, sub] = el.dataset.v.split(':'), l = leadById(id);
    closeModal();
    if (kind === 'publish') { l.status = 'published'; l.stage = null; l.events.push({kind: 'publish', at: Date.now(), text: '企业审核后发布 3 个方案'}); toast('已发布，客户可以在 H5 查看'); go(`/lead/${id}`); return false; }
    if (kind === 'revoke') { l.shares.find(s => s.id === sub).status = 'revoked'; log(l, '撤销分享链接'); toast('链接已撤销'); }
    if (kind === 'unbind') { log(l, `解绑客户 ${maskPhone(l.customer.phone)}`); l.customer = null; toast('已解绑'); }
    if (kind === 'approve') { const a = l.applications.find(x => x.id === sub); a.status = 'approved'; l.customer = {phone: a.phone, name: a.note.split('：')[0]}; log(l, `批准绑定申请，绑定 ${maskPhone(a.phone)}`); l.events.push({kind: 'bind', at: Date.now(), text: `企业批准绑定：${maskPhone(a.phone)}`}); toast('已批准，项目绑定到申请人'); }
    if (kind === 'adopt') { const c = l.agent.candidate; l.schemes = [...(l.schemes || []).filter(x => x.id !== 'D'), c]; l.revisions = {...l.revisions, D: 1}; l.agent = {status: 'idle', messages: [], candidate: null}; l.events.push({kind: 'agent', at: Date.now(), text: `采用 Agent 候选「${c.title}」为待审方案 D`}); state.ui[l.id] = {...(state.ui[l.id] || {}), scheme: 'D'}; toast('已采用为待审方案 D，核对后发布'); go(`/lead/${l.id}`); return false; }
    if (kind === 'reject') { l.applications.find(x => x.id === sub).status = 'rejected'; log(l, '拒绝绑定申请'); toast('已拒绝'); }
  },
  generate: el => { const l = leadById(el.dataset.v); l.stage = 'generating'; save(); render(); later(() => { l.stage = 'ready'; l.schemes = makeSchemes(l.facets, l.stones); save(); render(); }, 2600); return false; },
  regen: el => actions.generate(el),
  assist: el => {
    const l = current(), v = el.dataset.v;
    if (v === 'reset') { l.assistStage = 'waiting'; return; }
    l.assistStage = 'validating'; save(); render(); later(() => { l.assistStage = v === 'ok' ? 'valid' : 'invalid'; save(); render(); }, 1600); return false;
  },
  'assist-generate': el => { const l = leadById(el.dataset.v); l.status = 'review'; l.source = 'other'; l.facets = ['f1-living', 'f1-dining', 'f1-foyer', 's12', 'f2-lounge', 's23', 'f3-tea', 'f3-hall']; l.convert = {levels: 3, finishes: 8, scale: '按导入户型尺寸', hints: []}; l.reviewReason = '辅助转换的户型需企业核对'; l.events.push({kind: 'convert', at: Date.now(), text: '企业完成辅助转换：3 层、8 处饰面'}); l.stage = 'generating'; save(); go(`/lead/${l.id}/review`); later(() => { l.stage = 'ready'; l.schemes = makeSchemes(l.facets, l.stones); save(); render(); }, 2600); return false; },
  'agent-say': el => { agentRun(current(), el.dataset.v); },
  'agent-fallback': el => { const l = leadById(el.dataset.v); l.agent = {status: 'ready', messages: [...l.agent.messages, {role: 'ai', text: '已打开预先出好的演示方案（演示数据，非本次生成）。'}], candidate: {...makeSchemes(l.facets, ['feiwang', 'yashi'])[1], id: 'D', title: 'Agent · 雅致新中式（预先生成）', soft: 'chinese'}}; },
  dfloor: el => { state.draft.floor = el.dataset.v; },
  dfacet: el => { const a = state.draft.facets, i = a.indexOf(el.dataset.v); i < 0 ? a.push(el.dataset.v) : a.splice(i, 1); },
  dstone: el => { const a = state.draft.stones, i = a.indexOf(el.dataset.v); if (i >= 0) a.splice(i, 1); else if (a.length < 3) a.push(el.dataset.v); else toast('最多选择 3 款石材'); },
  create: el => {
    const d = state.draft, id = 'L' + state.seq++, viaAgent = !!el?.dataset?.agent;
    state.leads.unshift({id, title: d.name.trim() || '示例别墅 · 企业预置方案', origin: 'member', source: 'sample', status: 'published', customer: null, createdAt: Date.now(), facets: [...d.facets], stones: [...d.stones], prefs: '—', note: d.note,
      schemes: makeSchemes(d.facets, d.stones), revisions: {A: 1, B: 1, C: 1}, events: [{kind: 'create', at: Date.now(), text: '企业预置 3 个方案（全部通过排版校验，已发布）'}], follow: 'new', notes: [], shares: [], applications: [], history: []});
    state.draft = freshDraft(); save();
    if (viaAgent) { const l = leadById(id); l.schemes = null; l.events = [{kind: 'create', at: Date.now(), text: '企业新建预置方案，交给 Agent 出整体方案'}]; save(); go(`/lead/${id}/agent`); return false; }
    go(`/lead/${id}`); setTimeout(() => shareModal(id), 250); return false;
  },
};

// ---------- 渲染 ----------
function fillRenders(root) {
  const imgs = [...root.querySelectorAll('img[data-render]')];
  let i = 0;
  const step = () => {
    const img = imgs[i++]; if (!img) return;
    const cand = img.dataset.cand && leadById(img.dataset.cand)?.agent?.candidate;
    const l = leadById(img.dataset.lead || img.dataset.cand), sc = cand || l?.schemes?.find(s => s.id === (img.dataset.scheme || state.ui[l.id]?.scheme || 'A')) || l?.schemes?.[0];
    const box = img.closest('.plate-img, .thumb');
    if (sc) { box?.classList.add('loading'); const url = renderImage(img.dataset.render, sc, +(img.dataset.w || 960), +(img.dataset.h || 600)); if (url) img.src = url; box?.classList.remove('loading'); }
    setTimeout(step, 0);
  };
  setTimeout(step, 30);
}
function view() {
  const {parts, q} = parse();
  if (!state.session && parts[0] !== 'login') { go('/login'); return null; }
  switch (parts[0]) {
    case 'login': return loginView();
    case 'denied': return deniedView();
    case 'leads': return leadsView(q);
    case 'lead': { const l = leadById(parts[1]); if (!l) return leadsView({}); if (parts[2] === 'review' && l.status === 'review') return reviewView(l); if (parts[2] === 'assist' && l.status === 'assist') return assistView(l); if (parts[2] === 'agent') return agentView(l); return detailView(l); }
    case 'new': return newView();
    case 'stones': return stonesView();
    default: return todayView();
  }
}
let lastPath = null;
function render() {
  timers.forEach(clearTimeout); timers = [];
  const {path} = parse(), y = scrollY, html = view();
  if (html == null) return;
  const root = document.querySelector('#app');
  root.innerHTML = html;
  if (path !== lastPath) {
    scrollTo(0, 0);
    if (!reduced()) [...root.querySelectorAll('.story > *, .work > *')].slice(0, 10).forEach((el, i) => el.animate([{opacity: 0, transform: 'translateY(12px)'}, {opacity: 1, transform: 'none'}], {duration: 650, delay: 30 + i * 45, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards'}));
    document.title = `演示家装企业 · ${root.querySelector('h1')?.textContent || '企业工作台'}（原型）`;
  } else scrollTo(0, y);
  lastPath = path;
  root.querySelector('#search')?.addEventListener('change', e => { const {q} = parse(); go('/leads?' + new URLSearchParams({...q, t: e.target.value.trim()}).toString()); });
  root.querySelector('#dname')?.addEventListener('input', e => { state.draft.name = e.target.value; save(); });
  root.querySelector('#dnote')?.addEventListener('input', e => { state.draft.note = e.target.value; save(); });
  fillRenders(root);
  save();
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act]; if (!fn) return;
  e.preventDefault();
  const r = fn(el, e); save(); if (r !== false) render();
});
document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]'); if (!form) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (form.dataset.form === 'login') {
    if (data.email.trim().toLowerCase() !== member.email || data.password !== member.password) { state.login = {email: data.email, password: '', error: data.email.includes('@') && data.password === member.password ? 'denied' : 'wrong'}; save(); render(); return; }
    state.session = true; state.login.error = null; save(); go('/');
  }
  if (form.dataset.form === 'agent') { const t = (data.text || '').trim(); if (!t) return; agentRun(current(), t); save(); render(); return; }
  if (form.dataset.form === 'note') { const t = (data.note || '').trim(); if (!t) return; current().notes.push({by: member.name, at: Date.now(), text: t}); save(); render(); toast('备注已添加'); }
});
document.querySelector('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
addEventListener('hashchange', () => { closeModal(); render(); });
render();
