'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ProjectSummary, type ProjectView, type User } from './api';
import { Brand, Icon } from './icons';
import { SceneViewport } from './scene-viewport';
import { useViewState } from './view-state';
import { prepareSceneTransfer } from './scene-transition';
import dynamic from 'next/dynamic';
import { FurnitureInspector, objectName } from './furniture-inspector';
import { courtyard, angled } from '../../../packages/scene-runtime/src/fixtures';
import type { CreditsView } from '../../../packages/contracts/src/credits';
import './free-experience.css';
const DrawingPanel = dynamic(() => import('./drawing-panel').then(module => module.DrawingPanel), { ssr: false, loading: () => <p className="page-status" role="status">正在打开图纸…</p> });
const CandidatePanel = dynamic(() => import('./candidate-panel').then(module => module.CandidatePanel), { ssr: false, loading: () => <p className="page-status" role="status">正在打开候选方案…</p> });
const ConversationPanel = dynamic(() => import('./conversation-panel').then(module => module.ConversationPanel), { ssr: false, loading: () => <p className="page-status" role="status">正在打开空间对话…</p> });

const StylePanel = dynamic(() => import('./style-controls').then(module => module.StylePanel), { ssr: false, loading: () => <p className="page-status" role="status">正在打开视觉风格…</p> });

const RenderPanel = dynamic(() => import('./render-panel').then(module => module.RenderPanel), { ssr: false, loading: () => <p className="page-status" role="status">正在打开静态成果…</p> });

const errorText = (error: unknown) => error instanceof Error ? error.message : '请求未完成，请重试。';
const projectKey = (id: string) => ['project', id];
function useProject(id: string) { return useQuery({ queryKey: projectKey(id), queryFn: () => api<{ project: ProjectView }>(`/api/projects/${encodeURIComponent(id)}`), enabled: !!id }); }

export function HestiaApp() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000, refetchOnWindowFocus: false }, mutations: { retry: false } } }));
  return <QueryClientProvider client={client}><Application /></QueryClientProvider>;
}

function Application() {
  const client = useQueryClient();
  const [projectId, setProjectId] = useState('');
  const [invite, setInvite] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  useEffect(() => {
    const sync = () => { const params = new URLSearchParams(location.search); setProjectId(params.get('project') || ''); setInvite(params.get('invite') || ''); };
    sync(); window.addEventListener('popstate', sync); return () => window.removeEventListener('popstate', sync);
  }, []);
  const navigate = (project = '') => { if (project && !projectId) prepareSceneTransfer(project, project, 'open'); const url = new URL(location.href); url.searchParams.delete('view'); url.searchParams.delete('task'); url.searchParams.delete('render'); project ? url.searchParams.set('project', project) : url.searchParams.delete('project'); history.pushState(null, '', url); setProjectId(project); window.scrollTo({ top: 0 }); };
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<{ user: User | null }>('/api/session'), staleTime: 0, refetchOnWindowFocus: true });
  useEffect(() => {
    const refreshSession = () => { if (document.visibilityState === 'visible') void client.invalidateQueries({ queryKey: ['session'] }); };
    window.addEventListener('focus', refreshSession);
    return () => window.removeEventListener('focus', refreshSession);
  }, [client]);
  const logout = useMutation({ mutationFn: () => api('/api/auth/sign-out', {}), onSuccess: () => { client.clear(); useViewState.getState().clear(); client.setQueryData(['session'], { user: null }); navigate(); } });
  const user = session.data?.user;
  const sessionIdentity = session.data ? user?.id ?? null : undefined;
  const [renderedIdentity, setRenderedIdentity] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (sessionIdentity === undefined || sessionIdentity === renderedIdentity) return;
    if (renderedIdentity !== undefined) {
      client.removeQueries({ predicate: query => query.queryKey[0] !== 'session' });
      useViewState.getState().clear(); setShowCredits(false); navigate();
    }
    setRenderedIdentity(sessionIdentity);
  }, [sessionIdentity, renderedIdentity, client]);
  const verifyingSession = session.isFetching && !session.isPending;
  return <main className="hestia-app" data-theme="editorial">
    {verifyingSession && <div className="session-refresh-notice" role="status">正在确认当前账户…</div>}
    <div className={verifyingSession ? 'session-revalidating' : undefined} aria-hidden={verifyingSession || undefined} inert={verifyingSession || undefined}>
    {session.isPending || (sessionIdentity !== undefined && sessionIdentity !== renderedIdentity) ? <div className="opening-state"><Brand/><p role="status">正在打开你的工作室…</p></div>
      : session.isError ? <div className="opening-state"><Brand/><h1>暂时无法连接工作室</h1><p role="alert">{errorText(session.error)}</p><button className="button primary" onClick={() => session.refetch()}>重新连接</button></div>
      : !user ? <AuthPanel invite={invite} onAuthenticated={() => { const url = new URL(location.href); url.searchParams.delete('invite'); history.replaceState(null, '', url); setInvite(''); client.invalidateQueries({ queryKey: ['session'] }); }}/>
      : <>
        <header className="app-header"><button className="brand-button" onClick={() => navigate()} aria-label="返回我的项目"><Brand/></button><span className="header-purpose">空间设计工作室</span><nav aria-label="工作室导航"><span className="account-name" title={user.email}>{user.name}</span>{!session.isFetching && <CreditButton userId={user.id} open={showCredits} onClick={() => setShowCredits(value => !value)}/>}<button className="text-button" onClick={() => { setShowCredits(false); logout.mutate(); }} disabled={logout.isPending}><Icon name="exit" size={17}/><span>退出</span></button></nav></header>
        {logout.isError && <p className="global-error" role="alert">退出失败：{errorText(logout.error)}</p>}
        {showCredits && !session.isFetching && <CreditDetails userId={user.id} onClose={() => setShowCredits(false)}/>}
        {projectId ? <ProjectWorkspace id={projectId} onBack={() => navigate()}/> : <ProjectIndex onOpen={navigate} onCreate={() => setCreating(true)}/>}
        {creating && <CreateProject onClose={() => setCreating(false)} onCreated={project => { client.setQueryData(projectKey(project.id), { project }); client.invalidateQueries({ queryKey: ['projects'] }); setCreating(false); navigate(project.id); }}/>}
      </>}
    </div>
  </main>;
}

function AuthPanel({ invite, onAuthenticated }: { invite: string; onAuthenticated: () => void }) {
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [password, setPassword] = useState('');
  const [acceptedEmail, setAcceptedEmail] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [sample, setSample] = useState<'courtyard' | 'angled'>('courtyard');
  const accepting = !!invite && !acceptedEmail;
  const registering = !invite && mode === 'register' && !acceptedEmail;
  const mutation = useMutation({ mutationFn: async () => {
    let loginEmail = acceptedEmail || email;
    if (accepting) { const result = await api<{ ok: true; email: string }>('/api/invitations/accept', { token: invite, name: name.trim(), password }); loginEmail = result.email; setAcceptedEmail(result.email); }
    if (registering) { await api<{ registered: true }>('/api/register', { email: email.trim(), name: name.trim(), password }); loginEmail = email.trim(); setAcceptedEmail(loginEmail); }
    await api('/api/auth/sign-in/email', { email: loginEmail.trim(), password });
  }, onSuccess: onAuthenticated });
  function submit(event: FormEvent) { event.preventDefault(); mutation.mutate(); }
  return <div className="auth-page">
    <header className="auth-header"><Brand/><span className="header-purpose">空间设计工作室</span><a className="guest-access-link" href="#access">登录或注册</a></header>
    <div className="auth-layout"><section className="auth-story guest-story"><h1>理想的家，<br/><em>从这里开始。</em></h1><p>先看看空间，再慢慢想象自己的生活。</p><div className="guest-sample-heading"><h2>公开示例空间</h2><span>合成示例 · 非真实户型</span></div><div className="guest-scene"><SceneViewport key={sample} projectId={`public-example-${sample}`} scene={sample === 'courtyard' ? courtyard : angled} publicExample/></div><div className="guest-sample-controls" role="group" aria-label="选择公开示例"><button type="button" aria-pressed={sample === 'courtyard'} onClick={() => setSample('courtyard')}>方形空间</button><button type="button" aria-pressed={sample === 'angled'} onClick={() => setSample('angled')}>斜墙空间</button></div><p className="guest-sample-note">拖动查看空间。示例仅供浏览，尺寸为测试输入；你的户型需要登录后创建。</p></section>
      <section className="auth-form-area" id="access"><form className="auth-form" onSubmit={submit}><h2>{accepting ? '欢迎来到 Hestia' : registering ? '创建你的工作室' : '回到你的工作室'}</h2><p className="form-intro">{accepting ? '接受邀请，设置你的名字和登录密码。' : registering ? '注册后领取一次免费积分，开始整理自己的空间。' : '使用邮箱和密码登录，继续你的项目。'}</p>
        {(accepting || registering) && <label className="field">你的名字<input name="name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} maxLength={80} required/></label>}
        {!accepting && <label className="field">邮箱<input name="email" type="email" autoComplete="email" value={acceptedEmail || email} onChange={e => setEmail(e.target.value)} readOnly={!!acceptedEmail} required/></label>}
        <label className="field">{accepting || registering ? '设置密码' : '密码'}<input name="password" type="password" autoComplete={accepting || registering ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} minLength={accepting || registering ? 8 : undefined} maxLength={128} required/>{(accepting || registering) && <small>至少 8 位字符。</small>}</label>
        {acceptedEmail && mutation.isError && <p className="form-note">请使用该邮箱对应的密码登录；如需更换邮箱，可返回注册表单。</p>}
        {mutation.isError && <p className="form-error" role="alert">{errorText(mutation.error)}</p>}
        <button className="button primary auth-submit" disabled={mutation.isPending}>{mutation.isPending ? '正在连接…' : accepting ? '接受邀请并进入' : registering ? '注册并进入' : '登录'}<Icon name="arrow" size={19}/></button>
        {!invite && <p className="form-note">{registering ? '已有账户？' : '还没有账户？'} <button type="button" className="text-button auth-switch" onClick={() => { setAcceptedEmail(''); setMode(registering ? 'login' : 'register'); mutation.reset(); }}>{registering ? '直接登录' : '免费注册'}</button></p>}
        {accepting && <a className="auth-login-link" href="/">已有账户，直接登录</a>}
      </form></section></div><footer className="auth-footer">为自己的空间，留一点想象。</footer>
  </div>;
}

function CreditButton({ userId, open, onClick }: { userId: string; open: boolean; onClick: () => void }) {
  const credits = useQuery({ queryKey: ['credits', userId], queryFn: () => api<CreditsView>('/api/credits') });
  return <button className="text-button" aria-label="我的积分" aria-expanded={open} aria-controls="credit-details" onClick={onClick}>我的积分{credits.data && <span> · {credits.data.balance.available}</span>}</button>;
}
function CreditDetails({ userId, onClose }: { userId: string; onClose: () => void }) {
  const credits = useQuery({ queryKey: ['credits', userId], queryFn: () => api<CreditsView>('/api/credits'), staleTime: 0 });
  return <section id="credit-details" className="credit-details" aria-labelledby="credit-title"><div className="credit-heading"><div><h2 id="credit-title">我的积分</h2><p>记录当前账户的积分和变动。</p></div><button className="text-button" onClick={onClose}>收起</button></div>
    {credits.isPending ? <p role="status">正在读取积分…</p> : credits.isError ? <p role="alert">积分暂时未能读取。<button className="text-button" onClick={() => credits.refetch()}>重新读取</button></p> : <><p className="credit-balance"><strong>{credits.data.balance.available}</strong> 积分可用{credits.data.balance.reserved > 0 && <small> · {credits.data.balance.reserved} 积分处理中</small>}</p><h3>积分记录</h3>{credits.data.entries.length ? <ul>{credits.data.entries.map(entry => <li key={entry.id}><span>{entry.kind === 'registration_grant' ? '注册赠送' : '积分变动'}<small>{new Date(entry.createdAt).toLocaleDateString('zh-CN')}</small></span><strong>{entry.amount > 0 ? '+' : ''}{entry.amount}</strong></li>)}</ul> : <p className="credit-empty">暂时没有积分记录。</p>}</>}
  </section>;
}

function ProjectIndex({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: () => void }) {
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<{ projects: ProjectSummary[] }>('/api/projects') });
  const [selected, setSelected] = useState('');
  const items = projects.data?.projects || [];
  const active = items.find(p => p.id === selected) || items[0];
  const detail = useProject(active?.id || '');
  const selectProject = (id: string) => { if (active && active.id !== id) { prepareSceneTransfer(active.id, id, 'switch'); setSelected(id); } };
  const titleCharacters = Array.from(active?.name || '');
  if (projects.isPending) return <div className="page-status" role="status">正在读取你的项目…</div>;
  if (projects.isError) return <div className="page-status"><h1>项目暂时未能打开</h1><p role="alert">{errorText(projects.error)}</p><button className="button secondary" onClick={() => projects.refetch()}>重新读取</button></div>;
  if (!active) return <section className="empty-studio"><div><h1>一处空间，<br/><em>新的开始。</em></h1><p>工作室已经准备好。创建一个空间项目，<br/>从空白开始，或先探索合成测试空间。</p><button className="button primary" onClick={onCreate}><Icon name="plus"/>创建第一个项目</button></div><aside><span className="fine-rule"/><h2>属于你的空间</h2><p>项目由服务端保存，关闭页面后仍可重新打开。旧原型里的本地项目不会自动上传。</p><p className="muted">当前提供空间保存与 3D 查看。合成测试空间不代表图纸识别结果。</p></aside></section>;
  return <section className="folio"><div className="folio-spread"><div className="folio-story"><div><h1 title={active.name}>{titleCharacters.length > 1 && titleCharacters.length <= 8 ? <>{titleCharacters.slice(0, Math.ceil(titleCharacters.length / 2)).join('')}<br className="folio-title-break"/><em>{titleCharacters.slice(Math.ceil(titleCharacters.length / 2)).join('')}</em></> : active.name}</h1><p className="project-kind">{active.synthetic ? '合成测试空间' : '空白空间项目'}</p></div><div className="folio-reading"><span className="fine-rule"/><h2>让空间，慢慢成形。</h2><p>{active.synthetic ? '探索房间、墙体与物品之间的关系。这是用于验证的合成空间，尺寸为测试输入。' : '为新的想法留一处空白。项目已经保存在你的账户中，随时可以回来。'}</p><p className="project-facts">版本 {active.revision} · 已保存于服务端</p></div><button className="folio-open" onClick={() => onOpen(active.id)}>打开空间<span><Icon name="arrow" size={24}/></span></button></div><div className="folio-scene"><div className="scene-topline"><span>{active.synthetic ? '空间 / 合成测试' : '空间 / 等待新的想法'}</span><span>可交互 3D</span></div>{detail.data ? <SceneViewport key={active.id} projectId={active.id} scene={detail.data.project.scene}/> : <div className="scene-message" role={detail.isError ? 'alert' : 'status'}>{detail.isError ? <><p>{errorText(detail.error)}</p><button className="button secondary" onClick={() => detail.refetch()}>重新打开</button></> : '正在读取空间…'}</div>}</div></div><div className="folio-shelf"><div className="folio-shelf-label"><span>你的空间项目</span><small>{items.length} 个项目 · 服务端保存</small></div><div className="folio-projects" role="group" aria-label="选择空间项目">{items.map(p => <button key={p.id} className={`folio-project ${active.id === p.id ? 'active' : ''}`} aria-pressed={active.id === p.id} onClick={() => selectProject(p.id)}><span>{p.name}</span><small>{p.synthetic ? '合成测试空间' : '空白空间项目'} · 版本 {p.revision}</small></button>)}</div><button className="folio-add" aria-label="新建项目" onClick={onCreate}><Icon name="plus" size={24}/></button></div><footer className="folio-footer"><span>项目保存于服务端 · 合成数据明确标注</span><span>你的空间工作室</span></footer></section>;
}

function CreateProject({ onClose, onCreated }: { onClose: () => void; onCreated: (p: ProjectView) => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const operation = useRef('');
  const [name, setName] = useState(''); const [template, setTemplate] = useState<'empty' | 'courtyard' | 'angled'>('empty');
  const mutation = useMutation({ mutationFn: () => { operation.current ||= crypto.randomUUID(); return api<{ project: ProjectView }>('/api/projects', { name: name.trim(), template, operationId: operation.current }); }, onSuccess: data => onCreated(data.project) });
  useEffect(() => { dialog.current?.showModal(); dialog.current?.querySelector<HTMLInputElement>('input[name="projectName"]')?.focus(); }, []);
  const edit = () => { operation.current = ''; mutation.reset(); };
  return <dialog ref={dialog} className="create-dialog" aria-labelledby="create-project-title" onCancel={e => { if (mutation.isPending) e.preventDefault(); else onClose(); }} onClose={onClose}><form onSubmit={e => { e.preventDefault(); mutation.mutate(); }}><button type="button" className="dialog-close icon-button" onClick={onClose} disabled={mutation.isPending} aria-label="关闭新建项目"><Icon name="close"/></button><h2 id="create-project-title">从一处空间开始</h2><p className="form-intro">给项目起一个名字，选择这次的起点。</p><label className="field">项目名称<input name="projectName" autoFocus maxLength={100} value={name} onChange={e => { setName(e.target.value); edit(); }} required placeholder="例如：我的理想小家" disabled={mutation.isPending}/></label><fieldset className="template-options" disabled={mutation.isPending}><legend>开始方式</legend>{([['empty','空白空间','从一个没有房间和家具的项目开始。'],['courtyard','方形合成空间','6 × 5 米测试房间，包含墙体与物品。'],['angled','凹形合成空间','包含斜墙与开口，查看更丰富的空间关系。']] as const).map(([value,title,description]) => <label key={value} className={template === value ? 'selected' : ''}><input type="radio" name="template" value={value} checked={template === value} onChange={() => { setTemplate(value); edit(); }}/><span><strong>{title}</strong><small>{description}</small></span></label>)}</fieldset><p className="form-note">合成空间使用测试数据，不是真实住宅或识图结果。</p>{mutation.isError && <p className="form-error" role="alert">{errorText(mutation.error)} 可再次点击创建重试。</p>}<button className="button primary create-submit" disabled={mutation.isPending || !name.trim()}>{mutation.isPending ? '正在创建并保存…' : '创建项目'}<Icon name="arrow"/></button></form></dialog>;
}

function ProjectWorkspace({ id, onBack }: { id: string; onBack: () => void }) {
  const query = useProject(id);
  const selected = useViewState(state => state.selected[id]);
  const [viewMode, setViewMode] = useState<'space' | 'drawing' | 'candidates' | 'tasks' | 'renders' | 'styles'>('space');
  useEffect(() => {
    const syncView = () => { const view = new URLSearchParams(location.search).get('view'); setViewMode(view === 'drawing' || view === 'candidates' || view === 'tasks' || view === 'renders' || view === 'styles' ? view : 'space'); };
    syncView(); window.addEventListener('popstate', syncView);
    return () => window.removeEventListener('popstate', syncView);
  }, [id]);
  const selectView = (mode: 'space' | 'drawing' | 'candidates' | 'tasks' | 'renders' | 'styles') => {
    setViewMode(mode);
    const url = new URL(location.href);
    mode !== 'space' ? url.searchParams.set('view', mode) : url.searchParams.delete('view');
    history.replaceState(null, '', url);
  };
  if (query.isPending) return <div className="page-status" role="status">正在打开已保存的空间…</div>;
  if (query.isError) return <div className="page-status"><h1>暂时无法打开这个项目</h1><p role="alert">{errorText(query.error)}</p><div className="button-row"><button className="button secondary" onClick={onBack}>返回项目</button><button className="button primary" onClick={() => query.refetch()}>重新打开</button></div></div>;
  const project = query.data.project;
  return <section className="workspace">
    <header className="workspace-header">
      <button className="text-button" onClick={onBack}><Icon name="back" size={17}/>我的项目</button>
      <h1>{project.name}</h1><span className="save-state"><Icon name="check" size={15}/>服务端版本 {project.revision}</span>
    </header>
    <div className={`workspace-body${viewMode !== 'space' ? ' workspace-body-drawing' : ''}`}>
      {viewMode === 'space' && <aside className="space-outline">
        <h2>空间</h2><p>{project.synthetic ? '合成测试空间' : '空间项目'}</p>
        <button className={!selected ? 'outline-item active' : 'outline-item'} onClick={() => useViewState.getState().select(id, null)}><Icon name="home" size={18}/>整层概览</button>
        {project.scene.rooms.map((room, index) => <button className={`outline-item ${selected === room.id ? 'active' : ''}`} key={room.id} onClick={() => useViewState.getState().select(id, room.id)}>房间 {index + 1}</button>)}
        {!!project.scene.objects.length && <><h3 className="object-list-title">家具与固定设施</h3><div className="object-list">
          {project.scene.objects.map(object => <button className={`outline-item ${selected === object.id ? 'active' : ''}`} key={object.id} onClick={() => { selectView('space'); useViewState.getState().select(id, object.id); }}>
            <span>{object.name || objectName(object.id)}</span>{(object.kind === 'fixed' || project.lockedObjectIds.includes(object.id)) && <small>{object.kind === 'fixed' ? '固定' : '已锁定'}</small>}
          </button>)}
        </div></>}
        <div className="outline-bottom">{project.synthetic ? '尺寸为合成测试输入，不作为实测依据。' : '图纸需确认尺度后，才能判断家具是否放得下。'}</div>
      </aside>}
      <div className="workspace-canvas">
        <div className="canvas-toolbar"><div className="view-tabs" role="group" aria-label="空间视图">
          <button aria-pressed={viewMode === 'space'} onClick={() => selectView('space')}>3D 空间</button>
          <button aria-pressed={viewMode === 'drawing'} onClick={() => selectView('drawing')}>图纸底图</button>
          <button aria-pressed={viewMode === 'candidates'} onClick={() => selectView('candidates')}>候选方案</button>
          <button aria-pressed={viewMode === 'styles'} onClick={() => selectView('styles')}>视觉风格</button>
          <button aria-pressed={viewMode === 'tasks'} onClick={() => selectView('tasks')}>空间对话</button>
        <button aria-pressed={viewMode === 'renders'} onClick={() => selectView('renders')}>静态成果</button>
        </div><span>{viewMode === 'space' ? '单位 m' : viewMode === 'drawing' ? '未配准底图' : viewMode === 'tasks' ? '问答与局部调整' : viewMode === 'styles' ? '外观独立保存' : viewMode === 'renders' ? '指定版本出图' : '预览后采用'}</span></div>
        {viewMode === 'space' ? <SceneViewport projectId={id} scene={project.scene}/> : viewMode === 'drawing' ? <DrawingPanel projectId={id}/> : viewMode === 'tasks' ? <ConversationPanel key={id} project={project} selectedObjectId={selected} onSelect={objectId=>useViewState.getState().select(id,objectId)} onOpenSpace={()=>selectView('space')} onOpenCandidate={candidateId=>{ const url = new URL(location.href); url.searchParams.set('candidate',candidateId); history.replaceState(null,'',url); selectView('candidates'); }}/> : viewMode === 'styles' ? <StylePanel project={project}/> : viewMode === 'renders' ? <RenderPanel project={project}/> : <CandidatePanel project={project}/>}
      </div>
      {viewMode === 'space' && <aside className="space-details"><FurnitureInspector project={project} objectId={selected}/></aside>}
    </div>
  </section>;
}
