'use client';
// 分享码（ADR-0012）：输入或粘贴码即可预览；登录后按指定手机号 / 先登录者 / 成员审批绑定到客户账号。
// /s/{分享码} 只在应用内部打开（H5 输码后跳转，小程序识别剪贴板后用 web-view 打开），不发给客户。
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientApi, ClientError, maskPhone, operationId, shareApi, signOut, type SharePreviewView } from './client-api';
import { findShareCode, formatShareCode, normalizeShareCode } from '../../../../packages/contracts/src/share-code';
import { AppBar, ErrorLine, LoadingScreen, Screen, StatusScreen, useClient } from './client-app';
import { Icon } from './client-icons';
import { Alert, Group, Row, RowMain } from './client-parts';
import { ResultView } from './client-request';

const remembered = (entry: string) => `hestia.client.shares.${entry}`;
/** Share codes this browser applied with, so 我的项目 can show pending applications (the codes the customer entered). */
export function rememberedShares(entry: string): string[] {
  if (typeof window === 'undefined' || !entry) return [];
  try { return JSON.parse(localStorage.getItem(remembered(entry)) ?? '[]'); } catch { return []; }
}
function remember(entry: string, token: string) {
  try { localStorage.setItem(remembered(entry), JSON.stringify([...new Set([token, ...rememberedShares(entry)])].slice(0, 20))); } catch { /* memory only */ }
}

export function ShareRoute({ token, sub, query, onWorkspace }: { token: string; sub?: string; query: URLSearchParams; onWorkspace: (w: { slug: string; name: string }) => void }) {
  const { user } = useClient();
  const preview = useQuery({ queryKey: ['share', token, user?.id ?? null], queryFn: () => shareApi(token).preview(), retry: false, enabled: user !== undefined });
  useEffect(() => { if (preview.data) onWorkspace(preview.data.workspace); }, [preview.data, onWorkspace]);
  if (preview.error) return <LinkFail error={preview.error}/>;
  if (!preview.data) return <LoadingScreen text="正在打开分享的方案…"/>;
  return sub === 'bind' ? <BindView token={token} preview={preview.data} apply={query.get('apply') === '1'}/> : <PreviewView token={token} preview={preview.data} gate={query.get('gate') === '1'}/>;
}

const failText: Record<string, [string, string]> = {
  revoked: ['这个分享码已被撤销', '企业已撤销这个分享码，可能是发错了对象或已重新分享。'],
  expired: ['这个分享码已过期', '分享码已超过有效期。'],
  used: ['这个分享码已使用', '方案已绑定到客户的账号。如果是你绑定的，请用当时的手机号登录，在「项目」中查看。'],
  unavailable: ['分享码不正确或已失效', '请核对分享码是否完整。'],
};
function LinkFail({ error }: { error: unknown }) {
  const { user, base, entry } = useClient();
  const reason = error instanceof ClientError ? (error.details?.reason as string | undefined) ?? 'unavailable' : 'unavailable';
  const generic = error instanceof ClientError && (error.code === 'NETWORK_ERROR' || error.status === 429);
  if (generic) return <Screen bar={<AppBar/>}><main className="screen__body"><ErrorLine error={error}/></main></Screen>;
  const [title, sub] = failText[reason] ?? failText.unavailable;
  return <StatusScreen seal={<span className="seal seal--quiet" aria-hidden="true"><Icon name={reason === 'expired' ? 'clock' : 'lock'} size={26}/></span>}
    title={title} sub={`${sub}需要新的分享码请联系为你制作方案的企业成员。`}>
    {user && entry && <div className="btn-stack"><Link className="btn btn--secondary btn--block" href={`${base}/projects`}>查看我的项目</Link></div>}
  </StatusScreen>;
}

/**
 * 输入分享码：手动输入，或点「粘贴」读剪贴板（浏览器只允许点击后读取）。整段分享口令也能识别，只取其中的码；
 * 码先经服务端校验，有效才打开预览。
 */
export function ShareCodeEntry({ title = '输入分享码', sub = '企业发给你的 8 位分享码，打开即可预览' }: { title?: string; sub?: string }) {
  const { go } = useClient();
  const [open, setOpen] = useState(false), [value, setValue] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  useEffect(() => { const d = dialog.current; if (!d) return; if (open && !d.open) { d.showModal(); input.current?.focus(); } if (!open && d.open) d.close(); }, [open]);
  const take = (text: string) => { const code = findShareCode(text) ?? normalizeShareCode(text); setValue(code ? formatShareCode(code) : text.toUpperCase().slice(0, 9)); setError(''); return code; };
  const submit = async (raw = value) => {
    const code = findShareCode(raw) ?? normalizeShareCode(raw);
    if (!code) { setError('分享码为 8 位字母或数字，例如 HX7K-9QP2。'); return; }
    setBusy(true); setError('');
    try { await shareApi(code).preview(); setOpen(false); go(`/s/${code}`); }
    catch (e) {
      const reason = e instanceof ClientError ? e.details?.reason as string | undefined : undefined;
      setError(reason && failText[reason] ? `${failText[reason][0]}。${reason === 'unavailable' ? failText.unavailable[1] : ''}` : (e as Error).message);
    } finally { setBusy(false); }
  };
  const paste = async () => {
    try { const code = take(await navigator.clipboard.readText()); if (code) await submit(code); else setError('剪贴板里没有分享码，请手动输入。'); }
    catch { setError('无法读取剪贴板，请长按输入框粘贴，或手动输入。'); }
  };
  return <>
    <button className="row" onClick={() => setOpen(true)}><RowMain icon="link" title={title} sub={sub} chevron/></button>
    <dialog ref={dialog} className="sheet" aria-label="输入分享码" onClose={() => setOpen(false)} onClick={e => { if (e.target === dialog.current) setOpen(false); }}>
      <form className="sheet__body" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <span className="panel__grip" aria-hidden="true"/>
        <h2 className="sheet__title">输入分享码</h2>
        <p className="lede">企业成员发给你的 8 位分享码。整段分享消息粘贴进来也可以。不用登录就能预览；调整和确认时再用手机号登录。</p>
        <Group><label className="field field--code"><span className="field__label">分享码</span><span className="field__control">
          <input ref={input} inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="例如 HX7K-9QP2" value={value}
            onChange={e => take(e.target.value)} onPaste={e => { const text = e.clipboardData.getData('text'); if (findShareCode(text)) { e.preventDefault(); take(text); } }}/>
          <button type="button" className="chip" onClick={paste}>粘贴</button></span></label></Group>
        {error && <Alert kind="danger">{error}</Alert>}
        <div className="btn-stack">
          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? '正在打开…' : '打开方案'}</button>
          <button className="btn btn--secondary btn--block" type="button" onClick={() => setOpen(false)}>取消</button>
        </div>
      </form>
    </dialog>
  </>;
}

function PreviewView({ token, preview, gate }: { token: string; preview: SharePreviewView; gate: boolean }) {
  const { user, go } = useClient();
  const [open, setOpen] = useState(gate);
  const dialog = useRef<HTMLDialogElement>(null);
  const bound = preview.viewer?.boundToMe;
  useEffect(() => { if (bound) go(`/c/r/${preview.request.id}`, true); }, [bound, go, preview]);
  useEffect(() => { const d = dialog.current; if (!d) return; if (open && !d.open) { d.showModal(); d.querySelector<HTMLElement>('.sheet__body')?.focus(); } if (!open && d.open) d.close(); }, [open]);
  const bindPath = `/s/${encodeURIComponent(token)}/bind`;
  const onGate = () => { if (user) go(bindPath); else setOpen(true); };
  if (bound) return <LoadingScreen text="这个方案已绑定到你的账号，正在打开…"/>;
  return <>
    <ResultView request={preview.request} preview onGate={onGate} loadScene={id => shareApi(token).scene(id)}/>
    <dialog ref={dialog} className="sheet" aria-label="需要登录" onClose={() => setOpen(false)} onClick={e => { if (e.target === dialog.current) setOpen(false); }}>
      <div className="sheet__body" tabIndex={-1}>
        <span className="panel__grip" aria-hidden="true"/>
        <h2 className="sheet__title">调整和确认需要登录</h2>
        <p className="lede">分享码只能预览。调整、确认或留言需要验证手机号，并把这个方案绑定到你的账号；绑定后分享码失效，别人拿到也打不开。</p>
        <Group>
          <div className="row"><RowMain icon="phone" title={preview.binding === 'phone' ? '企业指定了手机号' : '登录即可绑定'} sub={preview.binding === 'phone' ? '用该手机号登录即自动绑定' : '用你的手机号登录，方案自动绑定到你的账号'}/></div>
          {preview.binding === 'phone' && <div className="row"><RowMain icon="user" title="换了号码？" sub="用其他号码登录可以提交绑定申请，由企业批准"/></div>}
        </Group>
        <div className="btn-stack">
          <button className="btn btn--primary btn--block" onClick={() => { setOpen(false); go(`/c/login?next=${encodeURIComponent(bindPath)}`); }}>手机号登录</button>
          <button className="btn btn--secondary btn--block" onClick={() => setOpen(false)}>继续预览</button>
        </div>
      </div>
    </dialog>
  </>;
}

type BindState = { how: 'phone' | 'open' | null; error: ClientError | null };
function BindView({ token, preview, apply }: { token: string; preview: SharePreviewView; apply: boolean }) {
  const { user, go, toast, refreshSession } = useClient();
  const queries = useQueryClient();
  const slug = preview.workspace.slug, api = clientApi(slug), back = `/s/${encodeURIComponent(token)}`;
  const [state, setState] = useState<BindState>({ how: null, error: null });
  const [name, setName] = useState(''), [note, setNote] = useState('');
  const [ops] = useState(() => ({ bind: operationId(), apply: operationId() }));
  const tried = useRef(false);
  useEffect(() => { if (user === null) go(`/c/login?next=${encodeURIComponent(`${back}/bind`)}`, true); }, [user, go, slug, back]);
  const settle = async () => { await queries.invalidateQueries({ queryKey: ['share', token] }); queries.invalidateQueries({ queryKey: ['requests', slug] }); };
  const bind = useMutation({
    mutationFn: () => api.bind(token, { operationId: ops.bind }),
    onSuccess: () => { setState({ how: preview.binding, error: null }); settle(); },
    onError: error => setState(s => ({ ...s, error: error as ClientError })),
  });
  const applyFor = useMutation({
    mutationFn: () => api.apply(token, { operationId: ops.apply, note: [name.trim(), note.trim()].filter(Boolean).join('：') || undefined }),
    onSuccess: () => { remember(slug, token); settle(); go(`${back}/bind`, true); },
    onError: error => toast((error as Error).message),
  });
  const viewer = preview.viewer;
  // Bind once on arrival: the server checks the verified phone of a targeted share; an open share binds the first customer.
  useEffect(() => {
    if (!user || tried.current || !viewer || viewer.boundToMe || viewer.application === 'pending' || apply) return;
    tried.current = true; bind.mutate();
  }, [user, viewer, apply, bind]);
  if (!user || !viewer) return <LoadingScreen back={back}/>;
  const projects = `/c/projects`;
  const requestPath = `/c/r/${preview.request.id}`;
  const phone = <span className="num">{maskPhone(user.phoneNumber)}</span>;
  if (viewer.boundToMe || state.how) return <StatusScreen back={projects} seal={<span className="seal" aria-hidden="true"><Icon name="check" size={28}/></span>} title="已绑定到你的账号"
    sub={`${state.how === 'phone' ? '你登录的手机号与企业分享时指定的一致，方案已自动绑定。' : state.how === 'open' ? '方案已绑定到你登录的手机号，分享码随之失效。' : '这个方案已绑定到你的账号。'}以后从「项目」进入，现在可以调整、确认和留言。`}>
    <Group style={{ marginTop: 24 }}><Row label="方案" value={preview.request.title}/><Row label="账号" value={phone}/><Row label="企业" value={preview.workspace.name}/></Group>
    <div className="btn-stack"><Link className="btn btn--primary btn--block" href={requestPath}>查看并调整方案</Link><Link className="btn btn--secondary btn--block" href={projects}>我的项目</Link></div>
  </StatusScreen>;
  if (viewer.application === 'pending') return <StatusScreen back={back} title="绑定申请已提交"
    sub={`${preview.workspace.name}核对你的身份后会批准。批准前仍可预览；批准后方案会出现在「项目」中，可以调整和确认。`}
    items={[['提交绑定申请', 'done', phone], ['企业成员核对', 'now', '通常在 1 个工作日内'], ['绑定到你的账号', '']]}>
    <div className="btn-stack"><Link className="btn btn--secondary btn--block" href={back}>继续预览方案</Link><Link className="btn btn--secondary btn--block" href={projects}>我的项目</Link></div>
  </StatusScreen>;
  if (state.error?.details?.reason === 'used' || state.error?.code === 'ALREADY_BOUND') return <StatusScreen back={back} seal={<span className="seal seal--quiet" aria-hidden="true"><Icon name="lock" size={26}/></span>}
    title="这个方案已绑定其他客户" sub="企业分享的方案只能绑定一位主客户，分享码已失效。如需参与，请联系企业成员。">
    <div className="btn-stack"><Link className="btn btn--secondary btn--block" href={projects}>我的项目</Link></div>
  </StatusScreen>;
  if (apply) return <Screen bar={<AppBar back={`${back}/bind`}/>} dock={<button className="btn btn--primary btn--block" disabled={applyFor.isPending}
    onClick={() => { if (!name.trim()) { toast('请填写称呼'); return; } applyFor.mutate(); }}>{applyFor.isPending ? '正在提交…' : '提交绑定申请'}</button>}>
    <main className="screen__body">
      <h1 className="page-title">提交绑定申请</h1>
      <p className="lede">企业成员核对后批准，方案才会绑定到你的账号。请留下称呼，方便企业确认是你。</p>
      {viewer.application === 'rejected' && <Alert kind="hint" title="上一次申请未获批准">可以补充说明后再提交。</Alert>}
      <Group><Row label="方案" value={preview.request.title}/><Row label="手机号" value={phone}/></Group>
      <Group>
        <label className="field"><span className="field__label">称呼</span><span className="field__control"><input maxLength={20} placeholder="例如：王女士" value={name} onChange={e => setName(e.target.value)}/></span></label>
        <label className="field"><span className="field__label">说明（选填）</span><textarea rows={2} maxLength={160} placeholder="例如：方案顾问上周来家里量过尺寸。" value={note} onChange={e => setNote(e.target.value)}/></label>
      </Group>
    </main>
  </Screen>;
  if (bind.isPending || !state.error) return <LoadingScreen back={back} text={preview.binding === 'phone' ? '正在核对手机号…' : '正在绑定到你的账号…'}/>;
  if (state.error.code !== 'PHONE_MISMATCH') return <Screen bar={<AppBar back={back}/>}><main className="screen__body"><ErrorLine error={state.error}/>
    <div className="btn-stack"><button className="btn btn--primary btn--block" onClick={() => bind.mutate()}>重试</button></div></main></Screen>;
  return <StatusScreen back={back} seal={<span className="seal seal--quiet" aria-hidden="true"><Icon name="phone" size={26}/></span>} title="手机号与分享指定的不一致"
    sub={<>这个方案是企业指定分享给另一个手机号的。为保护方案，用 {phone} 登录不能直接绑定，只能预览。</>}>
    <div className="section"><Group>
      <button className="row" onClick={async () => { await signOut().catch(() => {}); queries.clear(); await refreshSession(); go(`/c/login?next=${encodeURIComponent(`${back}/bind`)}`, true); }}>
        <RowMain icon="logout" title="换一个手机号登录" sub="如果企业分享时填写的是你的另一个号码" chevron/></button>
      <Link className="row" href={`${back}/bind?apply=1`}><RowMain icon="user" title="提交绑定申请" sub="由企业成员核对后批准" chevron/></Link>
    </Group></div>
    <div className="btn-stack"><Link className="btn btn--secondary btn--block" href={back}>返回预览</Link></div>
  </StatusScreen>;
}
