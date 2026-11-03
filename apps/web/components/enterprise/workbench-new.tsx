'use client';
// 预置方案（W04）：成员在示例别墅上选饰面和石材，按规则生成方案（企业预置），生成后在线索详情分享给客户。
// 「交给 Agent 出方案」待 K03 / W07 接入，这里不放不可用的按钮。草稿存在本机（关页后仍在）。
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientCatalogView, LeadView } from '../../../../packages/contracts/src/finish-requests';
import { get, operationId, post } from '../client/client-api';
import { Icon } from '../client/client-icons';
import { PlanDrawing, Swatch } from '../client/client-parts';
import { Note, Shell, tidy, useWorkbench } from './workbench-app';

type Draft = { name: string; note: string; level: string; finishes: string[]; stones: string[] };
const blank: Draft = { name: '', note: '', level: '', finishes: [], stones: [] };
const kindName: Record<string, string> = { floor: '地面', wall: '墙面', stair: '楼梯踏面' };

function useDraft(slug: string) {
  const key = `hestia.workbench.draft.${slug}`;
  const [draft, setDraft] = useState<Draft>(blank);
  useEffect(() => { try { const saved = localStorage.getItem(key); if (saved) setDraft({ ...blank, ...JSON.parse(saved) }); } catch { /* fresh draft */ } }, [key]);
  const update = (patch: Partial<Draft>) => setDraft(prev => { const next = { ...prev, ...patch }; try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* memory only */ } return next; });
  const clear = () => { setDraft(blank); try { localStorage.removeItem(key); } catch { /* ignore */ } };
  return { draft, update, clear };
}

export function NewView() {
  const { slug, base, workspace, go } = useWorkbench(), queries = useQueryClient();
  const catalog = useQuery({ queryKey: ['catalog', slug], queryFn: () => get<{ catalog: ClientCatalogView }>(`/api/client/${encodeURIComponent(slug)}/catalog`).then(r => r.catalog), staleTime: 5 * 60_000 });
  const { draft, update, clear } = useDraft(slug);
  const plan = catalog.data?.demoVilla.plan, finishes = catalog.data?.demoVilla.finishes ?? [];
  const levelOf = useMemo(() => {
    if (!plan) return () => '';
    return (f: (typeof finishes)[number]) => f.kind === 'stair' ? plan.stairs.find(s => s.id === f.stairId)?.levelId ?? ''
      : f.kind === 'wall' ? plan.walls.find(w => w.id === f.wallId)?.levelId ?? '' : plan.rooms.find(r => r.id === f.roomId)?.levelId ?? (f as { levelId?: string }).levelId ?? '';
  }, [plan]);
  const level = draft.level || plan?.levels[0]?.id || '';
  const here = finishes.filter(f => levelOf(f) === level);
  const toggle = (list: string[], id: string, max = Infinity) => list.includes(id) ? list.filter(x => x !== id) : list.length < max ? [...list, id] : list;
  const stones = catalog.data?.stones ?? [];
  const create = useMutation({
    mutationFn: () => post<{ lead: LeadView }>(`/api/workspaces/${workspace.id}/leads`, { operationId: operationId(), name: draft.name.trim(),
      finishIds: draft.finishes, note: draft.note.trim() || undefined,
      stones: draft.stones.map(id => { const s = stones.find(x => x.id === id)!; return { stoneId: s.id, stoneVersion: s.version }; }) }).then(r => tidy(r.lead)),
    onSuccess: lead => { queries.setQueryData<LeadView[]>(['leads', workspace.id], list => list ? [lead, ...list] : list); clear(); go(`${base}/leads/${lead.id}`); },
  });
  const ready = draft.name.trim() && draft.finishes.length && draft.stones.length;

  return <Shell nav="new"><div className="page">
    <header className="page__head"><div><h1 className="page__title">预置方案</h1>
      <p className="page__sub">在示例别墅上选择饰面和石材，按规则生成方案。生成后在线索里查看效果图，再生成分享码发给客户。</p></div></header>
    {catalog.isPending ? <p className="page-loading">正在读取示例别墅与石材库…</p> : catalog.error ? <Note kind="danger" title="读取失败">{catalog.error.message}</Note> : <div className="compose">
      <aside className="panel"><div className="panel__body" style={{ paddingTop: 4 }}>
        <label className="field"><span>方案名称</span><input className="input" maxLength={60} placeholder="例如：临水别墅 · 企业预置方案" value={draft.name} onChange={e => update({ name: e.target.value })}/></label>
        <label className="field"><span>内部说明（选填）</span><textarea className="input" rows={3} maxLength={200} placeholder="例如：客户上周到店，偏好暖色。" value={draft.note} onChange={e => update({ note: e.target.value })} style={{ height: 'auto', padding: '9px 12px' }}/></label>
        <p className="muted small" style={{ marginTop: 12 }}>说明会作为需求备注保存，客户在预览中看不到。</p>
      </div></aside>
      <div className="page__grid" style={{ marginTop: 0 }}>
        <section className="panel"><header className="panel__head"><h2 className="panel__title">饰面 <span className="muted small num">已选 {draft.finishes.length} 处</span></h2>
          <div className="segmented" role="group" aria-label="楼层">{plan!.levels.map(l => <button key={l.id} aria-pressed={l.id === level} onClick={() => update({ level: l.id })}>{l.name}
            <small>{draft.finishes.filter(id => { const f = finishes.find(x => x.id === id); return f && levelOf(f) === l.id; }).length}</small></button>)}</div></header>
          <div className="panel__body facet-pick"><div className="plan-box"><PlanDrawing plan={plan!} finishes={finishes} levelId={level} selected={draft.finishes}/></div>
            <div>{here.map(f => <button key={f.id} className="facet" aria-pressed={draft.finishes.includes(f.id)} onClick={() => update({ finishes: toggle(draft.finishes, f.id) })}>
              <span className="check"><Icon name="check" size={13}/></span><span><b>{f.name ?? f.id}</b><small>{kindName[f.kind] ?? f.kind}</small></span></button>)}
              {!here.length && <p className="muted small">这一层没有可铺贴的饰面。</p>}</div></div></section>
        <section className="panel"><header className="panel__head"><h2 className="panel__title">石材 <span className="muted small">最多 3 款，按顺序优先使用</span></h2><span className="muted small">示意素材</span></header>
          <div className="panel__body"><div className="stone-grid">{stones.map(s => { const n = draft.stones.indexOf(s.id) + 1;
            return <button key={`${s.id}:${s.version}`} className="stone-pick" aria-pressed={n > 0} onClick={() => update({ stones: toggle(draft.stones, s.id, 3) })}>
              <Swatch stone={s} size={240}/>{s.name.replace(/（示意）$/, '')}{n > 0 && <i>{n}</i>}</button>; })}</div></div></section>
      </div>
    </div>}
    <div className="action-bar">
      <span className="hint">{create.error ? (create.error as Error).message : !draft.name.trim() ? '先填写方案名称。' : !draft.finishes.length ? '至少选一处饰面。' : !draft.stones.length ? '至少选一款石材。' : '生成后进入线索详情，查看效果图并分享给客户。'}</span>
      <button className="btn btn--primary" disabled={!ready || create.isPending} onClick={() => create.mutate()}>{create.isPending ? '正在生成…' : '按规则生成方案'}</button>
    </div>
  </div></Shell>;
}
