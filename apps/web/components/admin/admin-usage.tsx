'use client';
// 平台管理后台 · 用量（AM04，ADR-0018）：按月、按企业或按模型汇总调用次数、token、未核对次数与金额，导出 CSV 用于结算。
import { useRouter, useSearchParams } from 'next/navigation';
import { ClientError } from '../client/client-api';
import { useLoad, yuan } from './admin-api';

export type UsageRow = { key: string; name: string; calls: number; inputTokens: number; outputTokens: number; unverified: number; costFen: number };
export type UsageReport = { month: string; months: string[]; by: string; rows: UsageRow[]; total: Omit<UsageRow, 'key' | 'name'> };
export const tokens = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
const monthName = (m: string) => `${m.slice(0, 4)} 年 ${Number(m.slice(5))} 月`;

export function UsageTable({ report, label, showUnverified = true }: { report: UsageReport; label: string; showUnverified?: boolean }) {
  const line = (name: string, r: Omit<UsageRow, 'key' | 'name'>, total = false) => <div className={`table__row${total ? ' table__total' : ''}`} key={name}>
    <span className="cell-main"><b>{name}</b></span><span className="num">{r.calls.toLocaleString('zh-CN')}</span><span className="num">{tokens(r.inputTokens)}</span><span className="num">{tokens(r.outputTokens)}</span>
    {showUnverified && <span className="num">{r.unverified ? <span className="tag tag--act">{r.unverified} 次</span> : <span className="muted">—</span>}</span>}<span className="num strong">¥{yuan(r.costFen)}</span></div>;
  return <div className={`table ${showUnverified ? 'table--usage' : 'table--ai'}`}><div className="table__head"><span>{label}</span><span>调用次数</span><span>输入 token</span><span>输出 token</span>{showUnverified && <span>未核对</span>}<span>金额</span></div>
    {report.rows.length ? <>{report.rows.map(r => line(r.name, r))}{line('合计', report.total, true)}</> : <div className="empty"><b>这个月没有调用</b>选择其他月份查看。</div>}</div>;
}

export function MonthTools({ report, byOptions, onChange }: { report: UsageReport; byOptions: [string, string][]; onChange: (month: string, by: string) => void }) {
  return <div className="list-tools">
    <div className="segmented segmented--fit" role="radiogroup" aria-label="月份">{report.months.slice(0, 6).map(m => <button type="button" key={m} role="radio" aria-checked={m === report.month} onClick={() => onChange(m, report.by)}>{monthName(m)}</button>)}</div>
    <div className="segmented segmented--fit" role="radiogroup" aria-label="汇总方式">{byOptions.map(([v, t]) => <button type="button" key={v} role="radio" aria-checked={v === report.by} onClick={() => onChange(report.month, v)}>{t}</button>)}</div>
  </div>;
}

export function UsageView() {
  const router = useRouter(), query = useSearchParams();
  const month = query.get('month') ?? '', by = query.get('by') ?? 'workspace', params = new URLSearchParams({ ...(month ? { month } : {}), by }).toString();
  const { data, error } = useLoad<UsageReport>(`/api/admin/usage?${params}`);
  return <div className="page">
    <div className="page__head"><div><h1 className="page__title">用量</h1><p className="page__sub">按月汇总所有企业的模型调用，用于与企业结算。月份按北京时间自然月。</p></div>
      {data && <a className={`btn btn--secondary${data.rows.length ? '' : ' is-disabled'}`} aria-disabled={!data.rows.length} href={`/api/admin/usage/export?${new URLSearchParams({ month: data.month, by: data.by })}`}>导出 CSV</a>}</div>
    {error ? <div className="empty"><b>暂时无法读取用量</b>{error instanceof ClientError ? error.message : ''}</div> : !data ? <p className="page-loading">正在读取…</p> : <>
      <MonthTools report={data} byOptions={[['workspace', '按企业'], ['model', '按模型']]} onChange={(m, b) => router.push(`/admin/usage?${new URLSearchParams({ month: m, by: b })}`)}/>
      <UsageTable report={data} label={data.by === 'workspace' ? '企业' : '模型'}/>
      <p className="small muted" style={{ marginTop: 12 }}>金额按每次调用当时的单价折算。未核对：服务商没有返回用量的调用，按预占额计入。进行中的调用结束后才计入。</p></>}
  </div>;
}
