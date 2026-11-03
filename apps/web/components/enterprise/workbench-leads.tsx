'use client';
// 线索列表与线索详情（W02），按定稿原型 P02 实现。数据来自线索接口（D06–D08、S02）；成员看到完整手机号，列表中脱敏。
// 详情是方案画面铺满、左侧面板悬浮；审核发布（W03）、分享管理（W04）与 Agent（W07）后续接入同一画面。
import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { followStatusNames, followStatuses, type FinishSchemeView, type FollowStatus, type LeadView, type RequestFinishView } from '../../../../packages/contracts/src/finish-requests';
import { ClientError, get, maskPhone, operationId, post } from '../client/client-api';
import { Icon, type IconName } from '../client/client-icons';
import { finishLine, letter } from '../client/client-request';
import { SchemeViewer } from '../client/scheme-viewer';
import type { SceneSnapshot } from '../client/client-api';
import { actionsOf, ago, leadsOf, Note, Shell, tidy, useWorkbench, who } from './workbench-app';
import { ShareDialog, useBindingActions } from './workbench-share';

// ---------- 共用 ----------
type Stage = 'review' | 'published' | 'confirmed';
const stageOf = (lead: LeadView): Stage => lead.status !== 'published' ? 'review' : lead.confirmation ? 'confirmed' : 'published';
const statusText: Record<LeadView['status'], string> = {
  awaiting_drawing: '待上传图纸', converting: '图纸识别中', conversion_failed: '图纸未识别', assisted_conversion: '排队待整理', pending_review: '待审核', published: '已发布',
};
function StatusTag({ lead }: { lead: LeadView }) {
  const reconfirm = lead.confirmation && !lead.confirmation.current;
  const [text, act] = lead.status === 'published'
    ? lead.confirmation ? [reconfirm ? '需重新确认' : '客户已确认', false] : ['已发布', false]
    : [statusText[lead.status], lead.status === 'pending_review' || lead.status === 'assisted_conversion'];
  return <span className={`tag${act ? ' tag--act' : ''}`}>{text}</span>;
}
const actionText: Record<NonNullable<LeadView['lastCustomerAction']>['kind'], string> = {
  submit: '客户提交了需求', confirm: '客户确认了方案', message: '客户留言', contact: '客户请求联系', apply: '有人申请绑定',
};
/** Latest thing that happened on the lead, for the list column. */
const latestOf = (lead: LeadView) => lead.lastCustomerAction ? { text: actionText[lead.lastCustomerAction.kind], at: lead.lastCustomerAction.at }
  : lead.publishedAt ? { text: lead.origin === 'member' ? '企业预置，已发布' : '方案已发布', at: lead.publishedAt } : { text: '企业预置', at: lead.createdAt };
const spacedPhone = (phone: string | null | undefined) => (phone ?? '').replace(/^\+86/, '').replace(/(\d{3})(\d{4})(\d{4})/, '$1 $2 $3');
const sourceText = (lead: LeadView) => lead.source === 'demo-villa' ? '示例别墅' : `图纸 · ${lead.drawingName ?? '未上传'}`;
const imageOf = (scheme: FinishSchemeView | undefined) => scheme?.render?.imageHref ?? null;
const day = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const when = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const preferenceText = (lead: LeadView) => {
  const p = lead.preferences; if (!p) return null;
  const tone = p.tone && { light: '浅色', warm: '暖色', dark: '深色', unsure: '色调未定' }[p.tone];
  const patterns = p.patterns?.length ? p.patterns.map(x => ({ straight: '直铺', 'running-bond': '工字铺', herringbone: '人字铺', diagonal: '斜铺' }[x])).join('、') : null;
  const border = p.border && { yes: '要波打线', no: '不要波打线', auto: '波打线听建议' }[p.border];
  return [tone, patterns, border].filter(Boolean).join(' · ') || null;
};

// ---------- 线索列表 ----------
const quickFilters: [string, string, IconName, (lead: LeadView) => boolean][] = [
  ['contact', '请求联系', 'phone', lead => actionsOf(lead).contact],
  ['todo', '待整理图纸', 'file', lead => { const a = actionsOf(lead); return a.review || a.assist; }],
  ['apply', '待批准绑定', 'link', lead => actionsOf(lead).apply],
];
const stages: [string, string][] = [['all', '全部'], ['review', '处理中'], ['published', '已发布'], ['confirmed', '客户已确认']];

export function LeadsView({ query }: { query: URLSearchParams }) {
  const { base, workspace, go } = useWorkbench();
  const leads = useQuery({ queryKey: ['leads', workspace.id], queryFn: () => leadsOf(workspace.id), refetchInterval: 60_000 });
  const s = query.get('s') ?? 'all', f = query.get('f') ?? '', text = (query.get('t') ?? '').trim();
  const link = (patch: Record<string, string>) => {
    const params = new URLSearchParams(Object.entries({ s, f, t: text, ...patch }).filter(([, v]) => v && v !== 'all'));
    return `${base}/leads${params.size ? `?${params}` : ''}`;
  };
  const all = leads.data ?? [];
  const rows = useMemo(() => {
    let list = all.filter(lead => s === 'all' || stageOf(lead) === s);
    const quick = quickFilters.find(([key]) => key === f);
    if (quick) list = list.filter(quick[3]);
    else if ((followStatuses as readonly string[]).includes(f)) list = list.filter(lead => lead.follow.status === f);
    if (text) {
      const digits = text.replace(/\s/g, '');
      list = list.filter(lead => lead.title.includes(text) || (lead.customer?.name ?? '').includes(text) || (!!digits && (lead.customer?.phone ?? '').includes(digits)));
    }
    return [...list].sort((a, b) => Date.parse(latestOf(b).at) - Date.parse(latestOf(a).at));
  }, [all, s, f, text]);

  return <Shell nav="leads"><div className="page">
    <header className="page__head"><div><h1 className="page__title">线索</h1>
      <p className="page__sub">客户自助提交的需求，以及企业为客户预置并分享的方案。跟进状态与备注只有企业成员能看到。</p></div>
      <Link className="btn btn--primary" href={`${base}/new`}><Icon name="plus" size={16} strokeWidth={1.6}/>预置方案</Link></header>
    <div className="quick">{quickFilters.map(([key, label, icon, test]) =>
      <Link key={key} className="quick__item" aria-pressed={f === key} href={link({ f: f === key ? '' : key })}><Icon name={icon} size={20} strokeWidth={1.6}/>
        <span><b>{all.filter(test).length}</b><small>{label}</small></span></Link>)}</div>
    <div className="list-tools">
      <div className="segmented" role="group" aria-label="状态">{stages.map(([key, label]) =>
        <button key={key} aria-pressed={s === key} onClick={() => go(link({ s: key }), true)}>{label}<small>{all.filter(lead => key === 'all' || stageOf(lead) === key).length}</small></button>)}</div>
      <div className="chips" role="group" aria-label="跟进状态">{followStatuses.map(key =>
        <button key={key} className="chip" aria-pressed={f === key} onClick={() => go(link({ f: f === key ? '' : key }), true)}>{followStatusNames[key]}</button>)}</div>
      <label className="search"><Icon name="search" size={15} strokeWidth={1.6}/>
        <input key={text} placeholder="手机号、称呼或项目名" aria-label="搜索线索" defaultValue={text}
          onKeyDown={e => { if (e.key === 'Enter') go(link({ t: e.currentTarget.value.trim() }), true); }}
          onBlur={e => { if (e.currentTarget.value.trim() !== text) go(link({ t: e.currentTarget.value.trim() }), true); }}/></label>
    </div>
    {leads.isPending ? <p className="page-loading">正在读取线索…</p>
      : leads.error ? <Note kind="danger" title="线索读取失败">{leads.error.message}</Note>
        : rows.length ? <div className="table" role="table" aria-label="线索列表">
          <div className="table__head" role="row"><span/><span>项目 / 客户</span><span>状态</span><span>跟进</span><span>最近动作</span><span/></div>
          {rows.map(lead => { const a = actionsOf(lead), latest = latestOf(lead), image = imageOf(lead.schemes.find(imageOf));
            return <Link key={lead.id} className="table__row" role="row" href={`${base}/leads/${lead.id}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <span className="thumb">{image ? <img src={image} alt=""/> : <Icon name="file" size={20} strokeWidth={1.6}/>}</span>
              <span className="cell-main"><b>{lead.title}</b><small>{who(lead)} · {lead.origin === 'member' ? '企业预置' : '客户自助'}</small>
                {a.contact && <em className="flag"><Icon name="phone" size={13}/> 请求联系</em>}{a.apply && <em className="flag"><Icon name="link" size={13}/> 绑定申请待批准</em>}</span>
              <span><StatusTag lead={lead}/></span>
              <span className={`follow follow--${lead.follow.status}`}>{followStatusNames[lead.follow.status]}</span>
              <span className="cell-event">{latest.text}<small>{ago(latest.at)}</small></span>
              <span className="chev"><Icon name="right" size={16} strokeWidth={1.6}/></span></Link>; })}
        </div>
          : <div className="panel" style={{ marginTop: 16 }}><div className="empty"><b>{all.length ? '没有符合条件的线索' : '还没有线索'}</b>
            {all.length ? <>换一个筛选条件，或 <Link className="text-link" href={`${base}/leads`}>清空筛选</Link></> : '客户在 H5 提交需求，或企业预置方案后，会出现在这里。'}</div></div>}
  </div></Shell>;
}

// ---------- 线索详情 ----------
type Tab = 'scheme' | 'client' | 'share';
const levelsOf = (finishes: RequestFinishView[]) => [...new Map(finishes.map(f => [f.levelId ?? '', f.levelName ?? '本层'])).entries()];

export function LeadDetailView({ id }: { id: string }) {
  const { base, workspace } = useWorkbench();
  const leads = useQuery({ queryKey: ['leads', workspace.id], queryFn: () => leadsOf(workspace.id), refetchInterval: 30_000 });
  const lead = leads.data?.find(item => item.id === id);
  if (leads.isPending) return <Shell nav="leads"><p className="page-loading">正在打开线索…</p></Shell>;
  if (!lead) return <Shell nav="leads"><div className="page"><div className="empty"><b>找不到这条线索</b>可能已被删除，或不属于本企业。
    <p style={{ marginTop: 16 }}><Link className="btn btn--secondary" href={`${base}/leads`}>回到线索</Link></p></div></div></Shell>;
  return <LeadWorkspace key={lead.id} lead={lead}/>;
}

function LeadWorkspace({ lead }: { lead: LeadView }) {
  const { base, workspace } = useWorkbench();
  const confirmedId = lead.confirmation?.schemeId;
  const [schemeId, setSchemeId] = useState(confirmedId ?? lead.schemes[0]?.id);
  const [tab, setTab] = useState<Tab>('scheme'), [left, setLeft] = useState(true), [view, setView] = useState<'image' | '3d'>('image');
  const levels = levelsOf(lead.finishes), [level, setLevel] = useState(levels[0]?.[0] ?? '');
  const scheme = lead.schemes.find(s => s.id === schemeId) ?? lead.schemes[0];
  const image = imageOf(scheme), a = actionsOf(lead);
  const scene = useQuery({ queryKey: ['lead-scene', lead.id, scheme?.id, scheme?.revision], enabled: view === '3d' && !!scheme?.render,
    queryFn: () => get<{ scene: SceneSnapshot }>(`/api/workspaces/${workspace.id}/leads/${lead.id}/schemes/${scheme!.id}/scene`).then(r => r.scene) });
  const levelName = levels.find(([key]) => key === level)?.[1] ?? '';
  const follow = useFollow(lead);

  const media = !scheme ? <div className="stage__plan"><p>{lead.status === 'assisted_conversion' ? '图纸在排队，整理户型并出方案后在这里显示' : lead.status === 'awaiting_drawing' ? '客户还没有上传图纸' : lead.status === 'conversion_failed' ? '客户的图纸没能自动识别' : '方案生成后在这里显示'}</p></div>
    : view === '3d' ? <div className="stage__3d"><SchemeViewer scene={scene.data}/></div>
      // eslint-disable-next-line @next/next/no-img-element
      : image ? <img className="stage__img" src={image} alt={`方案 ${letter(scheme)} 效果图（示意）`}/>
        : <div className="stage__plan"><p>{scheme.render?.status === 'failed' ? '效果图生成失败' : '效果图生成中，完成后在这里显示'}</p></div>;
  const reconfirm = lead.confirmation && !lead.confirmation.current;
  const tabs: [Tab, string][] = [['scheme', '方案'], ['client', '客户与跟进'], ['share', '分享与绑定']];
  const publish = usePublish(lead), [sharing, setSharing] = useState(false);
  const shareable = lead.origin === 'member' && lead.status === 'published' && !lead.customer;
  const foot = lead.status === 'assisted_conversion' ? <><span className="hint">客户的图纸在排队：整理户型后出方案，直接发布给客户。</span>
    <Link className="btn btn--primary btn--grow" href={`${base}/leads/${lead.id}/assist`}>整理图纸</Link></>
    : lead.status === 'pending_review' ? <><span className="hint">{publish.error ? (publish.error as Error).message : `${lead.reviewReason ?? '企业设置为全部审核后发布'}。核对方案后发布给客户。`}</span>
      <button className="btn btn--primary btn--grow" disabled={publish.isPending} onClick={() => { if (window.confirm('发布后客户就能看到这些方案。确认发布？')) publish.mutate(); }}>{publish.isPending ? '正在发布…' : '发布给客户'}</button></>
    : shareable && !a.contact ? <><span className="hint">{lead.sharing.shares.some(s => !s.revokedAt && !s.usedAt) ? '已有有效的分享码；可以再新建一个，发给另一个联系方式。' : '还没有绑定客户。生成分享码发给客户。'}</span>
      <button className="btn btn--primary btn--grow" onClick={() => setSharing(true)}><Icon name="link" size={16} strokeWidth={1.6}/>分享给客户</button></>
    : a.contact ? <><span className="hint">客户请求联系{lastPreferred(lead) ? `，方便时间：${lastPreferred(lead)}` : ''}。回电后标记，线索会移出「今日」的请求联系。</span>
    <button className="btn btn--primary btn--grow" disabled={follow.isPending} onClick={() => follow.mutate('contacted')}>已回电，标记为已联系</button></> : null;

  return <Shell nav="leads"><section className={`canvas${left ? ' has-left' : ''}`}>
    <div className="stage">{media}</div>
    <div className="caption"><b>{scheme ? `方案 ${letter(scheme)} · ${scheme.name}` : '还没有方案'}</b>
      {scheme && <span>{lead.status !== 'published' ? '待审 · 客户不可见' : `修订 ${scheme.revision}${scheme.id === confirmedId ? (reconfirm ? ' · 确认后又调整过' : ' · 客户已确认') : ''}`} · {view === 'image' ? '效果图示意' : '拖动旋转'}</span>}</div>
    {left && <aside className="float float--left" aria-label="方案与客户">
      <header className="float__head"><Link className="back" href={`${base}/leads`}><Icon name="back" size={16}/> 线索</Link>
        <h1 className="lead-title">{lead.title}</h1>
        <p className="muted"><StatusTag lead={lead}/> {lead.origin === 'member' ? '企业预置' : '客户自助'} · {ago(lead.createdAt)}
          {a.contact && <span className="tag tag--act">请求联系</span>}{a.apply && <span className="tag tag--act">绑定申请</span>}</p>
        <div className="segmented" role="tablist">{tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
      </header>
      <div className="float__body">{tab === 'scheme' ? <SchemeTab lead={lead} scheme={scheme} onPick={setSchemeId} level={level} levelName={levelName}/>
        : tab === 'client' ? <ClientTab lead={lead} follow={follow}/> : <ShareTab lead={lead} onShare={() => setSharing(true)}/>}</div>
      {foot && <footer className="float__foot">{foot}</footer>}
    </aside>}
    <ShareDialog lead={lead} open={sharing} onClose={() => setSharing(false)}/>
    <div className="toolbar" role="toolbar" aria-label="画面">
      <button className="tool" aria-pressed={left} onClick={() => setLeft(!left)} aria-label={left ? '收起方案面板' : '打开方案面板'}><Icon name="panel" size={18} strokeWidth={1.6}/></button>
      {levels.length > 1 && <><span className="toolbar__sep"/><div className="segmented segmented--bare" role="group" aria-label="楼层">{levels.map(([key, name]) =>
        <button key={key} aria-pressed={level === key} onClick={() => setLevel(key)}>{name}</button>)}</div></>}
      {scheme && <><span className="toolbar__sep"/><div className="segmented segmented--bare" role="group" aria-label="查看方式">
        <button aria-pressed={view === 'image'} onClick={() => setView('image')}><Icon name="image" size={15} strokeWidth={1.6}/>效果图</button>
        <button aria-pressed={view === '3d'} onClick={() => setView('3d')} disabled={!scheme.render}><Icon name="cube" size={15} strokeWidth={1.6}/>3D</button></div></>}
    </div>
  </section></Shell>;
}
const lastPreferred = (lead: LeadView) => lead.events.filter(e => e.contactRequested).at(-1)?.preferredTime ?? null;

/** Follow status and notes write through the server, then replace the lead in the shared list cache. */
function useFollow(lead: LeadView) {
  const { workspace } = useWorkbench(), queries = useQueryClient();
  const replace = (next: LeadView) => queries.setQueryData<LeadView[]>(['leads', workspace.id], list => list?.map(item => item.id === next.id ? next : item));
  return useMutation({
    mutationFn: (status: FollowStatus) => post<{ lead: LeadView }>(`/api/workspaces/${workspace.id}/leads/${lead.id}/follow`, { operationId: operationId(), status }).then(r => tidy(r.lead)),
    onSuccess: replace,
  });
}
/** Review-all workspaces only (ADR-0013): publish a request that waits for a member. */
function usePublish(lead: LeadView) {
  const { workspace } = useWorkbench(), queries = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ lead: LeadView }>(`/api/workspaces/${workspace.id}/leads/${lead.id}/publish`, { operationId: operationId() }).then(r => tidy(r.lead)),
    onSuccess: next => queries.setQueryData<LeadView[]>(['leads', workspace.id], list => list?.map(item => item.id === next.id ? next : item)),
  });
}
function useAddNote(lead: LeadView) {
  const { workspace } = useWorkbench(), queries = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => post<{ lead: LeadView }>(`/api/workspaces/${workspace.id}/leads/${lead.id}/notes`, { operationId: operationId(), note }).then(r => tidy(r.lead)),
    onSuccess: next => queries.setQueryData<LeadView[]>(['leads', workspace.id], list => list?.map(item => item.id === next.id ? next : item)),
  });
}

function SchemeTab({ lead, scheme, onPick, level, levelName }: { lead: LeadView; scheme: FinishSchemeView | undefined; onPick: (id: string) => void; level: string; levelName: string }) {
  if (!scheme) return <p className="muted">{lead.status === 'assisted_conversion' ? '客户的图纸在排队，整理户型后出方案。'
    : lead.status === 'conversion_failed' ? `图纸没能自动识别：${lead.conversionError ?? ''}客户可以重新上传，或交给企业整理。`
      : lead.status === 'converting' ? '图纸正在自动识别。' : lead.status === 'awaiting_drawing' ? '客户还没有上传图纸。' : '还没有方案。'}</p>;
  const confirmedId = lead.confirmation?.schemeId;
  const here = lead.finishes.filter(f => (f.levelId ?? '') === level);
  return <>
    <ul className="schemes">{lead.schemes.map(item => <li key={item.id}><button className="scheme" aria-pressed={item.id === scheme.id} onClick={() => onPick(item.id)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {imageOf(item) ? <img className="scheme__thumb" src={imageOf(item)!} alt=""/> : <span className="scheme__thumb"/>}
      <span className="scheme__main"><b>{letter(item)} · {item.name}</b><small>{item.summary}</small></span>
      <span className="scheme__meta">{item.id === confirmedId ? '客户已确认' : lead.status !== 'published' ? <span className="tag tag--act">待审</span> : `修订 ${item.revision}`}</span>
    </button></li>)}</ul>
    <section className="sect" style={{ marginTop: 22 }}><h3 className="sect__title">{levelName}硬装<small>方案 {letter(scheme)} · 示意素材</small></h3>
      {here.length ? here.map(finish => <div key={finish.id} className="kv"><span>{finish.name}</span><b>{finishLine(scheme, finish)}</b></div>)
        : <p className="muted small">本层没有铺贴饰面</p>}</section>
    {scheme.issues.length > 0 && <section className="sect"><h3 className="sect__title">校验提示</h3>
      {scheme.issues.map((issue, i) => <Note key={i} kind="hint" title="排版">{issue.message}</Note>)}</section>}
    <p className="muted small" style={{ marginTop: 18 }}>软装风格目录接入后，这里会显示每个方案的软装。</p>
  </>;
}

function ClientTab({ lead, follow }: { lead: LeadView; follow: ReturnType<typeof useFollow> }) {
  const { slug } = useWorkbench();
  const catalog = useQuery({ queryKey: ['catalog', slug], queryFn: () => get<{ catalog: { stones: { id: string; version: number; name: string }[] } }>(`/api/client/${encodeURIComponent(slug)}/catalog`).then(r => r.catalog), staleTime: 5 * 60_000 });
  // Names from the schemes' own stone data first (always present), then the catalog; never show internal IDs.
  const known = [...lead.schemes.flatMap(s => s.surfaceDesign.stones), ...(catalog.data?.stones ?? [])];
  const stones = lead.stones.map(ref => known.find(s => s.id === ref.stoneId && s.version === ref.stoneVersion)?.name.replace(/（示意）$/, '') ?? (catalog.isPending ? '…' : '已下架的石材'));
  const [note, setNote] = useState(''), addNote = useAddNote(lead);
  const submit = (event: FormEvent) => { event.preventDefault(); const text = note.trim(); if (!text || addNote.isPending) return; addNote.mutate(text, { onSuccess: () => setNote('') }); };
  const levels = levelsOf(lead.finishes).map(([, name]) => name);
  const feed = [
    ...(lead.origin === 'customer' ? [{ at: lead.createdAt, text: lead.source === 'drawing' ? '提交了图纸需求' : '提交了方案需求', strong: false, quote: lead.note }] : []),
    ...lead.events.map(e => ({ at: e.createdAt, strong: e.contactRequested, quote: e.message,
      text: e.kind === 'confirmation' ? `确认了方案 ${String.fromCharCode(64 + (lead.schemes.find(s => s.id === e.schemeId)?.ordinal ?? 1))} · 修订 ${e.schemeRevision}` : e.contactRequested ? `请求联系${e.preferredTime ? ` · ${e.preferredTime}` : ''}` : '留言' })),
    ...lead.sharing.applications.map(x => ({ at: x.createdAt, text: `${maskPhone(x.applicant.phone)} 申请绑定`, strong: false, quote: x.note })),
  ].sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  const error = (follow.error ?? addNote.error) as ClientError | null;
  return <>
    <section className="sect"><div className="kv"><span>客户</span>{lead.customer ? <><b className="phone-full">{spacedPhone(lead.customer.phone)}</b>
      <small className="muted">{lead.customer.name && !lead.customer.name.startsWith('手机用户') ? lead.customer.name : '未留称呼'} · 已验证手机号</small></> : <b className="muted">尚未绑定</b>}</div>
      <div className="kv"><span>户型</span><b>{sourceText(lead)}</b></div>
      <div className="kv"><span>饰面</span><b>{lead.finishes.length ? `${lead.finishes.length} 处 · ${levels.join('、')}` : '图纸转换后确定'}</b></div>
      <div className="kv"><span>石材</span><b>{stones.join('、') || '—'}</b></div>
      {preferenceText(lead) && <div className="kv"><span>偏好</span><b>{preferenceText(lead)}</b></div>}
      {lead.note && <div className="kv"><span>说明</span><b>{lead.note}</b></div>}</section>
    <section className="sect"><h3 className="sect__title">跟进<small>仅企业成员可见</small></h3>
      <div className="segmented segmented--wrap" role="radiogroup" aria-label="跟进状态">{followStatuses.map(key =>
        <button key={key} role="radio" aria-checked={lead.follow.status === key} disabled={follow.isPending} onClick={() => { if (lead.follow.status !== key) follow.mutate(key); }}>{followStatusNames[key]}</button>)}</div>
      <form onSubmit={submit} style={{ marginTop: 10 }}>
        <textarea className="input" rows={2} maxLength={500} placeholder="内部备注，例如：已约周六到店看样。" aria-label="内部备注" value={note} onChange={e => setNote(e.target.value)}/>
        <div style={{ marginTop: 8 }}><button className="btn btn--secondary btn--sm" type="submit" disabled={!note.trim() || addNote.isPending}>{addNote.isPending ? '正在添加…' : '添加备注'}</button></div></form>
      {error && <Note kind="danger" title="没有保存">{error.message}</Note>}
      {(lead.follow.notes.length > 0 || lead.follow.history.length > 0) && <ol className="feed" style={{ marginTop: 8 }}>{[
        ...lead.follow.notes.map(n => ({ key: n.id, at: n.at, body: <>{n.text}<small className="muted">{n.by.name ?? '成员'}</small></> })),
        ...lead.follow.history.map((h, i) => ({ key: `h${i}`, at: h.at, body: <span className="muted">{h.by.name ?? '成员'} 改为「{followStatusNames[h.status]}」</span> })),
      ].sort((x, y) => Date.parse(y.at) - Date.parse(x.at)).map(item => <li key={item.key}><time dateTime={item.at}>{when(item.at)}</time><span>{item.body}</span></li>)}</ol>}
    </section>
    <section className="sect"><h3 className="sect__title">客户动作</h3>{feed.length ? <ol className="feed">{feed.map((item, i) =>
      <li key={i}><time dateTime={item.at}>{when(item.at)}</time><span className={item.strong ? 'strong' : undefined}>{item.text}{item.quote && <q>{item.quote}</q>}</span></li>)}</ol>
      : <p className="muted small">还没有客户动作。</p>}</section>
  </>;
}

const historyText: Record<string, string> = { share: '分享', bind: '绑定客户', unbind: '解绑客户', revoke: '撤销分享码', apply: '提交绑定申请', approve: '批准绑定', reject: '拒绝绑定' };
const methodText: Record<string, string> = { phone: '指定手机号', code: '分享码', approval: '成员批准' };
function ShareTab({ lead, onShare }: { lead: LeadView; onShare: () => void }) {
  const { ask, dialog } = useBindingActions(lead);
  if (lead.origin === 'customer') return <p className="muted">客户自助提交的项目属于客户本人，不需要分享与绑定。</p>;
  const { shares, applications, history } = lead.sharing, now = Date.now();
  const shareState = (s: LeadView['sharing']['shares'][number]) => s.revokedAt ? '已撤销' : s.usedAt ? '已使用' : s.expiresAt && Date.parse(s.expiresAt) < now ? '已过期' : '有效';
  return <>
    {dialog}
    {lead.customer && <div className="share"><div className="share__head"><b>主客户 · {lead.customer.name && !lead.customer.name.startsWith('手机用户') ? lead.customer.name : '客户'}</b>
      <button className="btn btn--danger btn--sm" onClick={() => ask({ kind: 'unbind' })}>解绑</button></div>
      <p className="num">{spacedPhone(lead.customer.phone)} · 解绑后客户不能再打开这个方案，可以重新分享给其他人。</p></div>}
    {applications.filter(x => x.status === 'pending').map(x => <div key={x.id} className="share"><div className="share__head"><b>绑定申请 · <span className="num">{spacedPhone(x.applicant.phone)}</span></b><span className="tag tag--act">待批准</span></div>
      <p>{x.note ?? '未填写说明'} · {ago(x.createdAt)}</p>
      <div className="row-actions"><button className="btn btn--primary btn--sm" onClick={() => ask({ kind: 'approve', applicationId: x.id, phone: x.applicant.phone })}>核对无误，批准绑定</button>
        <button className="btn btn--danger btn--sm" onClick={() => ask({ kind: 'reject', applicationId: x.id, phone: x.applicant.phone })}>拒绝</button></div></div>)}
    {shares.map(s => <div key={s.id} className="share"><div className="share__head"><b>{s.targetPhone ? <>指定手机号 · <span className="num">{s.targetPhone.replace(/^\+86/, '').replace(/\*+/, ' **** ')}</span></> : '分享码 · 不指定手机号'}</b>
      <span className="tag">{shareState(s)}</span></div>
      <p>{s.targetPhone ? '客户用该手机号登录即自动绑定；其他号码只能预览或提交申请。' : '第一位登录的客户绑定。'}{s.expiresAt && <>有效至 <span className="num">{day(s.expiresAt)}</span>。</>}</p>
      {shareState(s) === '有效' && <div className="row-actions"><button className="btn btn--secondary btn--sm" onClick={() => ask({ kind: 'revoke', shareId: s.id })}>撤销分享码</button></div>}</div>)}
    {!shares.length && !lead.customer && <p className="muted small">还没有分享。</p>}
    {lead.status === 'published' && !lead.customer && <div style={{ marginTop: 12 }}><button className="btn btn--secondary btn--sm" onClick={onShare}><Icon name="plus" size={14}/>新建分享</button></div>}
    {history.length > 0 && <section className="sect"><h3 className="sect__title">记录</h3><ol className="feed">{[...history].reverse().map((h, i) =>
      <li key={i}><time dateTime={h.createdAt}>{when(h.createdAt)}</time><span>{historyText[h.kind] ?? h.kind}{h.method ? ` · ${methodText[h.method] ?? h.method}` : ''}</span></li>)}</ol></section>}
  </>;
}
