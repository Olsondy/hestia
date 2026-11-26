'use client';
// 石材与软装（W05）：成员只读浏览本企业石材库与软装风格，按定稿原型 enterprise-workbench（P02）的「石材与软装」页实现。
// 贴图为程序生成的示意素材；下架版本保留并标记，客户与 Agent 只能用在售版本。
import { useQuery } from '@tanstack/react-query';
import type { MemberCatalogView } from '../../../../packages/contracts/src/finish-requests';
import type { StoneSpec } from '../../../../packages/contracts/src/finishes';
import { get } from '../client/client-api';
import { Swatch } from '../client/client-parts';
import { Shell, useWorkbench } from './workbench-app';

const surfaceName: Record<StoneSpec['surface'], string> = { polished: '抛光', honed: '哑光' };
const mm = (m: number) => Math.round(m * 1000);
const sizes = (s: StoneSpec) => `长 ${mm(s.sizes.length.min)}–${mm(s.sizes.length.max)} · 宽 ${mm(s.sizes.width.min)}–${mm(s.sizes.width.max)} mm`;
const plainName = (name: string) => name.replace(/（示意）$/, '');

export function CatalogView() {
  const { workspace } = useWorkbench();
  const catalog = useQuery({ queryKey: ['member-catalog', workspace.id], staleTime: 5 * 60_000,
    queryFn: () => get<{ catalog: MemberCatalogView }>(`/api/workspaces/${workspace.id}/catalog`).then(r => r.catalog) });
  const data = catalog.data;
  const onSale = data?.stones.filter(s => s.status === 'active').length ?? 0;
  return <Shell nav="stones"><div className="page">
    <header className="page__head"><div><h1 className="page__title">石材与软装</h1>
      <p className="page__sub">客户在 H5 只能从这里的石材与软装风格中选择，Agent 也只在这个范围内出方案。贴图与家具均为示意素材；下架的版本不再出现在客户的选择里，已用它的方案保留原样。</p></div></header>
    {catalog.isPending ? <p className="page-loading">正在读取目录…</p>
      : catalog.error ? <div className="empty"><b>暂时读不到目录</b>{(catalog.error as Error).message}<p style={{ marginTop: 16 }}><button className="btn btn--secondary" onClick={() => void catalog.refetch()}>重试</button></p></div>
      : <>
        <h2 className="panel__title" style={{ marginTop: 28 }}>石材 <span className="muted small num">{onSale} 款在售</span></h2>
        {data!.stones.length ? <div className="catalog" style={{ marginTop: 12 }}>{data!.stones.map(({ status, stone }) =>
          <article key={`${stone.id}:${stone.version}`} className={`panel cat-card${status === 'retired' ? ' retired' : ''}`}>
            <Swatch stone={stone} size={240}/>
            <div><b>{plainName(stone.name)}</b> {status === 'retired' && <span className="tag">已下架 · 版本 {stone.version}</span>}
              <dl><dt>表面</dt><dd>{surfaceName[stone.surface]}</dd><dt>规格</dt><dd className="num">{sizes(stone)}</dd>
                <dt>厚度</dt><dd className="num">{mm(stone.thickness)} mm</dd><dt>版本</dt><dd className="num">{stone.version}{status === 'active' ? ' · 在售' : ''}</dd></dl></div>
          </article>)}</div>
          : <div className="empty" style={{ marginTop: 12 }}><b>还没有石材</b>石材由平台按企业录入，录入后在这里查看。</div>}
        <h2 className="panel__title" style={{ marginTop: 32 }}>软装风格 <span className="muted small">按房间给出家具换款与补充陈设 · 示意素材</span></h2>
        {data!.softStyles.length ? <div className="catalog" style={{ marginTop: 12 }}>{data!.softStyles.map(({ status, style, rooms }) =>
          <article key={`${style.id}:${style.version}`} className={`panel cat-card${status === 'retired' ? ' retired' : ''}`}>
            <div className="soft-swatch" aria-hidden="true">{style.palette.slice(0, 4).map((c, i) => <i key={i} style={{ background: c }}/>)}</div>
            <div><b>{style.name}</b> {status === 'retired' && <span className="tag">已下架 · 版本 {style.version}</span>}
              <p className="muted small" style={{ marginTop: 2 }}>{style.line}</p>
              <dl>{rooms.map(room => <div key={room.type} style={{ display: 'contents' }}><dt>{room.name}</dt><dd>{room.summary}</dd></div>)}
                <dt>版本</dt><dd className="num">{style.version}{status === 'active' ? ' · 在售' : ''}</dd></dl></div>
          </article>)}</div>
          : <div className="empty" style={{ marginTop: 12 }}><b>还没有软装风格</b>软装风格由平台按企业录入，录入后在这里查看。</div>}
      </>}
  </div></Shell>;
}
