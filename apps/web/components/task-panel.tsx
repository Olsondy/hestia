'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type ProjectView } from './api';
import { Icon } from './icons';
import type { CreateTask, TaskEvent, TaskView, TaskStatus } from '../../../packages/contracts/src/tasks';
import { terminalTaskStatuses } from '../../../packages/contracts/src/tasks';
import './task-panel.css';

const statusNames:Record<TaskStatus,string>={queued:'等待执行',running:'执行中',retry_wait:'等待重试',waiting_input:'等待补充',waiting_selection:'等待采用',completed:'已完成',partial:'部分完成',failed:'未完成',cancelled:'已取消'};
const explain:Record<TaskStatus,string>={queued:'任务已接收，尚未开始执行。关闭页面不会取消已接收的任务。',running:'正在执行已接受的测试步骤。可以离开页面，稍后回来查看。',retry_wait:'本次执行暂时中断，正在等待下一次尝试。',waiting_input:'等待用户补充必要信息。',waiting_selection:'候选已保存，等待用户查看后决定是否采用。',completed:'所有测试步骤已执行完成。此结果不代表真实 AI 设计能力。',partial:'任务未全部完成，已应用的步骤会保留。家具修改可回到 3D 空间查看或撤销。',failed:'任务未能完成，请查看下方原因。',cancelled:'已停止后续步骤；此前已应用的修改会保留，可回到 3D 空间查看或撤销。'};
const readable=(error:unknown)=>error instanceof Error?error.message:'请求未完成，请重试。';
const objectNames:Record<string,string>={sofa:'沙发',table:'茶几',desk:'书桌',bed:'床',fixed:'固定柜'};
const objectName=(id:string)=>objectNames[id.split('-')[0]]||'所选家具';
const date=(value:string)=>new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));

/** Protocol-only workbench: submitting and subscribing never starts a Worker. */
export function TaskPanel({projectId,selectedObjectId}:{projectId:string;selectedObjectId?:string|null}) {
  const client=useQueryClient(),attempt=useRef<CreateTask|null>(null);
  const [selected,setSelected]=useState<string|null>(null),[mode,setMode]=useState<'text'|'move'>('text');
  const [events,setEvents]=useState<TaskEvent[]>([]),[connection,setConnection]=useState<'connecting'|'open'|'retrying'>('connecting'),[subscription,setSubscription]=useState(0);
  const list=useQuery({queryKey:['tasks',projectId],queryFn:()=>api<{tasks:TaskView[]}>(`/api/projects/${projectId}/tasks`)});
  const project=useQuery({queryKey:['project',projectId],queryFn:()=>api<{project:ProjectView}>(`/api/projects/${projectId}`)});
  const taskId=selected||list.data?.tasks[0]?.id;
  const detail=useQuery({queryKey:['task',projectId,taskId],queryFn:()=>api<{task:TaskView}>(`/api/projects/${projectId}/tasks/${taskId}`),enabled:!!taskId});
  const task=detail.data?.task, active=list.data?.tasks.find(item=>!terminalTaskStatuses.has(item.status));
  const object=project.data?.project.scene.objects.find(item=>item.id===selectedObjectId);
  const canMove=!!project.data?.project.synthetic&&object?.kind==='furniture'&&!project.data.project.lockedObjectIds.includes(object.id);
  useEffect(()=>{setSelected(new URLSearchParams(location.search).get('task'));setMode('text');attempt.current=null;},[projectId]);
  useEffect(()=>{if(!canMove)setMode('text');},[canMove]);
  function choose(id:string){setSelected(id);const url=new URL(location.href);url.searchParams.set('task',id);history.replaceState(null,'',url);}
  function record(updated:TaskView){client.setQueryData(['task',projectId,updated.id],{task:updated});client.setQueryData<{tasks:TaskView[]}>(['tasks',projectId],current=>({tasks:[updated,...(current?.tasks||[]).filter(item=>item.id!==updated.id)].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}));void client.invalidateQueries({queryKey:['tasks',projectId]});}
  const submit=useMutation({mutationFn:async()=>{
    if(!project.data)throw new Error('项目尚未读取完成，请稍后重试。');
    if(!attempt.current){
      if(mode==='move'&&(!canMove||!object))throw new Error('请在合成测试空间选择未锁定的家具。');
      const steps:CreateTask['steps']=[{type:'text',text:'这是一条确定性协议测试消息，不是模型回答，也不是设计建议。'}];
      if(mode==='move'&&object){steps.push({type:'command',command:{type:'move-furniture',objectId:object.id,x:Number((object.position.x+.2).toFixed(6)),z:object.position.z,yaw:object.yaw%(Math.PI*2)}});steps.push({type:'text',text:'固定移动步骤已执行。请回到 3D 空间查看；这不是 AI 生成的布局。'});}
      attempt.current={operationId:crypto.randomUUID(),expectedRevision:project.data.project.revision,protocol:'deterministic-v1',steps};
    }
    return api<{task:TaskView}>(`/api/projects/${projectId}/tasks`,attempt.current);
  },onSuccess:({task:accepted})=>{attempt.current=null;choose(accepted.id);record(accepted);}});
  const cancel=useMutation({mutationFn:()=>api<{task:TaskView}>(`/api/projects/${projectId}/tasks/${taskId}/cancel`,{}),onSuccess:data=>{record(data.task);void client.invalidateQueries({queryKey:['project',projectId]});}});
  useEffect(()=>{
    setEvents([]);setConnection('connecting');if(!taskId)return;
    // Replay persisted events from zero on reopening; EventSource sends Last-Event-ID
    // on transport reconnect. Local deduplication makes either replay harmless.
    let cursor=0;const source=new EventSource(`/api/projects/${projectId}/tasks/${taskId}/events?after=0`);
    const receive=(raw:Event)=>{try{const event=JSON.parse((raw as MessageEvent).data) as TaskEvent;if(event.taskId!==taskId||!Number.isInteger(event.seq)||event.seq<=cursor)return;cursor=event.seq;setEvents(current=>[...current,event]);void client.invalidateQueries({queryKey:['task',projectId,taskId]});void client.invalidateQueries({queryKey:['tasks',projectId]});if(event.type==='operation'){void client.invalidateQueries({queryKey:['project',projectId]});void client.invalidateQueries({queryKey:['operations',projectId]});}if(event.type==='status'&&typeof event.data.status==='string'&&terminalTaskStatuses.has(event.data.status as TaskStatus))source.close();}catch{setConnection('retrying');}};
    for(const type of ['status','text','operation','usage'])source.addEventListener(type,receive);
    source.onopen=()=>setConnection('open');source.onerror=()=>setConnection('retrying');
    return()=>source.close();
  },[projectId,taskId,subscription,client]);
  const pending=submit.isPending||cancel.isPending;
  const unknownSubmission=submit.isError&&submit.error instanceof ApiError&&submit.error.code==='NETWORK_ERROR';
  const revise=()=>{attempt.current=null;submit.reset();void project.refetch();void list.refetch();};
  return <section className={`task-panel${taskId?' has-task':''}`} aria-labelledby="task-panel-title"><header className="task-heading"><div><h2 id="task-panel-title">让每一步，有迹可循。</h2><p>提交后可以离开，回来继续查看同一条任务。</p></div><span className="task-test-label">协议测试 · 非真实 AI 设计</span></header>
    <div className="task-layout"><aside className="task-compose"><h3>创建测试任务</h3><p className="task-description">选择一段固定文字，或在合成空间验证一次明确的家具移动。</p>
      <fieldset disabled={pending||!!active||unknownSubmission}><legend>测试内容</legend><label className="task-choice"><input type="radio" name={`task-mode-${projectId}`} checked={mode==='text'} onChange={()=>{setMode('text');attempt.current=null;submit.reset();}}/><span>仅文字<span>返回预先写好的测试消息，不修改空间。</span></span></label><label className="task-choice"><input type="radio" name={`task-mode-${projectId}`} checked={mode==='move'} disabled={!canMove} onChange={()=>{setMode('move');attempt.current=null;submit.reset();}}/><span>文字与固定移动<span>{canMove&&object?`${objectName(object.id)}沿 X 正方向移动 0.20 m，使用合成测试尺寸。`:'仅限合成空间中已选中、未锁定的家具。'}</span></span></label></fieldset>
      {!canMove&&<p className="task-help">需要测试移动时，请先回到合成项目的 3D 空间选中家具。用户项目在此仅提供文字测试。</p>}
      {mode==='move'&&object&&<p className="task-help">执行时仍会检查锁定、尺度、碰撞与项目版本；不满足条件会停止，不会强行移动。</p>}
      {active&&<p className="task-help" role="status">此项目已有一条进行中的任务。完成或取消后可再提交。</p>}
      {submit.isError&&<div className="task-error" role="alert"><p>{readable(submit.error)}</p>{!unknownSubmission&&<button className="text-button" onClick={revise}>重新读取项目状态</button>}</div>}
      <button className="button primary task-submit" disabled={pending||!!active||!project.data||list.isPending||list.isError} onClick={()=>submit.mutate()}>{submit.isPending?'正在提交…':unknownSubmission?'重试同一条任务':'提交测试任务'}<Icon name="arrow" size={18}/></button>
      <p className="task-help">只有点击提交才会创建任务。刷新、重开和重连不会重新提交。</p>
    </aside><div className="task-records"><header className="task-records-heading"><h3>任务记录</h3><button className="text-button" onClick={()=>{void list.refetch();void detail.refetch();}} disabled={list.isFetching}>刷新记录</button></header>
      {list.isPending&&<p className="task-status" role="status">正在读取任务记录…</p>}{list.isError&&<p className="task-error" role="alert">{readable(list.error)}</p>}
      {!!list.data?.tasks.length&&<div className="task-history" aria-label="任务历史">{list.data.tasks.map(item=><button key={item.id} className={taskId===item.id?'selected':''} aria-pressed={taskId===item.id} onClick={()=>{choose(item.id);cancel.reset();}}><span>{statusNames[item.status]}</span><time dateTime={item.createdAt}>{date(item.createdAt)}</time><small>{item.id.slice(0,8)}</small></button>)}</div>}
      {!list.isPending&&!list.isError&&!list.data?.tasks.length&&<div className="task-empty"><h4>这里会留下执行记录。</h4><p>先提交一条测试任务，查看接收状态，再尝试离开和返回。</p></div>}
      {taskId&&detail.isPending&&<p className="task-status" role="status">正在恢复任务…</p>}{detail.isError&&<p className="task-error" role="alert">{readable(detail.error)}</p>}
      {task&&<article className="task-detail" aria-labelledby="task-state-title"><div className="task-state-row"><h4 id="task-state-title" role="status">{statusNames[task.status]}</h4>{!terminalTaskStatuses.has(task.status)&&<button className="button secondary" disabled={pending} onClick={()=>cancel.mutate()}>{cancel.isPending?'正在取消…':'取消任务'}</button>}</div><p className="task-state-explanation">{explain[task.status]}</p><dl className="task-facts"><div><dt>已执行步骤</dt><dd>{task.checkpoint.nextStep} / {task.checkpoint.totalSteps}</dd></div><div><dt>最后更新</dt><dd><time dateTime={task.updatedAt}>{date(task.updatedAt)}</time></dd></div></dl><p className="task-reference">任务编号 <span>{task.id}</span></p>
        {task.error&&<p className="task-error" role="alert">{task.error.message}</p>}{cancel.isError&&<p className="task-error" role="alert">{readable(cancel.error)}</p>}
        <div className="task-output" aria-live="polite" aria-relevant="additions"><h5>已记录的输出</h5>{events.filter(event=>event.type==='text').map(event=><p key={event.seq}>{typeof event.data.text==='string'?event.data.text:'已记录一段测试输出。'}</p>)}{!events.some(event=>event.type==='text')&&<p className="task-help">尚无文字输出。任务状态以服务端记录为准。</p>}{events.filter(event=>event.type==='operation').map(event=><p key={event.seq}>已记录一次空间操作。请回到 3D 空间查看结果。</p>)}</div>
        {!terminalTaskStatuses.has(task.status)&&connection==='retrying'&&<p className="task-connection" role="status">实时连接暂时中断，正在重连。<button className="text-button" onClick={()=>setSubscription(value=>value+1)}>重新连接</button></p>}
      </article>}
    </div></div></section>;
}
