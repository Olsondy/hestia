'use client';
// 方案需求：提交、状态（出图、待审核、协助转换）、沉浸方案页、选项式调整（统一出图）、确认与留言。
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StoneSpec } from '../../../../packages/contracts/src/finishes';
import { adjustBatch, clientApi, ClientError, maskPhone, operationId, type FinishRequestView, type FinishSchemeView, type RequestFinishView, type SceneSnapshot, type SchemeChange } from './client-api';
import { AppBar, ErrorLine, Loading, LoadingScreen, NotFound, Screen, StatusScreen, useClient, useSignedIn, useStored } from './client-app';
import { Icon, PatternGlyph, patternName } from './client-icons';
import { Alert, Badge, dateText, Group, Palette, PlanDrawing, Row, RowMain, Section, Segmented, Stepper, StyleOptions, Swatch, SwatchChip, Switch, type BadgeKind } from './client-parts';
import { SchemeViewer } from './scheme-viewer';
import { useRail } from './rail';
import { SchemeInfo } from './scheme-info';
import { useSheetDrag, type SheetState } from './sheet-drag';
import { softOf, styleKey } from './soft-styles';

// ---------- 状态 ----------
const rendering = (s: FinishSchemeView) => !s.render || s.render.status === 'queued' || s.render.status === 'running' || s.render.status === 'retry_wait';
export function requestStatus(r: FinishRequestView): { kind: BadgeKind; label: string; line: string; polling: boolean } {
  const done = r.schemes.filter(s => s.render?.status === 'completed').length;
  switch (r.status) {
    case 'awaiting_drawing': return { kind: 'act', label: '待上传图纸', line: '请重新上传户型图纸', polling: false };
    case 'converting': return { kind: 'wait', label: '识别中', line: '正在自动识别图纸', polling: true };
    case 'conversion_failed': return { kind: 'act', label: '未能识别', line: '可重新上传，或交给企业整理', polling: false };
    case 'assisted_conversion': return { kind: 'wait', label: '排队处理中', line: '企业整理户型后出方案', polling: true };
    case 'pending_review': return { kind: 'wait', label: '等待确认', line: '企业确认后发布', polling: true };
    default: {
      const polling = r.schemes.some(rendering), c = r.confirmation;
      if (c) {
        const s = r.schemes.find(x => x.id === c.schemeId);
        return c.current ? { kind: 'ok', label: '已确认', line: `已确认 方案 ${s ? letter(s) : ''} · 修订 ${c.revision}`, polling }
          : { kind: 'act', label: '需重新确认', line: `确认后又调整过 · 已确认修订 ${c.revision}`, polling };
      }
      if (!done && polling) return { kind: 'wait', label: '出图中', line: '正在排版出图', polling: true };
      return { kind: 'ok', label: '已发布', line: `${r.schemes.length} 个整体方案 · ${r.finishes.length} 处饰面`, polling };
    }
  }
}
export const letter = (s: { ordinal: number }) => String.fromCharCode(64 + s.ordinal);
const schemeTitle = (s: FinishSchemeView) => `${letter(s)} · ${s.name}`;
const mm = (m: number) => Math.round(m * 1000);
export const tileLabel = (t: { length: number; width: number }) => `${mm(t.length)}×${mm(t.width)}`;
const sameTile = (a: { length: number; width: number }, b: { length: number; width: number }) => Math.abs(a.length - b.length) < 1e-9 && Math.abs(a.width - b.width) < 1e-9;
const stoneOf = (scheme: FinishSchemeView, ref: { stoneId: string; stoneVersion: number } | undefined) =>
  ref && scheme.surfaceDesign.stones.find(s => s.id === ref.stoneId && s.version === ref.stoneVersion);
const tilingOf = (scheme: FinishSchemeView, finishId: string) => scheme.surfaceDesign.tilings.find(t => t.finishId === finishId);
export function finishLine(scheme: FinishSchemeView, finish: RequestFinishView) {
  const t = tilingOf(scheme, finish.id);
  if (!t) return '未铺石材';
  const name = stoneOf(scheme, t)?.name ?? '石材';
  if (finish.kind === 'stair') return `${name} · 整板踏步`;
  const border = t.border ? ` · ${stoneOf(scheme, t.border)?.name ?? ''}波打线` : '';
  return `${name} · ${tileLabel(t.tile)} · ${patternName[t.pattern] ?? t.pattern}${border}`;
}
/** Levels that carry requested finishes, in request order. */
function levelsOf(r: FinishRequestView) {
  const seen = new Map<string, string>();
  for (const f of r.finishes) if (f.levelId && !seen.has(f.levelId)) seen.set(f.levelId, f.levelName ?? f.levelId);
  return [...seen].map(([id, name]) => ({ id, name }));
}
const shortName = (title: string) => title.split(' · ')[0];
const pickScheme = (r: FinishRequestView, id: string | null) => r.schemes.find(x => x.id === id) ?? r.schemes.find(x => x.id === r.confirmation?.schemeId) ?? r.schemes[0];

// ---------- 提交方案需求 ----------
type Draft = { step: 1 | 2 | 3; source: 'demo-villa' | 'drawing' | null; fileName: string | null; level: string | null; finishIds: string[] | null;
  kinds: string[]; stones: string[]; tone: string | null; patterns: string[]; border: 'yes' | 'no' | 'auto'; note: string; op: string; uploadOp: string; requestId: string | null };
const freshDraft = (): Draft => ({ step: 1, source: null, fileName: null, level: null, finishIds: null, kinds: ['floor', 'wall', 'stair'], stones: [], tone: null, patterns: [],
  border: 'auto', note: '', op: operationId(), uploadOp: operationId(), requestId: null });
const toneValue: Record<string, 'light' | 'warm' | 'dark' | 'unsure'> = { 浅色: 'light', 暖色: 'warm', 深色: 'dark', 不确定: 'unsure' };
const kindName: Record<string, string> = { floor: '地面', wall: '墙面', stair: '楼梯' };
const kindChoice: Record<string, string> = { floor: '各层地面', wall: '背景墙', stair: '楼梯踏面' };
const stoneKey = (s: { id: string; version: number }) => `${s.id}:${s.version}`;
function finishSize(finish: { kind: string; outline?: { x: number; z: number }[]; start?: number; end?: number }) {
  if (finish.kind === 'floor' && finish.outline) {
    const xs = finish.outline.map(p => p.x), zs = finish.outline.map(p => p.z);
    return `${(Math.max(...xs) - Math.min(...xs)).toFixed(1)} × ${(Math.max(...zs) - Math.min(...zs)).toFixed(1)} m`;
  }
  if (finish.kind === 'wall' && finish.end !== undefined) return `宽 ${(finish.end - (finish.start ?? 0)).toFixed(1)} m`;
  return finish.kind === 'stair' ? '踏步与平台' : '整间';
}
const toggle = (list: string[], value: string) => list.includes(value) ? list.filter(v => v !== value) : [...list, value];

export function NewRequestView() {
  const { entry, base, workspaceName, go, toast } = useClient();
  const user = useSignedIn(`${base}/new`);
  const catalog = useQuery({ queryKey: ['catalog', entry], queryFn: () => clientApi(entry).catalog(), staleTime: 5 * 60_000 });
  const [d, setDraft] = useStoredLocal<Draft>(`hestia.client.draft.${entry}`, freshDraft());
  const file = useRef<File | null>(null);
  const [, force] = useState(0);
  const queries = useQueryClient();
  const set = (patch: Partial<Draft>) => setDraft(old => ({ ...old, ...patch }));
  const submit = useMutation({
    mutationFn: async () => {
      const api = clientApi(entry), stones = catalog.data!.stones;
      const chosen = (d.stones.length ? d.stones.map(k => stones.find(s => stoneKey(s) === k)).filter((s): s is StoneSpec => !!s) : stones.slice(0, 3))
        .map(s => ({ stoneId: s.id, stoneVersion: s.version }));
      const kinds = d.source === 'drawing' && d.kinds.length < 3 ? `希望铺贴：${d.kinds.map(k => kindChoice[k]).join('、')}` : '';
      const note = [kinds, d.note.trim()].filter(Boolean).join('\n') || undefined;
      const preferences = { ...(d.tone ? { tone: toneValue[d.tone] } : {}), ...(d.patterns.length ? { patterns: d.patterns as never } : {}), border: d.border };
      let request = d.requestId ? await api.request(d.requestId) : await api.create(d.source === 'demo-villa'
        ? { source: 'demo-villa', operationId: d.op, finishIds: d.finishIds ?? catalog.data!.demoVilla.finishes.map(f => f.id), stones: chosen, note, preferences }
        : { source: 'drawing', operationId: d.op, stones: chosen, note, preferences });
      set({ requestId: request.id });
      if (request.status === 'awaiting_drawing' && file.current) request = await api.drawing(request.id, file.current, d.uploadOp);
      return request;
    },
    onSuccess: request => { setDraft(freshDraft()); queries.invalidateQueries({ queryKey: ['requests', entry] }); queries.setQueryData(['request', entry, request.id], request); go(`${base}/r/${request.id}`, true); },
    onError: error => toast(error instanceof Error ? error.message : '提交未完成，请重试'),
  });
  const bar = (step: number) => step > 1 ? <AppBar onBack={() => set({ step: (step - 1) as 1 | 2 })} title="提交方案需求"/> : <AppBar back={base} title="提交方案需求"/>;
  if (!user || catalog.isLoading) return <LoadingScreen back={base}/>;
  if (!catalog.data) return <Screen bar={bar(1)}><main className="screen__body"><ErrorLine error={catalog.error}/></main></Screen>;
  const { stones, demoVilla } = catalog.data, plan = demoVilla.plan;
  const finishIds = d.finishIds ?? demoVilla.finishes.map(f => f.id);
  const levels = plan.levels.filter(l => demoVilla.finishes.some(f => finishLevel(f, plan) === l.id));
  const level = d.level && levels.some(l => l.id === d.level) ? d.level : levels[0]?.id;
  const drawing = d.source === 'drawing', dxf = drawing && /\.dxf$/i.test(d.fileName ?? '');
  const fileMissing = drawing && !file.current;
  const ready = d.source === 'demo-villa' || (drawing && !!file.current);
  const pick = (f: File | undefined) => { if (!f) return; file.current = f; set({ source: 'drawing', fileName: f.name }); force(n => n + 1); };
  const step = (n: 1 | 2 | 3) => { set({ step: n }); window.scrollTo(0, 0); };
  let body: React.ReactNode, dock: React.ReactNode;
  if (d.step === 1) {
    body = <><h1 className="page-title">先选择户型</h1><p className="lede">用示例别墅体验完整流程，或上传你家的图纸。</p>
      <div className="section" role="radiogroup" aria-label="户型来源">
        <button className="option" role="radio" aria-checked={d.source === 'demo-villa'} onClick={() => { file.current = null; set({ source: 'demo-villa', fileName: null }); }}>
          <span className="option__media">{levels[0] && <PlanDrawing plan={plan} finishes={demoVilla.finishes} levelId={levels[0].id} selected={[]} small/>}</span>
          <span className="option__body"><b>示例别墅（演示）</b><small>{plan.levels.length} 层 · {demoVilla.finishes.length} 处可铺贴饰面 · 尺寸为示意</small></span>
          <span className="radio"><Icon name="check" size={14}/></span></button>
        <div className="upload" data-on={drawing ? '' : undefined}>
          <label className="option" role="radio" aria-checked={drawing}><input type="file" className="sr-only" accept=".dxf,.dwg,.pdf,.png,.jpg,.jpeg" onChange={e => pick(e.target.files?.[0])}/>
            <span className="option__media"><Icon name="upload" size={22}/></span>
            <span className="option__body"><b>上传我的图纸</b><small>DXF 立即识别出方案；照片、PDF、DWG 排队由企业整理</small></span>
            <span className="radio"><Icon name="check" size={14}/></span></label>
          {drawing && d.fileName && <>
            <div className="upload__file"><Icon name="file" size={16}/><b>{d.fileName}</b>{fileMissing ? <Badge kind="act">需重新选择</Badge> : dxf ? <Badge>立即识别</Badge> : <Badge>排队处理</Badge>}</div>
            <p className="meta">{fileMissing ? '页面刷新后需要重新选择这个文件。' : dxf ? '提交后几分钟内识别并出方案；识别不了会告诉你原因。每天可免费上传 3 次。' : `照片、PDF 和 DWG 需要${workspaceName}整理户型，提交后排队处理，完成后在「项目」里查看。每天可免费上传 3 次。`}</p>
          </>}
        </div>
      </div></>;
    dock = <button className="btn btn--primary btn--block" disabled={!ready} onClick={() => step(2)}>下一步：选择饰面</button>;
  } else if (d.step === 2) {
    if (drawing) {
      body = <><h1 className="page-title">想铺石材的部位</h1><p className="lede">图纸转换后，企业会和你确认具体楼层与饰面。先告诉我们大致范围。</p>
        <div className="section chips" role="group" aria-label="饰面范围">{['floor', 'wall', 'stair'].map(k =>
          <button key={k} className="chip" aria-pressed={d.kinds.includes(k)} onClick={() => set({ kinds: toggle(d.kinds, k) })}>{kindChoice[k]}</button>)}</div></>;
    } else {
      const here = demoVilla.finishes.filter(f => finishLevel(f, plan) === level);
      const count = (id: string) => finishIds.filter(fid => finishLevel(demoVilla.finishes.find(f => f.id === fid)!, plan) === id).length;
      body = <><h1 className="page-title">选择要铺石材的饰面</h1><p className="lede">饰面是建筑的一部分，不随家具移动。只为勾选的部位出方案。</p>
        <Section title="示例别墅" aside={`已选 ${finishIds.length} 处`}>
          {levels.length > 1 && <Segmented label="楼层" value={level ?? ''} onChange={v => set({ level: v })} options={levels.map(l => [l.id, `${l.name} · ${count(l.id)}`])}/>}
          {level && <figure className="plan"><PlanDrawing plan={plan} finishes={demoVilla.finishes} levelId={level} selected={finishIds}/>
            <figcaption>{plan.levels.find(l => l.id === level)?.name}平面 · 示例尺寸</figcaption></figure>}
          <Group>{here.map(f => <button key={f.id} className="check" aria-pressed={finishIds.includes(f.id)} onClick={() => set({ finishIds: toggle(finishIds, f.id) })}>
            <span className="check__box"><Icon name="check" size={14}/></span>
            <RowMain title={f.name} sub={`${kindName[f.kind]} · ${finishSize(f as never)}`}/></button>)}</Group>
        </Section></>;
    }
    dock = <><button className="btn btn--secondary" onClick={() => step(1)}>上一步</button>
      <button className="btn btn--primary btn--grow" disabled={drawing ? !d.kinds.length : !finishIds.length} onClick={() => step(3)}>下一步：挑选石材</button></>;
  } else {
    body = <><h1 className="page-title">挑选石材与偏好</h1><p className="lede">来自{workspaceName}的石材库，最多 3 款，方案按选择顺序优先使用。软装风格出方案后可以切换。</p>
      <Section title="石材" aside={d.stones.length ? `已选 ${d.stones.length} / 3` : '未选时按企业推荐'}>
        <div className="swatches">{stones.map(s => { const n = d.stones.indexOf(stoneKey(s)) + 1; return <button key={stoneKey(s)} className="swatch" aria-pressed={n > 0}
          onClick={() => { if (n) set({ stones: d.stones.filter(k => k !== stoneKey(s)) }); else if (d.stones.length < 3) set({ stones: [...d.stones, stoneKey(s)] }); else toast('最多选择 3 款石材'); }}>
          <Swatch stone={s} size={180}/>{n ? <i className="swatch__order">{n}</i> : null}{s.name}<small>{s.surface === 'polished' ? '抛光' : '哑光'}</small></button>; })}</div>
      </Section>
      <Section title="整体色调"><div className="chips" role="radiogroup" aria-label="整体色调">{Object.keys(toneValue).map(t =>
        <button key={t} className="chip" role="radio" aria-checked={d.tone === t} onClick={() => set({ tone: t })}>{t}</button>)}</div></Section>
      <Section title="铺法偏好" aside="可多选"><div className="chips" role="group" aria-label="铺法偏好">{Object.keys(patternName).map(p =>
        <button key={p} className="chip" aria-pressed={d.patterns.includes(p)} onClick={() => set({ patterns: toggle(d.patterns, p) })}><PatternGlyph pattern={p} size={18}/>{patternName[p]}</button>)}</div></Section>
      <Section title="波打线"><div className="chips" role="radiogroup" aria-label="波打线">{([['yes', '要'], ['no', '不要'], ['auto', '由方案决定']] as const).map(([v, t]) =>
        <button key={v} className="chip" role="radio" aria-checked={d.border === v} onClick={() => set({ border: v })}>{t}</button>)}</div></Section>
      <Section title="补充说明" aside="选填"><Group><label className="field"><span className="sr-only">补充说明（选填）</span>
        <textarea rows={3} maxLength={300} placeholder="例如：客厅想更大气；家里有老人，楼梯要防滑。" value={d.note} onChange={e => set({ note: e.target.value })}/></label></Group></Section>
      <p className="fine-print">石材为示意素材；偏好会随需求一起交给企业</p></>;
    dock = <><button className="btn btn--secondary" onClick={() => step(2)}>上一步</button>
      <button className="btn btn--primary btn--grow" disabled={submit.isPending || fileMissing} onClick={() => submit.mutate()}>{submit.isPending ? '正在提交…' : '提交方案需求'}</button></>;
  }
  return <Screen bar={bar(d.step)} dock={dock}><main className="screen__body"><Stepper step={d.step} names={['户型', '饰面', '石材与偏好']}/>{body}</main></Screen>;
}
function finishLevel(f: { kind: string; levelId?: string; roomId?: string; wallId?: string; stairId?: string }, plan: { rooms: { id: string; levelId: string }[]; walls: { id: string; levelId: string }[]; stairs: { id: string; levelId: string }[] }) {
  if (f.kind === 'floor') return f.levelId ?? plan.rooms.find(r => r.id === f.roomId)?.levelId;
  if (f.kind === 'wall') return plan.walls.find(w => w.id === f.wallId)?.levelId;
  return plan.stairs.find(s => s.id === f.stairId)?.levelId;
}
/** Draft survives closing the page (localStorage), unlike per-tab UI state. */
function useStoredLocal<T>(key: string, initial: T): [T, (value: T | ((old: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try { const raw = localStorage.getItem(key); return raw ? { ...initial, ...JSON.parse(raw) } : initial; } catch { return initial; }
  });
  const set = (next: T | ((old: T) => T)) => setValue(old => {
    const v = typeof next === 'function' ? (next as (old: T) => T)(old) : next;
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* memory only */ }
    return v;
  });
  return [value, set];
}

// ---------- 方案需求路由 ----------
export function RequestRoute({ id, sub }: { id: string; sub?: string }) {
  const { entry, base } = useClient();
  const user = useSignedIn(`${base}/r/${id}${sub ? `/${sub}` : ''}`);
  const request = useQuery({ queryKey: ['request', entry, id], queryFn: () => clientApi(entry).request(id), enabled: !!user,
    refetchInterval: query => query.state.data && requestStatus(query.state.data).polling ? 3000 : false });
  const [peek, setPeek] = useState(false);
  if (!user || request.isLoading) return <LoadingScreen back={`${base}/projects`}/>;
  if (request.error instanceof ClientError && request.error.status === 404) return <NotFound title="找不到这个项目" text="项目不存在，或没有绑定到你的账号。"/>;
  if (!request.data) return <Screen bar={<AppBar back={`${base}/projects`}/>}><main className="screen__body"><ErrorLine error={request.error}/></main></Screen>;
  const r = request.data;
  if (r.status === 'awaiting_drawing') return <UploadAgainView request={r}/>;
  if (r.status === 'converting') return <WaitView request={r} converting/>;
  if (r.status === 'conversion_failed') return <ConversionFailedView request={r}/>;
  if (r.status === 'assisted_conversion') return <AssistView request={r}/>;
  if (r.status === 'pending_review') return <ReviewView request={r}/>;
  // First generation only: once a scheme has been adjusted, re-renders show inside the scheme and adjust pages.
  // Stay until every render has finished so the progress is visible; the customer may look at finished schemes early.
  if (!sub && !peek && r.schemes.every(s => s.revision === 1) && r.schemes.some(rendering)) return <WaitView request={r} onPeek={() => setPeek(true)}/>;
  if (sub === 'adjust') return <AdjustView request={r}/>;
  if (sub === 'confirm') return <ConfirmView request={r}/>;
  if (sub === 'done') return <DoneView request={r}/>;
  return <ResultView request={r}/>;
}

function RequestSummary({ request: r }: { request: FinishRequestView }) {
  const { entry } = useClient();
  const catalog = useQuery({ queryKey: ['catalog', entry], queryFn: () => clientApi(entry).catalog(), staleTime: 5 * 60_000 });
  const names = r.stones.map(ref => catalog.data?.stones.find(s => s.id === ref.stoneId && s.version === ref.stoneVersion)?.name).filter(Boolean);
  const p = r.preferences;
  const tone = p?.tone && Object.entries(toneValue).find(([, v]) => v === p.tone)?.[0];
  return <Section title="你的方案需求"><Group>
    <Row label="户型" value={r.source === 'demo-villa' ? '示例别墅（演示）' : r.drawingName ?? '户型图纸'}/>
    <Row label="饰面" value={r.finishes.length ? `${r.finishes.length} 处` : '图纸转换后确认'}/>
    <Row label="石材" value={names.join('、') || '—'}/>
    <Row label="偏好" value={[tone, p?.patterns?.map(x => patternName[x]).join('、'), p?.border === 'yes' ? '要波打线' : p?.border === 'no' ? '不要波打线' : ''].filter(Boolean).join(' · ') || '未填写'}/>
    {r.note && <Row label="说明" value={r.note} stack/>}
  </Group></Section>;
}
const RENDER_GUESS_MS = 90_000;
const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** When each render was first seen running and completed on this page; the worker reports no finer progress. */
function useRenderClock(schemes: FinishSchemeView[]) {
  const seen = useRef(new Map<string, { start?: number; end?: number }>());
  const [now, setNow] = useState(() => Date.now());
  const [since] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const at = Date.now();
    for (const s of schemes) {
      const entry = seen.current.get(s.id) ?? {};
      if (s.render?.status === 'running' && !entry.start) seen.current.set(s.id, { ...entry, start: at });
      if (s.render?.status === 'completed' && entry.start && !entry.end) seen.current.set(s.id, { ...entry, end: at });
    }
  }, [schemes]);
  const measured = [...seen.current.values()].flatMap(e => e.start && e.end ? [e.end - e.start] : []);
  const estimate = measured.length ? measured.reduce((a, b) => a + b, 0) / measured.length : null;
  const elapsed = (id: string) => { const start = seen.current.get(id)?.start; return start ? now - start : 0; };
  return { estimate, elapsed, waited: now - since };
}
function WaitView({ request: r, converting = false, onPeek }: { request: FinishRequestView; converting?: boolean; onPeek?: () => void }) {
  const { base } = useClient();
  const { estimate, elapsed, waited } = useRenderClock(r.schemes);
  const total = r.schemes.length || 3;
  const done = r.schemes.filter(s => s.render?.status === 'completed').length, failed = r.schemes.filter(s => s.render?.status === 'failed').length;
  // Within a render, creep towards (never reach) the next step so a 30 s–2 min image does not look frozen.
  const creep = r.schemes.filter(s => s.render?.status === 'running').reduce((sum, s) => sum + Math.min(.95, 1 - Math.exp(-elapsed(s.id) / (estimate ?? RENDER_GUESS_MS))), 0);
  const k = converting ? .12 : .06 + .94 * Math.min(1, (done + failed + creep) / total);
  const slotState = (s: FinishSchemeView) => converting ? 'todo' : s.render?.status === 'completed' ? 'done'
    : s.render?.status === 'failed' ? 'failed' : s.render?.status === 'running' ? 'now' : 'todo';
  const slotNote = (s: FinishSchemeView, state: string) => state === 'now' ? ` · ${clock(elapsed(s.id))}` : state === 'failed' ? ' · 失败' : state === 'todo' && !converting ? ' · 排队' : '';
  const pace = estimate ? `每张约 ${Math.max(1, Math.round(estimate / 1000))} 秒` : '每张约 1–2 分钟';
  const steps = [...(r.source === 'drawing' ? ['识别图纸'] : []), '读取空间与饰面', '计算铺贴排版与切块', `渲染 ${total} 张效果图`, '整理方案'];
  const at = converting ? 0 : steps.length - 2;
  const slots = r.schemes.length ? r.schemes : [1, 2, 3].map(ordinal => ({ id: String(ordinal), ordinal, render: null } as unknown as FinishSchemeView));
  return <Screen bar={<AppBar back={`${base}/projects`}/>}>
    <main className="screen__body">
      <h1 className="page-title">{converting ? '正在识别图纸' : '正在排版出图'}</h1>
      <p className="lede">{converting ? `正在读取「${r.drawingName ?? '图纸'}」的图层、墙体与楼层，识别后直接排版出图。` : `按你选择的 ${r.finishes.length} 处饰面和石材计算整块与切块，再渲染效果图。`}{converting ? '每张约 1–2 分钟' : pace}，可以离开此页，完成后在「项目」里查看。</p>
      <div className="renders">{slots.map(s => { const state = slotState(s);
        return <div key={s.id} className="render-slot" data-state={state}>{state === 'done' && s.render?.imageHref && <img src={s.render.imageHref} alt=""/>}<span className="num">方案 {letter(s)}{slotNote(s, state)}</span></div>; })}</div>
      <div className="bar" role="progressbar" aria-label="出图进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(k * 100)}><i style={{ width: `${k * 100}%` }}/></div>
      <p className="meta num" style={{ marginTop: 8 }}>{converting ? '转换中' : [`已完成 ${done} / ${total}`, failed ? `${failed} 张出图失败` : '', `已等待 ${clock(waited)}`].filter(Boolean).join(' · ')}</p>
      <ol className="timeline">{steps.map((t, i) => <li key={t} data-state={i < at ? 'done' : i === at ? 'now' : 'todo'}><i aria-hidden="true">{i < at ? <Icon name="check" size={13}/> : null}</i><div><b>{t}</b></div></li>)}</ol>
      <div className="btn-stack">
        {onPeek && done > 0 && <button type="button" className="btn btn--primary btn--block" onClick={onPeek}>先看已出的 {done} 个方案</button>}
        <Link className="btn btn--secondary btn--block" href={`${base}/projects`}>去我的项目</Link>
      </div>
    </main>
  </Screen>;
}
function ReviewView({ request: r }: { request: FinishRequestView }) {
  const { base, workspaceName } = useClient();
  const drawing = r.source === 'drawing';
  return <StatusScreen back={`${base}/projects`} title="方案已生成，企业确认后发布"
    sub={`${workspaceName}设置了先确认、再发布方案。发布后可以在「项目」里查看。`}
    items={[['提交方案需求', 'done', dateText(r.createdAt)], [drawing ? '识别图纸与排版出图' : '排版出图', 'done', `${r.schemes.length || 3} 个整体方案`], ['企业确认', 'now', ''], ['发布方案', '']]}>
    <RequestSummary request={r}/>
  </StatusScreen>;
}
function AssistView({ request: r }: { request: FinishRequestView }) {
  const { base, workspaceName } = useClient();
  return <StatusScreen back={`${base}/projects`} title="已收到图纸，排队处理中"
    sub={`${workspaceName}会按顺序整理「${r.drawingName ?? '图纸'}」的户型，整理好后自动排版出图，完成后在「项目」里查看。不用一直停在这个页面。`}
    items={[['提交图纸', 'done', dateText(r.createdAt)], ['企业整理户型', 'now', '排队中，通常 1–2 个工作日'], ['排版出图', ''], ['查看方案', '']]}>
    <RequestSummary request={r}/>
  </StatusScreen>;
}
/** ADR-0013: a DXF the system could not read is explained right away; the customer uploads again or hands it over. */
function ConversionFailedView({ request: r }: { request: FinishRequestView }) {
  const { base, entry, workspaceName } = useClient();
  const queries = useQueryClient(), [op] = useState(operationId);
  const settle = (v: FinishRequestView) => { queries.setQueryData(['request', entry, r.id], v); queries.invalidateQueries({ queryKey: ['requests', entry] }); };
  const send = useMutation({ mutationFn: (file: File) => clientApi(entry).drawing(r.id, file, op), onSuccess: settle });
  const hand = useMutation({ mutationFn: () => clientApi(entry).handOver(r.id), onSuccess: settle });
  return <StatusScreen back={`${base}/projects`} seal={<span className="seal seal--quiet" aria-hidden="true"><Icon name="file" size={26}/></span>}
    title="图纸没能自动识别" sub={r.conversionError ?? '系统没能从这份图纸读出完整的户型。'}>
    <Section title="可以这样重新导出">
      <Group>
        <div className="row"><RowMain icon="check" title="另存为 DXF（AutoCAD 2013 或更早格式）" sub="墙线画成闭合的多段线，单位设为毫米"/></div>
        <div className="row"><RowMain icon="check" title="只保留一层平面" sub="删去图框、标注和家具图块后再导出"/></div>
      </Group>
    </Section>
    <div className="btn-stack">
      <label className="btn btn--primary btn--block"><input type="file" className="sr-only" accept=".dxf,.dwg,.pdf,.png,.jpg,.jpeg" disabled={send.isPending}
        onChange={e => { const f = e.target.files?.[0]; if (f) send.mutate(f); e.target.value = ''; }}/>{send.isPending ? '正在上传…' : '重新上传图纸'}</label>
      <button className="btn btn--secondary btn--block" disabled={hand.isPending} onClick={() => hand.mutate()}>{hand.isPending ? '正在提交…' : `交给${workspaceName || '企业'}整理`}</button>
    </div>
    <ErrorLine error={send.error ?? hand.error}/>
    <RequestSummary request={r}/>
  </StatusScreen>;
}
function UploadAgainView({ request: r }: { request: FinishRequestView }) {
  const { base, entry } = useClient();
  const queries = useQueryClient(), [op] = useState(operationId);
  const send = useMutation({ mutationFn: (file: File) => clientApi(entry).drawing(r.id, file, op), onSuccess: v => queries.setQueryData(['request', entry, r.id], v) });
  return <StatusScreen back={`${base}/projects`} title="还差一份户型图纸" sub="需求已保存，但图纸没有上传成功。重新选择文件即可继续。">
    <div className="btn-stack"><label className="btn btn--primary btn--block"><input type="file" className="sr-only" accept=".dxf,.dwg,.pdf,.png,.jpg,.jpeg"
      onChange={e => { const f = e.target.files?.[0]; if (f) send.mutate(f); }}/>{send.isPending ? '正在上传…' : '选择图纸文件'}</label></div>
    <ErrorLine error={send.error}/>
    <RequestSummary request={r}/>
  </StatusScreen>;
}

// ---------- 方案页：Stage（效果图 / 3D）+ Panel ----------
type ResultUi = { scheme: string | null; level: string | null; view: 'image' | '3d' | 'plan'; expanded: boolean; minimized?: boolean };
const resultUi: ResultUi = { scheme: null, level: null, view: 'image', expanded: false };
function useSwipe(onSwipe: (direction: 1 | -1) => void) {
  const start = useRef<number | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => { start.current = (e.target as HTMLElement).closest('button, canvas, [data-rail], [data-stage-ui]') ? null : e.clientX; },
    onPointerUp: (e: React.PointerEvent) => { if (start.current !== null && Math.abs(e.clientX - start.current) > 40) onSwipe(e.clientX < start.current ? 1 : -1); start.current = null; },
  };
}
export function ResultView({ request: r, preview, onGate, loadScene }: { request: FinishRequestView; preview?: boolean; onGate?: () => void; loadScene?: (schemeId: string) => Promise<SceneSnapshot> }) {
  const { base, entry } = useClient();
  const [ui, setUi] = useStored<ResultUi>(`hestia.client.result.${r.id}`, resultUi);
  const s = pickScheme(r, ui.scheme);
  const soft = softOf(s);
  const levels = levelsOf(r), level = levels.find(l => l.id === ui.level)?.id ?? levels[0]?.id ?? null;
  const sceneQuery = { queryKey: ['scene', r.id, s?.id, s?.revision], queryFn: () => (loadScene ?? (id => clientApi(entry).scene(r.id, id)))(s!.id), staleTime: Infinity };
  const scene = useQuery({ ...sceneQuery, enabled: ui.view !== 'image' && !!s });
  // While the still is on screen, fetch the scene and the 3D runtime when the page is idle, so the first switch to
  // 3D / plan starts from local data. Textures are not built here: that would cost the phone CPU while browsing.
  const prefetch = useQueryClient();
  useEffect(() => {
    if (ui.view !== 'image' || !s) return;
    const timer = setTimeout(() => {
      void prefetch.prefetchQuery(sceneQuery);
      void import('../../../../packages/scene-runtime/src/scene').catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.view, s?.id, s?.revision]);
  const index = Math.max(0, r.schemes.indexOf(s));
  const shift = (d: 1 | -1) => setUi(u => ({ ...u, scheme: r.schemes[(index + d + r.schemes.length) % r.schemes.length].id }));
  const swipe = useSwipe(shift);
  const sheet: SheetState = ui.expanded ? 'expanded' : ui.minimized ? 'min' : 'normal';
  const [night, setNight] = useState(false);
  const { panel, grip } = useSheetDrag(sheet, next => setUi(u => ({ ...u, expanded: next === 'expanded', minimized: next === 'min' })));
  if (!s) return <NotFound title="还没有可查看的方案" text="这个项目还没有发布方案。"/>;
  const conf = r.confirmation, mine = conf?.schemeId === s.id;
  const here = r.finishes.filter(f => !level || f.levelId === level);
  const main = r.finishes.find(f => f.kind === 'floor') ?? r.finishes[0];
  const mainTiling = main && tilingOf(s, main.id), mainStone = stoneOf(s, mainTiling);
  const compareFinish = here.find(f => f.kind === 'floor') ?? here[0];
  const issues = s.issues.filter(i => here.some(f => f.id === i.objectId) || !r.finishes.some(f => f.id === i.objectId));
  const reRendering = rendering(s) && s.revision > 1;
  const actions = preview
    ? <><button className="btn btn--secondary" onClick={onGate}><Icon name="lock" size={17}/>调整</button><button className="btn btn--primary btn--grow" onClick={onGate}><Icon name="lock" size={17}/>确认方案</button></>
    : conf?.current && mine
      ? <><Link className="btn btn--secondary" href={`${base}/r/${r.id}/adjust`}>继续调整</Link><Link className="btn btn--primary btn--grow" href={`${base}/r/${r.id}/done`}>查看确认</Link></>
      : <><Link className="btn btn--secondary" href={`${base}/r/${r.id}/adjust`}>调整</Link><Link className="btn btn--primary btn--grow" href={`${base}/r/${r.id}/confirm`}>确认方案 {letter(s)}</Link></>;
  const rows: [string, (x: FinishSchemeView) => string][] = [
    ['软装', x => x.softStyle?.name ?? '—'],
    ['石材', x => stoneOf(x, compareFinish && tilingOf(x, compareFinish.id))?.name ?? '—'],
    ['规格', x => { const t = compareFinish && tilingOf(x, compareFinish.id); return t ? (compareFinish.kind === 'stair' ? '整板' : tileLabel(t.tile)) : '—'; }],
    ['铺法', x => { const t = compareFinish && tilingOf(x, compareFinish.id); return t ? patternName[t.pattern] ?? t.pattern : '—'; }],
    ['波打线', x => { const t = compareFinish && tilingOf(x, compareFinish.id); return !t ? '—' : t.border ? '有' : '无'; }],
  ];
  const details = <>
    <p className="meta" style={{ marginTop: 12 }}>{s.summary}</p>
    {soft && <Section title={`软装 · ${soft.name}`} aside="示意素材"><div className="summary"><Palette style={soft}/><RowMain title={soft.name} sub={soft.line}/></div></Section>}
    {levels.length > 1 && <div className="section"><Segmented label="楼层" value={level ?? ''} onChange={v => setUi(u => ({ ...u, level: v }))} options={levels.map(l => [l.id, l.name])}/></div>}
    <Section title="硬装" aside={`${levels.length > 1 ? `${levels.find(l => l.id === level)?.name} · ` : ''}${here.length} 处`}>
      <Group>{here.map(f => <Row key={f.id} label={f.name} value={<><SwatchChip stone={stoneOf(s, tilingOf(s, f.id))}/>{finishLine(s, f)}</>} stack/>)}</Group>
    </Section>
    {compareFinish && r.schemes.length > 1 && <Section title={`${r.schemes.length} 个方案的差异`} aside={compareFinish.name}>
      <table className="compare"><thead><tr><th scope="col"><span className="sr-only">项目</span></th>{r.schemes.map(x =>
        <th key={x.id} scope="col" className={x.id === s.id ? 'is-current' : ''}>方案 {letter(x)}<br/>{x.name}</th>)}</tr></thead>
        <tbody>{rows.map(([label, fn]) => { const vals = r.schemes.map(fn), same = vals.every(v => v === vals[0]); return <tr key={label}>
          <th scope="row">{label}{same ? <small>相同</small> : null}</th>
          {vals.map((v, i) => <td key={r.schemes[i].id} className={r.schemes[i].id === s.id ? 'is-current' : ''}>{v}</td>)}</tr>; })}</tbody></table>
    </Section>}
    {issues.map(i => <Alert key={i.code + i.objectId} kind="hint" title="提示">{i.message}</Alert>)}
  </>;
  return <Screen className={`immersive${ui.expanded ? ' is-expanded' : ''}${sheet === 'min' ? ' is-min' : ''}`}>
    <div className={`stage${reRendering && ui.view === 'image' ? ' stage--busy' : ''}`} {...swipe}>
      {ui.view === 'image' ? <SchemeImage scheme={s} alt={`方案 ${letter(s)} 效果图（示意）`}/> : <SchemeViewer key={`${s.id}:${s.revision}`} scene={scene.data} plan={ui.view === 'plan'} night={night} onNightChange={setNight}/>}
      {ui.view !== 'image' && scene.error ? <div className="stage__msg" role="alert">{scene.error instanceof Error ? scene.error.message : '3D 暂时打不开'}</div> : null}
      {!ui.expanded && <>
        <div className="stage__top">
          {/* One short row so it never covers the model; the longer notes live in 方案说明. */}
          {preview && <span className="media-tag" title="企业分享给你的方案，登录绑定后才能调整和确认"><Icon name="eye" size={14}/>仅预览</span>}
          {reRendering && <span className="media-tag"><Icon name="clock" size={14}/>修订 {s.revision} 出图中</span>}
          {ui.view === '3d' && scene.data && <button type="button" className="media-tag" aria-pressed={night} onClick={() => setNight(!night)}>
            <Icon name={night ? 'moon' : 'sun'} size={14}/>{night ? '夜景' : '日景'}</button>}
          <SchemeInfo scheme={s} title={schemeTitle(s)}/>
        </div>
        {r.schemes.length > 1 && <><button className="icon-btn icon-btn--media stage__nav stage__nav--prev" onClick={() => shift(-1)} aria-label="上一个方案"><Icon name="left" size={18}/></button>
          <button className="icon-btn icon-btn--media stage__nav stage__nav--next" onClick={() => shift(1)} aria-label="下一个方案"><Icon name="right" size={18}/></button></>}
        <div className="stage__bottom">
          <Segmented media label="查看方式" value={ui.view} onChange={v => setUi(u => ({ ...u, view: v }))} options={[['image', '效果图', 'image'], ['3d', '3D', 'cube'], ['plan', '平面图', 'plan']]}/>
          <span className="media-tag num">{index + 1} / {r.schemes.length}</span>
        </div>
      </>}
    </div>
    <AppBar back={preview ? undefined : `${base}/projects`} title={shortName(r.title)} overlay/>
    <section className="panel" aria-label="方案详情" ref={panel}>
      <button className="panel__grip" {...grip} aria-expanded={ui.expanded} aria-label={sheet === 'expanded' ? '收起详情（可拖动）' : sheet === 'min' ? '显示方案（可拖动）' : '展开详情（可拖动）'}/>
      <div className="panel__scroll">
        {r.schemes.length > 1 && <Segmented label="切换方案" value={s.id} onChange={id => setUi(u => ({ ...u, scheme: id }))} options={r.schemes.map(x => [x.id, schemeTitle(x)])}/>}
        <div className="panel__head"><div><h1 className="panel__title">方案 {schemeTitle(s)}</h1><p className="meta">修订 {s.revision}{r.schemes.length > 1 ? ' · 左右滑动效果图也可切换' : ''}</p></div>
          {soft && <span className="style-tag"><Palette style={soft} mod="palette--dot"/>{soft.name}</span>}</div>
        {!preview && conf && mine && conf.current && <p className="panel__note"><Icon name="check" size={14}/>你已确认这一版</p>}
        {!preview && conf && !conf.current && <Alert kind="hint" title="需要重新确认">你确认的是方案 {letter(r.schemes.find(x => x.id === conf.schemeId) ?? s)} 修订 {conf.revision}，之后又调整过。企业看到的仍是修订 {conf.revision}。</Alert>}
        {main && <div className="summary"><Swatch stone={mainStone} size={104} className="summary__img"/>
          <RowMain title={mainStone?.name ?? '未铺石材'} sub={`${main.name} · ${finishLine(s, main).split(' · ').slice(1).join(' · ') || '—'}`}/></div>}
        {ui.expanded ? details : <button className="text-link" onClick={() => setUi(u => ({ ...u, expanded: true }))} style={{ marginTop: 8 }}>查看软装、硬装清单与方案对比 <Icon name="right" size={14}/></button>}
      </div>
      <div className="panel__actions">{actions}</div>
    </section>
  </Screen>;
}
// The image URL of a scheme always serves its current revision, and is unavailable while a new revision renders.
// Keep the last finished image per scheme so a re-render shows the previous revision (blurred by the caller) instead of a blank stage.
const lastImages = new Map<string, { revision: number; url: string }>();
function SchemeImage({ scheme, alt, className = 'stage__img' }: { scheme: FinishSchemeView; alt: string; className?: string }) {
  const href = scheme.render?.imageHref, failed = scheme.render?.status === 'failed';
  const [url, setUrl] = useState(() => lastImages.get(scheme.id)?.url ?? null);
  // A finished still is *downloaded* here, which is not the same as being rendered: say which, time out, retry.
  const [load, setLoad] = useState<'idle' | 'loading' | 'error'>('idle'), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const cached = lastImages.get(scheme.id);
    if (!href) { setUrl(cached?.url ?? null); setLoad('idle'); return; }
    if (cached?.revision === scheme.revision) { setUrl(cached.url); setLoad('idle'); return; }
    let live = true, tries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const get = () => {
      const timeout = setTimeout(() => controller.abort(), 45_000);
      setLoad('loading');
      // fetch() sends Accept: */* by default; ask for WebP so the server sends the ~50 KB version, not the 1 MB PNG.
      fetch(href, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { Accept: 'image/webp,image/png;q=0.9,*/*;q=0.5' } })
        .then(r => r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))).then(blob => {
          const next = URL.createObjectURL(blob), old = lastImages.get(scheme.id);
          lastImages.set(scheme.id, { revision: scheme.revision, url: next });
          if (old) setTimeout(() => URL.revokeObjectURL(old.url), 5000);
          if (live) { setUrl(next); setLoad('idle'); }
        }).catch(() => {
          if (!live) return;
          if (++tries <= 2 && !controller.signal.aborted) { timer = setTimeout(get, 1500 * tries); return; }
          setUrl(cached?.url ?? null); setLoad('error');
        }).finally(() => clearTimeout(timeout));
    };
    get();
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [href, scheme.id, scheme.revision, attempt]);
  if (url) return <img className={className} src={url} alt={alt}/>;
  if (className !== 'stage__img') return null;
  if (load === 'error') return <div className="stage__msg" role="alert">效果图加载失败，可能是网络不稳定。
    <button type="button" className="media-tag" onClick={() => setAttempt(n => n + 1)}>重试</button></div>;
  return <div className="stage__msg" role="status">{failed ? '这张效果图暂时没有生成，企业会处理。可以先看 3D。'
    : href ? <>正在加载效果图…<span className="progress"><i/></span></> : <>正在出图…每张约 1–2 分钟<span className="progress"><i/></span></>}</div>;
}

// ---------- 调整：修改先累积在本机，「重新出图」一次提交（ADR-0010） ----------
type Pending = { label: string; finishId?: string; change?: SchemeChange; soft?: { before: string; after: string } };
type AdjustUi = { tab: 'soft' | 'hard'; level: string | null; finish: string | null; pending: Pending[]; base: string; softDone: boolean };
function AdjustView({ request: r }: { request: FinishRequestView }) {
  const { base, entry, toast } = useClient();
  const queries = useQueryClient();
  const [result] = useStored<ResultUi>(`hestia.client.result.${r.id}`, resultUi);
  const s = pickScheme(r, result.scheme);
  const revisionKey = `${s.id}:${s.revision}`;
  const [ui, setUi] = useStored<AdjustUi>(`hestia.client.adjust.${r.id}`, { tab: 'soft', level: null, finish: null, pending: [], base: revisionKey, softDone: false });
  // Pending changes belong to the revision they were made on; a new revision (re-render, another device) starts over.
  useEffect(() => { if (ui.base !== revisionKey) setUi(u => ({ ...u, pending: [], base: revisionKey })); }, [ui.base, revisionKey, setUi]);
  const pending = ui.base === revisionKey ? ui.pending : [];
  const savedSoft = softOf(s), choices = s.softChoices;
  const soft = [...pending].reverse().find(p => p.soft)?.soft?.after ?? (savedSoft ? styleKey(savedSoft) : '');
  const styleName = (key: string) => choices.find(c => styleKey(c) === key)?.name ?? '';
  const catalog = useQuery({ queryKey: ['catalog', entry], queryFn: () => clientApi(entry).catalog(), staleTime: 5 * 60_000 });
  const options = useQuery({ queryKey: ['options', r.id, s.id, s.revision], queryFn: () => clientApi(entry).options(r.id, s.id) });
  const [rejected, setRejected] = useState<string | null>(null);
  const levels = levelsOf(r), level = levels.find(l => l.id === ui.level)?.id ?? levels[0]?.id ?? null;
  const here = r.finishes.filter(f => !level || f.levelId === level);
  const finish = here.find(f => f.id === ui.finish) ?? here.find(f => f.kind === 'floor') ?? here[0];
  const opt = options.data?.finishes.find(f => f.finishId === finish?.id);
  const busy = rendering(s);
  // Working value of the selected finish: the revision's current value with this finish's pending changes on top.
  const changesFor = (id: string) => pending.filter(p => p.finishId === id).reduce<SchemeChange>((acc, p) => ({ ...acc, ...p.change }), { finishId: id });
  const working = opt?.current && finish ? { ...opt.current, ...changesFor(finish.id), ...(changesFor(finish.id).stone ?? {}) } : null;
  const stoneSpec = (ref: { stoneId: string; stoneVersion: number }) => catalog.data?.stones.find(x => x.id === ref.stoneId && x.version === ref.stoneVersion) ?? stoneOf(s, ref);
  const workingStone = working && opt?.stones.find(x => x.stoneId === working.stoneId && x.stoneVersion === working.stoneVersion);
  const name = (ref?: { stoneId: string; stoneVersion: number }) => (ref && stoneSpec(ref)?.name) ?? '';
  const tabsRail = useRail<HTMLDivElement>(finish?.id), stonesRail = useRail<HTMLDivElement>(`${finish?.id}:${working?.stoneId}`);
  const add = (p: Pending) => { setRejected(null); setUi(u => ({ ...u, pending: [...(u.base === revisionKey ? u.pending : []), p], base: revisionKey, softDone: false })); };
  const undo = () => { setRejected(null); setUi(u => ({ ...u, pending: u.pending.slice(0, -1) })); };
  const hard = pending.filter(p => p.change).map(p => p.change!);
  const submit = useMutation({
    mutationFn: async () => {
      const target = [...pending].reverse().find(p => p.soft)?.soft?.after;
      const choice = target && target !== (savedSoft ? styleKey(savedSoft) : '') ? choices.find(c => styleKey(c) === target) : undefined;
      return adjustBatch(entry, r.id, s.id, s.revision, hard, choice ? { styleId: choice.id, styleVersion: choice.version } : undefined);
    },
    onSuccess: view => {
      setRejected(null);
      queries.setQueryData(['request', entry, r.id], view); queries.invalidateQueries({ queryKey: ['requests', entry] });
      setUi(u => ({ ...u, pending: [], softDone: false }));
    },
    onError: error => {
      const e = error as ClientError;
      if (e.code === 'NO_CHANGE') { setUi(u => ({ ...u, pending: [] })); toast('方案没有变化'); return; }
      if (e.code === 'ADJUSTMENT_REJECTED' || e.code === 'OPTION_NOT_ALLOWED') setRejected(e.message);
      else { toast(e.message); if (e.code === 'SCHEME_REVISION_CONFLICT') queries.invalidateQueries({ queryKey: ['request', entry, r.id] }); }
    },
  });
  const locked = busy || submit.isPending;
  const count = pending.length;
  const tag = busy ? '' : count ? `${count} 处修改未出图` : `当前修订 ${s.revision}`;
  const dock = busy || submit.isPending ? <button className="btn btn--primary btn--block" disabled>重新出图中…</button>
    : !count && s.revision > 1 && !rejected ? <><Link className="btn btn--secondary" href={`${base}/r/${r.id}`}>回到方案</Link><Link className="btn btn--primary btn--grow" href={`${base}/r/${r.id}/confirm`}>确认修订 {s.revision}</Link></>
      : <><button className="icon-btn icon-btn--outline" onClick={undo} disabled={!count} aria-label="撤回上一处修改"><Icon name="undo"/></button>
        <button className="btn btn--primary btn--grow" disabled={!count || !!rejected} onClick={() => submit.mutate()}>
          {rejected ? '有冲突，暂不能出图' : !count ? '先选择要调整的选项' : `重新出图 · 生成修订 ${s.revision + 1}`}</button></>;
  const softPanel = choices.length ? <><p className="meta" style={{ marginTop: 12 }}>换风格会改变全屋家具款式、布艺与配色；家具布局由方案确定。和石材修改一起，点「重新出图」后生成新的效果图。</p>
    <div style={{ marginTop: 12 }}><StyleOptions styles={choices} current={soft} disabled={locked} onPick={key => { if (key !== soft) add({ label: `软装风格：${styleName(soft) || '—'} → ${styleName(key)}`, soft: { before: soft, after: key } }); }}/></div></>
    : <p className="meta" style={{ marginTop: 12 }}>这个方案没有可切换的软装风格。</p>;
  const hardPanel = <>
    {levels.length > 1 && <div style={{ marginTop: 16 }}><Segmented label="楼层" value={level ?? ''} onChange={v => setUi(u => ({ ...u, level: v, finish: null }))} options={levels.map(l => [l.id, l.name])}/></div>}
    <div className="finish-tabs" ref={tabsRail} role="tablist" aria-label="饰面">{here.map(f =>
      <button key={f.id} className="chip" role="tab" aria-selected={f.id === finish?.id} aria-pressed={f.id === finish?.id} onClick={() => setUi(u => ({ ...u, finish: f.id }))}>{f.name}</button>)}</div>
    {!opt || !working || !finish ? (options.error ? <ErrorLine error={options.error}/> : <Loading/>) : <>
      <Section title={`${finish.name} · 石材`} aside="示意素材"><div className="swatches swatches--rail" ref={stonesRail}>{opt.stones.map(st => {
        const on = working.stoneId === st.stoneId && working.stoneVersion === st.stoneVersion;
        return <button key={`${st.stoneId}:${st.stoneVersion}`} className="swatch" aria-pressed={on} disabled={locked} onClick={() => {
          if (on) return;
          const fits = st.sizes.some(size => sameTile(size, working.tile)), tile = fits ? undefined : st.sizes[0];
          add({ finishId: finish.id, label: `${finish.name}：${name(working)} → ${st.name}${tile ? `（规格改为 ${tileLabel(tile)}）` : ''}`,
            change: { finishId: finish.id, stone: { stoneId: st.stoneId, stoneVersion: st.stoneVersion }, ...(tile ? { tile } : {}) } });
        }}><Swatch stone={stoneSpec(st)} size={144}/>{st.name}</button>; })}</div></Section>
      {finish.kind === 'stair' ? <p className="meta" style={{ marginTop: 12 }}>楼梯踏面使用整板踏步，只调整石材。</p> : <>
        <Section title="规格" aside="毫米"><div className="chips">{(workingStone?.sizes ?? []).map(size => { const on = sameTile(size, working.tile);
          return <button key={tileLabel(size)} className="chip num" aria-pressed={on} disabled={locked} onClick={() => { if (!on) add({ finishId: finish.id, label: `${finish.name}：${tileLabel(working.tile)} → ${tileLabel(size)}`, change: { finishId: finish.id, tile: size } }); }}>
            {tileLabel(size)}{size.length / size.width >= 3 ? <small>条板</small> : null}</button>; })}</div></Section>
        <Section title="铺法"><div className="chips">{opt.patterns.map(p => <button key={p} className="chip" aria-pressed={working.pattern === p} disabled={locked}
          onClick={() => { if (working.pattern !== p) add({ finishId: finish.id, label: `${finish.name}：${patternName[working.pattern] ?? working.pattern} → ${patternName[p]}`, change: { finishId: finish.id, pattern: p } }); }}>
          <PatternGlyph pattern={p} size={18}/>{patternName[p]}</button>)}</div></Section>
        {opt.border && <Group style={{ marginTop: 24 }}><div className="row"><RowMain title="波打线" sub={working.border ? '石材四周加一圈收边' : '石材直接铺到墙边'}/>
          <Switch on={!!working.border} label="波打线" disabled={locked} onChange={() => add({ finishId: finish.id, label: `${finish.name}：${working.border ? '有波打线 → 无波打线' : '无波打线 → 有波打线'}`, change: { finishId: finish.id, border: !working.border } })}/></div></Group>}
      </>}
      {s.issues.filter(i => i.objectId === finish.id).map(i => <Alert key={i.code} kind="hint" title="提示 · 可以继续">{i.message}</Alert>)}
    </>}
  </>;
  return <Screen className="immersive adjust">
    <div className={`stage${busy ? ' stage--busy' : ''}`}>
      <SchemeImage scheme={s} alt="当前修订效果图（示意）"/>
      {tag && <div className="stage__top"><span className="media-tag">{count ? <Icon name="clock" size={14}/> : null}{tag}</span></div>}
      {busy && <div className="stage__veil" role="status"><b>重新出图中</b><span>按你的调整重新排版、渲染 · 约 1–2 分钟</span><div className="progress"><i/></div></div>}
    </div>
    <AppBar back={`${base}/r/${r.id}`} title={`调整方案 ${letter(s)}`} overlay/>
    <section className="panel" aria-label="调整选项"><span className="panel__grip" aria-hidden="true"/>
      <div className="panel__scroll">
        <Segmented label="调整内容" value={choices.length ? ui.tab : 'hard'} onChange={tab => setUi(u => ({ ...u, tab }))} options={choices.length ? [['soft', '软装风格'], ['hard', '硬装石材']] : [['hard', '硬装石材']]}/>
        <fieldset disabled={locked}>{ui.tab === 'soft' && choices.length ? softPanel : hardPanel}</fieldset>
        {count > 0 && <Section title="本次修改" aside={`${count} 处`}><ol className="changes">{pending.map((p, i) => <li key={i}>{p.label}</li>)}</ol></Section>}
      </div>
      {rejected && !locked && <div className="panel__notice"><Alert kind="danger" title="冲突 · 不能出图">{rejected} 方案保持不变，可以撤回最后一处修改或换一个选项。</Alert></div>}
      <div className="panel__actions">{dock}</div>
    </section>
  </Screen>;
}

// ---------- 确认 + 留言 / 请求联系 ----------
type ConfirmDraft = { message: string; contact: boolean; time: string };
function ConfirmView({ request: r }: { request: FinishRequestView }) {
  const { base, entry, user, workspaceName, go, toast } = useClient();
  const queries = useQueryClient();
  const [result] = useStored<ResultUi>(`hestia.client.result.${r.id}`, resultUi);
  const [c, setC] = useStored<ConfirmDraft>(`hestia.client.confirm.${r.id}`, { message: '', contact: true, time: '下午' });
  const [op] = useState(operationId);
  const s = pickScheme(r, result.scheme);
  const soft = softOf(s);
  const confirm = useMutation({
    mutationFn: () => clientApi(entry).confirm(r.id, { operationId: op, schemeId: s.id, revision: s.revision, message: c.message.trim() || undefined,
      contactRequested: c.contact, preferredTime: c.contact ? c.time : undefined }),
    onSuccess: view => { queries.setQueryData(['request', entry, r.id], view); queries.invalidateQueries({ queryKey: ['requests', entry] }); go(`${base}/r/${r.id}/done`, true); },
    onError: error => { toast((error as Error).message); if ((error as ClientError).code === 'SCHEME_REVISION_CONFLICT') queries.invalidateQueries({ queryKey: ['request', entry, r.id] }); },
  });
  const levels = levelsOf(r);
  const dock = <button className="btn btn--primary btn--block" disabled={confirm.isPending || rendering(s)} onClick={() => confirm.mutate()}>
    {rendering(s) ? '等待出图完成后确认' : confirm.isPending ? '正在提交…' : `确认方案 ${letter(s)} · 修订 ${s.revision}`}</button>;
  return <Screen bar={<AppBar back={`${base}/r/${r.id}`} title="确认方案"/>} dock={dock}>
    <main className="screen__body">
      <h1 className="page-title">确认方案 {letter(s)} · 修订 {s.revision}</h1>
      <div className="confirm-hero"><div className="confirm-hero__img"><SchemeImage scheme={s} alt={`方案 ${letter(s)} 效果图（示意）`} className="confirm-hero__photo"/></div>
        <RowMain title={`${s.name}${soft ? ` · ${soft.name}` : ''}`} sub={`确认后，${workspaceName}会收到这一版整体方案。之后再调整，需要重新确认。`}/></div>
      <Section title="方案内容" aside={`${r.finishes.length} 处饰面`}><Group>
        {soft && <Row label="软装风格" value={soft.name}/>}
        {(levels.length ? levels : [{ id: '', name: '' }]).map(l => <div key={l.id || 'all'}>
          {levels.length > 1 && <span className="row__level">{l.name}</span>}
          {r.finishes.filter(f => !l.id || f.levelId === l.id).map(f => <Row key={f.id} label={f.name} value={finishLine(s, f)} stack/>)}</div>)}
      </Group></Section>
      <Section title="给企业留言" aside="选填"><Group><label className="field"><span className="sr-only">给企业留言（选填）</span>
        <textarea rows={3} maxLength={300} placeholder="例如：二层想再看看深色石材；希望周末看样品。" value={c.message} onChange={e => setC(v => ({ ...v, message: e.target.value }))}/></label></Group></Section>
      <Group style={{ marginTop: 12 }}>
        <div className="row"><RowMain title="请企业联系我" sub={<span className="num">{maskPhone(user?.phoneNumber)} · 登录手机号</span>}/><Switch on={c.contact} label="请企业联系我" onChange={() => setC(v => ({ ...v, contact: !v.contact }))}/></div>
        {c.contact && <div className="row row--stack"><span className="row__label">方便联系的时间</span><div className="chips" role="radiogroup" aria-label="方便联系的时间" style={{ marginTop: 8 }}>
          {['上午', '下午', '晚上', '都可以'].map(t => <button key={t} className="chip" role="radio" aria-checked={c.time === t} onClick={() => setC(v => ({ ...v, time: t }))}>{t}</button>)}</div></div>}
      </Group>
    </main>
  </Screen>;
}
function DoneView({ request: r }: { request: FinishRequestView }) {
  const { base, entry, user, workspaceName, go, toast } = useClient();
  const queries = useQueryClient();
  const [c] = useStored<ConfirmDraft>(`hestia.client.confirm.${r.id}`, { message: '', contact: true, time: '下午' });
  const [note, setNote] = useState(''), [op, setOp] = useState(operationId);
  const conf = r.confirmation;
  useEffect(() => { if (!conf) go(`${base}/r/${r.id}`, true); }, [conf, base, r.id, go]);
  const send = useMutation({
    mutationFn: () => clientApi(entry).message(r.id, { operationId: op, message: note.trim(), contactRequested: false }),
    onSuccess: view => { queries.setQueryData(['request', entry, r.id], view); setNote(''); setOp(operationId()); toast('留言已发送给企业'); },
    onError: error => toast((error as Error).message),
  });
  if (!conf) return <LoadingScreen back={`${base}/r/${r.id}`}/>;
  const s = r.schemes.find(x => x.id === conf.schemeId);
  return <StatusScreen back={`${base}/r/${r.id}`} seal={<span className="seal" aria-hidden="true"><Icon name="check" size={28}/></span>}
    title={`已确认 方案 ${s ? letter(s) : ''} · 修订 ${conf.revision}`}
    sub={<>{workspaceName}已收到你的确认。{c.contact ? <>企业会在{c.time === '都可以' ? '方便时' : c.time}联系 <span className="num">{maskPhone(user?.phoneNumber)}</span>。</> : '你没有请求联系，可以随时在这里留言。'}</>}
    items={[['确认方案', 'done', dateText(conf.confirmedAt)], ['企业跟进', 'now', c.contact ? '电话联系' : '查看留言'], ['看样与深化', '']]}>
    {!conf.current && <Alert kind="hint" title="需要重新确认">确认之后方案又调整过，企业看到的仍是修订 {conf.revision}。如需以新修订为准，请重新确认。</Alert>}
    <Section title="补充留言"><Group><label className="field"><span className="sr-only">补充留言</span>
      <textarea rows={3} maxLength={300} placeholder="例如：想约周末看样品。" value={note} onChange={e => setNote(e.target.value)}/></label></Group>
      <button className="btn btn--secondary btn--block" style={{ marginTop: 12 }} disabled={!note.trim() || send.isPending} onClick={() => send.mutate()}>{send.isPending ? '正在发送…' : '发送留言'}</button></Section>
    <div className="btn-stack"><Link className="btn btn--primary btn--block" href={`${base}/projects`}>我的项目</Link><Link className="btn btn--secondary btn--block" href={`${base}/r/${r.id}`}>回到方案</Link></div>
  </StatusScreen>;
}
