'use client';
// 企业设置 · 模型（AM03，ADR-0018）：只有企业管理员可见。模型由平台分配，企业只能启用、停用、设默认；额度、并发与可用模型
// 由我方设置。按定稿原型 enterprise-workbench 的「企业设置」实现；用量页由 AM04 接入。
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClientError } from '../client/client-api';
import { Shell, useWorkbench } from './workbench-app';
import { useRouter, useSearchParams } from 'next/navigation';
import { MonthTools, UsageTable, type UsageReport } from '../admin/admin-usage';

type EnterpriseModel = { id: string; modelId: string; name: string; description: string; enabled: boolean; isDefault: boolean; availability: 'ok' | 'platform_disabled' | 'not_ready' };
type Models = { role: 'admin' | 'member'; models: EnterpriseModel[]; defaultModel: string | null; quota: { limit: number | null; used: number; reserved: number; exhausted: boolean; concurrency?: number } };
const yuan = (fen: number) => `¥${(fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function request<T>(method: 'GET' | 'PATCH', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new ClientError('连接中断，请检查网络后重试。', 0, 'NETWORK_ERROR'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ClientError(data.error?.message || '请求未完成，请稍后重试。', response.status, data.error?.code);
  return data as T;
}
export const enterpriseModelsOf = (workspaceId: string) => request<Models>('GET', `/api/workspaces/${workspaceId}/models`);

export function SettingsView({ tab }: { tab: string }) {
  const { workspace } = useWorkbench();
  if (workspace.role !== 'admin') return <Shell nav="settings"><div className="page"><div className="empty"><b>只有企业管理员可以查看设置</b>需要启用模型或查看用量，请联系企业管理员。</div></div></Shell>;
  return <Shell nav="settings"><div className="page">
    <header className="page__head"><div><h1 className="page__title">企业设置</h1><p className="page__sub">只有企业管理员能看到这里。</p></div></header>
    <div className="list-tools"><SettingsNav tab={tab}/></div>
    {tab === 'models' ? <ModelsSettings/> : tab === 'usage' ? <UsageSettings/> : <div className="empty"><b>找不到这个页面</b>请从「模型」进入。</div>}
  </div></Shell>;
}

function SettingsNav({ tab }: { tab: string }) {
  const { base, go } = useWorkbench();
  return <div className="segmented segmented--fit" role="tablist" aria-label="设置">{[['models', '模型'], ['usage', '用量']].map(([key, label]) =>
    <button type="button" key={key} role="tab" aria-selected={tab === key} aria-pressed={tab === key} onClick={() => go(`${base}/settings/${key}`)}>{label}</button>)}</div>;
}

function UsageSettings() {
  const { workspace, base } = useWorkbench(), router = useRouter(), query = useSearchParams();
  const month = query.get('month') ?? '', by = query.get('by') ?? 'member', params = new URLSearchParams({ ...(month ? { month } : {}), by }).toString();
  const usage = useQuery({ queryKey: ['enterprise-usage', workspace.id, params], queryFn: () => request<UsageReport>('GET', `/api/workspaces/${workspace.id}/usage?${params}`) });
  if (usage.error) return <div className="empty"><b>暂时无法读取用量</b>{(usage.error as Error).message}</div>;
  if (!usage.data) return <p className="page-loading">正在读取…</p>;
  return <>
    <MonthTools report={usage.data} byOptions={[['member', '按成员'], ['model', '按模型']]} onChange={(m, b) => router.push(`${base}/settings/usage?${new URLSearchParams({ month: m, by: b })}`)}/>
    <UsageTable report={usage.data} label={usage.data.by === 'member' ? '成员' : '模型'} showUnverified={false}/>
    <p className="small muted" style={{ marginTop: 12 }}>金额按每次调用当时的单价折算，用于和我方结算；单价不在这里显示。服务商没有返回用量的调用按预占额计入。</p>
  </>;
}

function ModelsSettings() {
  const { workspace } = useWorkbench(), queries = useQueryClient(), key = ['enterprise-models', workspace.id];
  const models = useQuery({ queryKey: key, queryFn: () => enterpriseModelsOf(workspace.id) });
  const [notice, setNotice] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { enabled?: boolean; isDefault?: true } }) => request<Models>('PATCH', `/api/workspaces/${workspace.id}/models/${id}`, body),
    onMutate: () => setNotice(null),
    onSuccess: data => queries.setQueryData(key, data),
    onError: error => setNotice(error instanceof ClientError ? error.message : '没有完成，请稍后重试。'),
  });
  if (models.error) return <div className="empty"><b>暂时无法读取模型设置</b>{(models.error as Error).message}</div>;
  if (!models.data) return <p className="page-loading">正在读取…</p>;
  const { models: list, defaultModel, quota } = models.data, usable = list.filter(m => m.enabled && m.availability === 'ok').length;
  return <div className="settings-grid">
    <section className="panel"><div className="panel__head"><h2 className="panel__title">可用模型</h2><span className="small muted">{usable} 个已启用</span></div><div className="panel__body">
      {notice && <p className="note note--danger" role="alert"><span><b>没有完成</b>{notice}</span></p>}
      {list.length ? <ul className="model-list">{list.map(model => {
        const off = model.availability !== 'ok', isDefault = model.id === defaultModel && model.isDefault;
        return <li className={`model-row${off ? ' model-row--off' : ''}`} key={model.id}>
          <div className="model-row__main"><b>{model.name}</b>{isDefault && <span className="tag">默认</span>}
            {model.availability === 'platform_disabled' && <span className="tag tag--act">平台已停用</span>}{model.availability === 'not_ready' && <span className="tag tag--act">暂不可用</span>}
            <small><span className="mono">{model.modelId}</span>{model.description ? ` · ${model.description}` : ''}</small></div>
          <div className="model-row__actions">
            {model.enabled && !isDefault && !off && <button className="btn btn--secondary btn--sm" disabled={change.isPending} onClick={() => change.mutate({ id: model.id, body: { isDefault: true } })}>设为默认</button>}
            <button type="button" className="switch" role="switch" aria-checked={model.enabled && !off} aria-label={`启用「${model.name}」`} disabled={off || change.isPending}
              onClick={() => change.mutate({ id: model.id, body: { enabled: !model.enabled } })}><i/></button>
          </div></li>;
      })}</ul> : <div className="empty"><b>还没有开通模型</b>请联系我方开通，开通后会出现在这里。</div>}
      <p className="small muted" style={{ marginTop: 12 }}>成员在 Agent 助手里只能选择已启用的模型，默认选中「默认」模型。停用某个模型后，正在用它的任务会在当前一步结束后停止，已有成果保留。</p>
    </div></section>
    <QuotaPanel quota={quota}/>
  </div>;
}

function QuotaPanel({ quota }: { quota: Models['quota'] }) {
  const free = quota.limit === null, left = free ? null : quota.limit! - quota.used - quota.reserved;
  const pct = !free && quota.limit ? Math.min(100, Math.round((quota.used + quota.reserved) / quota.limit * 100)) : 0;
  return <section className="panel"><div className="panel__head"><h2 className="panel__title">本月额度</h2><span className="small muted num">{free ? '不限' : quota.limit ? yuan(quota.limit) : '未设置'}</span></div><div className="panel__body">
    <dl className="ledger"><div><dt>已用</dt><dd className="num">{yuan(quota.used)}</dd></div><div><dt>预占中</dt><dd className="num">{yuan(quota.reserved)}</dd></div>
      <div><dt>剩余</dt><dd className={`num${left !== null && left <= 0 ? ' danger' : ''}`}>{free ? '不限' : yuan(Math.max(0, left!))}</dd></div></dl>
    {free ? <p className="small muted">本企业的额度不设上限，只统计用量，不会因额度停止。</p>
      : <span className={`meter${left! <= 0 ? ' meter--full' : ''}`} role="img" aria-label={`已用 ${pct}%`}><i style={{ width: `${pct}%` }}/></span>}
    {quota.exhausted && !free && <p className="note note--hint"><span><b>{quota.limit ? '本月额度已用完' : '还没有设置本月额度'}</b>新的请求不会发出，已有方案不受影响。需要调整请联系我方。</span></p>}
    <p className="small muted" style={{ marginTop: 12 }}>同时运行的 Agent 任务最多 <span className="num">{quota.concurrency}</span> 个，超过时排队。额度、并发与可用模型由我方设置，需要调整请联系我方。</p>
  </div></section>;
}
