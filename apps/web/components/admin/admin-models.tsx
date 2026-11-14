'use client';
// 平台管理后台 · 模型服务（AM02，ADR-0018）：服务列表与测试连通、登记与管理服务（协议、兼容设置、密钥末四位、获取并启用模型 ID）、
// 模型设置（名称、参数、单价版本、接入检查、停用）。按定稿原型 admin-console 实现；密钥只在服务端，页面只见末四位。
import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ModelView as ModelData, ServiceView as ServiceData, Protocol } from '../../../../packages/contracts/src/models';
import { ClientError } from '../client/client-api';
import { send, stamp, useLoad, yuan } from './admin-api';

type Check = { status: 'running' | 'passed' | 'failed'; startedAt: string; finishedAt: string | null; startedBy: string; items: Record<string, string>; failure: string | null } | null;
const protocols: Record<Protocol, { name: string; hint: string }> = {
  chat: { name: 'OpenAI Chat Completions', hint: '大多数国内与第三方模型服务（/chat/completions）' },
  responses: { name: 'OpenAI Responses', hint: 'OpenAI 及兼容 Responses 接口的服务（/responses）' },
  anthropic: { name: 'Anthropic Messages', hint: 'Anthropic 及兼容其接口的服务（/v1/messages），地址填到域名为止' },
};
const compatDefaults = { chat: { usageInStream: true, maxTokensField: 'max_tokens', thinkingParam: 'enable_thinking' }, responses: { store: false }, anthropic: { apiVersion: '2023-06-01' } };
const stateInfo: Record<ModelData['state'], [string, boolean]> = { draft: ['待检查', true], checking: ['检查中', false], admitted: ['已准入', false], failed: ['检查未通过', true], stale: ['需重新检查', true], disabled: ['已停用', false] };
const checkLabels: [string, string][] = [['connect', '连通与鉴权'], ['stream', '流式输出'], ['tools', '工具调用'], ['toolStream', '工具参数流式返回'], ['protocol', 'Hestia 协议样本（3 条合成样本）'], ['usage', '返回用量（token）']];
const outcome: Record<string, string> = { ok: '通过', fail: '未通过', unsupported: '不支持', todo: '' };

const Tag = ({ text, act }: { text: string; act?: boolean }) => <span className={`tag${act ? ' tag--act' : ''}`}>{text}</span>;
const StateTag = ({ state }: { state: ModelData['state'] }) => <Tag text={stateInfo[state][0]} act={stateInfo[state][1]}/>;
const Note = ({ kind, title, children }: { kind: 'hint' | 'danger' | 'ok'; title: string; children?: React.ReactNode }) =>
  <p className={`note note--${kind}`} role={kind === 'danger' ? 'alert' : undefined}><span><b>{title}</b>{children}</span></p>;
const Switch = ({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (value: boolean) => void; disabled?: boolean }) =>
  <button type="button" className="switch" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}><i/></button>;
function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (value: T) => void; label: string }) {
  return <div className="segmented segmented--fit" role="radiogroup" aria-label={label}>{options.map(([v, t]) =>
    <button type="button" key={v} role="radio" aria-checked={v === value} onClick={() => onChange(v)}>{t}</button>)}</div>;
}
const Setting = ({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) =>
  <div className="setting"><div><b>{title}</b><small>{hint}</small></div>{children}</div>;
const message = (error: unknown) => error instanceof ClientError && error.message ? error.message : '请求未完成，请稍后重试。';
const priceOf = (model: ModelData) => model.prices.at(-1);

function PingResult({ service, busy }: { service: ServiceData; busy: boolean }) {
  if (busy) return <span className="ping ping--now"><i/>测试中…</span>;
  if (!service.ping) return <span className="ping muted">还没有测试</span>;
  return <span className="ping-cell__res">{service.ping.ok ? <span className="ping ping--ok"><i/>连通正常 · <span className="num">{service.ping.ms} ms</span></span>
    : <span className="ping ping--fail"><i/>连通失败：{service.ping.code}</span>}<small className="muted">{stamp(service.ping.at)}</small></span>;
}

// ---------- 服务列表 ----------
export function ServicesView() {
  const { data, error, reload } = useLoad<{ services: ServiceData[]; models: ModelData[] }>('/api/admin/services');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const ping = async (ids: string[]) => {
    setBusy(current => new Set([...current, ...ids]));
    await Promise.all(ids.map(id => send('POST', `/api/admin/services/${id}/ping`, {}).catch(() => null)));
    setBusy(current => new Set([...current].filter(id => !ids.includes(id)))); await reload();
  };
  if (error) return <div className="page"><div className="empty"><b>暂时无法读取模型服务</b>{message(error)}</div></div>;
  if (!data) return <p className="page-loading">正在读取…</p>;
  const failed = data.services.filter(s => s.ping && !s.ping.ok);
  return <div className="page">
    <div className="page__head"><div><h1 className="page__title">模型服务</h1><p className="page__sub">一组接口地址与密钥是一个模型服务；在服务里启用的模型 ID 各自接入检查、定价后才能分配给企业。</p></div>
      <div className="row-gap">{data.services.length > 0 && <button className="btn btn--secondary" disabled={busy.size > 0} onClick={() => ping(data.services.map(s => s.id))}>全部测试连通</button>}
        <Link className="btn btn--primary" href="/admin/services/new">登记模型服务</Link></div></div>
    {failed.length > 0 && <Note kind="danger" title={`${failed.length} 个服务连通失败`}>{failed.map(s => `「${s.name}」${s.ping!.reason ?? s.ping!.code}`).join('；')}。企业成员调用这些服务的模型时会看到“模型服务暂时无响应”。</Note>}
    {!data.services.length ? <div className="empty"><b>还没有模型服务</b>登记一个服务（接口地址与密钥），再从服务获取并启用模型 ID。</div>
      : <div className="svc-list">{data.services.map(service => {
        const models = data.models.filter(m => m.serviceId === service.id);
        return <section className="panel svc" key={service.id}>
          <div className="svc__head">
            <div className="svc__id"><Link href={`/admin/services/${service.id}`}><b>{service.name}</b></Link><small>{protocols[service.protocol].name} · <span className="mono">{service.baseUrl}</span></small></div>
            <div className="ping-cell"><PingResult service={service} busy={busy.has(service.id)}/><button className="btn btn--secondary btn--sm" disabled={busy.has(service.id)} onClick={() => ping([service.id])}>测试连通</button></div>
            <Link className="btn btn--secondary btn--sm" href={`/admin/services/${service.id}`}>管理</Link>
          </div>
          {models.length ? <div className="table table--svc-models"><div className="table__head"><span>已启用的模型 ID</span><span>状态</span><span>单价（输入 / 输出）</span><span>来源</span><span>最大输出</span><span/></div>
            {models.map(model => <Link className="table__row" key={model.id} href={`/admin/models/${model.id}`}>
              <span className="cell-main"><b>{model.name}</b><small className="mono">{model.modelId}</small></span><span><StateTag state={model.state}/></span>
              <span className="num small">{priceOf(model) ? `${yuan(priceOf(model)!.input)} / ${yuan(priceOf(model)!.output)}` : <span className="muted">未定价</span>}</span>
              <span className="small">{model.missingFromCatalog ? <Tag text="列表中已不存在" act/> : model.manual ? '手动添加' : '模型列表'}</span>
              <span className="num small">{model.maxOutput}</span><span className="chev">›</span></Link>)}</div>
            : <p className="svc__empty small muted">还没有启用模型 ID。进入「管理」获取模型列表后启用。</p>}
        </section>;
      })}</div>}
  </div>;
}

// ---------- 登记与管理服务 ----------
type ServiceDraft = { name: string; protocol: Protocol; baseUrl: string; apiKey: string; timeoutSeconds: string; concurrency: string; compat: Record<string, unknown> };
const draftOf = (service?: ServiceData): ServiceDraft => service
  ? { name: service.name, protocol: service.protocol, baseUrl: service.baseUrl, apiKey: '', timeoutSeconds: String(service.timeoutSeconds), concurrency: String(service.concurrency), compat: { ...service.compat } }
  : { name: '', protocol: 'chat', baseUrl: '', apiKey: '', timeoutSeconds: '60', concurrency: '8', compat: { ...compatDefaults.chat } };

export function ServiceView({ id }: { id: string }) {
  const isNew = id === 'new';
  return isNew ? <ServiceForm/> : <ExistingService id={id}/>;
}
function ExistingService({ id }: { id: string }) {
  const { data, error, reload } = useLoad<{ service: ServiceData; models: ModelData[] }>(`/api/admin/services/${id}`);
  if (error) return <div className="page"><div className="empty"><b>{error.status === 404 ? '模型服务不存在' : '暂时无法读取'}</b>{message(error)}</div></div>;
  if (!data) return <p className="page-loading">正在读取…</p>;
  return <ServiceForm key={data.service.updatedAt} service={data.service} models={data.models} reload={reload}/>;
}

function ServiceForm({ service, models = [], reload }: { service?: ServiceData; models?: ModelData[]; reload?: () => Promise<unknown> }) {
  const router = useRouter();
  const [draft, setDraft] = useState<ServiceDraft>(() => draftOf(service)), [saving, setSaving] = useState(false), [failure, setFailure] = useState<string | null>(null);
  const set = (patch: Partial<ServiceDraft>) => setDraft(current => ({ ...current, ...patch }));
  const base = useMemo(() => draftOf(service), [service]);
  const dirty = JSON.stringify({ ...draft, apiKey: '' }) !== JSON.stringify({ ...base, apiKey: '' }) || (!service && !!draft.apiKey);
  const recheck = !!service && (draft.protocol !== base.protocol || draft.baseUrl !== base.baseUrl || JSON.stringify(draft.compat) !== JSON.stringify(base.compat))
    && models.some(m => m.state === 'admitted' || m.state === 'failed');
  const save = async () => {
    setSaving(true); setFailure(null);
    const fields = { name: draft.name, protocol: draft.protocol, baseUrl: draft.baseUrl, timeoutSeconds: Number(draft.timeoutSeconds), concurrency: Number(draft.concurrency), compat: draft.compat };
    try {
      if (!service) { const { service: created } = await send<{ service: ServiceData }>('POST', '/api/admin/services', { ...fields, apiKey: draft.apiKey }); router.push(`/admin/services/${created.id}`); }
      else { await send('PATCH', `/api/admin/services/${service.id}`, fields); await reload?.(); }
    } catch (error) { setFailure(message(error)); } finally { setSaving(false); }
  };
  return <div className="page"><Link className="back" href="/admin/models">‹ 模型服务</Link>
    <div className="page__head" style={{ marginTop: 12 }}><div><h1 className="page__title">{service ? service.name : '登记模型服务'}</h1>
      <p className="page__sub">{service ? `${protocols[service.protocol].name} · 登记于 ${stamp(service.createdAt)}` : '代码里只有协议适配器，不预置任何供应商：地址、密钥与模型都由这里填写。'}</p></div></div>
    <div className="split">
      <div className="split__main">
        <section className="panel"><div className="panel__head"><h2 className="panel__title">接口</h2></div><div className="panel__body">
          <label className="field"><span>服务名称</span><input className="input" value={draft.name} maxLength={80} onChange={e => set({ name: e.target.value })} placeholder="只作标注，企业成员看不到"/></label>
          <div className="field"><span>接口协议</span><Seg label="接口协议" value={draft.protocol} options={(Object.keys(protocols) as Protocol[]).map(p => [p, protocols[p].name])}
            onChange={protocol => set({ protocol, compat: { ...compatDefaults[protocol] } })}/><small className="field__hint">{protocols[draft.protocol].hint}</small></div>
          <label className="field"><span>接口地址</span><input className="input input--mono" value={draft.baseUrl} maxLength={500} onChange={e => set({ baseUrl: e.target.value })} placeholder={draft.protocol === 'anthropic' ? 'https://api.example.com' : 'https://api.example.com/v1'}/></label>
          {service ? <KeyLine service={service} reload={reload!}/>
            : <label className="field"><span>API 密钥</span><input className="input input--mono" type="password" autoComplete="off" value={draft.apiKey} onChange={e => set({ apiKey: e.target.value })}/><small className="field__hint">加密保存，保存后只显示末四位，不再回显。</small></label>}
          <div className="form-grid">
            <label className="field"><span>超时</span><span className="input-group"><input className="input" type="number" inputMode="numeric" value={draft.timeoutSeconds} onChange={e => set({ timeoutSeconds: e.target.value })}/><em>秒</em></span></label>
            <label className="field"><span>总并发上限</span><span className="input-group"><input className="input" type="number" inputMode="numeric" value={draft.concurrency} onChange={e => set({ concurrency: e.target.value })}/><em>个</em></span><small className="field__hint">这个密钥下所有模型、所有企业共用，超过时排队。</small></label>
          </div>
        </div></section>
        <section className="panel"><div className="panel__head"><h2 className="panel__title">兼容设置</h2><span className="small muted">同一协议的服务商在细节上的差异，只能在这些开关里选</span></div>
          <div className="panel__body settings"><CompatSettings protocol={draft.protocol} compat={draft.compat} onChange={compat => set({ compat })}/></div></section>
      </div>
      <aside className="split__side">{service ? <ModelIds service={service} models={models} reload={reload!}/>
        : <section className="panel"><div className="panel__head"><h2 className="panel__title">接下来</h2></div><div className="panel__body"><ol className="steps small"><li>保存后测试连通。</li><li>获取模型列表，启用要用的模型 ID。</li><li>逐个设置名称、单价并运行接入检查。</li></ol></div></section>}</aside>
    </div>
    {(dirty || failure) && <div className="action-bar"><span className="hint">{failure ?? (recheck ? '保存后这个服务下已准入的模型需要重新接入检查' : service ? '保存后立即生效，并写入审计记录' : '密钥加密保存，保存后不能再查看')}</span>
      {service && <button className="btn btn--secondary" onClick={() => { setDraft(base); setFailure(null); }}>放弃修改</button>}
      <button className="btn btn--primary" disabled={saving || !dirty} onClick={save}>{saving ? '正在保存…' : '保存'}</button></div>}
  </div>;
}

function KeyLine({ service, reload }: { service: ServiceData; reload: () => Promise<unknown> }) {
  const [editing, setEditing] = useState(false), [key, setKey] = useState(''), [failure, setFailure] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const replace = async () => {
    setSaving(true); setFailure(null);
    try { await send('POST', `/api/admin/services/${service.id}/key`, { apiKey: key }); setEditing(false); setKey(''); await reload(); }
    catch (error) { setFailure(message(error)); } finally { setSaving(false); }
  };
  return <div className="field"><span>API 密钥</span>
    {editing ? <div className="row-gap"><input className="input input--mono" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="新的密钥"/>
      <button className="btn btn--secondary btn--sm" onClick={() => { setEditing(false); setKey(''); }}>取消</button><button className="btn btn--primary btn--sm" disabled={saving || key.trim().length < 8} onClick={replace}>保存密钥</button></div>
      : <div className="keyline"><span className="mono">•••• {service.keyTail}</span><button className="btn btn--secondary btn--sm" onClick={() => setEditing(true)}>更换密钥</button></div>}
    <small className="field__hint">{failure ?? '只显示末四位。更换密钥不改变登记和准入，换完测试一次连通即可。'}</small></div>;
}

function CompatSettings({ protocol, compat, onChange }: { protocol: Protocol; compat: Record<string, unknown>; onChange: (compat: Record<string, unknown>) => void }) {
  const set = (key: string, value: unknown) => onChange({ ...compat, [key]: value });
  if (protocol === 'chat') return <>
    <Setting title="流式输出时返回用量" hint="发送 stream_options.include_usage。服务商不支持时关闭，用量改按预占额计入并标为未核对。"><Switch on={!!compat.usageInStream} label="流式输出时返回用量" onChange={v => set('usageInStream', v)}/></Setting>
    <Setting title="最大输出的字段名" hint="多数服务用 max_tokens；部分新接口要求 max_completion_tokens。"><Seg label="最大输出的字段名" value={compat.maxTokensField as string} options={[['max_tokens', 'max_tokens'], ['max_completion_tokens', 'max_completion_tokens']]} onChange={v => set('maxTokensField', v)}/></Setting>
    <Setting title="思考参数写法" hint="模型开启或关闭思考时用这种写法发送。按服务商文档选择，接入检查会验证是否生效。"><Seg label="思考参数写法" value={compat.thinkingParam as string} options={[['enable_thinking', 'enable_thinking'], ['thinking.type', 'thinking.type'], ['reasoning_effort', 'reasoning_effort']]} onChange={v => set('thinkingParam', v)}/></Setting>
  </>;
  if (protocol === 'responses') return <Setting title="在服务商侧保存会话" hint="默认关闭：对话由 Hestia 自己保存，不留在服务商。"><Switch on={!!compat.store} label="在服务商侧保存会话" onChange={v => set('store', v)}/></Setting>;
  return <Setting title="API 版本" hint="请求头 anthropic-version，格式 YYYY-MM-DD。"><input className="input input--mono input--sm" style={{ width: 160 }} value={String(compat.apiVersion ?? '')} onChange={e => set('apiVersion', e.target.value)}/></Setting>;
}

function ModelIds({ service, models, reload }: { service: ServiceData; models: ModelData[]; reload: () => Promise<unknown> }) {
  const [busy, setBusy] = useState<string | null>(null), [failure, setFailure] = useState<string | null>(null), [manual, setManual] = useState('');
  const act = async (key: string, work: () => Promise<unknown>) => { setBusy(key); setFailure(null); try { await work(); await reload(); } catch (error) { setFailure(message(error)); } finally { setBusy(null); } };
  const enabled = new Map(models.map(m => [m.modelId, m])), catalog = service.catalog;
  const missing = models.filter(m => m.missingFromCatalog);
  return <section className="panel"><div className="panel__head"><h2 className="panel__title">模型 ID</h2>
    <button className="btn btn--secondary btn--sm" disabled={!!busy} onClick={() => act('fetch', () => send('POST', `/api/admin/services/${service.id}/catalog`, {}))}>{busy === 'fetch' ? '获取中…' : catalog ? '重新获取' : '获取模型列表'}</button></div>
    <div className="panel__body">
      {catalog ? <p className="small muted">{catalog.unsupported ? `这个服务不提供模型列表（${catalog.code}），请手动添加。` : `${stamp(catalog.at)} 获取到 ${catalog.ids.length} 个模型 ID。`}</p>
        : <p className="small muted">从服务读取可用的模型 ID（不消耗 token），再启用要用的。</p>}
      {failure && <Note kind="danger" title="没有完成">{failure}</Note>}
      {missing.length > 0 && <Note kind="hint" title="列表里已不存在">{missing.map(m => m.modelId).join('、')} 不在最新的模型列表里，仍保持原状态，请确认服务商是否已下线。</Note>}
      {catalog && !catalog.unsupported && catalog.ids.length > 0 && <div className="id-list">{catalog.ids.map(modelId => {
        const model = enabled.get(modelId);
        return <div className="id-row" key={modelId}><span className="mono small">{modelId}</span>
          <span className="id-row__id">{catalog.added.includes(modelId) && <Tag text="新" act/>}</span>
          {model ? <Link className="id-row__model" href={`/admin/models/${model.id}`}><StateTag state={model.state}/>设置</Link>
            : <button className="btn btn--secondary btn--sm" disabled={!!busy} onClick={() => act(modelId, () => send('POST', `/api/admin/services/${service.id}/models`, { modelId }))}>启用</button>}</div>;
      })}</div>}
      {models.filter(m => m.manual).map(model => <div className="id-row" key={model.id}><span className="mono small">{model.modelId}</span><span className="id-row__id"><Tag text="手动添加"/></span>
        <Link className="id-row__model" href={`/admin/models/${model.id}`}><StateTag state={model.state}/>设置</Link></div>)}
      <div className="id-add"><input className="input input--mono input--sm" value={manual} onChange={e => setManual(e.target.value)} placeholder="手动添加模型 ID"/>
        <button className="btn btn--secondary btn--sm" disabled={!!busy || !manual.trim()} onClick={() => act('manual', async () => { await send('POST', `/api/admin/services/${service.id}/models`, { modelId: manual.trim(), manual: true }); setManual(''); })}>添加</button></div>
      <p className="small muted" style={{ marginTop: 10 }}>服务不提供列表、或列表里没有时才手动添加；接入检查会真实调用验证。</p>
    </div></section>;
}

// ---------- 模型设置 ----------
type ModelDraft = { name: string; description: string; maxOutput: string; params: Record<string, unknown>; input: string; output: string };
const modelDraft = (model: ModelData): ModelDraft => ({ name: model.name, description: model.description, maxOutput: String(model.maxOutput), params: { ...model.params },
  input: priceOf(model) ? yuan(priceOf(model)!.input) : '', output: priceOf(model) ? yuan(priceOf(model)!.output) : '' });
const fen = (value: string) => Math.round(parseFloat(value) * 100);

export function ModelView({ id }: { id: string }) {
  const polling = useCallback((data: { model: ModelData }) => data.model.state === 'checking', []);
  const { data, error, reload } = useLoad<{ model: ModelData; service: ServiceData; check: Check }>(`/api/admin/models/${id}`, polling);
  if (error) return <div className="page"><div className="empty"><b>{error.status === 404 ? '模型不存在' : '暂时无法读取'}</b>{message(error)}</div></div>;
  if (!data) return <p className="page-loading">正在读取…</p>;
  return <ModelForm key={`${data.model.id}:${data.model.state}:${data.model.prices.length}:${data.model.name}:${data.model.description}:${JSON.stringify(data.model.params)}:${data.model.maxOutput}`} {...data} reload={reload}/>;
}

function ModelForm({ model, service, check, reload }: { model: ModelData; service: ServiceData; check: Check; reload: () => Promise<unknown> }) {
  const [draft, setDraft] = useState<ModelDraft>(() => modelDraft(model)), [saving, setSaving] = useState(false), [failure, setFailure] = useState<string | null>(null), [confirmOff, setConfirmOff] = useState(false);
  const set = (patch: Partial<ModelDraft>) => setDraft(current => ({ ...current, ...patch }));
  const base = modelDraft(model), checking = model.state === 'checking';
  const priceChanged = draft.input !== base.input || draft.output !== base.output;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base), paramsChanged = JSON.stringify(draft.params) !== JSON.stringify(base.params);
  const act = async (work: () => Promise<unknown>) => { setSaving(true); setFailure(null); try { await work(); await reload(); } catch (error) { setFailure(message(error)); } finally { setSaving(false); } };
  const save = () => act(() => send('PATCH', `/api/admin/models/${model.id}`, {
    ...(draft.name !== base.name ? { name: draft.name } : {}), ...(draft.description !== base.description ? { description: draft.description } : {}),
    ...(draft.maxOutput !== base.maxOutput ? { maxOutput: Number(draft.maxOutput) } : {}), ...(paramsChanged ? { params: draft.params } : {}),
    ...(priceChanged ? { price: { input: fen(draft.input), output: fen(draft.output) } } : {}) }));
  const priceValid = !priceChanged || (Number.isFinite(fen(draft.input)) && Number.isFinite(fen(draft.output)) && fen(draft.input) >= 0 && fen(draft.output) >= 0);
  return <div className="page"><Link className="back" href={`/admin/services/${service.id}`}>‹ {service.name}</Link>
    <div className="page__head" style={{ marginTop: 12 }}><div><h1 className="page__title">{model.name}</h1><p className="page__sub"><span className="mono">{model.modelId}</span> · {protocols[service.protocol].name}</p></div><StateTag state={model.state}/></div>
    <div className="split">
      <div className="split__main">
        <section className="panel"><div className="panel__head"><h2 className="panel__title">成员看到的</h2></div><div className="panel__body">
          <label className="field"><span>显示名称</span><input className="input" maxLength={80} value={draft.name} onChange={e => set({ name: e.target.value })}/></label>
          <label className="field"><span>说明</span><input className="input" maxLength={400} value={draft.description} onChange={e => set({ description: e.target.value })} placeholder="适合做什么，例如“整套方案、跨房间取舍时用；速度较慢”"/></label>
        </div></section>
        <section className="panel"><div className="panel__head"><h2 className="panel__title">调用参数</h2><span className="small muted">修改后需要重新接入检查</span></div><div className="panel__body settings">
          <Setting title="单次最大输出" hint="每次调用最多生成的 token；额度预占按它计算。"><span className="input-group input-group--sm"><input className="input" type="number" value={draft.maxOutput} onChange={e => set({ maxOutput: e.target.value })}/><em>token</em></span></Setting>
          <ParamSettings protocol={service.protocol} params={draft.params} onChange={params => set({ params })} thinkingParam={String((service.compat as { thinkingParam?: string }).thinkingParam ?? '')}/>
        </div></section>
        <section className="panel"><div className="panel__head"><h2 className="panel__title">单价</h2><span className="small muted">元 / 百万 token，从下一次调用起生效</span></div><div className="panel__body">
          <div className="form-grid">
            <label className="field"><span>输入</span><span className="input-group"><input className="input" type="number" inputMode="decimal" value={draft.input} onChange={e => set({ input: e.target.value })}/><em>元</em></span></label>
            <label className="field"><span>输出</span><span className="input-group"><input className="input" type="number" inputMode="decimal" value={draft.output} onChange={e => set({ output: e.target.value })}/><em>元</em></span></label>
          </div>
          {model.prices.length > 0 ? <div className="price-hist"><b className="small">单价记录</b><ul className="plain-list">{[...model.prices].reverse().map(p =>
            <li key={p.from}><span className="small muted">{stamp(p.from)} 起</span><span className="num small">{yuan(p.input)} / {yuan(p.output)}</span></li>)}</ul>
            <p className="small muted" style={{ marginTop: 6 }}>每次调用记录当时的单价，历史用量不重算。</p></div>
            : <p className="small muted" style={{ marginTop: 8 }}>填写单价后才能分配给企业。</p>}
        </div></section>
      </div>
      <aside className="split__side">
        <CheckPanel model={model} check={check} busy={saving} start={() => act(() => send('POST', `/api/admin/models/${model.id}/check`, {}))}/>
        <section className="panel"><div className="panel__head"><h2 className="panel__title">{model.state === 'disabled' ? '已停用' : '停用'}</h2></div><div className="panel__body">
          {model.state === 'disabled' ? <><p className="small muted">新任务不能选它。重新启用后需要再通过接入检查。</p><button className="btn btn--secondary" style={{ marginTop: 12 }} disabled={saving} onClick={() => act(() => send('POST', `/api/admin/models/${model.id}/state`, { disabled: false }))}>重新启用</button></>
            : <><p className="small muted">新任务不能再选这个模型；正在用它的任务在当前调用结束后停止并告知成员，已有成果保留，不会自动换成其他模型。</p>
              {confirmOff ? <div className="row-gap" style={{ marginTop: 12 }}><button className="btn btn--secondary btn--sm" onClick={() => setConfirmOff(false)}>取消</button><button className="btn btn--danger btn--sm" disabled={saving || checking} onClick={() => act(() => send('POST', `/api/admin/models/${model.id}/state`, { disabled: true }))}>确认停用</button></div>
                : <button className="btn btn--secondary" style={{ marginTop: 12 }} disabled={checking} onClick={() => setConfirmOff(true)}>停用这个模型</button>}</>}
        </div></section>
      </aside>
    </div>
    {(dirty || failure) && <div className="action-bar"><span className="hint">{failure ?? (paramsChanged && model.state === 'admitted' ? '保存后需要重新接入检查' : priceChanged ? '新单价从下一次调用起生效' : '保存后立即生效，并写入审计记录')}</span>
      <button className="btn btn--secondary" onClick={() => { setDraft(base); setFailure(null); }}>放弃修改</button>
      <button className="btn btn--primary" disabled={saving || !dirty || checking || !priceValid} onClick={save}>{saving ? '正在保存…' : '保存'}</button></div>}
  </div>;
}

function ParamSettings({ protocol, params, onChange, thinkingParam }: { protocol: Protocol; params: Record<string, unknown>; onChange: (params: Record<string, unknown>) => void; thinkingParam: string }) {
  if (protocol === 'chat') return <Setting title="思考模式" hint={`“不设置”时不发送思考参数，按服务商默认；写法见所在服务的兼容设置（${thinkingParam}）。`}>
    <Seg label="思考模式" value={params.thinking as string} options={[['unset', '不设置'], ['on', '开启'], ['off', '关闭']]} onChange={v => onChange({ ...params, thinking: v })}/></Setting>;
  if (protocol === 'responses') return <Setting title="推理强度" hint="“不设置”时按服务商默认。"><Seg label="推理强度" value={params.reasoning as string} options={[['unset', '不设置'], ['low', '低'], ['medium', '中'], ['high', '高']]} onChange={v => onChange({ ...params, reasoning: v })}/></Setting>;
  return <>
    <Setting title="扩展思考" hint="开启后先思考再回答，更慢、输出 token 更多。"><Switch on={!!params.thinking} label="扩展思考" onChange={v => onChange({ ...params, thinking: v })}/></Setting>
    {!!params.thinking && <Setting title="思考预算" hint="思考最多使用的 token，1024–64000。"><span className="input-group input-group--sm"><input className="input" type="number" value={String(params.thinkingBudget)} onChange={e => onChange({ ...params, thinkingBudget: Number(e.target.value) })}/><em>token</em></span></Setting>}
  </>;
}

function CheckPanel({ model, check, busy, start }: { model: ModelData; check: Check; busy: boolean; start: () => void }) {
  const running = model.state === 'checking';
  return <section className="panel"><div className="panel__head"><h2 className="panel__title">接入检查</h2>
    <button className="btn btn--secondary btn--sm" disabled={busy || running || model.state === 'disabled'} onClick={start}>{running ? '检查中…' : check ? '重新检查' : '运行接入检查'}</button></div>
    <div className="panel__body">
      {!check ? <p className="small muted">用合成样本真实调用这个模型，验证连通、流式、工具调用与 Hestia 协议。通过并填写单价后才能分配给企业。</p> : <>
        <p className="small muted">{running ? `${check.startedBy} 发起，进行中…` : `${stamp(check.finishedAt ?? check.startedAt)} · ${check.startedBy} 发起`}</p>
        <ul className="checklist">{checkLabels.map(([key, label]) => { const r = running && check.items[key] === 'todo' ? 'todo' : check.items[key];
          return <li key={key} data-r={r}><i>{r === 'ok' ? '✓' : r === 'fail' ? '×' : r === 'unsupported' ? '–' : ''}</i><span>{label}</span><small>{outcome[r] ?? ''}</small></li>; })}</ul>
        {check.status === 'failed' && check.failure && <Note kind="danger" title="未通过">{check.failure}</Note>}
        {check.status === 'passed' && <Note kind="ok" title="已通过">{model.prices.length ? '可以在「企业」页分配给企业。' : '填写单价后可以分配给企业。'}</Note>}
        {model.state === 'stale' && <Note kind="hint" title="需要重新检查">服务或调用参数改过，之前的结果已失效。</Note>}
      </>}
    </div></section>;
}
