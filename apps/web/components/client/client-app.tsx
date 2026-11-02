'use client';
// H5 客户端：企业入口 /c/{entry}/… 与分享链接 /s/{token}/…。按获批原型（P01）实现，只调用公开接口。
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientApi, ClientError, maskPhone, safeNext, session, signOut, type ClientUser, type FinishRequestView, type SendCodeResult } from './client-api';
import { Icon } from './client-icons';
import { Swatch, PlanDrawing, StatusChip } from './client-parts';
import { NewRequestView, RequestRoute, requestStatus } from './client-request';
import { ShareRoute, rememberedShares } from './client-share';

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
  useEffect(() => { const h1 = document.querySelector('main h1')?.textContent; document.title = `${workspaceName || '方案客户端'}${h1 ? ` · ${h1}` : ''}`; });

  let page: React.ReactNode;
  if (share) page = <ShareRoute token={share} sub={pathname.split('/')[3]} query={search} onWorkspace={setShareEntry}/>;
  else {
    const parts = pathname.split('/').filter(Boolean).slice(2);
    page = parts[0] === 'login' ? <LoginView next={search.get('next')}/>
      : parts[0] === 'new' ? <NewRequestView/>
      : parts[0] === 'projects' ? <ProjectsView/>
      : parts[0] === 'r' && parts[1] ? <RequestRoute id={parts[1]} sub={parts[2]}/>
      : <HomeView/>;
  }
  return <ClientContext.Provider value={ctx}>
    <div className="client-app">
      {catalog.error instanceof ClientError && catalog.error.status === 404 && !share ? <Shell><NotFound title="这个企业入口" text="入口不存在或已停用。请确认链接是否完整。"/></Shell> : page}
      <div className={`toast${toastText ? ' on' : ''}`} role="status" aria-live="polite">{toastText}</div>
    </div>
  </ClientContext.Provider>;
}

// ---------- 外壳 ----------
export function Shell({ children, back, dock, title }: { children: React.ReactNode; back?: string; dock?: React.ReactNode; title?: string }) {
  const { base, user, workspaceName, entry } = useClient();
  return <>
    <header className="bar">
      {back && <Link className="bar-back" href={back} aria-label="返回"><Icon name="back" size={20}/></Link>}
      <Link className="brand" href={entry ? base : '#'} aria-label={`${workspaceName}首页`}>
        <span className="brand-mark" aria-hidden="true">标志</span><span className="brand-name">{title ?? workspaceName}</span>
      </Link>
      {entry && (user
        ? <Link className="bar-link" href={`${base}/projects`}><Icon name="folder" size={17}/><span>我的项目</span></Link>
        : <Link className="bar-link" href={`${base}/login?next=${encodeURIComponent(`${base}/projects`)}`}><Icon name="user" size={17}/><span>登录</span></Link>)}
    </header>
    <main className="page" id="page">{children}</main>
    {dock && <div className="dock">{dock}</div>}
    <footer className="colophon"><span>演示环境 · 数据、尺寸与效果图均为示意</span></footer>
  </>;
}
export const Title = ({ a, b, small = false }: { a: string; b?: string; small?: boolean }) => <h1 className={`title${small ? ' small' : ''}`}>{a}{b && <em>{b}</em>}</h1>;
export function NotFound({ title, text }: { title: string; text: string }) {
  const { base, entry } = useClient();
  return <section className="status-page"><Title a="找不到" b={title}/><p className="lede">{text}</p>
    {entry && <div className="stack"><Link className="btn primary wide" href={`${base}/projects`}>我的项目</Link></div>}</section>;
}
export function Loading({ text = '正在读取…' }: { text?: string }) { return <p className="page-loading" role="status">{text}</p>; }
export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="alert danger error-line" role="alert"><Icon name="alert" size={18}/><span>{error instanceof Error ? error.message : '请求未完成，请稍后重试。'}</span></div>;
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

// ---------- 企业入口首页 ----------
function HomeView() {
  const { entry, base, user, workspaceName, go } = useClient();
  const catalog = useQuery({ queryKey: ['catalog', entry], queryFn: () => clientApi(entry).catalog(), staleTime: 5 * 60_000 });
  const start = () => go(user ? `${base}/new` : `${base}/login?next=${encodeURIComponent(`${base}/new`)}`);
  return <Shell>
    <section className="cover">
      <figure className="cover-plate">
        <img src="/client/demo-villa-cover.jpg" alt="示例别墅一层客厅铺贴效果图（示意）"/>
        <figcaption><span>示例别墅 · 一层客厅</span><span>效果图 · 示意素材</span></figcaption>
      </figure>
      <h1 className="display">为你的空间，<em>先铺一遍石材。</em></h1>
      <p className="lede">提交户型与石材偏好，得到 2–3 个铺贴方案的效果图。{workspaceName || '企业'}核对后发布，你可以在给定选项内调整，再确认。</p>
      <div className="cover-actions">
        <button className="design-row" onClick={start}>提交方案需求<span><Icon name="arrow" size={22}/></span></button>
        <Link className="text-link" href={`${base}/projects`}>查看我的项目 <Icon name="chevron" size={14}/></Link>
      </div>
    </section>
    <section className="section">
      <h2 className="h2">从图纸到铺贴方案</h2>
      <ol className="flow">
        <li><b>示例别墅或上传图纸</b><span>DXF 自动转换；其他格式由企业协助转换。</span></li>
        <li><b>勾选要铺石材的饰面</b><span>地面、背景墙、楼梯踏面。</span></li>
        <li><b>挑选石材，得到 2–3 个方案</b><span>换石材、规格、铺法后重新出图，满意再确认。</span></li>
      </ol>
    </section>
    <section className="section">
      <div className="label-row"><h2 className="h2">企业石材库</h2><span className="tag">示意素材</span></div>
      {catalog.isLoading ? <Loading/> : <div className="peek">{catalog.data?.stones.map(stone =>
        <figure key={`${stone.id}:${stone.version}`}><Swatch stone={stone} size={192}/><figcaption>{stone.name}</figcaption></figure>)}</div>}
      <ErrorLine error={catalog.error}/>
    </section>
    <section className="section share-hint">
      <h2 className="h2">收到企业分享的链接？</h2>
      <p>直接打开即可预览企业为你做好的方案。调整和确认需要手机号登录，并把项目绑定到你的账号。</p>
    </section>
  </Shell>;
}

// ---------- 手机号登录 ----------
const codeMessages: Record<string, string> = {
  INVALID_PHONE: '请输入 11 位中国大陆手机号。', OTP_NOT_REQUESTED: '请先获取验证码。',
  OTP_EXPIRED: '验证码已过期（5 分钟内有效）。请重新获取。', OTP_LOCKED: '错误次数过多，此验证码已失效。请重新获取验证码。',
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
  const fieldError = error && ['INVALID_PHONE', 'OTP_NOT_REQUESTED', 'FORMAT'].includes(error.code);
  const locked = error?.code === 'OTP_LOCKED';
  const sendLabel = rate ? '暂不可获取' : cooldown ? `${cooldown} 秒后重新获取` : state.sent ? '重新获取' : '获取验证码';
  const showDemo = state.sent && state.demoCode && state.expiresAt > now && !locked;
  return <Shell back={fromShare ? target.replace(/\/bind$/, '') : base}>
    <section className="form-page">
      <Title a="手机号" b="登录"/>
      <p className="lede">验证手机号即可登录，无需密码。首次登录会关联{workspaceName || '企业'}，你提交和绑定的方案都保存在这个账号下。</p>
      {fromShare && <p className="note"><Icon name="link" size={16}/><span>登录后，分享给你的项目会按企业设定的方式绑定到你的账号。</span></p>}
      <label className="field"><span>手机号</span><span className="field-row"><span className="prefix">+86</span>
        <input inputMode="numeric" autoComplete="tel" maxLength={11} placeholder="11 位手机号" value={state.phone}
          onChange={e => { const phone = e.target.value.replace(/\D/g, ''); setState(s => ({ ...s, phone })); }}/></span></label>
      {fieldError && error.code === 'INVALID_PHONE' && <p className="field-error">{error.message}</p>}
      <label className="field"><span>验证码</span><span className="field-row">
        <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 位验证码" value={state.code}
          onChange={e => { const code = e.target.value.replace(/\D/g, ''); setState(s => ({ ...s, code })); }}
          onKeyDown={e => { if (e.key === 'Enter') login(); }}/>
        <button className="send" onClick={send} disabled={busy || !!cooldown || rate}>{sendLabel}</button></span></label>
      {fieldError && error.code !== 'INVALID_PHONE' && <p className="field-error">{error.message}</p>}
      {showDemo && <div className="demo-code" role="status"><div><span>演示验证码</span><strong>{state.demoCode}</strong></div>
        <small>演示环境不发送短信，验证码只显示在这里 · 5 分钟内有效</small>
        <button onClick={() => setState(s => ({ ...s, code: s.demoCode ?? '' }))}>填入</button></div>}
      {error && !fieldError && <div className="alert danger" role="alert"><Icon name="alert" size={18}/><span>{error.message}</span></div>}
      <button className="btn primary wide" onClick={login} disabled={busy || locked || rate}>{busy ? '请稍候…' : '登录'}</button>
      <p className="fine">登录即表示同意《用户协议》与《隐私政策》（演示占位）。</p>
    </section>
  </Shell>;
}

// ---------- 我的项目 ----------
function ProjectsView() {
  const { entry, base, go, refreshSession, toast } = useClient();
  const user = useSignedIn(`${base}/projects`);
  const queries = useQueryClient();
  const list = useQuery({ queryKey: ['requests', entry], queryFn: () => clientApi(entry).requests(), enabled: !!user,
    refetchInterval: query => (query.state.data ?? []).some(r => requestStatus(r).polling) ? 4000 : false });
  const pending = rememberedShares(entry);
  if (!user) return <Shell back={base}><Loading/></Shell>;
  const mine = (list.data ?? []).filter(r => r.origin === 'customer'), shared = (list.data ?? []).filter(r => r.origin === 'member');
  const logout = async () => { await signOut().catch(() => {}); queries.clear(); await refreshSession(); toast('已退出登录'); go(base, true); };
  const start = () => go(`${base}/new`);
  const empty = !list.isLoading && !mine.length && !shared.length && !pending.length;
  return <Shell back={base} dock={mine.length || shared.length ? <button className="btn primary wide" onClick={start}><Icon name="plus" size={18}/> 提交新的方案需求</button> : undefined}>
    <section className="projects">
      <Title a="我的" b="项目"/>
      <p className="account"><Icon name="phone" size={16}/><span>{maskPhone(user.phoneNumber)}</span><button onClick={logout}>退出登录</button></p>
      <p className="lede small">只显示你自己提交的，以及已绑定到你账号的项目。</p>
      <ErrorLine error={list.error}/>
      {list.isLoading ? <Loading/> : empty ? <div className="empty"><h2 className="h2">还没有项目</h2>
        <p>提交户型和石材偏好，得到第一份铺贴方案；或打开企业发给你的分享链接。</p>
        <button className="btn primary" onClick={start}>提交方案需求</button></div> : <>
        <h2 className="h3 group">我提交的 <small>{mine.length}</small></h2>
        {mine.length ? <ul className="proj-list">{mine.map(r => <ProjectRow key={r.id} request={r}/>)}</ul> : <p className="muted small none">还没有自己提交的方案需求。</p>}
        <h2 className="h3 group">企业分享给我的 <small>{shared.length + pending.length}</small></h2>
        <ul className="proj-list">{shared.map(r => <ProjectRow key={r.id} request={r}/>)}
          {pending.map(token => <PendingRow key={token} token={token}/>)}</ul>
        {!shared.length && !pending.length && <p className="muted small none">打开企业分享的链接并完成绑定后，项目会出现在这里。</p>}
      </>}
    </section>
  </Shell>;
}
function ProjectRow({ request }: { request: FinishRequestView }) {
  const { base, entry } = useClient();
  const status = requestStatus(request), image = request.schemes.find(s => s.render?.imageHref)?.render?.imageHref;
  const catalog = useQuery({ queryKey: ['catalog', entry], queryFn: () => clientApi(entry).catalog(), staleTime: 5 * 60_000 });
  const plan = catalog.data?.demoVilla.plan;
  return <li><Link className="proj" href={`${base}/r/${request.id}`}>
    <span className="proj-thumb">{image ? <img src={image} alt=""/> : request.source === 'demo-villa' && plan
      ? <PlanDrawing plan={plan} finishes={catalog.data!.demoVilla.finishes} levelId={plan.levels[0].id} selected={request.finishIds} small/>
      : <Icon name="file" size={22}/>}</span>
    <span className="proj-text"><b>{request.title}</b><StatusChip kind={status.kind}>{status.label}</StatusChip><small>{status.line}</small></span>
    <Icon name="chevron" size={16}/></Link></li>;
}
function PendingRow({ token }: { token: string }) {
  const preview = useQuery({ queryKey: ['share', token], queryFn: () => import('./client-api').then(m => m.shareApi(token).preview()), retry: false });
  const viewer = preview.data?.viewer;
  if (!preview.data || viewer?.boundToMe || !viewer?.application) return null;
  return <li><Link className="proj" href={`/s/${encodeURIComponent(token)}/bind`}><span className="proj-thumb lock"><Icon name="lock" size={22}/></span>
    <span className="proj-text"><b>{preview.data.request.title}</b>
      <StatusChip kind={viewer.application === 'pending' ? 'review' : 'assist'}>{viewer.application === 'pending' ? '等待企业批准' : '未获批准'}</StatusChip>
      <small>{viewer.application === 'pending' ? '绑定申请已提交，批准后可调整和确认' : '企业未批准这次绑定申请，可联系企业成员'}</small></span>
    <Icon name="chevron" size={16}/></Link></li>;
}
