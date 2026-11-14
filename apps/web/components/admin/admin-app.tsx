'use client';
// 平台管理后台 /admin/…（AM01，ADR-0018）：平台管理员邮箱登录、身份校验、页头导航与审计记录。按定稿原型 admin-console 实现；
// 模型服务、企业、用量由 AM02–AM04 接入，这里先占位。是否为平台管理员只由服务端判断。
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ClientError, get, post, signOut } from '../client/client-api';
import { ModelView, ServicesView, ServiceView } from './admin-models';

type Admin = { name: string; email: string; level: 'platform' | 'super' };
type AuditEntry = { at: string; actor: string; action: string; target: string; detail: Record<string, unknown> };
type State = { kind: 'loading' } | { kind: 'signed-out' } | { kind: 'denied' } | { kind: 'error' } | { kind: 'ready'; admin: Admin };

const sections = [['models', '模型服务'], ['workspaces', '企业'], ['usage', '用量'], ['audit', '审计记录']] as const;
const levelName = { platform: '平台管理员', super: '超级管理员' } as const;
const actionName: Record<string, string> = { grant: '授予权限', revoke: '撤销权限', register_service: '登记模型服务', update_service: '修改模型服务', replace_key: '更换密钥',
  fetch_models: '获取模型列表', enable_model_id: '启用模型 ID', update_model: '修改模型', change_price: '调整单价', disable_model: '停用模型', reenable_model: '重新启用',
  start_check: '运行接入检查', finish_check: '接入检查结束' };
const stamp = (iso: string) => { const d = new Date(iso), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const describe = (entry: AuditEntry) => {
  const { level, previous } = entry.detail as { level?: keyof typeof levelName; previous?: keyof typeof levelName | null };
  if (entry.action === 'grant') return previous ? `${levelName[previous]} → ${levelName[level!]}` : levelName[level!] ?? '';
  if (entry.action === 'revoke') return previous ? `原为${levelName[previous]}` : '';
  const d = entry.detail as Record<string, unknown>;
  if (entry.action === 'replace_key') return '密钥已更换';
  if (entry.action === 'change_price') return `输入 ${(Number(d.input) / 100).toFixed(2)} / 输出 ${(Number(d.output) / 100).toFixed(2)} 元每百万 token`;
  if (entry.action === 'fetch_models') return d.unsupported ? `不提供模型列表（${d.code}）` : `${d.count} 个模型 ID，新增 ${d.added}`;
  if (entry.action === 'enable_model_id') return `${d.modelId}${d.manual ? '（手动添加）' : ''}`;
  if (entry.action === 'finish_check') return d.passed ? '通过' : '未通过';
  if (entry.action === 'update_service' || entry.action === 'update_model') return `修改：${Object.keys((d.changed as object) ?? {}).join('、')}${d.recheck ? '，需重新检查' : ''}`;
  return '';
};

export function AdminApp({ path }: { path: string[] }) {
  const section = path[0] === 'services' ? 'models' : path[0] ?? 'models';
  const [state, setState] = useState<State>({ kind: 'loading' });
  const load = useCallback(() => get<{ admin: Admin }>('/api/admin/session')
    .then(r => setState({ kind: 'ready', admin: r.admin }))
    .catch(error => setState(error instanceof ClientError && error.status === 401 ? { kind: 'signed-out' } : error instanceof ClientError && error.status === 403 ? { kind: 'denied' } : { kind: 'error' })), []);
  useEffect(() => { void load(); }, [load]);
  const leave = () => signOut().catch(() => {}).finally(() => setState({ kind: 'signed-out' }));

  if (state.kind === 'loading') return <p className="page-loading">正在打开…</p>;
  if (state.kind === 'signed-out') return <LoginView onSignedIn={load}/>;
  if (state.kind === 'denied') return <Frame><h1>这个账号不是平台管理员</h1><p className="muted" style={{ marginTop: 8 }}>平台管理后台只对我方平台管理员开放，权限只能在服务器上授予。</p>
    <button className="btn btn--secondary" style={{ marginTop: 20 }} onClick={leave}>换一个账号登录</button></Frame>;
  if (state.kind === 'error') return <Frame><h1>暂时无法打开</h1><p className="muted" style={{ marginTop: 8 }}>请稍后刷新重试。</p></Frame>;
  const current = sections.some(([key]) => key === section) ? section : 'models';
  return <>
    <header className="topbar">
      <Link className="brand" href="/admin"><b>Hestia</b><span className="muted">平台管理</span></Link>
      <nav className="topnav" aria-label="平台管理">{sections.map(([key, title]) => <Link key={key} href={`/admin/${key}`} aria-current={key === current ? 'page' : undefined}>{title}</Link>)}</nav>
      <div className="topbar__end"><span className="member"><span className="member__name">{state.admin.name} · {levelName[state.admin.level]}</span></span>
        <button className="btn btn--secondary btn--sm" onClick={leave}>退出登录</button></div>
    </header>
    <main id="page">{current === 'audit' ? <AuditView/>
      : current === 'models' ? (path[0] === 'services' && path[1] ? <ServiceView id={path[1]}/> : path[0] === 'models' && path[1] ? <ModelView id={path[1]}/> : <ServicesView/>)
        : <Pending title={sections.find(([key]) => key === current)![1]}/>}</main>
  </>;
}

function Frame({ children }: { children: React.ReactNode }) {
  return <><header className="topbar"><span className="brand"><b>Hestia</b><span className="muted">平台管理</span></span></header>
    <main id="page"><section className="admin-auth"><div className="panel">{children}</div></section></main></>;
}

function LoginView({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<ClientError | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    try { await post('/api/auth/sign-in/email', { email: email.trim(), password }); onSignedIn(); }
    catch (failure) { setError(failure instanceof ClientError ? failure : new ClientError('', 500, 'INTERNAL_ERROR')); }
    finally { setBusy(false); }
  };
  return <Frame><form onSubmit={submit}>
    <h1>登录平台管理</h1>
    <p className="muted" style={{ marginTop: 6 }}>使用被授予平台管理员权限的邮箱和密码。</p>
    <label className="field"><span>邮箱</span><input className="input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254}/></label>
    <label className="field"><span>密码</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={128}/></label>
    {error && <p className="note note--danger" role="alert"><span><b>{error.status === 429 ? '尝试太频繁' : error.status >= 500 || error.status === 0 ? '暂时无法登录' : '登录失败'}</b>
      {error.status === 429 ? '请稍等几分钟再登录。' : error.status >= 500 || error.status === 0 ? '请稍后重试。' : '邮箱或密码不正确，请检查后重试。'}</span></p>}
    <button className="btn btn--primary" type="submit" style={{ marginTop: 20 }} disabled={busy}>{busy ? '正在登录…' : '登录'}</button>
  </form></Frame>;
}

function Pending({ title }: { title: string }) {
  return <div className="page"><div className="page__head"><div><h1 className="page__title">{title}</h1></div></div>
    <div className="empty"><b>这一页还在开发中</b>模型服务、企业分配与用量随后续工单接入。</div></div>;
}

function AuditView() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => { get<{ entries: AuditEntry[] }>('/api/admin/audit').then(r => setEntries(r.entries)).catch(() => setFailed(true)); }, []);
  return <div className="page">
    <div className="page__head"><div><h1 className="page__title">审计记录</h1><p className="page__sub">平台管理员的每次改动、权限的授予与撤销都记在这里，不能修改或删除。密钥只记“已更换”。</p></div></div>
    {failed ? <div className="empty"><b>暂时无法读取审计记录</b>请稍后刷新重试。</div>
      : !entries ? <p className="page-loading">正在读取…</p>
        : !entries.length ? <div className="empty"><b>还没有记录</b>授予权限、登记模型等操作会记在这里。</div>
          : <div className="table table--audit"><div className="table__head"><span>时间</span><span>操作者</span><span>动作</span><span>对象</span><span>内容</span></div>
            {entries.map((entry, i) => <div className="table__row" key={i}><span className="num small muted">{stamp(entry.at)}</span><span className="small">{entry.actor === 'server command' ? '服务器命令' : entry.actor}</span>
              <span className="small">{actionName[entry.action] ?? entry.action}</span><span className="small">{entry.target}</span><span className="small">{describe(entry)}</span></div>)}</div>}
  </div>;
}
