'use client';
// 企业工作台 /w/{企业标识}/…：成员邮箱登录、成员校验、页头导航、「今日」（W01）与线索（W02，见 workbench-leads.tsx）。
// 按定稿原型 enterprise-workbench（P02）实现；预置方案、石材与软装由 W04、W05 接入，这里先占位。成员关系只由服务端判断。
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LeadView } from '../../../../packages/contracts/src/finish-requests';
import type { WorkspaceView } from '../../../../packages/contracts/src/workspaces';
import { ClientError, get, maskPhone, post, session, signOut } from '../client/client-api';
import { Icon, type IconName } from '../client/client-icons';
import { LeadDetailView, LeadsView } from './workbench-leads';
import { AssistView } from './workbench-assist';

// ---------- 上下文 ----------
type Ctx = { slug: string; base: string; user: SessionUser; workspace: WorkspaceView; go: (path: string, replace?: boolean) => void };
const WorkbenchContext = createContext<Ctx | null>(null);
export const useWorkbench = () => useContext(WorkbenchContext)!;
type SessionUser = { id: string; name: string; email: string | null; phoneNumber: string | null };
const sessionUser = () => session() as Promise<SessionUser | null>;
const memberOf = (slug: string) => get<{ workspace: WorkspaceView }>(`/api/workspaces/by-slug/${encodeURIComponent(slug)}`).then(r => r.workspace);
// Demo stone names end in「（示意）」; the workbench labels the section as 示意素材 once instead (same as the H5).
export const tidy = (lead: LeadView): LeadView => ({ ...lead, schemes: lead.schemes.map(scheme => ({ ...scheme, surfaceDesign: { ...scheme.surfaceDesign,
  stones: scheme.surfaceDesign.stones.map(stone => ({ ...stone, name: stone.name.replace(/（示意）$/, '') })) } })) });
export const leadsOf = (workspaceId: string) => get<{ leads: LeadView[] }>(`/api/workspaces/${workspaceId}/leads`).then(r => r.leads.map(tidy));

export function WorkbenchApp({ slug }: { slug: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: {
    retry: (count, error) => count < 2 && !(error instanceof ClientError && error.status >= 400 && error.status < 500), refetchOnWindowFocus: true } } }));
  return <QueryClientProvider client={client}><Suspense fallback={<p className="page-loading">正在打开…</p>}><Router slug={slug}/></Suspense></QueryClientProvider>;
}

/** Only paths inside this workbench are followed after sign-in. */
const safeNext = (value: string | null, base: string) =>
  value && value.startsWith(`${base}/`) && !value.includes('//') && !value.includes('\\') ? value : base;

function Router({ slug }: { slug: string }) {
  const pathname = usePathname(), search = useSearchParams(), router = useRouter();
  const base = `/w/${encodeURIComponent(slug)}`, parts = pathname.split('/').filter(Boolean).slice(2);
  const go = useCallback((path: string, replace = false) => { if (replace) router.replace(path); else router.push(path); }, [router]);
  const user = useQuery({ queryKey: ['session'], queryFn: sessionUser, staleTime: 30_000 });
  const membership = useQuery({ queryKey: ['membership', slug, user.data?.id], queryFn: () => memberOf(slug), enabled: !!user.data, staleTime: 60_000 });
  const onLogin = parts[0] === 'login';
  const denied = membership.error instanceof ClientError && membership.error.status === 403;

  // Signed out → login (keeping the page asked for); a member on the login page → where they were going.
  useEffect(() => {
    if (user.isSuccess && !user.data && !onLogin) go(`${base}/login${pathname === base ? '' : `?next=${encodeURIComponent(pathname)}`}`, true);
    if (onLogin && membership.data) go(safeNext(search.get('next'), base), true);
  }, [user.isSuccess, user.data, onLogin, membership.data, base, pathname, search, go]);
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  useEffect(() => {
    const h1 = document.querySelector('main h1')?.textContent;
    document.title = `${membership.data?.name ?? '企业工作台'}${h1 ? ` · ${h1}` : ''}`;
  });

  const ctx = useMemo(() => user.data && membership.data ? { slug, base, user: user.data, workspace: membership.data, go } : null, [slug, base, user.data, membership.data, go]);
  if (user.isPending || (user.data && membership.isPending)) return <p className="page-loading">正在打开…</p>;
  if (user.error || (membership.error && !denied)) return <AuthFrame><h1>暂时打不开工作台</h1><p className="muted" style={{ marginTop: 8 }}>{(user.error ?? membership.error)?.message}</p>
    <button className="btn btn--secondary" onClick={() => { void user.refetch(); void membership.refetch(); }}>重试</button></AuthFrame>;
  if (!user.data) return onLogin ? <LoginView/> : <p className="page-loading">正在打开…</p>;
  if (denied) return <DeniedView base={base}/>;
  if (!ctx) return <p className="page-loading">正在打开…</p>;

  const page = !parts[0] ? <TodayView/>
    : parts[0] === 'leads' ? (parts[1] ? (parts[2] === 'assist' ? <AssistView id={parts[1]}/> : <LeadDetailView id={parts[1]}/>) : <LeadsView query={search}/>)
      : parts[0] === 'new' ? <Pending nav="new" title="预置方案"/>
        : parts[0] === 'stones' ? <Pending nav="stones" title="石材与软装"/>
          : <Shell nav={null}><div className="page"><div className="empty"><b>找不到这个页面</b>请从页头进入需要的页面。</div></div></Shell>;
  return <WorkbenchContext.Provider value={ctx}>{page}</WorkbenchContext.Provider>;
}

/** Sign out and show the sign-in form; cached session and membership are dropped so nothing of the old account remains. */
function useSignOut(base: string) {
  const queries = useQueryClient(), router = useRouter();
  return async () => {
    await signOut().catch(() => {});
    queries.removeQueries({ predicate: query => query.queryKey[0] !== 'session' });
    queries.setQueryData(['session'], null);
    router.replace(`${base}/login`);
  };
}

// ---------- 主题 ----------
const THEME_KEY = 'hestia.workbench.theme';
function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const read = () => { const set = document.documentElement.dataset.theme; setDark(set ? set === 'dark' : media.matches); };
    read(); media.addEventListener('change', read); return () => media.removeEventListener('change', read);
  }, []);
  const toggle = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; setDark(!dark);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* this visit only */ }
  };
  return { dark, toggle };
}
function ThemeButton() {
  const { dark, toggle } = useTheme();
  return <button className="icon-btn" onClick={toggle} aria-label={dark ? '切换到浅色' : '切换到深色'}><Icon name={dark ? 'sun' : 'moon'} size={17} strokeWidth={1.6}/></button>;
}

// ---------- 外壳 ----------
export type Nav = 'today' | 'leads' | 'new' | 'stones';
const navItems: [Nav, string, string][] = [['today', '', '今日'], ['leads', '/leads', '线索'], ['new', '/new', '预置方案'], ['stones', '/stones', '石材与软装']];
function Brand({ name, href }: { name: string; href?: string }) {
  const inner = <><span className="brand-mark brand-mark--initial" aria-hidden="true">{name.slice(0, 1)}</span><b>{name}</b></>;
  return href ? <Link className="brand" href={href}>{inner}</Link> : <span className="brand">{inner}</span>;
}
export function Shell({ nav, children }: { nav: Nav | null; children: React.ReactNode }) {
  const { base, user, workspace } = useWorkbench(), logout = useSignOut(base);
  const leads = useQuery({ queryKey: ['leads', workspace.id], queryFn: () => leadsOf(workspace.id), staleTime: 30_000 });
  const count = leads.data ? leads.data.filter(lead => { const a = actionsOf(lead); return a.review || a.assist || a.contact || a.apply; }).length : 0;
  const name = user.name || user.email || '成员';
  return <>
    <header className="topbar"><Brand name={workspace.name} href={base}/>
      <nav className="topnav" aria-label="工作台">{navItems.map(([key, href, label]) =>
        <Link key={key} href={`${base}${href}`} aria-current={nav === key ? 'page' : undefined}>{label}{key === 'today' && count > 0 && <span className="count" aria-label={`${count} 件需要处理`}>{count}</span>}</Link>)}</nav>
      <div className="topbar__end"><TopSearch/><ThemeButton/>
        <span className="member"><span className="member__name">{name}</span><span className="avatar" title={name} aria-hidden="true">{name.slice(0, 1)}</span></span>
        <button className="icon-btn" onClick={logout} aria-label="退出登录"><Icon name="logout" size={16} strokeWidth={1.6}/></button></div>
    </header>
    <main id="page">{children}</main>
  </>;
}
/** 页头搜索：回车后到线索列表按手机号、称呼或项目名查找。 */
function TopSearch() {
  const { base, go } = useWorkbench();
  return <label className="search"><Icon name="search" size={15} strokeWidth={1.6}/>
    <input placeholder="搜索客户或项目" aria-label="搜索客户或项目" onKeyDown={e => { const t = e.currentTarget.value.trim(); if (e.key === 'Enter') go(`${base}/leads${t ? `?t=${encodeURIComponent(t)}` : ''}`); }}/></label>;
}
/** Sign-in and refusal pages: demo cover underneath, one floating panel, no navigation. */
function AuthFrame({ children, name }: { children: React.ReactNode; name?: string }) {
  return <>
    <header className="topbar">{name ? <Brand name={name}/> : <span className="brand"><b>企业工作台</b></span>}<div className="topbar__end"><ThemeButton/></div></header>
    <main id="page"><section className="auth">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/client/demo-villa-cover.jpg" alt=""/>
      <div className="panel">{children}</div>
      <span className="auth__caption">示例别墅 · 效果图示意</span>
    </section></main>
  </>;
}
export function Note({ kind, title, children }: { kind: 'danger' | 'hint' | 'ok' | 'info'; title: string; children: React.ReactNode }) {
  const name: IconName = kind === 'danger' ? 'alert' : kind === 'ok' ? 'check' : 'info';
  return <p className={`note note--${kind}`} role={kind === 'danger' ? 'alert' : undefined}><Icon name={name} size={16} strokeWidth={1.6}/><span><b>{title}</b>{children}</span></p>;
}

// ---------- 登录 / 无权访问 ----------
function LoginView() {
  const queries = useQueryClient();
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => post('/api/auth/sign-in/email', { email: email.trim(), password }),
    onSuccess: () => queries.invalidateQueries({ queryKey: ['session'] }),
  });
  const submit = (event: FormEvent) => { event.preventDefault(); if (!login.isPending) login.mutate(); };
  const error = login.error instanceof ClientError ? login.error : null;
  return <AuthFrame>
    <form onSubmit={submit}>
      <h1>登录企业工作台</h1>
      <p className="muted" style={{ marginTop: 6 }}>使用企业邀请时设置的邮箱和密码。工作台不开放注册。</p>
      <label className="field"><span>邮箱</span><input className="input" name="email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254}/></label>
      <label className="field"><span>密码</span><input className="input" name="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={128}/></label>
      {error && (error.status === 429 ? <Note kind="danger" title="尝试太频繁">请稍等几分钟再登录。</Note>
        : error.status === 0 ? <Note kind="danger" title="连接中断">请检查网络后重试。</Note>
          : error.status >= 500 ? <Note kind="danger" title="暂时无法登录">请稍后重试。</Note>
            : <Note kind="danger" title="登录失败">邮箱或密码不正确，请检查后重试。</Note>)}
      <button className="btn btn--primary" type="submit" disabled={login.isPending}>{login.isPending ? '正在登录…' : '登录'}</button>
      <p className="muted small" style={{ marginTop: 14 }}>客户请从企业的 H5 入口用手机号登录。</p>
    </form>
  </AuthFrame>;
}
function DeniedView({ base }: { base: string }) {
  const other = useSignOut(base);
  return <AuthFrame>
    <h1>这个账号不是本企业成员</h1>
    <p className="muted" style={{ marginTop: 8 }}>企业工作台只对企业成员开放。客户请使用企业的 H5 入口；如需成为成员，请联系企业管理员邀请。</p>
    <button className="btn btn--secondary" onClick={other}>换一个账号登录</button>
  </AuthFrame>;
}

// ---------- 今日 ----------
/** What a lead needs from members. A contact request is open until someone moves the lead past 新线索 (S02). */
export function actionsOf(lead: LeadView) {
  return {
    review: lead.status === 'pending_review',
    assist: lead.status === 'assisted_conversion',
    contact: lead.contactRequested && lead.follow.status === 'new',
    apply: lead.sharing.applications.some(application => application.status === 'pending'),
  };
}
export const ago = (iso: string) => {
  const t = Date.parse(iso), m = Math.round((Date.now() - t) / 60e3);
  if (m < 1) return '刚刚'; if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60); if (h < 24) return `${h} 小时前`;
  const d = new Date(t); return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};
/** Phone accounts are named「手机用户 尾号」by default; only a real name is shown before the masked number. */
export const who = (lead: LeadView) => {
  if (!lead.customer) return '未绑定客户';
  const { name, phone } = lead.customer, masked = maskPhone(phone);
  return name && !name.startsWith('手机用户') ? `${name} · ${masked}` : masked || '客户';
};
export const letterOf = (lead: LeadView, schemeId: string | null) => {
  const ordinal = lead.schemes.find(scheme => scheme.id === schemeId)?.ordinal;
  return ordinal ? `方案 ${String.fromCharCode(64 + ordinal)}` : '方案';
};
type FeedItem = { at: string; lead: LeadView; text: string; quote?: string | null };
function feedOf(leads: LeadView[]): FeedItem[] {
  return leads.flatMap(lead => [
    ...(lead.origin === 'customer' ? [{ at: lead.createdAt, lead, text: lead.source === 'drawing' ? '客户提交了图纸需求' : '客户提交了方案需求' }] : []),
    ...(lead.publishedAt ? [{ at: lead.publishedAt, lead, text: '方案已发布给客户' }] : []),
    ...lead.events.map(event => event.kind === 'confirmation'
      ? { at: event.createdAt, lead, text: `客户确认了${letterOf(lead, event.schemeId)}` }
      : { at: event.createdAt, lead, text: event.contactRequested ? `客户请求联系${event.preferredTime ? ` · ${event.preferredTime}` : ''}` : '客户留言', quote: event.message }),
    ...lead.sharing.applications.map(application => ({ at: application.createdAt, lead, text: `${maskPhone(application.applicant.phone)} 申请绑定`, quote: application.note })),
  ]).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 7);
}

function TodayView() {
  const { base, workspace } = useWorkbench();
  const leads = useQuery({ queryKey: ['leads', workspace.id], queryFn: () => leadsOf(workspace.id), refetchInterval: 60_000 });
  if (leads.isPending) return <Shell nav="today"><p className="page-loading">正在读取线索…</p></Shell>;
  if (leads.error) return <Shell nav="today"><div className="page"><Note kind="danger" title="线索读取失败">{leads.error.message}</Note>
    <button className="btn btn--secondary" style={{ marginTop: 16 }} onClick={() => leads.refetch()}>重试</button></div></Shell>;

  const rows = leads.data.map(lead => [lead, actionsOf(lead)] as const);
  const pick = (test: (a: ReturnType<typeof actionsOf>) => boolean) => rows.filter(([, a]) => test(a)).map(([lead]) => lead);
  const contact = pick(a => a.contact), review = pick(a => a.review || a.assist), apply = pick(a => a.apply);
  const total = pick(a => a.review || a.assist || a.contact || a.apply).length;
  const lastContact = (lead: LeadView) => lead.events.filter(event => event.contactRequested).at(-1)!;
  const column = (title: string, items: LeadView[], line: (lead: LeadView) => string) =>
    <section className="panel"><header className="panel__head"><h2 className="panel__title">{title}</h2><span className="muted small num">{items.length}</span></header>
      <div className="panel__body">{items.length ? <ul className="todo">{items.map(lead =>
        <li key={lead.id}><Link href={`${base}/leads/${lead.id}`}><b>{lead.title}</b><small>{line(lead)}</small></Link></li>)}</ul>
        : <p className="todo none">暂无</p>}</div></section>;
  const feed = feedOf(leads.data);

  return <Shell nav="today"><div className="page">
    <header className="page__head"><div><h1 className="page__title">今日</h1>
      <p className="page__sub">{total ? `${total} 件需要处理：客户请求联系的先回电，排队的图纸整理户型后出方案，绑定申请核对身份后批准。` : '今天没有需要处理的事项。新的需求、联系请求和绑定申请会出现在这里。'}</p></div>
      <div className="chips"><Link className="btn btn--secondary" href={`${base}/leads`}>全部线索</Link><Link className="btn btn--primary" href={`${base}/new`}><Icon name="plus" size={16} strokeWidth={1.6}/>预置方案</Link></div></header>
    <div className="page__grid today">
      {column('请求联系', contact, lead => { const event = lastContact(lead); return [who(lead), event.preferredTime, ago(event.createdAt)].filter(Boolean).join(' · '); })}
      {column('待整理图纸', review, lead => `${lead.status === 'pending_review' ? (lead.reviewReason || '方案已生成，待发布') : `${lead.drawingName ?? '图纸'} · 排队中`} · ${ago(lead.createdAt)}`)}
      {column('待批准绑定', apply, lead => { const application = lead.sharing.applications.find(a => a.status === 'pending')!;
        return [maskPhone(application.applicant.phone), application.note, ago(application.createdAt)].filter(Boolean).join(' · '); })}
    </div>
    <section className="panel recent" style={{ marginTop: 16 }}><header className="panel__head"><h2 className="panel__title">最近动态</h2><Link className="text-link" href={`${base}/leads`}>全部线索</Link></header>
      <div className="panel__body">{feed.length ? <ol className="feed">{feed.map((item, i) =>
        <li key={i}><time dateTime={item.at}>{ago(item.at)}</time><span><Link className="strong" href={`${base}/leads/${item.lead.id}`}>{item.lead.title}</Link> · {item.text}{item.quote && <q>{item.quote}</q>}</span></li>)}</ol>
        : <p className="today-empty">还没有动态。</p>}</div></section>
  </div></Shell>;
}

// ---------- 尚未开放的页面 ----------
function Pending({ nav, title }: { nav: Nav; title: string }) {
  const { base } = useWorkbench();
  return <Shell nav={nav}><div className="page">
    <header className="page__head"><div><h1 className="page__title">{title}</h1></div></header>
    <div className="empty"><b>这个页面还在准备中</b>需要处理的线索请先从「今日」查看。<p style={{ marginTop: 16 }}><Link className="btn btn--secondary" href={base}>回到今日</Link></p></div>
  </div></Shell>;
}
