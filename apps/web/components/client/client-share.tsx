'use client';
// 分享链接：未登录预览，登录后按定向手机号 / 一次性绑定码 / 成员审批绑定到客户账号。
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientApi, ClientError, maskPhone, operationId, shareApi, signOut, type SharePreviewView } from './client-api';
import { AppBar, ErrorLine, LoadingScreen, Screen, StatusScreen, useClient } from './client-app';
import { Icon } from './client-icons';
import { Alert, Group, Row, RowMain } from './client-parts';
import { ResultView } from './client-request';

const remembered = (entry: string) => `hestia.client.shares.${entry}`;
/** Share tokens this browser applied with, so 我的项目 can show pending applications (tokens are the customer's own link). */
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

function LinkFail({ error }: { error: unknown }) {
  const { user, base, entry } = useClient();
  const reason = error instanceof ClientError ? (error.details?.reason as string | undefined) : undefined;
  const offline = error instanceof ClientError && error.code === 'NETWORK_ERROR';
  if (offline) return <Screen bar={<AppBar/>}><main className="screen__body"><ErrorLine error={error}/></main></Screen>;
  const revoked = reason === 'revoked', expired = reason === 'expired';
  return <StatusScreen seal={<span className="seal seal--quiet" aria-hidden="true"><Icon name={expired ? 'clock' : 'link'} size={26}/></span>}
    title={`这个分享链接${revoked ? '已被撤销' : expired ? '已过期' : '已失效'}`}
    sub={`${revoked ? '企业已撤销这个链接，可能是发错了对象或已重新分享。' : expired ? '链接已超过有效期。' : '链接不完整，或方案已不再公开。'}请联系为你制作方案的企业成员获取新链接；已绑定的项目可在「项目」中继续查看。`}>
    {user && entry && <div className="btn-stack"><Link className="btn btn--secondary btn--block" href={`${base}/projects`}>查看我的项目</Link></div>}
  </StatusScreen>;
}

function PreviewView({ token, preview, gate }: { token: string; preview: SharePreviewView; gate: boolean }) {
  const { user, go } = useClient();
  const [open, setOpen] = useState(gate);
  const dialog = useRef<HTMLDialogElement>(null);
  const bound = preview.viewer?.boundToMe;
  useEffect(() => { if (bound) go(`/c/${encodeURIComponent(preview.workspace.slug)}/r/${preview.request.id}`, true); }, [bound, go, preview]);
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
        <p className="lede">分享链接只能预览。调整、确认或留言需要验证手机号，并把这个方案绑定到你的账号；转发出去的链接不能让别人修改你的方案。</p>
        <Group>
          <div className="row"><RowMain icon="phone" title={preview.binding === 'phone' ? '企业指定了手机号' : '企业会单独告诉你绑定码'} sub={preview.binding === 'phone' ? '用该手机号登录即自动绑定' : '登录后输入 6 位一次性绑定码'}/></div>
          <div className="row"><RowMain icon="user" title="都不满足？" sub="可以提交绑定申请，由企业批准"/></div>
        </Group>
        <div className="btn-stack">
          <button className="btn btn--primary btn--block" onClick={() => { setOpen(false); go(`/c/${encodeURIComponent(preview.workspace.slug)}/login?next=${encodeURIComponent(bindPath)}`); }}>手机号登录</button>
          <button className="btn btn--secondary btn--block" onClick={() => setOpen(false)}>继续预览</button>
        </div>
      </div>
    </dialog>
  </>;
}

type BindState = { how: 'phone' | 'code' | null; error: ClientError | null };
function BindView({ token, preview, apply }: { token: string; preview: SharePreviewView; apply: boolean }) {
  const { user, go, toast, refreshSession } = useClient();
  const queries = useQueryClient();
  const slug = preview.workspace.slug, api = clientApi(slug), back = `/s/${encodeURIComponent(token)}`;
  const [state, setState] = useState<BindState>({ how: null, error: null });
  const [code, setCode] = useState(''), [name, setName] = useState(''), [note, setNote] = useState('');
  const [ops] = useState(() => ({ phone: operationId(), apply: operationId() }));
  const tried = useRef(false);
  useEffect(() => { if (user === null) go(`/c/${encodeURIComponent(slug)}/login?next=${encodeURIComponent(`${back}/bind`)}`, true); }, [user, go, slug, back]);
  const settle = async () => { await queries.invalidateQueries({ queryKey: ['share', token] }); queries.invalidateQueries({ queryKey: ['requests', slug] }); };
  const bind = useMutation({
    mutationFn: (input: { how: 'phone' | 'code'; code?: string }) => api.bind(token, { operationId: input.how === 'phone' ? ops.phone : operationId(), ...(input.code ? { code: input.code } : {}) }),
    onSuccess: (_view, input) => { setState({ how: input.how, error: null }); settle(); },
    onError: error => setState(s => ({ ...s, error: error as ClientError })),
  });
  const applyFor = useMutation({
    mutationFn: () => api.apply(token, { operationId: ops.apply, note: [name.trim(), note.trim()].filter(Boolean).join('：') || undefined }),
    onSuccess: () => { remember(slug, token); settle(); go(`${back}/bind`, true); },
    onError: error => toast((error as Error).message),
  });
  const viewer = preview.viewer;
  // Targeted share: try binding once on arrival; the server checks the verified phone.
  useEffect(() => {
    if (!user || tried.current || !viewer || viewer.boundToMe || viewer.application === 'pending' || preview.binding !== 'phone' || apply) return;
    tried.current = true; bind.mutate({ how: 'phone' });
  }, [user, viewer, preview.binding, apply, bind]);
  if (!user || !viewer) return <LoadingScreen back={back}/>;
  const projects = `/c/${encodeURIComponent(slug)}/projects`;
  const requestPath = `/c/${encodeURIComponent(slug)}/r/${preview.request.id}`;
  const phone = <span className="num">{maskPhone(user.phoneNumber)}</span>;
  if (viewer.boundToMe || state.how) return <StatusScreen back={projects} seal={<span className="seal" aria-hidden="true"><Icon name="check" size={28}/></span>} title="已绑定到你的账号"
    sub={`${state.how === 'phone' ? '你登录的手机号与企业分享时指定的一致，方案已自动绑定。' : state.how === 'code' ? '绑定码验证通过，方案已绑定；绑定码已失效。' : '这个方案已绑定到你的账号。'}现在可以调整、确认和留言。`}>
    <Group style={{ marginTop: 24 }}><Row label="方案" value={preview.request.title}/><Row label="账号" value={phone}/><Row label="企业" value={preview.workspace.name}/></Group>
    <div className="btn-stack"><Link className="btn btn--primary btn--block" href={requestPath}>查看并调整方案</Link><Link className="btn btn--secondary btn--block" href={projects}>我的项目</Link></div>
  </StatusScreen>;
  if (viewer.application === 'pending') return <StatusScreen back={back} title="绑定申请已提交"
    sub={`${preview.workspace.name}核对你的身份后会批准。批准前仍可预览；批准后方案会出现在「项目」中，可以调整和确认。`}
    items={[['提交绑定申请', 'done', phone], ['企业成员核对', 'now', '通常在 1 个工作日内'], ['绑定到你的账号', '']]}>
    <div className="btn-stack"><Link className="btn btn--secondary btn--block" href={back}>继续预览方案</Link><Link className="btn btn--secondary btn--block" href={projects}>我的项目</Link></div>
  </StatusScreen>;
  if (state.error?.code === 'ALREADY_BOUND') return <StatusScreen back={back} seal={<span className="seal seal--quiet" aria-hidden="true"><Icon name="lock" size={26}/></span>}
    title="这个方案已绑定其他客户" sub="企业分享的方案只能绑定一位主客户。你仍可以预览；如需参与，请联系企业成员。">
    <div className="btn-stack"><Link className="btn btn--secondary btn--block" href={back}>返回预览</Link></div>
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
  if (preview.binding === 'phone') {
    if (bind.isPending || !state.error) return <LoadingScreen back={back} text="正在核对手机号…"/>;
    if (state.error.code !== 'PHONE_MISMATCH') return <Screen bar={<AppBar back={back}/>}><main className="screen__body"><ErrorLine error={state.error}/>
      <div className="btn-stack"><button className="btn btn--primary btn--block" onClick={() => bind.mutate({ how: 'phone' })}>重试</button></div></main></Screen>;
    return <StatusScreen back={back} seal={<span className="seal seal--quiet" aria-hidden="true"><Icon name="phone" size={26}/></span>} title="手机号与分享指定的不一致"
      sub={<>这个方案是企业定向分享给另一个手机号的。为保护方案，用 {phone} 登录不能直接绑定，转发的链接只能预览。</>}>
      <div className="section"><Group>
        <button className="row" onClick={async () => { await signOut().catch(() => {}); queries.clear(); await refreshSession(); go(`/c/${encodeURIComponent(slug)}/login?next=${encodeURIComponent(`${back}/bind`)}`, true); }}>
          <RowMain icon="logout" title="换一个手机号登录" sub="如果企业分享时填写的是你的另一个号码" chevron/></button>
        <Link className="row" href={`${back}/bind?apply=1`}><RowMain icon="user" title="提交绑定申请" sub="由企业成员核对后批准" chevron/></Link>
      </Group></div>
      <div className="btn-stack"><Link className="btn btn--secondary btn--block" href={back}>返回预览</Link></div>
    </StatusScreen>;
  }
  const e = state.error;
  const locked = e?.code === 'BINDING_CODE_LOCKED' || e?.code === 'BINDING_CODE_EXPIRED' || (e?.code === 'BINDING_CODE_INVALID' && Number(e.details?.remaining ?? 1) <= 0);
  const message = !e ? null : locked && e.code === 'BINDING_CODE_INVALID' ? '尝试次数过多，这个绑定码已锁定。请联系企业成员重新分享，或提交绑定申请。'
    : e.code === 'BINDING_CODE_INVALID' ? `绑定码不正确，请核对后重试。还可尝试 ${Number(e.details?.remaining ?? 0)} 次。` : e.message;
  const submitCode = () => { if (!/^[A-Z0-9]{6}$/.test(code)) { setState(s => ({ ...s, error: new ClientError('绑定码为 6 位字母或数字。', 400, 'FORMAT') })); return; } bind.mutate({ how: 'code', code }); };
  return <Screen bar={<AppBar back={back}/>} dock={<button className="btn btn--primary btn--block" disabled={bind.isPending || locked} onClick={submitCode}>{bind.isPending ? '正在核对…' : '绑定到我的账号'}</button>}>
    <main className="screen__body">
      <h1 className="page-title">输入绑定码</h1>
      <p className="lede">企业成员会通过电话、微信等方式单独告诉你 6 位绑定码。只能使用一次，48 小时内有效。</p>
      <Group><label className="field field--code"><span className="field__label">绑定码</span><span className="field__control">
        <input maxLength={6} autoCapitalize="characters" autoComplete="one-time-code" spellCheck={false} placeholder="6 位绑定码" value={code} disabled={locked}
          onChange={ev => setCode(ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} onKeyDown={ev => { if (ev.key === 'Enter') submitCode(); }}/></span></label></Group>
      {message && <Alert kind="danger">{message}</Alert>}
      <Link className="text-link" href={`${back}/bind?apply=1`} style={{ marginTop: 16 }}>没有绑定码？提交绑定申请 <Icon name="right" size={14}/></Link>
    </main>
  </Screen>;
}
