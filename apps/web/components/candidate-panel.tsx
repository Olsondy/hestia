'use client';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CandidateList, CandidateView, CandidateCheck, CandidateCheckItem, CandidatePresentation, CandidateSelection, AdoptionResult } from '../../../packages/contracts/src/candidates';
import { api, type ProjectView } from './api';
import { SceneViewport } from './scene-viewport';
import { objectName } from './furniture-inspector';
import { Icon } from './icons';
import { CandidateCatalog, CandidateObjectChanges } from './candidate-catalog';
import { StyleControls, StyleChanges, changeKindLabel } from './style-controls';
import type { VisualStyle } from '../../../packages/contracts/src/styles';
import { LayoutPlanReport } from './layout-plan-report';
import type { TaskView } from '../../../packages/contracts/src/tasks';
import './candidate-panel.css';

const angle = (yaw: number) => (yaw % (Math.PI * 2) * 180 / Math.PI).toFixed(2);
const inputYaw = (yaw: number) => Math.abs(yaw) <= Math.PI * 2 ? yaw : yaw % (Math.PI * 2);
function summarizeChecks(checks: CandidateCheckItem[]) {
  const priority = { failed: 3, 'not-checked': 2, passed: 1, 'not-applicable': 0 };
  const summary = new Map<string, CandidateCheckItem>();
  for (const item of checks) {
    const prior = summary.get(item.code);
    if (!prior || priority[item.status] > priority[prior.status]) summary.set(item.code, item);
  }
  return [...summary.values()];
}
const checkNames: Record<string, string> = { 'planner-room': '房间范围', 'ergonomics-accessibility-certification': '人体工学与无障碍专业核验', 'planner-functional-assets': '会客与办公家具', 'planner-retained-objects': '保留已有家具', 'planner-preserved-poses': '保留要求与锁定位置', 'planner-workstation': '办公座位与使用位置', 'planner-entry-functional-route-0.7m': '入口与功能区域通路', boundary: '空间边界', objects: '家具与固定设施', walls: '墙体与开口', 'door-clearances': '门扇区域', scale: '尺寸依据', input: '输入数据', 'fixed-facts': '固定事实', locks: '锁定物品', 'scope-and-locks': '修改范围与锁定', 'visual-style': '视觉风格引用', 'change-set': '摆放、组合与风格变化', 'furniture-geometry': '家具摆放', 'geometry-completed': '几何检查完整性', 'human-use-clearance': '日常使用净空', 'transport-path': '搬运路径', 'structural-safety': '结构安全' };

export function CandidatePanel({ project }: { project: ProjectView }) {
  const client = useQueryClient(), base = `/api/projects/${project.id}`;
  const [selected, setSelected] = useState(() => typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('candidate') || ''), [name, setName] = useState('方案探索');
  const [showCurrent, setShowCurrent] = useState(false), [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [positionDirty, setPositionDirty] = useState(false), [catalogDirty, setCatalogDirty] = useState(false);
  const [styleDirty, setStyleDirty] = useState(false), [stylePreview, setStylePreview] = useState<VisualStyle | null>(null);
  const draftDirty = positionDirty || catalogDirty || styleDirty;
  const attempts = useRef(new Map<string, string>());
  const list = useQuery({ queryKey: ['candidates', project.id], queryFn: () => api<CandidateList>(`${base}/candidates`) });
  const detail = useQuery({ queryKey: ['candidate', project.id, selected], queryFn: () => api<{ candidate: CandidateView }>(`${base}/candidates/${selected}`), enabled: !!selected });
  const candidate = detail.data?.candidate;
  const taskId = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('task');
  const taskDetail = useQuery({ queryKey: ['task', project.id, taskId], queryFn: () => api<{ task: TaskView }>(`${base}/tasks/${taskId}`), enabled: !!taskId });
  const tasks = useQuery({ queryKey: ['tasks', project.id], queryFn: () => api<{ tasks: TaskView[] }>(`${base}/tasks`) });
  const recommendation = [taskDetail.data?.task, ...(tasks.data?.tasks || [])].flatMap(task => task?.conversation ? [task.conversation.outcome, ...(task.conversation.brief?.history.map(turn => turn.outcome) || [])].flatMap(outcome => outcome?.candidateId === candidate?.id && outcome?.planReport ? [{ task, outcome }] : []) : []).find(item => item.outcome.candidateRevision === candidate?.revision);
  const [showEdits, setShowEdits] = useState(false);
  useEffect(() => { setShowEdits(false); }, [selected]);
  const showTools = !recommendation || showEdits;
  const post = <T,>(path: string, data: Record<string, unknown>) => {
    const signature = JSON.stringify({ path, data });
    if (!attempts.current.has(signature)) attempts.current.set(signature, crypto.randomUUID());
    return api<T>(path, { ...data, operationId: attempts.current.get(signature) });
  };
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['candidates', project.id] });
    client.invalidateQueries({ queryKey: ['candidate', project.id] });
  };
  const syncProject = (updated: ProjectView) => {
    client.setQueryData(['project', project.id], { project: updated });
    client.invalidateQueries({ queryKey: ['projects'] });
    client.invalidateQueries({ queryKey: ['operations', project.id] });
    client.invalidateQueries({ queryKey: ['styles', project.id] });
    client.invalidateQueries({ queryKey: ['tasks', project.id] });
    client.invalidateQueries({ queryKey: ['task', project.id] });
    refresh();
  };
  const create = useMutation({ mutationFn: () => post<{ candidate: CandidateView }>(`${base}/candidates`, { name: name.trim(), expectedRevision: project.revision }),
    onSuccess: data => { attempts.current.clear(); setSelected(data.candidate.id); setShowCurrent(false); client.setQueryData(['candidate', project.id, data.candidate.id], data); refresh(); setNotice('已复制为独立候选，当前方案保持不变。'); } });
  const check = useMutation({ mutationFn: () => post<{ check: CandidateCheck }>(`${base}/candidates/${selected}/checks`, { expectedCandidateRevision: candidate!.revision }),
    onSuccess: () => { attempts.current.clear(); refresh(); setNotice('检查已完成，请查看本版结果。'); } });
  const adopt = useMutation({ mutationFn: async () => {
    if (!candidate?.check?.adoptable || showCurrent || !ready) throw new Error('请先查看已通过检查的候选。');
    const prefix = `${base}/candidates/${candidate.id}`;
    // Each retry reuses the complete selection chain, including after a committed response is lost.
    const presented = await post<{ presentation: CandidatePresentation }>(`${prefix}/presentations`, {
      expectedCandidateRevision: candidate.revision, expectedRevision: project.revision, checkId: candidate.check.id,
    });
    const chosen = await post<{ selection: CandidateSelection }>(`${prefix}/selections`, { presentationId: presented.presentation.id });
    return post<AdoptionResult>(`${prefix}/adopt`, { expectedRevision: project.revision, selectionId: chosen.selection.id });
  }, onSuccess: result => { attempts.current.clear(); syncProject(result.project); setNotice('这版方案已采用并保存，可整体撤销。'); } });
  const undo = useMutation({ mutationFn: () => post<AdoptionResult>(`${base}/adoptions/${list.data!.undoableAdoption!.operationId}/undo`, { expectedRevision: project.revision }),
    onSuccess: result => { attempts.current.clear(); syncProject(result.project); setNotice('已整体撤销采用，恢复为新的当前方案版本。'); } });
  useEffect(() => { setShowCurrent(false); setNotice(''); setReady(false); check.reset(); adopt.reset(); }, [selected]); // selection owns its feedback
  const busy = editing || create.isPending || check.isPending || adopt.isPending || undo.isPending;
  const failure = create.error || check.error || adopt.error || undo.error;
  const stale = !!candidate && (candidate.stale || candidate.baseRevision !== project.revision);
  const editable = !!candidate && candidate.status !== 'adopted' && !stale;
  const canAdopt = editable && ready && !draftDirty && !showCurrent && candidate.check?.adoptable && candidate.check.candidateRevision === candidate.revision && !detail.isFetching;
  const previewScene = useMemo(() => showCurrent || !candidate ? project.scene : stylePreview ? { ...candidate.scene, visualStyle: stylePreview } : candidate.scene, [showCurrent, candidate, project.scene, stylePreview]);
  return <section className="candidate-panel" aria-label="候选方案比较">
    <header className="candidate-heading"><div><h2>先看见变化，再作决定。</h2><p>候选单独保存；预览与调整不会替换当前方案。</p></div>
      {list.data?.undoableAdoption && <button className="button secondary" disabled={busy} onClick={() => undo.mutate()}>整体撤销上次采用</button>}
    </header>
    {failure && <div className="candidate-feedback" role="alert"><p>{failure.message}</p><button className="text-button" onClick={() => { refresh(); client.invalidateQueries({ queryKey: ['project', project.id] }); }}>读取最新版本</button></div>}
    {notice && !failure && <p className="candidate-notice" role="status">{notice}</p>}
    <div className="candidate-layout">
      <aside className="candidate-controls">
        <form className="candidate-create" onSubmit={event => { event.preventDefault(); create.mutate(); }}><label className="field">新候选名称<input maxLength={120} required value={name} onChange={event => { setName(event.target.value); create.reset(); }}/></label><button className="button secondary" disabled={busy || !name.trim()}><Icon name="plus" size={16}/>从当前方案创建</button></form>
        <nav className="candidate-list" aria-label="已保存候选">
          {list.isPending && <p role="status">正在读取候选…</p>}
          {list.isError && <><p role="alert">候选暂时无法读取。</p><button className="text-button" onClick={() => list.refetch()}>重新读取</button></>}
          {list.data?.candidates.length === 0 && <p>还没有候选。先复制当前方案，再探索摆放、组合或视觉风格。</p>}
          {list.data?.candidates.map(item => <button key={item.id} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); const url = new URL(location.href); url.searchParams.set('candidate', item.id); history.replaceState(null, '', url); }} disabled={busy}><strong>{item.name}</strong><small>{changeKindLabel(item.changeKind)} · 候选版本 {item.revision} · {item.status === 'adopted' ? '已采用记录' : item.stale ? '基础已变化' : item.changeKind === 'style' ? '外观变化' : `${item.changedObjectIds.length} 件变化`}</small></button>)}
        </nav>
        {candidate && showTools && <><h3>调整候选</h3>{candidate.status === 'adopted' ? <p>这版曾被采用，作为记录保留。新的探索请从当前方案创建。</p> : stale ? <p>当前方案已更新。这份候选保留作参考，请从最新方案创建候选。</p> : <CandidatePosition key={`${candidate.id}:${candidate.revision}`} candidate={candidate} busy={busy || catalogDirty || styleDirty} post={post} onBusy={setEditing} onDraftChange={setPositionDirty} onSaved={value => { client.setQueryData(['candidate', project.id, selected], value); attempts.current.clear(); refresh(); check.reset(); adopt.reset(); setNotice('候选已保存，采用前需要重新检查。'); }}/>}</>}
      </aside>
      <div className="candidate-preview">
        <div className="candidate-preview-toolbar"><div className="view-tabs" role="group" aria-label="比较视图"><button aria-pressed={showCurrent || !candidate} onClick={() => setShowCurrent(true)}>当前方案</button><button disabled={!candidate} aria-pressed={!!candidate && !showCurrent} onClick={() => setShowCurrent(false)}>候选预览</button></div><span>{showCurrent || !candidate ? `当前版本 ${project.revision}` : `候选版本 ${candidate.revision} · ${candidate.status === 'adopted' ? '已采用记录' : '未采用'}`}</span></div>
        {candidate && (candidate.scale === 'missing' || candidate.scale === 'estimated') && <p className="candidate-scale-note">尺寸尚未可靠确认，只能作概念参考，不能据此判断家具放得下。</p>}{detail.isError && <p className="candidate-feedback" role="alert">这份候选暂时无法读取。<button className="text-button" onClick={() => detail.refetch()}>重试</button></p>}
        {stale && candidate?.status !== 'adopted' && <p className="candidate-scale-note" role="status">空间或需求已更新。这份历史候选仅供参考，原推荐与检查不能沿用于当前要求；请回到空间对话重新生成。</p>}
        {recommendation && <div className="candidate-recommendation"><p className="candidate-reference">{stale && candidate?.status !== 'adopted' ? '历史生成记录' : '本次生成的候选'} · 版本 {recommendation.outcome.candidateRevision} · {candidate?.synthetic ? '合成测试空间' : '已校准空间'} · {candidate?.status === 'adopted' ? '已采用记录' : '尚未采用'}</p><LayoutPlanReport report={recommendation.outcome.planReport!} brief={recommendation.task.conversation?.brief} historical={stale || candidate?.status === 'adopted'}/></div>}
        <div className="candidate-scene"><SceneViewport projectId={`${project.id}:compare`} scene={previewScene} onReadyChange={setReady} initialView="overhead"/></div>
        {recommendation && editable && <div className="candidate-edit-toggle"><button className="text-button" aria-expanded={showEdits} onClick={() => setShowEdits(value => !value)}>{showEdits ? '收起候选调整' : '自行调整这份候选'}</button><span>调整后，原推荐依据不再代表新版本，需要重新检查。</span></div>}
        {editable && candidate && showTools && <CandidateCatalog key={`${candidate.id}:${candidate.revision}`} candidate={candidate} busy={busy || positionDirty || styleDirty} post={post} onBusy={setEditing} onDraftChange={setCatalogDirty} onSaved={value => { client.setQueryData(['candidate', project.id, selected], value); attempts.current.clear(); refresh(); check.reset(); adopt.reset(); setNotice('家具组合已保存到候选，采用前需要重新检查。'); }}/>}
        {editable && candidate && showTools && <StyleControls key={`style:${candidate.id}:${candidate.revision}`} scene={candidate.scene} lockedObjectIds={candidate.lockedObjectIds} busy={busy || positionDirty || catalogDirty} scope="candidate" onBusy={setEditing} onDirty={setStyleDirty} onPreview={setStylePreview} save={command => post<{ candidate: CandidateView }>(`${base}/candidates/${candidate.id}/commands`, { expectedCandidateRevision: candidate.revision, command })} onSaved={value => { client.setQueryData(['candidate', project.id, selected], value); attempts.current.clear(); refresh(); check.reset(); adopt.reset(); setNotice('视觉风格已保存到候选，当前方案保持不变。'); }}/>}
        {candidate && <div className="candidate-assessment"><section><h3>与创建时方案的差异</h3><p className="candidate-reference">基础版本 {candidate.baseRevision} · 固定事实版本 {candidate.fixedFactsRevision}{candidate.synthetic ? ' · 合成测试空间' : ''}</p>
          <p className="candidate-reference">{changeKindLabel(candidate.changeKind)}{candidate.changeKind === 'style' ? ' · 仅改变外观，不会新建布局。' : candidate.changeKind === 'mixed' ? ' · 包含家具布局与外观变化。' : ''}</p>
          {!!candidate.objectChanges.length && <CandidateObjectChanges candidate={candidate}/>}<StyleChanges changes={candidate.styleChanges} scene={candidate.scene}/>{candidate.changeKind === 'none' && <p>与创建时相比尚无变化。</p>}
        </section><section className="candidate-check"><h3>采用前检查</h3>
          {candidate.check && candidate.check.candidateRevision === candidate.revision ? <><p>{stale && candidate.status !== 'adopted' ? '以下为历史检查记录，不能据此采用到当前空间。' : candidate.check.adoptable ? '本版必要检查已通过。' : '这版暂时不能采用。'}</p><ul className="candidate-check-items">{summarizeChecks(candidate.check.checks).map(item => <li key={`${item.code}:${item.status}`}><span>{checkNames[item.code] || item.code}</span><span>{({ passed: '通过', failed: '未通过', 'not-applicable': '不适用', 'not-checked': '未检查' })[item.status]}</span></li>)}</ul>{candidate.check.issues.length > 0 && <ul className="candidate-issues">{candidate.check.issues.map((item, index) => <li key={index}>{item.objectId ? `${candidate.scene.objects.find(object => object.id === item.objectId)?.name || objectName(item.objectId)}：` : ''}{item.message}</li>)}</ul>}</> : <p>内容变化后需要重新检查，旧检查不会继续生效。</p>}
          {draftDirty && <p className="candidate-reference">有未保存的候选调整，请先保存或还原。</p>}<div className="candidate-actions"><button className="button secondary" disabled={!editable || busy || draftDirty || detail.isFetching} onClick={() => check.mutate()}>{check.isPending ? '正在检查…' : '检查这版方案'}</button><button className="button primary" disabled={!canAdopt || busy} onClick={() => adopt.mutate()}>{adopt.isPending ? '正在采用…' : candidate?.changeKind === 'style' ? '采用这版风格' : '采用这版方案'}</button></div>
          <p className="candidate-reference">{candidate.changeKind === 'style' ? '采用仅更新视觉风格，保留家具摆放与尺寸。' : '采用将整体更新当前方案。'}后续修改发生前，可以整体撤销。</p>
        </section></div>}
      </div>
    </div>
  </section>;
}

function CandidatePosition({ candidate, busy, post, onBusy, onDraftChange, onSaved }: { candidate: CandidateView; busy: boolean; onBusy: (value: boolean) => void; onDraftChange: (value: boolean) => void; post: <T>(path: string, data: Record<string, unknown>) => Promise<T>; onSaved: (value: { candidate: CandidateView }) => void }) {
  const objects = candidate.scene.objects.filter(item => item.kind === 'furniture');
  const [objectId, setObjectId] = useState(objects[0]?.id || '');
  const object = objects.find(item => item.id === objectId);
  const [x, setX] = useState(''), [z, setZ] = useState(''), [yaw, setYaw] = useState('');
  useEffect(() => { setX(String(object?.position.x ?? '')); setZ(String(object?.position.z ?? '')); setYaw(object ? angle(object.yaw) : ''); }, [object]);
  const dirty = !!object && ([x, z, yaw].some(value => value.trim() === '' || !Number.isFinite(Number(value))) || Number(x) !== object.position.x || Number(z) !== object.position.z || yaw !== angle(object.yaw));
  useEffect(() => { onDraftChange(dirty); return () => onDraftChange(false); }, [dirty, onDraftChange]);
  const mutation = useMutation({ mutationFn: () => post<{ candidate: CandidateView }>(`/api/projects/${candidate.projectId}/candidates/${candidate.id}/commands`, { expectedCandidateRevision: candidate.revision, command: { type: 'move-furniture', objectId, x: Number(x), z: Number(z), yaw: object && yaw === angle(object.yaw) ? inputYaw(object.yaw) : Number(yaw) * Math.PI / 180 } }), onMutate: () => onBusy(true), onSettled: () => onBusy(false), onSuccess: onSaved });
  const submit = (event: FormEvent) => { event.preventDefault(); mutation.mutate(); };
  if (!objects.length) return <p>当前候选没有家具，可在「探索家具组合」中从目录添加。</p>;
  return <form className="candidate-position" onSubmit={submit}><label className="field">候选中的家具<select aria-label="候选中的家具" value={objectId} onChange={event => { setObjectId(event.target.value); mutation.reset(); }} disabled={busy || mutation.isPending}>{objects.map(item => <option key={item.id} value={item.id}>{item.name || objectName(item.id)} · {item.id}</option>)}</select></label>
    <fieldset disabled={busy || mutation.isPending || candidate.lockedObjectIds.includes(objectId)}><div className="candidate-coordinates"><label className="field">X 位置（米）<input type="number" step="0.001" min="-1000" max="1000" required value={x} onChange={event => setX(event.target.value)}/></label><label className="field">Z 位置（米）<input type="number" step="0.001" min="-1000" max="1000" required value={z} onChange={event => setZ(event.target.value)}/></label></div><label className="field">旋转角度（度）<input type="number" step="0.01" min="-360" max="360" required value={yaw} onChange={event => setYaw(event.target.value)}/></label><button className="button secondary">{mutation.isPending ? '正在保存…' : '保存候选调整'}</button></fieldset>
    {dirty && <button className="text-button" type="button" disabled={busy || mutation.isPending} onClick={() => { if (object) { setX(String(object.position.x)); setZ(String(object.position.z)); setYaw(angle(object.yaw)); mutation.reset(); } }}>还原未保存调整</button>}
    {candidate.lockedObjectIds.includes(objectId) && <p>这件家具已锁定，候选不能绕过锁定。</p>}{mutation.isError && <p className="candidate-feedback" role="alert">{mutation.error.message}</p>}
  </form>;
}
