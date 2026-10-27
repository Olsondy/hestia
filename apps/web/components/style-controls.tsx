'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { defaultVisualStyle, type VisualStyle, type StyleCommand, type StyleCatalog, type StyleState, type StyleResult, type StyleChange } from '../../../packages/contracts/src/styles';
import type { SceneSnapshot } from '../../../packages/contracts/src/scene';
import { api, type ProjectView } from './api';
import { objectName } from './furniture-inspector';
import { SceneViewport } from './scene-viewport';
import './style-controls.css';

const useStyleCatalog = () => useQuery({ queryKey: ['style-catalog'], queryFn: () => api<StyleCatalog>('/api/styles/catalog') });
export const changeKindLabel = (kind: string) => ({ none: '尚无变化', layout: '布局方案', style: '视觉风格', mixed: '布局与风格' })[kind] || '候选';

function applyPreview(style: VisualStyle, command: StyleCommand | null): VisualStyle {
  if (!command) return style;
  if (command.type === 'set-display-lighting') return { ...style, lighting: { presetId: command.presetId, presetVersion: command.presetVersion } };
  const materials = style.materials.filter(item => item.objectId !== command.objectId);
  if (command.type === 'set-material') materials.push({ objectId: command.objectId, materialId: command.materialId, materialVersion: command.materialVersion });
  return { ...style, materials };
}

export function StyleControls({ scene, lockedObjectIds, busy, scope, save, onBusy, onDirty, onPreview, onSaved }: {
  scene: SceneSnapshot; lockedObjectIds: string[]; busy: boolean; scope: 'current' | 'candidate';
  save: (command: StyleCommand) => Promise<unknown>; onBusy: (value: boolean) => void;
  onDirty: (value: boolean) => void; onPreview: (value: VisualStyle | null) => void; onSaved: (value: unknown) => void;
}) {
  const catalog = useStyleCatalog();
  const style = useMemo(() => scene.visualStyle ?? defaultVisualStyle(), [scene]);
  const objects = scene.objects.filter(item => item.kind === 'furniture' && !lockedObjectIds.includes(item.id));
  const [mode, setMode] = useState<'material' | 'lighting'>('material');
  const [objectId, setObjectId] = useState(objects[0]?.id || '');
  const [materialId, setMaterialId] = useState(style.materials.find(item => item.objectId === objects[0]?.id)?.materialId || 'original');
  const [lightingId, setLightingId] = useState(style.lighting.presetId);
  const object = objects.find(item => item.id === objectId);
  const material = catalog.data?.materials.find(item => item.id === materialId);
  const lighting = catalog.data?.lighting.find(item => item.id === lightingId);
  const command = useMemo<StyleCommand | null>(() => {
    if (mode === 'lighting') return lighting && lighting.id !== style.lighting.presetId ? { type: 'set-display-lighting', presetId: lighting.id, presetVersion: lighting.version } : null;
    if (!object) return null;
    const saved = style.materials.find(item => item.objectId === objectId);
    if (materialId === 'original') return saved ? { type: 'reset-material', objectId } : null;
    return material && (saved?.materialId !== material.id || saved?.materialVersion !== material.version) ? { type: 'set-material', objectId, materialId: material.id, materialVersion: material.version } : null;
  }, [mode, lighting, style, object, objectId, materialId, material]);
  useEffect(() => { onDirty(!!command); onPreview(command ? applyPreview(style, command) : null); return () => { onDirty(false); onPreview(null); }; }, [command, style, onDirty, onPreview]);
  const mutation = useMutation({ mutationFn: () => save(command!), onMutate: () => onBusy(true), onSettled: () => onBusy(false), onSuccess: onSaved });
  const reset = () => { setMaterialId(style.materials.find(item => item.objectId === objectId)?.materialId || 'original'); setLightingId(style.lighting.presetId); mutation.reset(); };
  return <section className="style-controls" aria-label={scope === 'current' ? '当前空间风格设置' : '候选风格设置'}>
    <header><h3>{scope === 'current' ? '材质与光，改变空间的表情。' : '探索视觉风格'}</h3><p>{scope === 'current' ? '先预览，再应用到当前空间。家具位置与尺寸保持不变。' : '风格只保存到这份候选；单独换色或灯光不会成为新布局。'}</p></header>
    {catalog.isPending ? <p role="status">正在读取风格目录…</p> : catalog.isError ? <div role="alert"><p>风格目录暂时无法读取。</p><button className="text-button" onClick={() => catalog.refetch()}>重新读取风格目录</button></div> : <form onSubmit={event => { event.preventDefault(); if (command) mutation.mutate(); }}>
      <fieldset disabled={busy || mutation.isPending} aria-label="风格调整内容">
        <div className="style-modes" role="group" aria-label="风格调整内容"><button type="button" aria-pressed={mode === 'material'} onClick={() => { reset(); setMode('material'); }}>家具材质</button><button type="button" aria-pressed={mode === 'lighting'} onClick={() => { reset(); setMode('lighting'); }}>展示灯光</button></div>
        {mode === 'material' ? <div className="style-fields"><label className="field">风格家具<select aria-label="风格家具" value={objectId} onChange={event => { setObjectId(event.target.value); setMaterialId(style.materials.find(item => item.objectId === event.target.value)?.materialId || 'original'); mutation.reset(); }}>{!objects.length && <option value="">没有可调整的家具</option>}{objects.map(item => <option value={item.id} key={item.id}>{item.name || objectName(item.id)}</option>)}</select></label>
          <label className="field">展示材质<select aria-label="展示材质" value={materialId} disabled={!object} onChange={event => { setMaterialId(event.target.value); mutation.reset(); }}><option value="original">沿用家具原材质</option>{catalog.data?.materials.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          {material && <p className="style-swatch"><span style={{ backgroundColor: material.swatch }} aria-hidden="true"/>{material.name} · 目录版本 {material.version}</p>}
          {object && <p className="style-note">{object.catalog ? '目录家具按自身部件显示这组材质。' : '这件物品为简化模型，仅用代理色展示材质方向。'}{object.dimensionSource === 'measured' && ' 已测尺寸保持不变。'}</p>}
          {!objects.length && <p className="style-note">当前没有可调整的家具。固定设施与已锁定物品的材质保持不变；仍可查看全场展示灯光。</p>}
        </div> : <div className="style-fields"><label className="field">全场展示灯光<select aria-label="全场展示灯光" value={lightingId} onChange={event => { setLightingId(event.target.value); mutation.reset(); }}>{catalog.data?.lighting.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><p className="style-note">{lighting?.description}</p><p className="style-note">影响整场明暗与色温观感；不改变任何物品材质，不代表真实日照、照度或电路设计。</p></div>}
        <div className="style-actions"><button className="button primary" disabled={!command}>{mutation.isPending ? '正在保存…' : scope === 'current' ? '应用当前风格' : '保存候选风格'}</button>{command && <button className="text-button" type="button" onClick={reset}>还原风格预览</button>}</div>
      </fieldset>
      {command && <p className="style-preview-note" role="status">风格预览尚未确认保存。{scope === 'candidate' ? '请保存或还原后再检查与采用。' : '应用后会保存到项目，可撤销本次修改。'}</p>}
      {mutation.isError && <p className="style-error" role="alert">{mutation.error.message} 可重试保存，或读取最新版本后继续。</p>}
    </form>}
    <p className="style-boundary">内置材质为视觉示意，不对应真实商品；固定设施、锁定家具不能单独改材质。</p>
  </section>;
}

export function StylePanel({ project }: { project: ProjectView }) {
  const client = useQueryClient(), base = `/api/projects/${project.id}`;
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [preview, setPreview] = useState<VisualStyle | null>(null), [notice, setNotice] = useState('');
  const attempts = useRef(new Map<string, string>());
  const state = useQuery({ queryKey: ['styles', project.id, project.revision], queryFn: () => api<StyleState>(`${base}/styles`) });
  const post = (path: string, data: Record<string, unknown>) => { const key = JSON.stringify({ path, data }); if (!attempts.current.has(key)) attempts.current.set(key, crypto.randomUUID()); return api<StyleResult>(path, { ...data, operationId: attempts.current.get(key) }); };
  const sync = (value: unknown) => { const result = value as StyleResult; attempts.current.clear(); client.setQueryData(['project', project.id], { project: result.project }); client.invalidateQueries({ queryKey: ['styles', project.id] }); client.invalidateQueries({ queryKey: ['projects'] }); client.invalidateQueries({ queryKey: ['operations', project.id] }); client.invalidateQueries({ queryKey: ['candidates', project.id] }); setNotice('风格已应用并保存；家具摆放与尺寸保持不变。'); };
  const undo = useMutation({ mutationFn: () => post(`${base}/styles/commands/${state.data!.undoableCommand!.operationId}/undo`, { expectedRevision: project.revision }), onSuccess: result => { sync(result); setNotice('已撤销上次风格修改。'); } });
  const scene = useMemo(() => preview ? { ...project.scene, visualStyle: preview } : project.scene, [project.scene, preview]);
  return <section className="style-panel" aria-label="当前空间视觉风格"><header className="style-panel-heading"><div><h2>让熟悉的空间，有新的气息。</h2><p>视觉风格独立保存；不会新增布局，也不会替换家具。</p></div>{state.data?.undoableCommand && <button className="button secondary" disabled={busy || dirty || undo.isPending} onClick={() => undo.mutate()}>撤销上次风格修改</button>}</header>
    {notice && <p className="style-preview-note" role="status">{notice}</p>}
    {(state.isError || undo.isError) && <p className="style-error" role="alert">{state.error?.message || undo.error?.message}</p>}
    <div className="style-layout"><div className="style-stage"><div className="style-stage-caption"><span>{dirty ? '风格预览 · 待保存确认' : '当前已保存风格'}</span><span>版本 {project.revision}</span></div><SceneViewport projectId={`${project.id}:styles`} scene={scene}/></div>
      <StyleControls key={`${project.id}:${project.revision}`} scene={project.scene} lockedObjectIds={project.lockedObjectIds} busy={busy || undo.isPending} scope="current" save={command => post(`${base}/styles/commands`, { expectedRevision: project.revision, command })} onBusy={setBusy} onDirty={setDirty} onPreview={setPreview} onSaved={sync}/></div>
    <button className="text-button style-refresh" disabled={busy || undo.isPending} onClick={() => { client.invalidateQueries({ queryKey: ['project', project.id] }); state.refetch(); }}>读取最新版本</button>
  </section>;
}

export function StyleChanges({ changes, scene }: { changes: StyleChange[]; scene: SceneSnapshot }) {
  const catalog = useStyleCatalog();
  if (!changes.length) return null;
  const materialName = (value: { materialId: string; materialVersion: number } | null) => value ? `${catalog.data?.materials.find(item => item.id === value.materialId)?.name || value.materialId} · v${value.materialVersion}` : '沿用家具原材质';
  const lightName = (value: VisualStyle['lighting']) => `${catalog.data?.lighting.find(item => item.id === value.presetId)?.name || value.presetId} · v${value.presetVersion}`;
  return <ul className="style-changes" aria-label="视觉风格差异">{changes.map((change, index) => <li key={index}><strong>{change.kind === 'lighting' ? '全场展示灯光' : `${scene.objects.find(item => item.id === change.objectId)?.name || objectName(change.objectId)} · 材质`}</strong><div><span>创建时：{change.kind === 'lighting' ? lightName(change.before) : materialName(change.before)}</span><span>候选中：{change.kind === 'lighting' ? lightName(change.after) : materialName(change.after)}</span></div></li>)}</ul>;
}
