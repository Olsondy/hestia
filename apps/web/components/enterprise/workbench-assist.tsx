'use client';
// 图纸整理队列（W03，ADR-0013）：客户上传的照片、PDF、DWG，或主动交给企业的图纸，由成员整理户型后出方案。
// 流程按定稿原型 P02 的辅助转换页：下载客户图纸 → 整理户型 → 导入户型（校验）→ 确认户型并出方案（直接发布给客户）。
// 预留：接入模型后，在「导入整理好的户型」前增加“自动识别户型草稿”，成员核对修改后照常导入；首版不调用模型。
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LeadView } from '../../../../packages/contracts/src/finish-requests';
import type { FloorplanImportView } from '../../../../packages/contracts/src/floorplan-imports';
import { ClientError, get, operationId, post } from '../client/client-api';
import { Icon } from '../client/client-icons';
import { leadsOf, Note, Shell, tidy, useWorkbench, who } from './workbench-app';

/** Member-facing wording for floor-plan check codes; the same issue on several openings shows once with a count. */
const issueText: Record<string, string> = {
  ASSUMED_OPENING_HEIGHT: '门窗高度按默认值估算，请按图纸核对', ASSUMED_STAIR_RISE: '楼梯总高按层高加楼板估算', ASSUMED_STAIR_STEPS: '楼梯踏步数按 170 mm 踏高估算',
  ASSUMED_STOREY_HEIGHT: '层高按默认值估算', ASSUMED_PROP_SIZE: '部分固定物品尺寸按默认值估算', DIMENSION_CONFLICTS: '图纸中有相互矛盾的尺寸标注',
  ROOM_NOT_CLOSED: '有房间没有被墙围合', SHARED_ROOM_FACE: '多个房间名落在同一块区域里', TOPOLOGY_NOT_CHECKED: '房间轮廓不是闭合多边形，墙体交接需人工核对',
  UNMAPPED_SOURCE_FIELDS: '户型文件里有未识别的字段，已忽略', NO_CLOSED_ROOMS: '墙体没有围合出任何房间',
};
type Issue = { code: string; detail: string };
function grouped(issues: Issue[]) {
  const map = new Map<string, { text: string; n: number }>();
  for (const issue of issues) {
    // INVALID_HOUSESPEC details are schema paths (e.g. floors.0.height); show them as a field hint.
    const text = issue.code === 'INVALID_HOUSESPEC' ? `户型文件缺少或填错了字段：${issue.detail.split(':')[0]}` : issueText[issue.code] ?? issue.detail;
    const entry = map.get(text) ?? { text, n: 0 }; entry.n++; map.set(text, entry);
  }
  return [...map.values()].map(({ text, n }) => n > 1 ? `${text}（${n} 处）` : text);
}

const Steps = ({ labels, at }: { labels: string[]; at: number }) => <ol className="steps-row">{labels.map((label, i) =>
  <li key={label} data-s={i < at ? 'done' : i === at ? 'now' : 'todo'}><i>{i < at && <Icon name="check" size={12}/>}</i>{label}</li>)}</ol>;

export function AssistView({ id }: { id: string }) {
  const { base, workspace } = useWorkbench();
  const leads = useQuery({ queryKey: ['leads', workspace.id], queryFn: () => leadsOf(workspace.id) });
  const lead = leads.data?.find(item => item.id === id);
  if (leads.isPending) return <Shell nav="leads"><p className="page-loading">正在打开…</p></Shell>;
  if (!lead || lead.source !== 'drawing' || !lead.floorplanImportId) return <Shell nav="leads"><div className="page"><div className="empty"><b>这条线索没有待整理的图纸</b>
    <p style={{ marginTop: 16 }}><Link className="btn btn--secondary" href={`${base}/leads${lead ? `/${lead.id}` : ''}`}>返回</Link></p></div></div></Shell>;
  return <AssistWork lead={lead}/>;
}

function AssistWork({ lead }: { lead: LeadView }) {
  const { base, workspace, go } = useWorkbench(), queries = useQueryClient();
  const target = `/api/projects/${lead.projectId}/floorplan-imports/${lead.floorplanImportId}`;
  const record = useQuery({ queryKey: ['floorplan-import', lead.floorplanImportId], queryFn: () => get<{ import: FloorplanImportView }>(target).then(r => r.import) });
  const importPlan = useMutation({
    mutationFn: async (file: File) => {
      let houseSpec: unknown;
      try { houseSpec = JSON.parse(await file.text()); } catch { throw new ClientError('文件不是有效的 JSON。请导出 HouseSpec（JSON，单位毫米）。', 400); }
      const current = await get<{ import: FloorplanImportView }>(target).then(r => r.import);
      return post<{ import: FloorplanImportView }>(`${target}/housespec`, { operationId: operationId(), expectedRevision: current.revision, houseSpec,
        name: file.name.replace(/\.json$/i, '').slice(0, 100) || '整理后的户型' }).then(r => r.import);
    },
    onSuccess: view => queries.setQueryData(['floorplan-import', lead.floorplanImportId], view),
  });
  const generate = useMutation({
    mutationFn: () => post<{ lead: LeadView }>(`/api/workspaces/${workspace.id}/leads/${lead.id}/generate`, { operationId: operationId() }).then(r => tidy(r.lead)),
    onSuccess: next => { queries.setQueryData<LeadView[]>(['leads', workspace.id], list => list?.map(item => item.id === next.id ? next : item)); go(`${base}/leads/${lead.id}`); },
  });
  const view = record.data, candidate = view?.candidate?.source === 'member-housespec' ? view.candidate : null;
  const queued = lead.status === 'assisted_conversion';
  const at = !candidate ? 1 : candidate.valid ? 3 : 2;
  const blocking = candidate?.issues.filter(issue => issue.severity === 'blocking') ?? [];
  const review = candidate?.issues.filter(issue => issue.severity === 'review') ?? [];
  const generateError = generate.error as ClientError | null;

  return <Shell nav="leads"><div className="page">
    <Link className="back" href={`${base}/leads/${lead.id}`}><Icon name="back" size={16}/> 返回线索</Link>
    <header className="page__head" style={{ marginTop: 12 }}><div><h1 className="page__title">整理图纸</h1>
      <p className="page__sub">{lead.drawingName ? `「${lead.drawingName}」` : '这份图纸'}需要按图整理户型（墙体、门窗、楼层与楼梯）。导入并校验通过后出方案，直接发布给客户。</p></div></header>
    {!queued && <Note kind="info" title="不在队列中">{lead.status === 'published' ? '这条线索已经出方案并发布。' : lead.status === 'conversion_failed' ? '客户的图纸没能自动识别，客户可以重新上传；客户选择“交给企业整理”后会进入队列。' : '这条线索当前不需要整理图纸。'}</Note>}
    <div className="flow">
      <aside className="panel"><div className="panel__body" style={{ paddingTop: 16 }}>
        <Steps labels={['下载客户图纸', '整理户型', '导入户型并校验', '出方案并发布']} at={at}/>
        <section className="sect"><div className="kv"><span>客户</span><b>{who(lead)}</b></div>
          <div className="kv"><span>提交时间</span><b>{new Date(lead.createdAt).toLocaleString('zh-CN', { hour12: false })}</b></div>
          {lead.note && <div className="kv"><span>说明</span><b>{lead.note}</b></div>}</section>
      </div></aside>
      <div className="page__grid" style={{ marginTop: 0 }}>
        <section className="panel"><header className="panel__head"><h2 className="panel__title">客户图纸</h2>{view && <span className="muted small">{view.file.format.toUpperCase()} · {(view.file.bytes / 1024).toFixed(0)} KB</span>}</header>
          <div className="panel__body" style={{ display: 'flex', alignItems: 'center', gap: 12 }}><Icon name="file" size={20}/>
            <b style={{ fontWeight: 500, flex: 1 }}>{lead.drawingName ?? '图纸'}</b>
            <a className="btn btn--secondary btn--sm" href={`${target}/source`} download>下载原图</a></div></section>
        <section className="panel"><header className="panel__head"><h2 className="panel__title">导入整理好的户型</h2></header>
          <div className="panel__body">
            <label className="drop" style={{ cursor: queued ? 'pointer' : 'not-allowed' }}>
              <Icon name="upload" size={24}/><b>{importPlan.isPending ? '正在导入并校验…' : candidate ? '重新选择户型文件' : '选择户型文件'}</b>
              <span className="small">HouseSpec（JSON，单位毫米），包含楼层、墙体、门窗与楼梯；导入后先校验，再派生铺贴饰面</span>
              <input type="file" accept=".json,application/json" className="sr-only" disabled={!queued || importPlan.isPending}
                onChange={e => { const f = e.target.files?.[0]; if (f) importPlan.mutate(f); e.target.value = ''; }}/>
            </label>
            {importPlan.error && <Note kind="danger" title="没有导入">{(importPlan.error as Error).message}</Note>}
            {candidate && (candidate.valid
              ? <Note kind="ok" title="户型校验通过">{candidate.summary ? `${candidate.summary.levels} 层 · ${candidate.summary.rooms} 个房间 · ${candidate.summary.walls} 段墙 · ${candidate.summary.openings} 处门窗` : '可以出方案。'}</Note>
              : <Note kind="danger" title="户型未通过校验">{grouped(blocking).slice(0, 4).join('；') || '请修正后重新导入。'}</Note>)}
            {candidate && review.length > 0 && <ul className="hint-lines">{grouped(review).map(text =>
              <li key={text} className="hint-line hint-line--hint"><Icon name="info" size={14}/><span><b>请核对</b>{text}</span></li>)}</ul>}
          </div></section>
      </div>
    </div>
    <div className="action-bar">
      <span className="hint">{generateError ? generateError.message : candidate?.valid ? '确认后按客户选的石材出方案，通过排版校验的直接发布给客户。' : '导入户型并通过校验后才能出方案。'}</span>
      <button className="btn btn--primary" disabled={!queued || !candidate?.valid || generate.isPending} onClick={() => generate.mutate()}>{generate.isPending ? '正在出方案…' : '确认户型并出方案'}</button>
    </div>
  </div></Shell>;
}
