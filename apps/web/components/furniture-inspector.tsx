'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type ProjectView } from './api';
import { useViewState } from './view-state';
import './furniture-inspector.css';
import type { Command, OperationSummary as Operation } from '../../../packages/contracts/src/commands';

type Issue = { code: string; objectId: string; relatedObjectId?: string; message: string };
// Imported scenes can retain multiple turns; the editor sends an equivalent bounded angle.
const editableYaw = (yaw: number) => Math.abs(yaw) <= Math.PI * 2 ? yaw : yaw % (Math.PI * 2);
export function objectName(id: string) {
  const names: Record<string, string> = { sofa: '沙发', table: '茶几', desk: '书桌', bed: '床', fixed: '固定柜' };
  return names[id.split('-')[0]] || '空间物品';
}

export function FurnitureInspector({ project, objectId }: { project: ProjectView; objectId?: string | null }) {
  const client = useQueryClient();
  const object = project.scene.objects.find(item => item.id === objectId);
  const [x, setX] = useState(''), [z, setZ] = useState(''), [angle, setAngle] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setNotice(''); }, [objectId]);
  const initial = useRef({ x: '', z: '', angle: '' });
  const attempt = useRef<{ signature: string; operationId: string } | null>(null);
  const history = useQuery({ queryKey: ['operations', project.id], queryFn: () => api<{ operations: Operation[] }>(`/api/projects/${project.id}/commands`) });
  const locked = !!object && project.lockedObjectIds.includes(object.id);
  const latest = history.data?.operations.find(item => item.undoable);

  const mutation = useMutation({
    mutationFn: (command: Command) => {
      const signature = JSON.stringify({ command, revision: project.revision });
      if (attempt.current?.signature !== signature) attempt.current = { signature, operationId: crypto.randomUUID() };
      return api<{ project: ProjectView; operation: Operation }>(`/api/projects/${project.id}/commands`, {
        operationId: attempt.current.operationId, expectedRevision: project.revision, command,
      });
    },
    onSuccess: ({ project: updated }, command) => {
      client.setQueryData(['project', project.id], { project: updated });
      client.invalidateQueries({ queryKey: ['projects'] });
      client.invalidateQueries({ queryKey: ['operations', project.id] });
      attempt.current = null;
      setNotice(command.type === 'undo' ? '已撤销最近一次修改。' : command.type === 'set-lock' ? (command.locked ? '已锁定，位置保持不变。' : '已解锁，可以调整位置。') : '位置已更新并保存。');
    },
  });
  useEffect(() => {
    const values = { x: object ? String(object.position.x) : '', z: object ? String(object.position.z) : '', angle: object ? (editableYaw(object.yaw) * 180 / Math.PI).toFixed(2) : '' };
    initial.current = values; setX(values.x); setZ(values.z); setAngle(values.angle);
    mutation.reset(); attempt.current = null;
    // Only authoritative changes reset the form; a failed request keeps its retry ID and the user's input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.revision, objectId]);
  function edit(set: (value: string) => void, value: string) { set(value); mutation.reset(); setNotice(''); }
  function submit(event: FormEvent) {
    event.preventDefault(); if (!object) return;
    mutation.mutate({ type: 'move-furniture', objectId: object.id,
      x: x === initial.current.x ? object.position.x : Number(x),
      z: z === initial.current.z ? object.position.z : Number(z),
      yaw: angle === initial.current.angle ? editableYaw(object.yaw) : Number(angle) * Math.PI / 180 });
  }
  const failure = mutation.error;
  const poseChanged = !!object && (
    Number(x) !== object.position.x || Number(z) !== object.position.z ||
    (angle !== initial.current.angle && Number(angle) * Math.PI / 180 !== object.yaw)
  );
  const issues = failure instanceof ApiError ? (failure.details as { issues?: Issue[] } | undefined)?.issues || [] : [];
  const relatedName = (id: string) => project.scene.objects.some(item => item.id === id) ? (project.scene.objects.find(item => item.id === id)?.name || objectName(id)) : project.scene.walls.some(wall => wall.id === id) ? '墙体' : '开口';
  return <div className="furniture-inspector">
    {object && <>
      <h2>{object.name || objectName(object.id)}</h2><p className="object-identity">{object.kind === 'fixed' ? '固定设施' : locked ? '家具 · 已锁定' : '家具'} · {object.id}</p>
      <dl className="object-measures"><dt>宽 × 深 × 高</dt><dd>{object.size.width} × {object.size.depth} × {object.size.height} m</dd></dl>
      {object.kind === 'fixed' ? <p className="inspector-note">这是固定事实，普通家具调整不能改变它的位置。</p> : <>
        <form className="position-form" onSubmit={submit}>
          <fieldset disabled={locked || mutation.isPending}><legend>位置与朝向</legend>
            <div className="position-coordinates">
              <label className="field">X 位置 <span>m</span><input type="number" step="0.001" min="-1000" max="1000" required value={x} onChange={event => edit(setX, event.target.value)} aria-label="X 位置（米）"/></label>
              <label className="field">Z 位置 <span>m</span><input type="number" step="0.001" min="-1000" max="1000" required value={z} onChange={event => edit(setZ, event.target.value)} aria-label="Z 位置（米）"/></label>
            </div>
            <label className="field">旋转角度 <span>°</span><input type="number" step="0.01" min="-360" max="360" required value={angle} onChange={event => edit(setAngle, event.target.value)} aria-label="旋转角度（度）"/></label>
            <button className="button primary position-submit" type="submit" disabled={!poseChanged}>{mutation.isPending ? '正在保存…' : '应用位置'}</button>
          </fieldset>
        </form>
        <button className="text-button lock-control" disabled={mutation.isPending} onClick={() => mutation.mutate({ type: 'set-lock', objectId: object.id, locked: !locked })}>{locked ? '解锁这件家具' : '锁定这件家具'}</button>
      </>}
    </>}
    {!object && <><h2>空间记录</h2><p className="inspector-note">点击画布或空间列表中的家具，精确调整位置与朝向。</p><dl><dt>房间</dt><dd>{project.scene.rooms.length}</dd><dt>墙体</dt><dd>{project.scene.walls.length}</dd><dt>物品</dt><dd>{project.scene.objects.length}</dd></dl></>}
    {failure && <div className="edit-feedback" role="alert"><p>{failure.message}</p>
      {issues.map((issue, index) => <div className="edit-issue" key={`${issue.code}-${index}`}><span>{issue.message}</span>{issue.relatedObjectId && <button className="text-button" onClick={() => useViewState.getState().select(project.id, issue.relatedObjectId!)}>定位{relatedName(issue.relatedObjectId)}</button>}</div>)}
      {failure instanceof ApiError && failure.code === 'REVISION_CONFLICT' && <button className="text-button" onClick={() => client.invalidateQueries({ queryKey: ['project', project.id] })}>读取最新空间</button>}
    </div>}
    {notice && !failure && <p className="edit-success" role="status">{notice}</p>}
    <div className="undo-section"><button className="button secondary" disabled={!latest || mutation.isPending || history.isFetching} onClick={() => latest && mutation.mutate({ type: 'undo', targetOperationId: latest.id })}>撤销最近修改</button>
      <p>{history.isError ? '暂时无法读取修改记录。' : latest ? '撤销也会保存为新版本。' : '当前没有可撤销的最新修改。'}</p>
      {history.isError && <button className="text-button" onClick={() => history.refetch()}>重试读取记录</button>}
    </div>
    <p className="inspector-note">{project.synthetic ? '合成测试空间；检查依据为测试尺寸。' : project.scale === 'calibrated' ? '修改后会检查空间边界、物品与开口关系。' : '尚未确认尺度，不能判断家具是否放得下。'}</p>
    <div className="detail-bottom">固定事实版本 {project.fixedFacts.revision}<br/>布局版本 {project.currentLayout.revision}</div>
  </div>;
}
