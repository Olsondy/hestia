'use client';
// H5 客户端：企业入口 /c/{entry}/… 与分享码页面 /s/{分享码}/…（应用内部打开，ADR-0012）。按定稿原型 client-h5-v2（P03）实现，只调用公开接口。
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientApi, ClientError, maskPhone, safeNext, session, signOut, type ClientUser, type FinishRequestView, type SendCodeResult } from './client-api';
import { Icon } from './client-icons';
import { Alert, Badge, Group, PlanDrawing, Row, RowMain, Section, Segmented, StyleOptions, Swatch, Timeline } from './client-parts';
import { NewRequestView, RequestRoute, requestStatus } from './client-request';
import { ShareCodeEntry, ShareRoute, rememberedShares } from './client-share';
import { useRail } from './rail';

// ---------- 上下文 ----------
type Ctx = {
  entry: string; base: string; user: ClientUser | null | undefined; workspaceName: string;
  go: (path: string, replace?: boolean) => void; toast: (text: string) => void; refreshSession: () => Promise<unknown>;
};
const ClientContext = createContext<Ctx | null>(null);
export const useClient = () => useContext(ClientContext)!;

export function ClientApp(props: { entry?: string; share?: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: (count, error) => count < 2 && !(error instanceof ClientError && error.status >= 400 && error.status < 500), refetchOnWindowFocus: true } } }));
  return <QueryClientProvider client={client}><Suspense fallback={<div className="client-app"><p className="page-loading">正在打开…</p></div>}><Router {...props}/></Suspense></QueryClientProvider>;
}

function Router({ entry: entryProp, share }: { entry?: string; share?: string }) {
  const pathname = usePathname(), search = useSearchParams(), router = useRouter(), queries = useQueryClient();
  const user = useQuery({ queryKey: ['session'], queryFn: session, staleTime: 30_000 });
  const [toastText, setToast] = useState(''), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useCallback((text: string) => { setToast(text); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(''), 2400); }, []);
  const go = useCallback((path: string, replace = false) => { if (replace) router.replace(path); else router.push(path); }, [router]);
  const refreshSession = useCallback(() => queries.invalidateQueries({ queryKey: ['session'] }), [queries]);
  const [shareEntry, setShareEntry] = useState<{ slug: string; name: string } | null>(null);
  const entry = entryProp ?? shareEntry?.slug ?? '';
  const catalog = useQuery({ queryKey: ['catalog', entry], queryFn: () => clientApi(entry).catalog(), enabled: !!entry, staleTime: 5 * 60_000 });
  const workspaceName = catalog.data?.workspace.name ?? shareEntry?.name ?? '';
  const ctx = useMemo<Ctx>(() => ({ entry, base: `/c/${encodeURIComponent(entry)}`, user: user.data, workspaceName, go, toast, refreshSession }),
    [entry, user.data, workspaceName, go, toast, refreshSession]);

  // Page title and scroll position follow route changes.
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  useEffect(() => { const h1 = document.querySelector('main h1, .panel__title')?.textContent; document.title = `${workspaceName || '方案客户端'}${h1 ? ` · ${h1}` : ''}`; });

  let page: React.ReactNode;
  if (share) page = <ShareRoute token={share} sub={pathname.split('/')[3]} query={search} onWorkspace={setShareEntry}/>;
  else {
    const parts = pathname.split('/').filter(Boolean).slice(2);
    page = parts[0] === 'login' ? <LoginView next={search.get('next')}/>
      : parts[0] === 'new' ? <NewRequestView/>
      : parts[0] === 'projects' ? <ProjectsView/>
      : parts[0] === 'me' ? <MeView/>
      : parts[0] === 'r' && parts[1] ? <RequestRoute id={parts[1]} sub={parts[2]}/>
      : <HomeView/>;
  }
  return <ClientContext.Provider value={ctx}>
    <div className="client-app">
      {catalog.error instanceof ClientError && catalog.error.status === 404 && !share ? <NotFound title="找不到这个企业入口" text="入口不存在或已停用。请确认链接是否完整。"/> : page}
      <div className={`toast${toastText ? ' is-on' : ''}`} role="status" aria-live="polite">{toastText}</div>
    </div>
  </ClientContext.Provider>;
}

// ---------- 外壳：Screen / AppBar / TabBar ----------
export function Screen({ children, bar, dock, tabs, className = '' }: { children: React.ReactNode; bar?: React.ReactNode; dock?: React.ReactNode; tabs?: 'home' | 'projects' | 'me'; className?: string }) {
  return <div className={`screen${tabs ? ' screen--tabs' : ''}${dock ? ' screen--dock' : ''} ${className}`}>
    {bar}{children}{dock && <div className="dock">{dock}</div>}{tabs && <TabBar active={tabs}/>}
  </div>;
}
export function AppBar({ back, onBack, title = '', overlay = false, brand = false, end }: { back?: string; onBack?: () => void; title?: string; overlay?: boolean; brand?: boolean; end?: React.ReactNode }) {
  const { workspaceName } = useClient();
  const cls = `icon-btn${overlay ? ' icon-btn--media' : ''}`;
  const start = onBack ? <button className={cls} onClick={onBack} aria-label="上一步"><Icon name="back"/></button>
    : back ? <Link className={cls} href={back} aria-label="返回"><Icon name="back"/></Link>
      : brand ? <span className="brand-mark" aria-label={`${workspaceName}标志（占位）`}>标志</span> : <span/>;
  return <header className={`appbar${overlay ? ' appbar--overlay' : ''}`}>{start}<b className="appbar__title">{title}</b><span className="appbar__end">{end}</span></header>;
}
function TabBar({ active }: { active: 'home' | 'projects' | 'me' }) {
  const { base, user, go } = useClient();
  const items = [['home', base, '首页'], ['folder', `${base}/projects`, '项目'], ['user', `${base}/me`, '我的']] as const;
  const keys = { home: 0, projects: 1, me: 2 };
  return <nav className="tabbar" aria-label="主菜单">
    {items.map(([icon, href, text], i) => <Link key={href} className="tabbar__item" href={href} aria-current={keys[active] === i ? 'page' : undefined}>
      <Icon name={icon} size={22} strokeWidth={keys[active] === i ? 2.1 : 1.7}/><span>{text}</span></Link>)}
    <button className="tabbar__action" aria-label="提交方案需求" onClick={() => go(user ? `${base}/new` : `${base}/login?next=${encodeURIComponent(`${base}/new`)}`)}><i><Icon name="plus" size={26}/></i></button>
  </nav>;
}
/** Title + explanation + optional timeline and actions: waiting, review, results, failures. */
export function StatusScreen({ back, seal, title, sub, items, children }: { back?: string; seal?: React.ReactNode; title: string; sub: React.ReactNode; items?: [string, 'done' | 'now' | '', React.ReactNode?][]; children?: React.ReactNode }) {
  return <Screen bar={<AppBar back={back}/>}><main className="screen__body">{seal}<h1 className="page-title">{title}</h1><p className="lede">{sub}</p>
    {items && <Timeline items={items}/>}{children}</main></Screen>;
}
export function NotFound({ title, text }: { title: string; text: string }) {
  const { base, entry } = useClient();
  return <StatusScreen back={entry ? base : undefined} seal={<span className="seal seal--quiet" aria-hidden="true"><Icon name="info" size={26}/></span>} title={title} sub={text}>
    {entry && <div className="btn-stack"><Link className="btn btn--secondary btn--block" href={`${base}/projects`}>查看我的项目</Link></div>}</StatusScreen>;
}
export function Loading({ text = '正在读取…' }: { text?: string }) { return <p className="page-loading" role="status">{text}</p>; }
export function LoadingScreen({ back, text }: { back?: string; text?: string }) { return <Screen bar={<AppBar back={back}/>}><Loading text={text}/></Screen>; }
export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return <Alert kind="danger">{error instanceof Error ? error.message : '请求未完成，请稍后重试。'}</Alert>;
}
/** Redirects to the entry login when signed out; renders nothing until the session is known. */
export function useSignedIn(next: string) {
  const { user, base, go } = useClient();
  useEffect(() => { if (user === null) go(`${base}/login?next=${encodeURIComponent(next)}`, true); }, [user, base, go, next]);
  return user ?? null;
}
/** Small persisted UI state (survives refresh within the tab). */
export function useStored<T>(key: string, initial: T): [T, (value: T | ((old: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try { const raw = sessionStorage.getItem(key); return raw ? { ...initial, ...JSON.parse(raw) } : initial; } catch { return initial; }
  });
  const set = useCallback((next: T | ((old: T) => T)) => setValue(old => {
    const value = typeof next === 'function' ? (next as (old: T) => T)(old) : next;
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: memory only */ }
    return value;
  }), [key]);
  return [value, set];
}

// ---------- 首页 ----------
function HomeView() {
  const { entry, workspaceName } = useClient();
  const catalog = useQuery({ queryKey: ['catalog', entry], queryFn: () => clientApi(entry).catalog(), staleTime: 5 * 60_000 });
  const stoneRail = useRail<HTMLDivElement>();
  return <Screen tabs="home">
    <section className="home-hero">
      <img src="/client/demo-villa-cover.jpg" alt="示例别墅一层客厅效果图（示意）"/>
      <AppBar brand overlay title={workspaceName}/>
      <div className="home-hero__copy"><h1>为你的家，<br/>先做一遍硬装与软装</h1><p className="home-hero__caption">示例别墅一层客厅 · 效果图示意</p></div>
    </section>
    <div className="home-body screen__body">
      <p className="lede">提交户型与石材偏好，得到 3 个整体方案的效果图。{workspaceName || '企业'}核对后发布，你可以换软装风格、换石材铺法，满意再确认。</p>
      <ol className="flow" aria-label="流程">{[['选户型', '示例或你的图纸'], ['选饰面与石材', '最多 3 款'], ['看 3 个方案', '可调整再确认']].map(([t, s]) =>
        <li key={t}>{t}<small>{s}</small></li>)}</ol>
      {!!catalog.data?.softStyles.length && <Section title={`${catalog.data.softStyles.length} 套软装风格`} aside="示意素材"><StyleOptions styles={catalog.data.softStyles}/></Section>}
      <Section title="企业石材库" aside="示意素材">
        {catalog.isLoading ? <Loading/> : <div className="stone-rail" ref={stoneRail}>{catalog.data?.stones.map(stone =>
          <figure key={`${stone.id}:${stone.version}`}><Swatch stone={stone} size={176}/><figcaption>{stone.name}</figcaption></figure>)}</div>}
        <ErrorLine error={catalog.error}/>
      </Section>
      <div className="section"><Group><ShareCodeEntry title="收到企业的分享码？" sub="输入或粘贴即可预览；调整和确认时再用手机号登录"/></Group></div>
      <p className="fine-print">演示环境 · 数据、尺寸与效果图均为示意</p>
    </div>
  </Screen>;
}

// ---------- 手机号登录 ----------
const codeMessages: Record<string, string> = {
  INVALID_PHONE: '请输入 11 位中国大陆手机号。', OTP_NOT_REQUESTED: '请先获取验证码。',
  OTP_EXPIRED: '验证码已过期（5 分钟内有效）。请重新获取。', OTP_LOCKED: '错误次数过多，此验证码已失效。请重新获取。',
};
type LoginState = { phone: string; code: string; demoCode: string | null; expiresAt: number; cooldownUntil: number; sent: boolean };
function LoginView({ next }: { next: string | null }) {
  const { entry, base, workspaceName, go, refreshSession, user } = useClient();
  const target = safeNext(next, `${base}/projects`), fromShare = target.startsWith('/s/');
  const [state, setState] = useStored<LoginState>(`hestia.client.login.${entry}`, { phone: '', code: '', demoCode: null, expiresAt: 0, cooldownUntil: 0, sent: false });
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false), [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (user) go(target, true); }, [user, go, target]);
  const cooldown = Math.max(0, Math.ceil((state.cooldownUntil - now) / 1000));
  const rate = error?.code === 'OTP_RATE_LIMITED';
  const send = async () => {
    if (!/^1\d{10}$/.test(state.phone)) { setError({ code: 'INVALID_PHONE', message: codeMessages.INVALID_PHONE }); return; }
    setBusy(true); setError(null);
    try {
      const result: SendCodeResult = await clientApi(entry).sendCode(state.phone);
      setState(s => ({ ...s, sent: true, code: '', demoCode: result.demoCode ?? null, expiresAt: Date.now() + result.expiresInSeconds * 1000, cooldownUntil: Date.now() + result.resendAfterSeconds * 1000 }));
    } catch (e) {
      const err = e as ClientError, retry = Number(err.details?.retryAfterSeconds ?? 0);
      if (err.code === 'OTP_COOLDOWN' && retry) setState(s => ({ ...s, cooldownUntil: Date.now() + retry * 1000 }));
      setError({ code: err.code ?? 'ERROR', message: err.code === 'OTP_RATE_LIMITED' ? `获取验证码过于频繁。为保护账号，请${retry > 90 ? ` ${Math.ceil(retry / 60)} 分钟` : '稍'}后再试。` : err.message });
    } finally { setBusy(false); }
  };
  const login = async () => {
    if (!/^1\d{10}$/.test(state.phone)) { setError({ code: 'INVALID_PHONE', message: codeMessages.INVALID_PHONE }); return; }
    if (!state.sent) { setError({ code: 'OTP_NOT_REQUESTED', message: codeMessages.OTP_NOT_REQUESTED }); return; }
    if (!/^\d{6}$/.test(state.code)) { setError({ code: 'FORMAT', message: '请输入 6 位验证码。' }); return; }
    setBusy(true); setError(null);
    try {
      await clientApi(entry).signIn(state.phone, state.code);
      setState({ phone: '', code: '', demoCode: null, expiresAt: 0, cooldownUntil: 0, sent: false });
      await refreshSession();
      go(target, true);
    } catch (e) {
      const err = e as ClientError;
      const left = Number(err.details?.attemptsRemaining ?? 0);
      setError({ code: err.code ?? 'ERROR', message: err.code === 'OTP_INVALID' ? `验证码不正确，还可尝试 ${left} 次。` : codeMessages[err.code ?? ''] ?? err.message });
      if (err.code === 'OTP_LOCKED' || err.code === 'OTP_EXPIRED') setState(s => ({ ...s, demoCode: null }));
    } finally { setBusy(false); }
  };
  const fieldError = !!error && ['INVALID_PHONE', 'OTP_NOT_REQUESTED', 'FORMAT'].includes(error.code);
  const locked = error?.code === 'OTP_LOCKED';
  const sendLabel = rate ? '暂不可获取' : cooldown ? `${cooldown} 秒后重发` : state.sent ? '重新获取' : '获取验证码';
  const showDemo = state.sent && state.demoCode && state.expiresAt > now && !locked;
  return <Screen bar={<AppBar back={fromShare ? target.replace(/\/bind$/, '') : base}/>}>
    <main className="screen__body">
      <h1 className="page-title">手机号登录</h1>
      <p className="lede">验证手机号即可，无需密码。首次登录会关联{workspaceName || '企业'}，你提交和绑定的方案都保存在这个账号下。</p>
      {fromShare && <Alert kind="info">登录后，分享给你的方案会按企业设定的方式绑定到你的账号。</Alert>}
      <Group>
        <label className="field"><span className="field__label">手机号</span><span className="field__control"><span className="field__prefix">+86</span>
          <input inputMode="numeric" autoComplete="tel-national" maxLength={11} placeholder="11 位手机号" value={state.phone}
            onChange={e => { const phone = e.target.value.replace(/\D/g, ''); setState(s => ({ ...s, phone })); }}/></span></label>
        <label className="field"><span className="field__label">验证码</span><span className="field__control">
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 位验证码" value={state.code}
            onChange={e => { const code = e.target.value.replace(/\D/g, ''); setState(s => ({ ...s, code })); }}
            onKeyDown={e => { if (e.key === 'Enter') login(); }}/>
          <button className="field__action" onClick={send} disabled={busy || !!cooldown || rate}>{sendLabel}</button></span></label>
      </Group>
      {showDemo && <div className="demo-code" role="status"><div><span>演示验证码 · 不发送短信 · 5 分钟内有效</span><strong>{state.demoCode}</strong></div>
        <button className="btn btn--secondary btn--sm" onClick={() => setState(s => ({ ...s, code: s.demoCode ?? '' }))}>填入</button></div>}
      {error && <Alert kind={fieldError ? 'hint' : 'danger'}>{error.message}</Alert>}
      <div className="btn-stack"><button className="btn btn--primary btn--block" onClick={login} disabled={busy || locked || rate}>{busy ? '请稍候…' : '登录'}</button></div>
      <p className="fine-print">登录即表示同意《用户协议》《隐私政策》（演示占位）</p>
    </main>
  </Screen>;
}

// ---------- 我的项目 ----------
function ProjectsView() {
  const { entry, base } = useClient();
  const user = useSignedIn(`${base}/projects`);
  const list = useQuery({ queryKey: ['requests', entry], queryFn: () => clientApi(entry).requests(), enabled: !!user,
    refetchInterval: query => (query.state.data ?? []).some(r => requestStatus(r).polling) ? 4000 : false });
  const pending = rememberedShares(entry);
  if (!user) return <Screen tabs="projects" bar={<AppBar brand/>}><Loading/></Screen>;
  const mine = (list.data ?? []).filter(r => r.origin === 'customer'), shared = (list.data ?? []).filter(r => r.origin === 'member');
  const empty = !list.isLoading && !mine.length && !shared.length && !pending.length;
  return <Screen tabs="projects" bar={<AppBar brand/>}>
    <main className="screen__body">
      <h1 className="page-title">我的项目</h1>
      <ErrorLine error={list.error}/>
      {list.isLoading ? <Loading/> : empty ? <div className="empty"><span className="seal seal--quiet" aria-hidden="true"><Icon name="folder" size={26}/></span><h2>还没有项目</h2>
        <p>点下方 + 按钮提交户型和石材偏好，得到第一份整体方案；或输入企业发给你的分享码。</p>
        <Group><ShareCodeEntry/></Group></div> : <>
        <Section title="我提交的" aside={String(mine.length)}>
          {mine.length ? mine.map(r => <ProjectCard key={r.id} request={r}/>) : <p className="meta">还没有自己提交的方案需求。</p>}
        </Section>
        <Section title="企业分享给我的" aside={String(shared.length + pending.length)}>
          {shared.map(r => <ProjectCard key={r.id} request={r}/>)}
          {pending.map(token => <PendingCard key={token} token={token}/>)}
          {!shared.length && !pending.length && <p className="meta">输入企业的分享码并完成绑定后，方案会出现在这里。</p>}
          <Group><ShareCodeEntry/></Group>
        </Section>
      </>}
    </main>
  </Screen>;
}
function ProjectCard({ request }: { request: FinishRequestView }) {
  const { base, entry } = useClient();
  const status = requestStatus(request), image = request.schemes.find(s => s.render?.imageHref)?.render?.imageHref;
  const catalog = useQuery({ queryKey: ['catalog', entry], queryFn: () => clientApi(entry).catalog(), staleTime: 5 * 60_000 });
  const plan = catalog.data?.demoVilla.plan;
  return <Link className="project" href={`${base}/r/${request.id}`}>
    <span className="project__thumb">{image ? <img src={image} alt=""/> : request.source === 'demo-villa' && plan
      ? <PlanDrawing plan={plan} finishes={catalog.data!.demoVilla.finishes} levelId={plan.levels[0].id} selected={request.finishIds} small/>
      : <Icon name={status.kind === 'act' ? 'upload' : request.status === 'assisted_conversion' ? 'file' : 'clock'} size={24}/>}</span>
    <span className="project__main"><b>{request.title}</b><Badge kind={status.kind}>{status.label}</Badge><span className="meta">{status.line}</span></span>
    <span className="row__chev"><Icon name="right" size={16}/></span></Link>;
}
function PendingCard({ token }: { token: string }) {
  const preview = useQuery({ queryKey: ['share', token], queryFn: () => import('./client-api').then(m => m.shareApi(token).preview()), retry: false });
  const viewer = preview.data?.viewer;
  if (!preview.data || viewer?.boundToMe || !viewer?.application) return null;
  const waiting = viewer.application === 'pending';
  return <Link className="project" href={`/s/${encodeURIComponent(token)}/bind`}><span className="project__thumb"><Icon name="lock" size={24}/></span>
    <span className="project__main"><b>{preview.data.request.title}</b><Badge kind={waiting ? 'wait' : 'act'}>{waiting ? '待企业批准' : '未获批准'}</Badge>
      <span className="meta">{waiting ? '绑定申请已提交，批准后可调整和确认' : '企业未批准这次绑定申请，可联系企业成员'}</span></span>
    <span className="row__chev"><Icon name="right" size={16}/></span></Link>;
}

// ---------- 我的：账号与主题 ----------
export type Theme = 'system' | 'light' | 'dark';
export const THEME_KEY = 'hestia.client.theme';
function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
}
function MeView() {
  const { base, user, workspaceName, go, refreshSession, toast } = useClient();
  const queries = useQueryClient();
  const [theme, setTheme] = useState<Theme>('system');
  // Read after mount: the server render cannot know the stored choice.
  useEffect(() => { try { const saved = localStorage.getItem(THEME_KEY) as Theme | null; if (saved) setTheme(saved); } catch { /* memory only */ } }, []);
  const pick = (value: Theme) => { setTheme(value); try { localStorage.setItem(THEME_KEY, value); } catch { /* memory only */ } applyTheme(value); };
  const logout = async () => { await signOut().catch(() => {}); queries.clear(); await refreshSession(); toast('已退出登录'); go(base, true); };
  return <Screen tabs="me" bar={<AppBar brand/>}>
    <main className="screen__body">
      <h1 className="page-title">我的</h1>
      <div className="section"><Group><div className="row">
        <RowMain icon="user" title={<span className="num">{user ? maskPhone(user.phoneNumber) : '未登录'}</span>} sub={user ? `已关联 ${workspaceName}` : '登录后可提交需求、调整和确认方案'}/>
        {user === null && <Link className="btn btn--primary btn--sm" href={`${base}/login?next=${encodeURIComponent(`${base}/me`)}`}>登录</Link>}
      </div></Group></div>
      <Section title="显示"><Segmented label="显示主题" value={theme} onChange={pick} options={[['system', '跟随系统', 'system'], ['light', '浅色', 'sun'], ['dark', '深色', 'moon']]}/></Section>
      <Section title="关于"><Group><Row label="企业" value={workspaceName}/><Row label="说明" value="效果图与石材为示意素材"/><Row label="协议" value="《用户协议》《隐私政策》（占位）"/></Group></Section>
      {user && <div className="btn-stack"><button className="btn btn--secondary btn--block" onClick={logout}><Icon name="logout" size={17}/>退出登录</button></div>}
    </main>
  </Screen>;
}
