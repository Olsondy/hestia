'use client';
// 平台管理后台 · 企业（AM03，ADR-0018）：为每家企业分配可用模型、月度额度（可设“不限”）与同时运行的 Agent 任务数。
// 只有已准入、已定价的模型能新分配；企业管理员只在分配范围内启用与设默认。按定稿原型 admin-console 实现。
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ModelView as ModelData, ServiceView as ServiceData } from '../../../../packages/contracts/src/models';
import { ClientError } from '../client/client-api';
import { send, useLoad, yuan } from './admin-api';

type Grant = { id: string; modelId: string; name: string; state: ModelData['state']; enabled: boolean; isDefault: boolean; serviceName: string };
type Enterprise = { id: string; ref: string; slug: string | null; kind: 'enterprise' | 'personal'; owner: string | null; name: string; domains: string[]; quota: number | null; concurrency: number; used: number; reserved: number; grants: Grant[] };
const message = (error: unknown) => error instanceof ClientError && error.message ? error.message : '请求未完成，请稍后重试。';
const Tag = ({ text, act }: { text: string; act?: boolean }) => <span className={`tag${act ? ' tag--act' : ''}`}>{text}</span>;
const Meter = ({ used, quota }: { used: number; quota: number }) => { const pct = quota ? Math.min(100, Math.round(used / quota * 100)) : 0;
  return <span className={`meter${quota && used >= quota ? ' meter--full' : ''}`} role="img" aria-label={`已用 ${pct}%`}><i style={{ width: `${pct}%` }}/></span>; };
const full = (e: Enterprise) => e.quota !== null && e.used + e.reserved >= e.quota;

export function WorkspacesView() {
  const { data, error } = useLoad<{ enterprises: Enterprise[] }>('/api/admin/workspaces');
  if (error) return <div className="page"><div className="empty"><b>暂时无法读取企业</b>{message(error)}</div></div>;
  if (!data) return <p className="page-loading">正在读取…</p>;
  return <div className="page">
    <div className="page__head"><div><h1 className="page__title">工作空间</h1><p className="page__sub">为每家企业和每个个人空间指定可用模型、月度额度与同时运行的 Agent 任务数。月份按北京时间自然月计算。</p></div></div>
    {!data.enterprises.length ? <div className="empty"><b>还没有工作空间</b>企业由服务器命令创建（pnpm workspace），个人空间在用户注册后出现。</div>
      : <div className="table table--ws"><div className="table__head"><span>工作空间</span><span>可用模型</span><span>本月用量 / 额度</span><span>并发上限</span><span>状态</span><span/></div>
        {data.enterprises.map(e => <Link className="table__row" key={e.id} href={`/admin/workspaces/${encodeURIComponent(e.ref)}`}>
          <span className="cell-main"><b>{e.name}{e.kind === 'personal' && <> <Tag text="个人"/></>}</b><small className="mono">{e.kind === 'personal' ? e.owner : e.domains[0] ?? e.slug}</small></span>
          <span className="small">{e.grants.length ? e.grants.map(g => g.name).join('、') : <span className="muted">—</span>}</span>
          <span className="usage-cell">{e.quota === null ? <span className="num small">¥{yuan(e.used)} / 不限</span> : e.quota === 0 ? <span className="small muted">未设额度</span>
            : <><span className="num small">¥{yuan(e.used)} / ¥{yuan(e.quota)}</span><Meter used={e.used + e.reserved} quota={e.quota}/></>}</span>
          <span className="num small">{e.concurrency}</span>
          <span>{!e.grants.length ? <Tag text="未开通"/> : full(e) && e.quota ? <Tag text="本月额度已用完" act/> : null}</span><span className="chev">›</span></Link>)}</div>}
  </div>;
}

type Draft = { grants: string[]; free: boolean; quota: string; concurrency: string };
const draftOf = (e: Enterprise): Draft => ({ grants: e.grants.map(g => g.id), free: e.quota === null, quota: e.quota === null ? '' : yuan(e.quota), concurrency: String(e.concurrency) });
const stateName: Record<ModelData['state'], string> = { draft: '待检查', checking: '检查中', admitted: '已准入', failed: '检查未通过', stale: '需重新检查', disabled: '已停用' };

export function WorkspaceView({ slug }: { slug: string }) {
  const enterprise = useLoad<{ enterprise: Enterprise }>(`/api/admin/workspaces/${encodeURIComponent(slug)}`);
  const registry = useLoad<{ services: ServiceData[]; models: ModelData[] }>('/api/admin/services');
  if (enterprise.error) return <div className="page"><div className="empty"><b>{enterprise.error.status === 404 ? '企业不存在' : '暂时无法读取'}</b>{message(enterprise.error)}</div></div>;
  if (!enterprise.data || !registry.data) return <p className="page-loading">正在读取…</p>;
  const e = enterprise.data.enterprise;
  return <GrantForm key={JSON.stringify([e.grants.map(g => g.id), e.quota, e.concurrency])} enterprise={e} registry={registry.data}
    saved={next => enterprise.setData({ enterprise: next })}/>;
}

function GrantForm({ enterprise, registry, saved }: { enterprise: Enterprise; registry: { services: ServiceData[]; models: ModelData[] }; saved: (e: Enterprise) => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(enterprise)), [busy, setBusy] = useState(false), [failure, setFailure] = useState<string | null>(null);
  const base = useMemo(() => draftOf(enterprise), [enterprise]);
  const dirty = JSON.stringify({ ...draft, grants: [...draft.grants].sort() }) !== JSON.stringify({ ...base, grants: [...base.grants].sort() });
  const quotaFen = draft.free ? null : Math.round(parseFloat(draft.quota || '0') * 100);
  const valid = (draft.free || (Number.isFinite(quotaFen) && quotaFen! >= 0)) && Number.isInteger(Number(draft.concurrency)) && Number(draft.concurrency) >= 1;
  const toggle = (id: string) => setDraft(d => ({ ...d, grants: d.grants.includes(id) ? d.grants.filter(x => x !== id) : [...d.grants, id] }));
  const save = async () => {
    setBusy(true); setFailure(null);
    try { saved((await send<{ enterprise: Enterprise }>('PATCH', `/api/admin/workspaces/${encodeURIComponent(enterprise.ref)}`,
      { grants: draft.grants, quota: quotaFen, concurrency: Number(draft.concurrency) })).enterprise); }
    catch (error) { setFailure(message(error)); } finally { setBusy(false); }
  };
  const left = quotaFen === null ? null : quotaFen - enterprise.used - enterprise.reserved;
  return <div className="page"><Link className="back" href="/admin/workspaces">‹ 工作空间</Link>
    <div className="page__head" style={{ marginTop: 12 }}><div><h1 className="page__title">{enterprise.name}</h1><p className="page__sub mono">{enterprise.kind === 'personal' ? `个人空间 · ${enterprise.owner ?? ''}` : enterprise.domains.join('、') || enterprise.slug}</p></div></div>
    <div className="split">
      <div className="split__main"><section className="panel"><div className="panel__head"><h2 className="panel__title">可用模型</h2><span className="small muted">只能分配已准入、已定价的模型</span></div>
        <div className="panel__body"><ul className="grant-list">{registry.services.map(service => {
          const models = registry.models.filter(m => m.serviceId === service.id);
          if (!models.length) return null;
          return [<li className="grant-group" key={service.id}>{service.name}</li>, ...models.map(model => {
            const on = draft.grants.includes(model.id), ok = model.state === 'admitted' && model.prices.length > 0, grant = enterprise.grants.find(g => g.id === model.id);
            const price = model.prices.at(-1);
            return <li key={model.id}><button type="button" className="facet" aria-pressed={on} disabled={!ok && !on} onClick={() => toggle(model.id)}>
              <span className="check">{on ? '✓' : ''}</span><span><b>{model.name} <span className="mono muted">{model.modelId}</span></b><small>{model.description}{price ? ` · 单价 ${yuan(price.input)} / ${yuan(price.output)}` : ''}</small></span></button>
              <small className="muted">{!ok ? `${model.state === 'admitted' ? '未定价' : stateName[model.state]}${on ? '，已分配的保留' : '，不能分配'}` : grant ? (grant.enabled ? (grant.isDefault ? '企业已启用 · 默认' : '企业已启用') : '企业未启用') : on ? '保存后企业管理员可启用' : ''}</small></li>;
          })];
        })}</ul>
        {!draft.grants.length && <p className="note note--hint"><span><b>未开通</b>不分配任何模型时，这个工作空间的 Agent 入口显示“未开通”，不会模拟结果。</span></p>}
        <p className="small muted" style={{ marginTop: 12 }}>企业管理员只能在这些模型里启用、停用和设默认，看不到密钥、地址与单价。</p></div></section></div>
      <aside className="split__side"><section className="panel"><div className="panel__head"><h2 className="panel__title">额度与并发</h2></div><div className="panel__body">
        <div className="field"><span>月度额度</span>
          <div className="segmented segmented--fit" role="radiogroup" aria-label="月度额度">{([['cap', '设上限'], ['none', '不限']] as const).map(([v, t]) =>
            <button type="button" key={v} role="radio" aria-checked={(v === 'none') === draft.free} onClick={() => setDraft(d => ({ ...d, free: v === 'none' }))}>{t}</button>)}</div>
          {draft.free ? <small className="field__hint">只统计用量，不因额度停止。独立部署或按实际用量结算的企业可以选这个。</small>
            : <><span className="input-group" style={{ marginTop: 8 }}><input className="input" type="number" inputMode="decimal" aria-label="月度额度（元）" value={draft.quota} onChange={e => setDraft(d => ({ ...d, quota: e.target.value }))}/><em>元</em></span>
              <small className="field__hint">用尽即停：新的调用不会发出，任务暂停可恢复，已有成果保留。</small></>}</div>
        <label className="field"><span>同时运行的 Agent 任务</span><span className="input-group"><input className="input" type="number" inputMode="numeric" value={draft.concurrency} onChange={e => setDraft(d => ({ ...d, concurrency: e.target.value }))}/><em>个</em></span><small className="field__hint">超过时新任务排队，不拒绝。</small></label>
        <dl className="ledger"><div><dt>本月已用</dt><dd className="num">¥{yuan(enterprise.used)}</dd></div><div><dt>预占中</dt><dd className="num">¥{yuan(enterprise.reserved)}</dd></div>
          <div><dt>剩余</dt><dd className={`num${left !== null && left <= 0 ? ' danger' : ''}`}>{left === null ? '不限' : `¥${yuan(Math.max(0, left))}`}</dd></div></dl>
        {quotaFen !== null && quotaFen > 0 && <Meter used={enterprise.used + enterprise.reserved} quota={quotaFen}/>}
        {quotaFen !== null && quotaFen < enterprise.used && <p className="note note--hint"><span><b>低于本月已用</b>保存后本月新的调用会被拒绝，进行中的调用不受影响。</span></p>}
      </div></section></aside>
    </div>
    {(dirty || failure) && <div className="action-bar"><span className="hint">{failure ?? '调整立即生效，并写入审计记录'}</span>
      <button className="btn btn--secondary" onClick={() => { setDraft(base); setFailure(null); }}>放弃修改</button>
      <button className="btn btn--primary" disabled={busy || !dirty || !valid} onClick={save}>{busy ? '正在保存…' : '保存'}</button></div>}
  </div>;
}
