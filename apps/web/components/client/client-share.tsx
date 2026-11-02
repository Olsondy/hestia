'use client';
// 分享链接：未登录预览，登录后按定向手机号 / 一次性绑定码 / 成员审批绑定到客户账号。
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientApi, ClientError, maskPhone, operationId, shareApi, signOut, type SharePreviewView } from './client-api';
import { ErrorLine, Loading, Shell, Title, useClient } from './client-app';
import { Icon } from './client-icons';
import { Timeline } from './client-parts';
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
  if (!preview.data) return <Shell><Loading text="正在打开分享的方案…"/></Shell>;
  return sub === 'bind' ? <BindView token={token} preview={preview.data} apply={query.get('apply') === '1'}/> : <PreviewView token={token} preview={preview.data} gate={query.get('gate') === '1'}/>;
}

function LinkFail({ error }: { error: unknown }) {
  const { user, base, entry } = useClient();
  const reason = error instanceof ClientError ? (error.details?.reason as string | undefined) : undefined;
  const offline = error instanceof ClientError && error.code === 'NETWORK_ERROR';
  if (offline) return <Shell><section className="status-page"><ErrorLine error={error}/></section></Shell>;
  const revoked = reason === 'revoked', expired = reason === 'expired';
  return <Shell>
    <section className="status-page fail">
      <span className="seal danger" aria-hidden="true"><Icon name={expired ? 'clock' : 'link'} size={28}/></span>
      <Title a="这个分享链接" b={revoked ? '已被撤销' : expired ? '已过期' : '已失效'}/>
      <p className="lede">{revoked ? '企业已撤销这个链接，可能是发错了对象或已重新分享。' : expired ? '链接已超过有效期。' : '链接不完整，或方案已不再公开。'}请联系为你制作方案的企业成员，获取新的分享链接。</p>
      <p className="small muted">如果项目已经绑定到你的账号，可以在「我的项目」继续查看。</p>
      {user && entry && <div className="stack"><Link className="btn ghost wide" href={`${base}/projects`}>我的项目</Link></div>}
    </section>
  </Shell>;
}

function PreviewView({ token, preview, gate }: { token: string; preview: SharePreviewView; gate: boolean }) {
  const { user, go } = useClient();
  const [open, setOpen] = useState(gate);
  const dialog = useRef<HTMLDialogElement>(null);
  const bound = preview.viewer?.boundToMe;
  useEffect(() => { if (bound) go(`/c/${encodeURIComponent(preview.workspace.slug)}/r/${preview.request.id}`, true); }, [bound, go, preview]);
  useEffect(() => { const d = dialog.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  const bindPath = `/s/${encodeURIComponent(token)}/bind`;
  const onGate = () => { if (user) go(bindPath); else setOpen(true); };
  if (bound) return <Shell><Loading text="这个方案已绑定到你的账号，正在打开…"/></Shell>;
  return <>
    <ResultView request={preview.request} preview={{ member: '企业' }} onGate={onGate} loadScene={id => shareApi(token).scene(id)}/>
    <dialog ref={dialog} className="sheet" aria-label="需要登录" onClose={() => setOpen(false)} onClick={e => { if (e.target === dialog.current) setOpen(false); }}>
      <div className="sheet-body">
        <h2 className="sheet-title">调整和确认<em>需要登录</em></h2>
        <p>分享链接只能预览。调整、确认或留言需要验证手机号，并把这个项目绑定到你的账号；转发出去的链接不能让别人修改你的方案。</p>
        <ul className="sheet-list">
          <li><Icon name="phone" size={18}/><span><b>{preview.binding === 'phone' ? '企业指定了手机号' : '企业会单独告诉你绑定码'}</b>{preview.binding === 'phone' ? '用该手机号登录即自动绑定。' : '登录后输入 6 位一次性绑定码。'}</span></li>
          <li><Icon name="user" size={18}/><span><b>都不满足？</b>可以提交绑定申请，由企业批准。</span></li>
        </ul>
        <div className="stack">
          <button className="btn primary wide" onClick={() => { setOpen(false); go(`/c/${encodeURIComponent(preview.workspace.slug)}/login?next=${encodeURIComponent(bindPath)}`); }}>手机号登录</button>
          <button className="btn ghost wide" onClick={() => setOpen(false)}>继续预览</button>
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
  if (!user || !viewer) return <Shell back={back}><Loading/></Shell>;
  const requestPath = `/c/${encodeURIComponent(slug)}/r/${preview.request.id}`;
  if (viewer.boundToMe || state.how) return <Shell back={back}>
    <section className="status-page ok">
      <span className="seal" aria-hidden="true"><Icon name="check" size={30}/></span>
      <Title a="已绑定到" b="你的账号"/>
      <p className="lede">{state.how === 'phone' ? '你登录的手机号与企业分享时指定的一致，项目已自动绑定。' : state.how === 'code' ? '绑定码验证通过，项目已绑定。绑定码已失效，不能再次使用。' : '这个项目已绑定到你的账号。'}现在可以调整、确认和留言。</p>
      <dl className="summary"><div><dt>项目</dt><dd>{preview.request.title}</dd></div><div><dt>账号</dt><dd>{maskPhone(user.phoneNumber)}</dd></div><div><dt>企业</dt><dd>{preview.workspace.name}</dd></div></dl>
      <div className="stack"><Link className="btn primary wide" href={requestPath}>查看并调整方案</Link><Link className="btn ghost wide" href={`/c/${encodeURIComponent(slug)}/projects`}>我的项目</Link></div>
    </section></Shell>;
  if (viewer.application === 'pending') return <Shell back={back}>
    <section className="status-page">
      <span className="status review">等待企业批准</span>
      <Title a="绑定申请" b="已提交"/>
      <p className="lede">{preview.workspace.name}核对你的身份后会批准绑定。批准前你仍可预览方案；批准后，项目会出现在「我的项目」中，可以调整和确认。</p>
      <Timeline items={[['提交绑定申请', 'done', maskPhone(user.phoneNumber)], ['企业成员核对', 'now', '通常在 1 个工作日内'], ['绑定到你的账号', '']]}/>
      <div className="stack"><Link className="btn ghost wide" href={back}>继续预览方案</Link><Link className="btn ghost wide" href={`/c/${encodeURIComponent(slug)}/projects`}>我的项目</Link></div>
    </section></Shell>;
  if (state.error?.code === 'ALREADY_BOUND') return <Shell back={back}>
    <section className="status-page fail">
      <span className="seal danger" aria-hidden="true"><Icon name="lock" size={26}/></span>
      <Title a="这个方案已绑定" b="其他客户"/>
      <p className="lede">企业分享的方案只能绑定一位主客户。你仍可以预览；如需参与，请联系企业成员。</p>
      <Link className="btn ghost wide" href={back} style={{ marginTop: 24 }}>返回预览</Link></section></Shell>;
  if (apply) return <Shell back={`${back}/bind`} dock={<button className="btn primary wide" disabled={applyFor.isPending}
    onClick={() => { if (!name.trim()) { toast('请填写称呼'); return; } applyFor.mutate(); }}>{applyFor.isPending ? '正在提交…' : '提交绑定申请'}</button>}>
    <section className="form-page">
      <Title a="提交" b="绑定申请"/>
      <p className="lede">企业成员核对后批准，项目才会绑定到你的账号。请留下称呼，方便企业确认是你。</p>
      <dl className="summary"><div><dt>项目</dt><dd>{preview.request.title}</dd></div><div><dt>手机号</dt><dd>{maskPhone(user.phoneNumber)}</dd></div></dl>
      {viewer.application === 'rejected' && <p className="alert hint"><Icon name="info" size={16}/><span>企业没有批准上一次申请。可以补充说明后再提交。</span></p>}
      <label className="field"><span>称呼</span><input maxLength={20} placeholder="例如：王女士" value={name} onChange={e => setName(e.target.value)}/></label>
      <label className="field"><span>说明（选填）</span><textarea rows={3} maxLength={160} placeholder="例如：方案顾问上周来家里量过尺寸。" value={note} onChange={e => setNote(e.target.value)}/></label>
    </section></Shell>;
  if (preview.binding === 'phone') {
    if (bind.isPending || !state.error) return <Shell back={back}><Loading text="正在核对手机号…"/></Shell>;
    if (state.error.code !== 'PHONE_MISMATCH') return <Shell back={back}><section className="status-page"><ErrorLine error={state.error}/>
      <div className="stack"><button className="btn primary wide" onClick={() => bind.mutate({ how: 'phone' })}>重试</button></div></section></Shell>;
    return <Shell back={back}>
      <section className="status-page fail">
        <span className="seal danger" aria-hidden="true"><Icon name="phone" size={26}/></span>
        <Title a="手机号与分享" b="指定的不一致"/>
        <p className="lede">这个项目是企业定向分享给另一个手机号的。为保护方案，用 {maskPhone(user.phoneNumber)} 登录不能直接绑定，转发的链接只能预览。</p>
        <div className="options">
          <button className="option" onClick={async () => { await signOut().catch(() => {}); queries.clear(); await refreshSession(); go(`/c/${encodeURIComponent(slug)}/login?next=${encodeURIComponent(`${back}/bind`)}`, true); }}>
            <Icon name="logout" size={20}/><span><b>换一个手机号登录</b><small>如果企业分享时填写的是你的另一个号码</small></span><Icon name="chevron" size={16}/></button>
          <Link className="option" href={`${back}/bind?apply=1`}><Icon name="user" size={20}/><span><b>提交绑定申请</b><small>由企业成员核对后批准</small></span><Icon name="chevron" size={16}/></Link>
        </div>
        <Link className="btn ghost wide" href={back}>返回预览</Link>
      </section></Shell>;
  }
  const e = state.error;
  const message = !e ? null : e.code === 'BINDING_CODE_INVALID' ? `绑定码不正确，请核对后重试。还可尝试 ${Number(e.details?.remaining ?? 0)} 次。` : e.message;
  const locked = e?.code === 'BINDING_CODE_LOCKED' || e?.code === 'BINDING_CODE_EXPIRED' || (e?.code === 'BINDING_CODE_INVALID' && Number(e.details?.remaining ?? 1) <= 0);
  const submitCode = () => { if (!/^[A-Z0-9]{6}$/.test(code)) { setState(s => ({ ...s, error: new ClientError('绑定码为 6 位字母或数字。', 400, 'FORMAT') })); return; } bind.mutate({ how: 'code', code }); };
  return <Shell back={back} dock={<button className="btn primary wide" disabled={bind.isPending || locked} onClick={submitCode}>{bind.isPending ? '正在核对…' : '绑定到我的账号'}</button>}>
    <section className="form-page">
      <Title a="输入" b="绑定码"/>
      <p className="lede">企业成员会通过电话、微信等方式单独告诉你 6 位绑定码。绑定码只能使用一次，48 小时内有效。</p>
      <label className="field"><span>绑定码</span><input className="code-input" maxLength={6} autoCapitalize="characters" autoComplete="off" placeholder="6 位绑定码" value={code} disabled={locked}
        onChange={ev => setCode(ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} onKeyDown={ev => { if (ev.key === 'Enter') submitCode(); }}/></label>
      {message && <div className="alert danger" role="alert"><Icon name="alert" size={18}/><span>{locked && e?.code === 'BINDING_CODE_INVALID' ? '尝试次数过多，这个绑定码已锁定。请联系企业成员重新分享，或提交绑定申请。' : message}</span></div>}
      <Link className="text-link" href={`${back}/bind?apply=1`}>没有绑定码？提交绑定申请 <Icon name="chevron" size={14}/></Link>
    </section></Shell>;
}
