'use client';
// 线索工作台的 Agent 助手（W07，ADR-0019），按定稿原型 P02 实现：右侧悬浮面板，对话为流式，关页后回来可看到进行中的任务与结果。
// Agent 只在企业石材库与软装目录内出整体方案；结果先作为候选进入方案列表与画面，客户看不到，由成员采用为待审方案、再发布。
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FinishSchemeView, LeadView } from '../../../../packages/contracts/src/finish-requests';
import type { SchemeCandidateView } from '../../../../packages/contracts/src/agent-schemes';
import { terminalTaskStatuses, type TaskEvent, type TaskView } from '../../../../packages/contracts/src/tasks';
import { ClientError, get, operationId, post } from '../client/client-api';
import { Icon } from '../client/client-icons';
import { ModelPicker } from './model-picker';
import { enterpriseModelsOf } from './workbench-settings';
import { Note, useWorkbench } from './workbench-app';

// ---------- 候选 ----------
const rendering = (c: SchemeCandidateView) => !!c.render && ['queued', 'running', 'retry_wait'].includes(c.render.status);
export const candidatesKey = (leadId: string) => ['lead-candidates', leadId];
export function useCandidates(lead: LeadView, enabled = true) {
  const { workspace } = useWorkbench();
  return useQuery({ queryKey: candidatesKey(lead.id), enabled,
    queryFn: () => get<{ candidates: SchemeCandidateView[] }>(`/api/workspaces/${workspace.id}/leads/${lead.id}/candidates`).then(r => r.candidates),
    refetchInterval: query => query.state.data?.some(c => c.status === 'draft' && rendering(c)) ? 5000 : false });
}
/** A draft candidate in the scheme list, shaped like a scheme so the stage, caption and finish lines treat both alike. */
export type Shown = FinishSchemeView & { candidate?: SchemeCandidateView };
export const asScheme = (c: SchemeCandidateView): Shown => ({ id: c.id, ordinal: 0, name: c.name, summary: c.summary, revision: 1, adoptable: true,
  issues: c.issues.filter(i => i.severity === 'hint').map(i => ({ code: i.code, objectId: i.objectId ?? '', message: i.message })),
  surfaceDesign: { ...c.surfaceDesign, stones: c.surfaceDesign.stones.map(stone => ({ ...stone, name: stone.name.replace(/（示意）$/, '') })) },
  render: c.render, softStyle: c.softStyle, softChoices: c.softChoices, pendingReview: false, candidate: c });
/** 「方案 D」for schemes, 「候选」for candidates. */
export const labelOf = (s: Shown) => s.candidate ? '候选' : String.fromCharCode(64 + s.ordinal);

/** Adopt, discard and publish write through the lead endpoints, then refresh the lead list and the candidates. */
export function useSchemeActions(lead: LeadView) {
  const { workspace } = useWorkbench(), queries = useQueryClient(), base = `/api/workspaces/${workspace.id}/leads/${lead.id}`;
  const replace = (next: LeadView) => queries.setQueryData<LeadView[]>(['leads', workspace.id], list => list?.map(item => item.id === next.id ? next : item));
  const settle = () => { void queries.invalidateQueries({ queryKey: candidatesKey(lead.id) }); void queries.invalidateQueries({ queryKey: ['leads', workspace.id] }); };
  return {
    adopt: useMutation({ mutationFn: (candidateId: string) => post<{ lead: LeadView }>(`${base}/candidates/${candidateId}/adopt`, { operationId: operationId() }).then(r => r.lead),
      onSuccess: next => { replace(next); settle(); } }),
    discard: useMutation({ mutationFn: (candidateId: string) => post<{ candidates: SchemeCandidateView[] }>(`${base}/candidates/${candidateId}/discard`, { operationId: operationId() }),
      onSuccess: settle }),
    publish: useMutation({ mutationFn: (schemeId: string) => post<{ lead: LeadView }>(`${base}/schemes/${schemeId}/publish`, { operationId: operationId() }).then(r => r.lead),
      onSuccess: next => { replace(next); settle(); } }),
  };
}

// ---------- 对话 ----------
const prompts = ['客厅大气一点，整体浅色，加深色波打线', '整体换成另一套软装风格，地面保持浅色', '背景墙用纹理明显的石材工字铺'];
const phaseText: Record<string, string> = { accepted: '已接收，正在排队', calling_model: '正在出方案', validating: '正在校验目录、规格与排版', committing: '正在保存候选', finished: '正在完成本轮' };
const busy = (task: TaskView | undefined) => !!task && ['queued', 'running', 'retry_wait'].includes(task.status);
const continuable = (task: TaskView | undefined) => !!task?.conversation?.brief && ['waiting_input', 'completed'].includes(task.status);
type Line = { key: string; role: 'me' | 'ai' | 'sys'; text: string; task?: TaskView; current?: boolean };

/** Turns of the lead's recent tasks, oldest first. Only the newest turn streams; older ones show their saved reply or outcome. */
function linesOf(tasks: TaskView[], live: string): Line[] {
  const lines: Line[] = [];
  [...tasks].slice(0, 6).reverse().forEach((task, index, list) => {
    const c = task.conversation; if (!c) return;
    for (const turn of c.brief?.history ?? []) {
      lines.push({ key: `${task.id}-${turn.intentVersion}-q`, role: 'me', text: turn.input.message });
      lines.push({ key: `${task.id}-${turn.intentVersion}-a`, role: 'ai', text: turn.reply ?? turn.outcome?.message ?? '' });
    }
    const newest = index === list.length - 1;
    lines.push({ key: `${task.id}-q`, role: 'me', text: c.input.message });
    lines.push({ key: `${task.id}-a`, role: 'ai', text: newest ? live : '', task, current: newest });
  });
  return lines;
}

export function AgentPanel({ lead, shown, onClose, onShow }: { lead: LeadView; shown: Shown | undefined; onClose: () => void; onShow: (candidateId: string) => void }) {
  const { workspace, base } = useWorkbench(), queries = useQueryClient(), project = lead.projectId;
  const tasks = useQuery({ queryKey: ['tasks', project], queryFn: () => get<{ tasks: TaskView[] }>(`/api/projects/${project}/tasks`).then(r => r.tasks) });
  const models = useQuery({ queryKey: ['enterprise-models', workspace.id], queryFn: () => enterpriseModelsOf(workspace.id), staleTime: 30_000 });
  const candidates = useCandidates(lead);
  const latest = tasks.data?.[0];
  const [text, setText] = useState(''), [modelId, setModelId] = useState<string | null>(null), [events, setEvents] = useState<TaskEvent[]>([]);
  const [subscription, setSubscription] = useState(0), attempt = useRef<string | null>(null), log = useRef<HTMLDivElement>(null);
  const usable = models.data?.models.filter(m => m.enabled && m.availability === 'ok') ?? [];
  const block = !models.data ? null : !usable.length ? 'none' : models.data.quota.exhausted ? 'quota' : null;
  const refresh = () => { void queries.invalidateQueries({ queryKey: ['tasks', project] }); void queries.invalidateQueries({ queryKey: candidatesKey(lead.id) });
    void queries.invalidateQueries({ queryKey: ['enterprise-models', workspace.id] }); };

  // Live events of the newest task. Replay starts at 0, so a reopened page sees the whole current turn again.
  const latestId = latest?.id, latestGeneration = latest?.generation, settled = !!latest && !busy(latest);
  useEffect(() => {
    setEvents([]); if (!latestId) return;
    let cursor = 0;
    const source = new EventSource(`/api/projects/${project}/tasks/${latestId}/events?after=0`);
    const receive = (raw: Event) => {
      try {
        const event = JSON.parse((raw as MessageEvent).data) as TaskEvent;
        if (event.taskId !== latestId || event.seq <= cursor) return;
        cursor = event.seq; setEvents(current => [...current, event]);
        if (event.type === 'status') refresh();
      } catch { /* a malformed frame is skipped; the next status refetch corrects the view */ }
    };
    for (const type of ['status', 'text', 'operation', 'usage']) source.addEventListener(type, receive);
    source.onerror = () => { if (settled) source.close(); };
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, latestId, latestGeneration, settled, subscription]);
  const intent = latest?.conversation?.brief?.intentVersion;
  const live = events.filter(e => e.type === 'text' && typeof e.data.text === 'string'
    && (typeof e.data.generation !== 'number' || e.data.generation === latest?.generation) && (typeof e.data.intentVersion !== 'number' || e.data.intentVersion === intent))
    .reduce((all, e) => e.data.completeReply ? String(e.data.text) : all + String(e.data.text), '');
  const lines = linesOf(tasks.data ?? [], live);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [lines.length, live]);

  const send = useMutation({
    mutationFn: async (message: string) => {
      attempt.current ??= operationId();
      const pick = modelId ? { modelId } : {};
      if (latest && continuable(latest)) return post<{ task: TaskView }>(`/api/projects/${project}/tasks/${latest.id}/inputs`, { operationId: attempt.current, kind: 'message',
        expectedIntentVersion: latest.conversation!.brief!.intentVersion, expectedRevision: lead.projectRevision, message, ...pick });
      return post<{ task: TaskView }>(`/api/projects/${project}/tasks`, { protocol: 'conversation-v1', operationId: attempt.current,
        expectedRevision: lead.projectRevision, message, referenceFrame: 'plan', ...pick });
    },
    onSuccess: () => { attempt.current = null; setText(''); refresh(); setSubscription(n => n + 1); },
    onError: error => { if (error instanceof ClientError && error.code === 'REVISION_CONFLICT') { attempt.current = null; void queries.invalidateQueries({ queryKey: ['leads', workspace.id] }); } },
  });
  const uncertain = send.error instanceof ClientError && (send.error.code === 'NETWORK_ERROR' || send.error.status >= 500);
  const running = busy(latest) || send.isPending, off = running || block === 'none' || block === 'quota';
  const submit = (event: FormEvent | null, value = text) => { event?.preventDefault(); const message = value.trim(); if (!message || off) return; if (value !== text) attempt.current = null; send.mutate(message); };
  const modelName = (task: TaskView) => { const id = (task.conversation as { configuration?: { model?: string } } | undefined)?.configuration?.model;
    return models.data?.models.find(m => m.modelId === id)?.name ?? id ?? null; };
  const draft = (id?: string) => candidates.data?.find(c => c.id === id && c.status === 'draft');
  const startingPoint = shown ? shown.candidate ? '当前候选' : `方案 ${labelOf(shown)} · ${shown.name}` : '空间与企业目录';

  return <aside className="float float--right" aria-label="Agent 助手">
    <header className="float__head row"><div><b className="float__title"><Icon name="spark" size={16} strokeWidth={1.6}/> Agent 助手</b>
      <p className="muted">正在看「{startingPoint}」· 结果先作为候选</p></div>
      <button className="icon-btn" onClick={onClose} aria-label="收起 Agent 助手"><Icon name="close" size={16}/></button></header>
    <div className="float__body chat" ref={log} aria-live="polite">
      {tasks.isPending ? <p className="muted small">正在读取对话…</p>
        : tasks.error ? <Note kind="danger" title="对话读取失败">{(tasks.error as Error).message}</Note>
          : !lines.length && block !== 'none' && <p className="agent-intro">说出客户的要求，Agent 在企业石材库与软装目录内出整体方案（硬装 + 软装）。候选会出现在画面和方案列表里，客户看不到，由你决定是否采用。</p>}
      {lines.map(line => line.role === 'me' ? <div key={line.key} className="msg msg--me">{line.text}</div>
        : <AgentLine key={line.key} line={line} model={line.task ? modelName(line.task) : null} draft={draft(line.task?.conversation?.outcome?.schemeCandidateId)} onShow={onShow}/>)}
      {block === 'none' && <Note kind="hint" title="未开通">本企业还没有可用的模型，Agent 暂时不能出方案，不会模拟结果。{workspace.role === 'admin'
        ? <>可在<Link className="text-link" href={`${base}/settings/models`}>企业设置</Link>里启用模型；没有可启用的模型时请联系我方开通。</> : '请联系企业管理员。'}</Note>}
      {block === 'quota' && <Note kind="hint" title="本月额度已用完">新的请求不会发出；已有候选与方案不受影响。{workspace.role === 'admin' ? '需要增加额度请联系我方。' : '请联系企业管理员。'}</Note>}
      {!off && !lines.length && !tasks.isPending && <div className="agent-prompts">{prompts.map(p => <button key={p} className="chip" onClick={() => submit(null, p)}>{p}</button>)}</div>}
    </div>
    <div className="agent-foot">
      {block !== 'none' && <ModelPicker workspaceId={workspace.id} value={modelId} onChange={id => { setModelId(id); attempt.current = null; }}/>}
      {send.error && <p className="small danger" role="alert" style={{ padding: '8px 16px 0' }}>{uncertain ? '发送结果尚未确认，再发一次会核对同一条消息，不会重复创建。'
        : (send.error as ClientError).code === 'REVISION_CONFLICT' ? '空间刚刚更新，已重新读取，请再发一次。' : (send.error as Error).message}</p>}
      <form className="composer" onSubmit={submit}>
        <textarea rows={2} maxLength={300} aria-label="给 Agent 的要求" value={text} disabled={off && !uncertain}
          placeholder={shown?.candidate ? '继续调整候选，例如：背景墙换成工字铺' : '描述客户的要求，例如：客厅大气一点，整体浅色'}
          onChange={e => { setText(e.target.value); attempt.current = null; send.reset(); }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e); }}/>
        <button className="btn btn--primary btn--icon" type="submit" aria-label={uncertain ? '重试同一条消息' : '发送'} disabled={off || !text.trim()}><Icon name="send" size={16} strokeWidth={1.6}/></button>
      </form>
    </div>
  </aside>;
}

function AgentLine({ line, model, draft, onShow }: { line: Line; model: string | null; draft: SchemeCandidateView | undefined; onShow: (id: string) => void }) {
  const task = line.task, outcome = task?.conversation?.outcome, conflicts = outcome?.schemeIssues?.filter(i => i.severity === 'conflict') ?? [];
  if (!task) return line.text ? <div className="msg msg--ai"><p>{line.text}</p></div> : null;
  const phase = busy(task) ? task.status === 'queued' ? '已接收，正在排队' : task.status === 'retry_wait' ? '处理中断，正在恢复' : phaseText[task.conversation?.phase ?? 'accepted'] : null;
  return <div className="msg msg--ai">
    {line.text && <p>{line.text}</p>}
    {phase && <ol className="steps"><li className="now">{phase}</li></ol>}
    {outcome && (outcome.kind === 'scheme_candidate'
      ? <p>{draft ? `候选「${draft.name}」已放到画面里：硬装与软装都通过校验，客户看不到。可以继续调整，或在左侧采用为待审方案。` : '这一轮出的候选已经采用或放弃。'}</p>
      : outcome.kind === 'no_change' || !line.text ? <p>{outcome.message}</p> : null)}
    {conflicts.length > 0 && <ul className="issues">{conflicts.slice(0, 5).map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>}
    {task.error && <p className="danger">{task.error.message}</p>}
    {model && !busy(task) && <small className="msg__meta">由「{model}」生成</small>}
    {draft && <button className="btn btn--secondary btn--sm" onClick={() => onShow(draft.id)}>在画面中查看</button>}
  </div>;
}
