'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type ProjectView } from './api';
import type { CandidateList } from '../../../packages/contracts/src/candidates';
import type { CreateRender, RenderView } from '../../../packages/contracts/src/renders';
import './render-panel.css';

const names: Record<RenderView['status'], string> = { queued: '等待生成', running: '正在生成', retry_wait: '等待重试', completed: '已生成', failed: '生成未完成' };
const active = (value: RenderView) => !['completed', 'failed'].includes(value.status);
const sourceName = (value: RenderView) => `${value.source.kind === 'current' ? '当前方案' : '候选方案'} · 版本 ${value.source.revision}`;
const readable = (error: unknown) => error instanceof Error ? error.message : '请求未完成，请重试。';
const time = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));

export function RenderPanel({ project }: { project: ProjectView }) {
  const client = useQueryClient(), attempt = useRef<CreateRender | null>(null);
  const [source, setSource] = useState('current'), [selected, setSelected] = useState<string | null>(null);
  const listKey = ['renders', project.id];
  const list = useQuery({ queryKey: listKey, queryFn: () => api<{ renders: RenderView[] }>(`/api/projects/${project.id}/renders`), refetchInterval: query => query.state.data?.renders.some(active) ? 2500 : false });
  const candidates = useQuery({ queryKey: ['candidates', project.id], queryFn: () => api<CandidateList>(`/api/projects/${project.id}/candidates`) });
  const renderId = selected || list.data?.renders[0]?.id;
  const detail = useQuery({ queryKey: ['render', project.id, renderId], queryFn: () => api<{ render: RenderView }>(`/api/projects/${project.id}/renders/${renderId}`), enabled: !!renderId, refetchInterval: query => query.state.data && active(query.state.data.render) ? 1500 : false });
  const render = detail.data?.render;
  useEffect(() => { setSelected(new URLSearchParams(location.search).get('render')); setSource('current'); attempt.current = null; }, [project.id]);
  const choose = (id: string) => { setSelected(id); const url = new URL(location.href); url.searchParams.set('render', id); history.replaceState(null, '', url); };
  const create = useMutation({ mutationFn: () => {
    if (!attempt.current) {
      const candidate = candidates.data?.candidates.find(item => item.id === source);
      if (source !== 'current' && !candidate) throw new Error('请重新选择要生成的方案。');
      attempt.current = { operationId: crypto.randomUUID(), source: candidate ? { kind: 'candidate', candidateId: candidate.id, revision: candidate.revision } : { kind: 'current', revision: project.revision } };
    }
    return api<{ render: RenderView }>(`/api/projects/${project.id}/renders`, attempt.current);
  }, onSuccess: ({ render: result }) => {
    attempt.current = null; choose(result.id); client.setQueryData(['render', project.id, result.id], { render: result });
    client.setQueryData<{ renders: RenderView[] }>(listKey, value => ({ renders: [result, ...(value?.renders || []).filter(item => item.id !== result.id)] }));
  }, onError: error => { if (!(error instanceof ApiError) || error.status !== 0) attempt.current = null; } });
  const uncertain = create.isError && !!attempt.current;
  const refresh = () => { void list.refetch(); void candidates.refetch(); void client.invalidateQueries({ queryKey: ['project', project.id] }); if (renderId) void detail.refetch(); };
  const selectedCandidate = candidates.data?.candidates.find(item => item.id === source);
  return <section className={`render-panel${render ? ' has-render' : ''}`} aria-labelledby="render-heading">
    <header className="render-heading"><div><h2 id="render-heading">把这一版空间留下来</h2><p>生成指定版本的静态图。离开页面后，回来继续领取。</p></div><button className="text-button" onClick={refresh}>刷新成果</button></header>
    <div className="render-layout"><div className="render-compose"><h3>选择出图版本</h3>
      <label className="field">方案来源<select value={source} disabled={create.isPending || uncertain} onChange={event => { setSource(event.target.value); create.reset(); }}>
        <option value="current">当前方案 · 版本 {project.revision}</option>{candidates.data?.candidates.map(item => <option key={item.id} value={item.id}>{item.name} · 候选版本 {item.revision}{item.stale ? ' · 基于旧版空间' : ''}</option>)}
      </select></label>
      {candidates.isError && <p className="render-error" role="alert">候选列表读取失败：{readable(candidates.error)}<button className="text-button" onClick={() => candidates.refetch()}>重新读取候选</button></p>}
      <p className="render-note">{source === 'current' ? '保留这次提交时的方案。之后继续编辑，不会改变已生成的图片。' : '只为这版候选出图，不会采用或替换当前方案。'}</p>
      {selectedCandidate?.stale && <p className="render-note">这版候选基于旧版空间，成果会保留原版本信息。</p>}
      {project.synthetic && <p className="render-note">此项目是合成测试空间，图片中也会明确标注。</p>}
      <button className="button primary render-create" disabled={create.isPending || (source !== 'current' && !selectedCandidate && !uncertain)} onClick={() => create.mutate()}>{create.isPending ? '正在提交…' : uncertain ? '重试同一次生成' : '生成静态图'}</button>
      {create.isError && <p className="render-error" role="alert">{readable(create.error)}{uncertain && <span>重试会继续确认同一条生成请求。</span>}</p>}
      <p className="render-note">未校准的空间以概念图呈现，不能用来判断家具能否放下。</p>
    </div><div className="render-results">
      <div className="render-results-heading"><h3>已保存的成果</h3><span>{list.data?.renders.length ? `最近 ${list.data.renders.length} 项` : ''}</span></div>
      {list.isPending && <p className="render-note" role="status">正在读取成果…</p>}
      {list.isError && <p className="render-error" role="alert">成果列表读取失败：{readable(list.error)}</p>}
      {!!list.data?.renders.length && <div className="render-history" aria-label="成果历史">{list.data.renders.map(item => <button key={item.id} aria-pressed={renderId === item.id} onClick={() => choose(item.id)}><strong>{sourceName(item)}</strong><span>{names[item.status]}</span><time dateTime={item.createdAt}>{time(item.createdAt)}</time></button>)}</div>}
      {!renderId && !list.isPending && !list.isError && <div className="render-empty"><h4>第一张空间图，从这里开始。</h4><p>选好当前方案或候选版本，生成后可以在这里查看和下载。</p></div>}
      {renderId && detail.isPending && <p className="render-note" role="status">正在打开这份成果…</p>}
      {detail.isError && <p className="render-error" role="alert">这份成果暂时无法打开：{readable(detail.error)}<button className="text-button" onClick={() => detail.refetch()}>重新打开成果</button></p>}
      {render && <article className="render-detail"><div className="render-state"><h4>{names[render.status]}</h4>{render.status === 'completed' && render.downloadHref && <a className="button secondary" href={render.downloadHref} download>下载图片</a>}</div>
        <p className="render-source">{render.label}</p>
        {render.stale && <p className="render-version-note">来源方案已有更新。这张图保留的是提交时的版本。</p>}
        {render.source.kind === 'candidate' && <p className="render-note">候选成果，出图不代表已采用。</p>}
        {render.concept && <p className="render-version-note">概念图 · 尺寸未校准</p>}
        {active(render) && <div className="render-wait" role="status"><p>{render.status === 'queued' ? '请求已保存，等待后台开始生成。' : render.status === 'retry_wait' ? '本次生成暂时中断，正在等待后台重试。' : '正在根据保存的空间版本生成图片。'}</p><p>可以关闭页面，任务会继续；重开后查看同一份成果。</p></div>}
        {render.error && <p className="render-error" role="alert">{render.error.message}</p>}
        {render.status === 'completed' && render.contentHref && <RenderImage key={render.id} render={render}/>}
      </article>}
    </div></div>
  </section>;
}

function RenderImage({ render }: { render: RenderView }) {
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  return <figure className="render-image">{failed ? <div className="render-wait"><p role="alert">图片暂时未能加载。</p><button className="button secondary" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>重新加载图片</button></div> : <img src={`${render.contentHref}?attempt=${attempt}`} width={render.width || 1280} height={render.height || 900} alt={`${render.label}，${sourceName(render)}${render.concept ? '，未校准概念图' : ''}`} onError={() => setFailed(true)}/>}<figcaption>{render.synthetic ? '合成测试空间 · 尺寸为测试输入' : render.concept ? '概念图 · 尺寸未校准' : '按已保存空间版本生成'} · {render.width} × {render.height} px</figcaption></figure>;
}
