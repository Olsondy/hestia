'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type ProjectView } from './api';
import { Icon } from './icons';
import { SceneViewport } from './scene-viewport';
import { LayoutPlanReport } from './layout-plan-report';
import { objectName } from './furniture-inspector';
import { terminalTaskStatuses, type AppendConversationInput, type CreateConversationTask, type RequirementRecord, type TaskEvent, type TaskStatus, type TaskView } from '../../../packages/contracts/src/tasks';
import './conversation-panel.css';

const readable = (error: unknown) => error instanceof Error ? error.message : '暂时未能连接，请重试。';
const date = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
const statusNames: Record<TaskStatus, string> = { queued: '等待回复', running: '正在处理', retry_wait: '等待恢复', waiting_input: '等待你补充', waiting_selection: '候选已保存，等待你决定', completed: '本轮已完成', partial: '部分完成', failed: '本轮未完成', cancelled: '本轮已取消' };
const sourceNames = { user_explicit: '你明确提出', user_confirmed: '你已确认', assistant_suggestion: '助手建议 · 待确认' };
const outcomeNames = { answer: '回答已完成', clarification: '需要你补充', applied: '本轮修改已应用', no_change: '本轮未改动空间', candidate: '候选已保存' };
const stateExplanation: Record<TaskStatus, string> = {
  queued: '这条消息已接收。关闭页面不会取消，回来可继续查看。',
  running: '正在理解你的要求。回复过程不代表家具已经修改。',
  retry_wait: '本次处理中断，正在等待恢复。已接收的消息无需重新发送。',
  waiting_input: '已保存本轮可以完成的工作。补充下方问题后，这项任务会继续；整套设计尚未完成。',
  waiting_selection: '推荐单独保存在候选中，当前空间尚未替换。先查看变化与检查结果，再决定是否采用。',
  completed: '本轮结果已保存，可以继续提问或调整。',
  partial: '本轮已停止后续处理。已保存的回答、需求和候选仍可查看；已应用的修改可以撤销。',
  failed: '本轮未形成可用成果。此前保存的项目和记录仍然保留，请查看下方原因。',
  cancelled: '已停止后续处理。已经应用的修改会保留，可以查看或撤销。',
};

export function ConversationPanel({ project, selectedObjectId, onSelect, onOpenSpace, onOpenCandidate }: {
  project: ProjectView; selectedObjectId?: string | null; onSelect: (id: string | null) => void; onOpenSpace: () => void; onOpenCandidate: (id: string) => void;
}) {
  const client = useQueryClient(), attempt = useRef<{ body: CreateConversationTask | AppendConversationInput; taskId?: string } | null>(null);
  const taskRef = useRef<TaskView | undefined>(undefined);
  const [message, setMessage] = useState(''), [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [briefExpanded, setBriefExpanded] = useState(true);
  useEffect(() => { const narrow = matchMedia('(max-width:700px)'); const resize = () => setBriefExpanded(!narrow.matches); resize(); narrow.addEventListener('change', resize); return () => narrow.removeEventListener('change', resize); }, []);
  const [events, setEvents] = useState<TaskEvent[]>([]), [connection, setConnection] = useState<'connecting' | 'open' | 'retrying'>('connecting');
  const [subscription, setSubscription] = useState(0);
  const list = useQuery({ queryKey: ['tasks', project.id], queryFn: () => api<{ tasks: TaskView[] }>(`/api/projects/${project.id}/tasks`) });
  const taskId = selectedTask || list.data?.tasks[0]?.id;
  const detail = useQuery({ queryKey: ['task', project.id, taskId], queryFn: () => api<{ task: TaskView }>(`/api/projects/${project.id}/tasks/${taskId}`), enabled: !!taskId });
  const task = detail.data?.task;
  taskRef.current = task;
  const brief = task?.conversation?.brief;
  const active = list.data?.tasks.find(item => !terminalTaskStatuses.has(item.status));
  const canContinue = !!brief && !!task && ['queued', 'running', 'waiting_input', 'waiting_selection', 'completed'].includes(task.status) && (!active || active.id === task.id);
  const waiting = task?.status === 'waiting_input';
  const awaitingSelection = task?.status === 'waiting_selection';
  const execution = task?.conversation?.execution, retained = task?.conversation?.retained;
  const openQuestions = brief?.questions.filter(item => item.status === 'open') ?? [];
  const question = openQuestions.find(item => item.id === questionId);
  const object = project.scene.objects.find(item => item.id === selectedObjectId);
  const selectedName = object ? object.name || objectName(object.id) : '未选择家具';
  const protectedObject = !!object && (object.kind === 'fixed' || project.lockedObjectIds.includes(object.id));
  useEffect(() => { setSelectedTask(new URLSearchParams(location.search).get('task')); }, [project.id]);
  function choose(id: string) { setSelectedTask(id); setQuestionId(null); const url = new URL(location.href); url.searchParams.set('task', id); history.replaceState(null, '', url); }
  function refreshSpace() { void client.invalidateQueries({ queryKey: ['project', project.id] }); void client.invalidateQueries({ queryKey: ['operations', project.id] }); void client.invalidateQueries({ queryKey: ['projects'] }); }
  function record(updated: TaskView) {
    client.setQueryData(['task', project.id, updated.id], { task: updated });
    client.setQueryData<{ tasks: TaskView[] }>(['tasks', project.id], current => ({ tasks: [updated, ...(current?.tasks || []).filter(item => item.id !== updated.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }));
    void client.invalidateQueries({ queryKey: ['tasks', project.id] });
  }
  const submit = useMutation({ mutationFn: async (confirmation?: RequirementRecord) => {
    if (!attempt.current) {
      const base = { operationId: crypto.randomUUID(), expectedRevision: project.revision };
      if (canContinue && task && brief) attempt.current = { taskId: task.id, body: confirmation
        ? { ...base, kind: 'confirm_requirement', expectedIntentVersion: brief.intentVersion, requirementId: confirmation.id, requirementRevision: confirmation.revision }
        : { ...base, kind: 'message', expectedIntentVersion: brief.intentVersion, message: message.trim(), ...(question ? { questionId: question.id } : {}), ...(object ? { selectedObjectId: object.id } : {}) } };
      else attempt.current = { body: { ...base, protocol: 'conversation-v1', message: message.trim(), ...(object ? { selectedObjectId: object.id } : {}), referenceFrame: 'plan' } };
    }
    const endpoint = `/api/projects/${project.id}/tasks${attempt.current.taskId ? `/${attempt.current.taskId}/inputs` : ''}`;
    const result = await api<{ task: TaskView }>(endpoint, attempt.current.body);
    if (!result.task?.id) throw new ApiError('消息的接收结果尚未确认，请重试同一条消息。', 0, 'NETWORK_ERROR');
    return result;
  }, onSuccess: ({ task: accepted }) => { if (!('kind' in attempt.current!.body) || attempt.current!.body.kind === 'message') setMessage(''); attempt.current = null; choose(accepted.id); record(accepted); setSubscription(value => value + 1); } });
  const cancel = useMutation({ mutationFn: () => api<{ task: TaskView }>(`/api/projects/${project.id}/tasks/${taskId}/cancel`, {}), onSuccess: ({ task: updated }) => { record(updated); refreshSpace(); } });
  const uncertain = submit.isError && submit.error instanceof ApiError && (submit.error.code === 'NETWORK_ERROR' || submit.error.status >= 500);
  const inputDisabled = submit.isPending || uncertain || (!!active && !canContinue);
  const sendDisabled = submit.isPending || cancel.isPending || (!uncertain && ((!!active && !canContinue) || !message.trim())) || list.isPending || list.isError;
  function revise() { attempt.current = null; submit.reset(); refreshSpace(); void list.refetch(); if (taskId) void detail.refetch(); }
  function send(event: FormEvent) { event.preventDefault(); if (!sendDisabled) submit.mutate(); }
  useEffect(() => {
    setEvents([]); setConnection('connecting'); if (!taskId) return;
    let cursor = 0;
    const source = new EventSource(`/api/projects/${project.id}/tasks/${taskId}/events?after=0`);
    const receive = (raw: Event) => {
      try {
        const event = JSON.parse((raw as MessageEvent).data) as TaskEvent;
        if (event.taskId !== taskId || !Number.isInteger(event.seq) || event.seq <= cursor) return;
        cursor = event.seq; setEvents(current => [...current, event]);
        if (event.type !== 'text') {
          void client.invalidateQueries({ queryKey: ['task', project.id, taskId] });
          void client.invalidateQueries({ queryKey: ['tasks', project.id] });
        }
        if (event.type === 'operation') { void client.invalidateQueries({ queryKey: ['project', project.id] }); void client.invalidateQueries({ queryKey: ['operations', project.id] }); void client.invalidateQueries({ queryKey: ['projects'] }); }
        const current = taskRef.current;
        if (event.type === 'status' && current?.id === taskId && (terminalTaskStatuses.has(current.status) || ['waiting_input', 'waiting_selection'].includes(current.status)) && event.seq >= current.eventsCursor) source.close();
      } catch { setConnection('retrying'); }
    };
    for (const type of ['status', 'text', 'operation', 'usage']) source.addEventListener(type, receive);
    source.onopen = () => setConnection('open'); source.onerror = () => { const current = taskRef.current; if (current?.id === taskId && (terminalTaskStatuses.has(current.status) || ['waiting_input', 'waiting_selection'].includes(current.status)) && cursor >= current.eventsCursor) source.close(); else setConnection('retrying'); };
    return () => source.close();
  }, [project.id, taskId, task?.generation, brief?.intentVersion, subscription, client]);
  const taskEvents = events.filter(event => event.taskId === taskId);
  const currentEvents = taskEvents.filter(event => (typeof event.data.generation !== 'number' || event.data.generation === task?.generation) && (!brief || typeof event.data.intentVersion !== 'number' || event.data.intentVersion === brief.intentVersion));
  const modelText = currentEvents.filter(event => event.type === 'text' && typeof event.data.text === 'string').reduce((text, event) => event.data.completeReply ? String(event.data.text) : text + event.data.text, '');
  const hasOperation = currentEvents.some(event => event.type === 'operation');
  const outcome = task?.conversation?.outcome;
  const adoptedCandidate = outcome?.kind === 'candidate' && !!outcome.operationId && !!outcome.projectRevision;
  const settled = !!task && terminalTaskStatuses.has(task.status);
  const replayPending = !!task && task.eventsCursor > (taskEvents.at(-1)?.seq ?? 0);
  const submittedId = task?.conversation?.input.selectedObjectId;
  const submittedName = submittedId ? project.scene.objects.find(item => item.id === submittedId)?.name || objectName(submittedId) : '未选择物品';
  const title = task?.status === 'completed' && outcome ? adoptedCandidate ? '候选采用已记录' : outcomeNames[outcome.kind] : task?.status === 'running' && task.conversation ? ({ accepted: '已接收', calling_model: '正在回复', validating: '正在检查本轮结果', committing: '正在保存修改', finished: '正在完成本轮' })[task.conversation.phase] : task ? statusNames[task.status] : '';
  return <section className="conversation-panel" aria-labelledby="conversation-title">
    <header className="conversation-heading"><h2 id="conversation-title">聊聊空间，做一点改变。</h2><p>问一个问题，或说出想调整的家具。接收后，关页也会继续。</p></header>
    <div className="conversation-layout">
      <aside className="conversation-space" aria-label="当前空间与修改对象">
        <div className="conversation-scene-heading"><span>当前空间{project.synthetic ? ' · 合成测试' : ''}</span><span>版本 {project.revision}</span></div>
        <div className="conversation-stage"><SceneViewport projectId={project.id} scene={project.scene}/></div>
        <div className="conversation-context"><label className="field">本轮关注的物品<select aria-label="本轮关注的物品" value={object?.id || ''} disabled={inputDisabled} onChange={event => { onSelect(event.target.value || null); attempt.current = null; submit.reset(); }}><option value="">未选择 · 可以先提问</option>{project.scene.objects.map(item => <option key={item.id} value={item.id}>{item.name || objectName(item.id)}{item.kind === 'fixed' ? ' · 固定设施' : project.lockedObjectIds.includes(item.id) ? ' · 已锁定' : ''}</option>)}</select></label>
          <p>{protectedObject ? '此物品受保护，可以围绕它提问；不会通过对话移动固定或锁定物品。' : object ? '本轮关注这件家具。方向按图纸的上、下、左、右理解，不随观察角度改变。' : '先选中家具，再明确说出移动距离或旋转角度。没有选择时也可以提问。'}</p>
          <button className="text-button" onClick={onOpenSpace}>打开 3D 空间与撤销记录<Icon name="arrow" size={16}/></button>
        </div>
        {brief && <details className="conversation-brief" open={briefExpanded} onToggle={event => setBriefExpanded(event.currentTarget.open)}><summary className="conversation-brief-heading"><h3>关于这个家的需求</h3><span>{brief.requirements.length} 条 · 第 {brief.intentVersion} 次补充<Icon name="arrow" size={14}/></span></summary>
          <p className="conversation-note">明确提出的要求与待确认的建议分开记录。确认建议只更新需求，不代表已经改变空间。</p>
          {brief.summary && <p className="conversation-brief-summary">{brief.summary}</p>}
          {!brief.requirements.length && <p className="conversation-note">还没有整理出的需求。可以从居住习惯、想保留的物品或正在犹豫的安排开始说。</p>}
          <ul className="conversation-requirements">{brief.requirements.map(requirement => <li key={requirement.id} data-requirement-id={requirement.id}><span className={`requirement-source source-${requirement.sourceKind}`}>{sourceNames[requirement.sourceKind]}</span><p>{requirement.content}</p>
            <details className="conversation-source"><summary>查看来源</summary>{requirement.sourceInputIds.length ? requirement.sourceInputIds.map(id => { const source = brief.inputs.find(input => input.id === id); return <blockquote key={id}>{source?.text || '来源记录暂不可读'}<small>你的第 {source?.intentVersion ?? '—'} 次补充</small></blockquote>; }) : <p>由助手在第 {requirement.createdAtIntentVersion} 次整理时提出。</p>}{requirement.confirmedByInputId && <p>你通过“确认这条需求”明确确认了此建议。</p>}</details>
            {requirement.sourceKind === 'assistant_suggestion' && <button type="button" className="text-button" aria-label={`确认需求：${requirement.content}`} disabled={!canContinue || submit.isPending || uncertain || cancel.isPending} onClick={() => submit.mutate(requirement)}>确认这条需求<Icon name="check" size={14}/></button>}
          </li>)}</ul>
        </details>}
      </aside>
      <div className="conversation-dialogue">
        <div className="conversation-history"><h3>空间对话</h3>{!!list.data?.tasks.length && <label><span className="conversation-history-label">查看记录</span><select aria-label="查看对话记录" value={taskId || ''} disabled={submit.isPending || uncertain} onChange={event => { choose(event.target.value); cancel.reset(); attempt.current = null; submit.reset(); }}>{list.data.tasks.map(item => <option key={item.id} value={item.id}>{date(item.createdAt)} · {item.conversation?.input.message.slice(0, 28) || '历史协议测试'}</option>)}</select></label>}<button className="text-button" onClick={() => { void list.refetch(); if (taskId) void detail.refetch(); }} disabled={list.isFetching}>刷新</button></div>
        {list.isPending && <p className="conversation-status" role="status">正在读取对话…</p>}
        {list.isError && <p className="conversation-error" role="alert">{readable(list.error)}</p>}
        {!taskId && !list.isPending && !list.isError && <div className="conversation-empty"><h4>从一个具体的想法开始。</h4><p>“我想保留书桌，也需要安静的阅读角。”<br/>也可以选中书桌，再说“沿图纸向右移动 20 厘米”。</p><p>可以整理需求、回答问题、调整选中的家具，也可以请求为单个房间生成会客与办公布局。推荐会先存为候选，由你决定采用。</p></div>}
        {taskId && detail.isPending && <p className="conversation-status" role="status">正在恢复这轮对话…</p>}
        {detail.isError && <p className="conversation-error" role="alert">{readable(detail.error)}</p>}
        {!!brief?.history.length && <details className="conversation-past"><summary>之前的沟通 · {brief.history.length} 次</summary>{brief.history.map(turn => <article key={turn.intentVersion}><h4>第 {turn.intentVersion} 次补充{turn.status === 'superseded' ? ' · 已被新补充替代' : ''}</h4><p className="conversation-past-question">你：{turn.input.message}</p>{turn.outcome && <p className="conversation-note">当时结果：{turn.outcome.message}</p>}{turn.reply && <p>助手：{turn.reply}</p>}{turn.status === 'superseded' && <small>这是旧要求下的记录，未完成的提案不会继续执行。</small>}</article>)}</details>}
        {task && <article className="conversation-turn" aria-label="当前对话记录">
          {task.conversation ? <div className="conversation-question"><span>你</span><p>{task.conversation.input.message}</p><small>提交时关注：{submittedName} · 按图纸方向</small></div> : <p className="conversation-note">这是一条历史协议测试，不是模型回答。</p>}
          <div className="conversation-state"><h4 role="status">{title}</h4>{!settled && <button className="text-button" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{cancel.isPending ? '正在取消…' : '取消本轮'}</button>}</div>
          <p className="conversation-note">{stateExplanation[task.status]}</p>
          {outcome && <div className={`conversation-outcome outcome-${outcome.kind}`}><p>{outcome.message}</p>{outcome.kind === 'applied' && <><small>本轮保存于版本 {outcome.projectRevision} · 当前空间版本 {project.revision}</small><button className="text-button" onClick={() => { if (outcome.objectId) onSelect(outcome.objectId); onOpenSpace(); }}>查看修改与撤销<Icon name="arrow" size={16}/></button></>}{outcome.kind === 'candidate' && outcome.candidateId && <><small>{adoptedCandidate ? `采用记录对应空间版本 ${outcome.projectRevision}，当前空间版本 ${project.revision}；可查看空间与撤销记录。` : '仅生成候选，不代表已采用或完成整套设计。'}</small><button className="text-button" onClick={() => onOpenCandidate(outcome.candidateId!)}>{adoptedCandidate ? '查看候选记录' : '查看推荐候选'}<Icon name="arrow" size={16}/></button></>}{outcome.kind === 'clarification' && <small>{waiting ? '请回答下方问题，或补充你希望保留的条件。' : '请补充对象或方向，完整描述要求后再发送。'}</small>}</div>}
          {outcome?.planReport && outcome.kind !== 'candidate' && <LayoutPlanReport report={outcome.planReport} brief={brief}/>}
          {modelText && <div className="conversation-response"><h5>助手回复</h5><p>{modelText}</p><small>{settled ? '空间操作以上方已记录的本轮结果为准。' : hasOperation ? '修改已记录，正在完成本轮。' : '本轮尚未完成；回复文字不代表空间已经修改。'}</small></div>}
          {settled && replayPending && <p className="conversation-note" role="status">正在读取本轮已保存的回复…</p>}
          {retained && task.status !== 'completed' && settled && (retained.answerCount > 0 || retained.requirementCount > 0 || retained.candidateIds.length > 0) && <section className="conversation-retained" aria-label="已保留的成果"><h5>已保留的成果</h5><p>{retained.answerCount > 0 ? `${retained.answerCount} 次回答` : ''}{retained.answerCount > 0 && retained.requirementCount > 0 ? ' · ' : ''}{retained.requirementCount > 0 ? `${retained.requirementCount} 条需求` : ''}</p>{retained.candidateIds.map((id, index) => <button key={id} className="text-button" onClick={() => onOpenCandidate(id)}>查看已保存候选{retained.candidateIds.length > 1 ? ` ${index + 1}` : ''}<Icon name="arrow" size={14}/></button>)}</section>}
          {execution && execution.unresolvedAttempts > 0 && <div className="conversation-usage">{execution.unresolvedAttempts > 0 && <p>有 {execution.unresolvedAttempts} 次模型请求的用量待核对，已保留相应额度，不按零用量处理。</p>}{execution.reservedTokens > 0 && <small>处理额度仍有预留；这是本任务的运行上限记录，不代表实际费用。</small>}</div>}
          {task.error && <p className="conversation-error" role="alert">{task.error.message}</p>}
          {cancel.isError && <p className="conversation-error" role="alert">{readable(cancel.error)}</p>}
          {((!settled && !waiting && !awaitingSelection) || replayPending) && connection === 'retrying' && <p className="conversation-note" role="status">实时连接暂时中断，正在重连。<button className="text-button" onClick={() => setSubscription(value => value + 1)}>重新连接</button></p>}
          <p className="conversation-time">更新于 <time dateTime={task.updatedAt}>{date(task.updatedAt)}</time></p>
        </article>}
        {!!brief?.questions.length && <section className="conversation-questions" aria-labelledby="questions-title"><h4 id="questions-title">{canContinue ? '继续前，想了解的事' : '已保存的问题'}</h4>{openQuestions.map(item => <div className="conversation-open-question" key={item.id}><p>{item.prompt}</p><button type="button" className="text-button" disabled={!canContinue || inputDisabled} aria-pressed={questionId === item.id} onClick={() => { setQuestionId(item.id); document.getElementById(`conversation-message-${project.id}`)?.focus(); }}>{questionId === item.id ? '正在回答这条问题' : '回答这条问题'}<Icon name="arrow" size={14}/></button></div>)}{!openQuestions.length && <p className="conversation-note">{canContinue ? '目前的问题都已回答；仍可以继续补充需求。' : '已回答的信息保留在记录中。'}</p>}{brief.questions.some(item => item.status === 'answered') && <details className="conversation-answered"><summary>已回答的问题 · {brief.questions.filter(item => item.status === 'answered').length}</summary>{brief.questions.filter(item => item.status === 'answered').map(item => <div key={item.id}><p>{item.prompt}</p><blockquote>{brief.inputs.find(input => input.id === item.answerInputId)?.text || '回答记录暂不可读'}</blockquote></div>)}</details>}</section>}
        <form className="conversation-compose" onSubmit={send}>
          <label htmlFor={`conversation-message-${project.id}`}>{question ? '补充这条问题' : '说说你的想法'}</label>{question && <p className="conversation-answer-context">{question.prompt}<button type="button" className="text-button" disabled={inputDisabled} onClick={() => setQuestionId(null)}>改为一般补充</button></p>}<textarea id={`conversation-message-${project.id}`} value={message} disabled={inputDisabled} maxLength={4000} rows={3} placeholder={canContinue ? '补充居住习惯、保留条件，或回答选中的问题…' : '问一个空间问题，或描述选中家具的调整要求…'} onChange={event => { setMessage(event.target.value); attempt.current = null; submit.reset(); }}/>
          <div className="conversation-send-row"><span>{selectedName}{protectedObject ? ' · 受保护' : ''}</span><button className="button primary" disabled={sendDisabled}>{submit.isPending ? '正在发送…' : uncertain ? attempt.current && 'kind' in attempt.current.body && attempt.current.body.kind === 'confirm_requirement' ? '重试这次确认' : '重试同一条消息' : '发送'}<Icon name="arrow" size={18}/></button></div>
          {canContinue && <p className="conversation-note">{waiting ? question ? '回答会保存到这条问题，并继续同一项任务。' : '补充会保留在同一项任务中。回答具体问题时，请先选择“回答这条问题”。' : awaitingSelection ? '新的补充仍属于同一项任务；已经保存的候选会保留。' : task?.status === 'completed' ? '继续补充会沿用已有需求和沟通记录。' : '可以补充新要求；新补充会替代尚未完成的旧提案。'}</p>}
          {task && ['failed', 'cancelled', 'partial'].includes(task.status) && <p className="conversation-note">这项任务已结束，记录仍然保留。再次发送会开始新的任务。</p>}
          {awaitingSelection && <p className="conversation-note">可以先查看候选，也可以继续补充要求；旧候选会作为记录保留，不会自动采用。</p>}
          {active && !canContinue && <p className="conversation-note" role="status">这个项目已有一项任务需要处理。{active.id !== taskId && <button className="text-button" type="button" onClick={() => choose(active.id)}>查看正在处理的一项</button>}</p>}
          {submit.isError && <div className="conversation-error" role="alert"><p>{uncertain ? '发送结果尚未确认。重试会核对同一条消息，不会重复创建。' : readable(submit.error)}</p>{!uncertain && <button type="button" className="text-button" onClick={revise}>读取最新空间后重试</button>}</div>}
          <p className="conversation-help">明确的局部修改通过检查后直接应用，可以撤销。问答与澄清不会改变家具。</p>
        </form>
      </div>
    </div>
  </section>;
}
