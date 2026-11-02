'use client';
// 方案需求：提交、状态（出图、待审核、辅助转换）、方案结果、选项式调整、确认与留言。
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StoneSpec } from '../../../../packages/contracts/src/finishes';
import { clientApi, ClientError, maskPhone, operationId, type FinishRequestView, type FinishSchemeView, type RequestFinishView, type SceneSnapshot } from './client-api';
import { ErrorLine, Loading, NotFound, Shell, Title, useClient, useSignedIn, useStored } from './client-app';
import { Icon, PatternGlyph, patternName } from './client-icons';
import { dateText, PlanDrawing, StatusChip, Swatch, SwatchChip, Timeline, type StatusKind } from './client-parts';
import { SchemeViewer } from './scheme-viewer';

// ---------- 状态 ----------
const rendering = (s: FinishSchemeView) => !s.render || s.render.status === 'queued' || s.render.status === 'running';
export function requestStatus(r: FinishRequestView): { kind: StatusKind; label: string; line: string; polling: boolean } {
  const done = r.schemes.filter(s => s.render?.status === 'completed').length;
  switch (r.status) {
    case 'awaiting_drawing': return { kind: 'assist', label: '待上传图纸', line: '请上传户型图纸', polling: false };
    case 'converting': return { kind: 'wait', label: '图纸转换中', line: 'DXF 自动转换中', polling: true };
    case 'assisted_conversion': return { kind: 'assist', label: '需辅助转换', line: '等待企业转换图纸', polling: true };
    case 'pending_review': return { kind: 'review', label: '待审核', line: '企业审核后发布', polling: true };
    default:
      if (r.confirmation?.current) {
        const s = r.schemes.find(x => x.id === r.confirmation!.schemeId);
        return { kind: 'ok', label: '已确认', line: `已确认 方案 ${s?.name ?? ''} · 修订 ${r.confirmation.revision}`, polling: r.schemes.some(rendering) };
      }
      if (!done && r.schemes.some(rendering)) return { kind: 'wait', label: '出图中', line: '正在排版出图', polling: true };
      return { kind: 'ok', label: '已发布', line: `${r.schemes.length} 个方案 · ${r.finishes.length} 处饰面`, polling: r.schemes.some(rendering) };
  }
}
const mm = (m: number) => Math.round(m * 1000);
export const tileLabel = (t: { length: number; width: number }) => `${mm(t.length)}×${mm(t.width)}`;
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
const splitTitle = (title: string) => { const i = title.indexOf(' · '); return i > 0 ? [title.slice(0, i + 3), title.slice(i + 3)] : [title, '']; };

// ---------- 提交方案需求 ----------
type Draft = { step: 1 | 2 | 3; source: 'demo-villa' | 'drawing' | null; fileName: string | null; level: string | null; finishIds: string[] | null;
  kinds: string[]; stones: string[]; tone: string | null; patterns: string[]; border: 'yes' | 'no' | 'auto'; note: string; op: string; uploadOp: string; requestId: string | null };
const freshDraft = (): Draft => ({ step: 1, source: null, fileName: null, level: null, finishIds: null, kinds: ['floor', 'wall', 'stair'], stones: [], tone: null, patterns: [],
  border: 'auto', note: '', op: operationId(), uploadOp: operationId(), requestId: null });
const toneValue: Record<string, 'light' | 'warm' | 'dark' | 'unsure'> = { 浅色: 'light', 暖色: 'warm', 深色: 'dark', 不确定: 'unsure' };
const kindName: Record<string, string> = { floor: '地面', wall: '墙面', stair: '楼梯踏面' };
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
  if (!user || catalog.isLoading) return <Shell back={base}><Loading/></Shell>;
  if (!catalog.data) return <Shell back={base}><ErrorLine error={catalog.error}/></Shell>;
  const { stones, demoVilla } = catalog.data, plan = demoVilla.plan;
  const finishIds = d.finishIds ?? demoVilla.finishes.map(f => f.id);
  const levels = plan.levels.filter(l => demoVilla.finishes.some(f => finishLevel(f, plan) === l.id));
  const level = d.level && levels.some(l => l.id === d.level) ? d.level : levels[0]?.id;
  const drawing = d.source === 'drawing', dxf = drawing && /\.dxf$/i.test(d.fileName ?? '');
  const fileMissing = drawing && !file.current;
  const ready = d.source === 'demo-villa' || (drawing && !!file.current);
  const pick = (f: File | undefined) => { if (!f) return; file.current = f; set({ source: 'drawing', fileName: f.name }); force(n => n + 1); };
  const toggle = (list: string[], value: string) => list.includes(value) ? list.filter(v => v !== value) : [...list, value];
  const stepper = <ol className="stepper" aria-label="提交步骤">{['图纸', '饰面', '石材与偏好'].map((n, i) =>
    <li key={n} className={i + 1 === d.step ? 'on' : i + 1 < d.step ? 'done' : ''} aria-current={i + 1 === d.step ? 'step' : undefined}><i>{i + 1}</i>{n}</li>)}</ol>;
  let body: React.ReactNode, dock: React.ReactNode;
  if (d.step === 1) {
    body = <>{stepper}<Title a="先选择" b="户型来源"/>
      <div className="choices" role="radiogroup" aria-label="户型来源">
        <button className="choice" role="radio" aria-checked={d.source === 'demo-villa'} onClick={() => { file.current = null; set({ source: 'demo-villa', fileName: null }); }}>
          <span className="choice-plan">{levels[0] && <PlanDrawing plan={plan} finishes={demoVilla.finishes} levelId={levels[0].id} selected={[]} small/>}</span>
          <span className="choice-text"><b>示例别墅（演示）</b><small>三层 · {demoVilla.finishes.length} 处可铺贴饰面 · 尺寸为示意</small></span><span className="radio" aria-hidden="true"/>
        </button>
        <div className={`choice upload${drawing ? ' is-on' : ''}`}>
          <label className="choice-main"><input type="file" className="sr-only" accept=".dxf,.dwg,.pdf,.png,.jpg,.jpeg" onChange={e => pick(e.target.files?.[0])}/>
            <span className="choice-icon"><Icon name="upload" size={22}/></span>
            <span className="choice-text"><b>上传我的图纸</b><small>DXF 自动转换；PDF、图片、DWG 等需企业辅助转换</small></span><span className="radio" aria-hidden="true"/></label>
          {drawing && d.fileName && (fileMissing
            ? <div className="upload-state assist" role="status"><div className="file-line"><Icon name="file" size={18}/><b>{d.fileName}</b></div><p>页面刷新后需要重新选择这个文件。</p></div>
            : dxf ? <div className="upload-state ok" role="status"><div className="file-line"><Icon name="file" size={18}/><b>{d.fileName}</b><span className="status ok">DXF</span></div>
                <p>提交后在后台自动转换，读取图层、墙体与楼层。</p><p className="small">自动转换的结果需企业核对后才会发布方案。</p></div>
              : <div className="upload-state assist" role="status"><div className="file-line"><Icon name="file" size={18}/><b>{d.fileName}</b><span className="status assist">需辅助转换</span></div>
                <p><b>需辅助转换，企业将协助处理。</b>这个格式不能自动识别，{workspaceName}会协助转换图纸，确认楼层和饰面后再出方案。</p><p className="small">你可以继续提交石材偏好。</p></div>)}
        </div>
      </div></>;
    dock = <button className="btn primary wide" disabled={!ready} onClick={() => set({ step: 2 })}>下一步：选择饰面 <Icon name="arrow" size={18}/></button>;
  } else if (d.step === 2) {
    if (drawing) {
      body = <>{stepper}<Title a="想铺石材的" b="部位"/>
        <p className="lede">图纸转换后，企业会和你确认具体楼层与饰面。先告诉我们大致范围。</p>
        <div className="chips big" role="group" aria-label="饰面类型">{['floor', 'wall', 'stair'].map(k =>
          <button key={k} className="chip" aria-pressed={d.kinds.includes(k)} onClick={() => set({ kinds: toggle(d.kinds, k) })}>{kindChoice[k]}</button>)}</div>
        <div className="alert assist"><Icon name="info" size={18}/><span>楼层与饰面将在图纸转换后确认。</span></div></>;
    } else {
      const here = demoVilla.finishes.filter(f => finishLevel(f, plan) === level);
      const count = (id: string) => finishIds.filter(fid => finishLevel(demoVilla.finishes.find(f => f.id === fid)!, plan) === id).length;
      body = <>{stepper}<Title a="选择要铺石材的" b="饰面"/>
        <p className="lede">饰面是建筑的一部分，不随家具移动。只为勾选的部位出方案。</p>
        {levels.length > 1 && <div className="seg" role="tablist" aria-label="楼层">{levels.map(l =>
          <button key={l.id} role="tab" aria-selected={l.id === level} onClick={() => set({ level: l.id })}>{l.name}<small>{count(l.id)}</small></button>)}</div>}
        {level && <figure className="plan"><PlanDrawing plan={plan} finishes={demoVilla.finishes} levelId={level} selected={finishIds}/>
          <figcaption>{plan.levels.find(l => l.id === level)?.name}平面 · 示例尺寸</figcaption></figure>}
        <ul className="facet-list">{here.map(f => <li key={f.id}><button className="facet" aria-pressed={finishIds.includes(f.id)} onClick={() => set({ finishIds: toggle(finishIds, f.id) })}>
          <span className="check"><Icon name="check" size={14}/></span>
          <span className="facet-text"><b>{f.name}</b><small>{kindName[f.kind]} · {finishSize(f as never)}</small></span></button></li>)}</ul>
        <p className="tally">已选 {finishIds.length} 处饰面{levels.length > 1 ? ` · ${levels.map(l => `${l.name} ${count(l.id)}`).join(' / ')}` : ''}</p></>;
    }
    dock = <><button className="btn ghost" onClick={() => set({ step: 1 })}>上一步</button>
      <button className="btn primary grow" disabled={drawing ? !d.kinds.length : !finishIds.length} onClick={() => set({ step: 3 })}>下一步：挑选石材 <Icon name="arrow" size={18}/></button></>;
  } else {
    body = <>{stepper}<Title a="挑选石材与" b="偏好"/>
      <p className="lede">来自{workspaceName}的石材库。最多选 3 款，方案会按选择顺序优先使用。</p>
      <div className="label-row"><h2 className="h3">石材库</h2><span className="tag">示意素材</span></div>
      <div className="stone-grid">{stones.map(s => { const n = d.stones.indexOf(stoneKey(s)) + 1; return <button key={stoneKey(s)} className="stone" aria-pressed={n > 0}
        onClick={() => { if (n) set({ stones: d.stones.filter(k => k !== stoneKey(s)) }); else if (d.stones.length < 3) set({ stones: [...d.stones, stoneKey(s)] }); else toast('最多选择 3 款石材'); }}>
        <Swatch stone={s} size={180}/><span className="stone-name">{s.name}</span><small>{s.surface === 'polished' ? '抛光' : '哑光'} · 示意</small>{n ? <i className="order">{n}</i> : null}</button>; })}</div>
      <p className="tally">{d.stones.length ? `已选 ${d.stones.map(k => stones.find(s => stoneKey(s) === k)?.name).join('、')}` : '未选择时，按企业石材库的推荐款出方案'}</p>
      <h2 className="h3">整体色调</h2>
      <div className="chips" role="radiogroup" aria-label="整体色调">{Object.keys(toneValue).map(t =>
        <button key={t} className="chip" role="radio" aria-checked={d.tone === t} onClick={() => set({ tone: t })}>{t}</button>)}</div>
      <h2 className="h3">铺法偏好 <small>可多选</small></h2>
      <div className="chips glyphs" role="group" aria-label="铺法偏好">{Object.keys(patternName).map(p =>
        <button key={p} className="chip" aria-pressed={d.patterns.includes(p)} onClick={() => set({ patterns: toggle(d.patterns, p) })}><PatternGlyph pattern={p}/>{patternName[p]}</button>)}</div>
      <h2 className="h3">波打线</h2>
      <div className="chips" role="radiogroup" aria-label="波打线">{([['yes', '要'], ['no', '不要'], ['auto', '由方案决定']] as const).map(([v, t]) =>
        <button key={v} className="chip" role="radio" aria-checked={d.border === v} onClick={() => set({ border: v })}>{t}</button>)}</div>
      <label className="field"><span>补充说明（选填）</span><textarea rows={3} maxLength={300} placeholder="例如：客厅想更大气；家里有老人，楼梯要防滑。" value={d.note} onChange={e => set({ note: e.target.value })}/></label>
      <p className="small muted">偏好会随需求一起交给企业；自动方案按空间与所选石材的规则生成。</p></>;
    dock = <><button className="btn ghost" onClick={() => set({ step: 2 })}>上一步</button>
      <button className="btn primary grow" disabled={submit.isPending || fileMissing} onClick={() => submit.mutate()}>{submit.isPending ? '正在提交…' : '提交方案需求'}</button></>;
  }
  return <Shell back={base} dock={dock}><section className="wizard">{body}</section></Shell>;
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
  if (!user || request.isLoading) return <Shell back={`${base}/projects`}><Loading/></Shell>;
  if (request.error instanceof ClientError && request.error.status === 404) return <Shell back={`${base}/projects`}><NotFound title="这个项目" text="项目不存在，或没有绑定到你的账号。"/></Shell>;
  if (!request.data) return <Shell back={`${base}/projects`}><ErrorLine error={request.error}/></Shell>;
  const r = request.data;
  if (r.status === 'awaiting_drawing') return <UploadAgainView request={r}/>;
  if (r.status === 'converting') return <WaitView request={r} converting/>;
  if (r.status === 'assisted_conversion') return <AssistView request={r}/>;
  if (r.status === 'pending_review') return <ReviewView request={r}/>;
  // First generation only: once a scheme has been adjusted, re-renders show inside the result and adjust pages.
  if (!sub && r.schemes.every(s => s.revision === 1) && !r.schemes.some(s => s.render?.status === 'completed') && r.schemes.some(rendering)) return <WaitView request={r}/>;
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
  const rows: [string, string][] = [
    ['户型', r.source === 'demo-villa' ? '示例别墅（演示）' : r.drawingName ?? '户型图纸'],
    ['饰面', r.finishes.length ? `${r.finishes.length} 处` : '图纸转换后确认'],
    ['石材', names.join('、') || '—'],
    ['偏好', [tone, p?.patterns?.map(x => patternName[x]).join('、'), p?.border === 'yes' ? '要波打线' : p?.border === 'no' ? '不要波打线' : ''].filter(Boolean).join(' · ') || '未填写'],
  ];
  if (r.note) rows.push(['说明', r.note]);
  return <dl className="summary">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}
function WaitView({ request: r, converting = false }: { request: FinishRequestView; converting?: boolean }) {
  const { base } = useClient();
  const total = r.schemes.length || 3, done = r.schemes.filter(s => s.render && !rendering(s)).length;
  const k = converting ? .15 : (1 + done) / (total + 1);
  const steps = converting ? ['读取图层、墙体与楼层', '识别房间与饰面', '计算铺贴排版与切块', '提交企业审核'] : ['读取空间与饰面', '计算铺贴排版与切块', `渲染效果图（${done}/${total}）`, '整理方案'];
  const at = converting ? 0 : 2;
  return <Shell back={`${base}/projects`}>
    <section className="status-page">
      <StatusChip kind="wait">{converting ? '图纸转换中' : '出图中'}</StatusChip>
      <Title a={converting ? '正在' : '正在'} b={converting ? '转换图纸' : '排版出图'}/>
      <p className="lede">{converting ? `「${r.drawingName ?? '图纸'}」正在自动转换。转换完成后按房间生成铺贴方案，由企业核对后发布。` : `按你选择的 ${r.finishes.length} 处饰面和石材，计算整块与切块，再渲染效果图。每张效果图通常需要 1–2 分钟。`}可以离开此页，完成后在「我的项目」查看。</p>
      <figure className="loom" aria-hidden="true"><svg viewBox="0 0 320 200">
        {Array.from({ length: 9 }, (_, i) => <line key={`v${i}`} className="lv" style={{ ['--d' as string]: `${i * 90}ms` }} x1={i * 40} y1={0} x2={i * 40} y2={200}/>)}
        {Array.from({ length: 6 }, (_, i) => <line key={`h${i}`} className="lh" style={{ ['--d' as string]: `${300 + i * 110}ms` }} x1={0} y1={i * 40} x2={320} y2={i * 40}/>)}
      </svg><span className="loom-pct">{Math.round(k * 100)}%</span></figure>
      <div className="bar-progress determinate"><i style={{ width: `${k * 100}%` }}/></div>
      <ol className="steps-live">{steps.map((t, i) => <li key={t} className={i < at ? 'done' : i === at ? 'now' : ''}>{t}</li>)}</ol>
      <Link className="btn ghost wide" href={`${base}/projects`}>去我的项目</Link>
    </section>
  </Shell>;
}
function ReviewView({ request: r }: { request: FinishRequestView }) {
  const { base, workspaceName } = useClient();
  const drawing = r.source === 'drawing';
  return <Shell back={`${base}/projects`}>
    <section className="status-page">
      <StatusChip kind="review">待审核</StatusChip>
      <Title a="方案已生成，" b="企业审核后发布"/>
      <p className="lede">{drawing ? `你的图纸由系统自动转换。为避免尺寸或饰面边界不准确的方案误导你，${workspaceName}会先核对，再发布给你。` : `${workspaceName}会先核对方案，再发布给你。`}发布后可以在「我的项目」查看。</p>
      <Timeline items={[['提交方案需求', 'done', dateText(r.createdAt)], [drawing ? '图纸转换与排版出图' : '排版出图', 'done'], ['企业审核', 'now', '核对尺寸与饰面边界'], ['发布方案', '']]}/>
      <h2 className="h3">你的方案需求</h2><RequestSummary request={r}/>
    </section>
  </Shell>;
}
function AssistView({ request: r }: { request: FinishRequestView }) {
  const { base, workspaceName } = useClient();
  return <Shell back={`${base}/projects`}>
    <section className="status-page">
      <StatusChip kind="assist">需辅助转换</StatusChip>
      <Title a="图纸需要" b="辅助转换"/>
      <p className="lede">「{r.drawingName ?? '图纸'}」不是 DXF，系统不自动识别。{workspaceName}会协助转换图纸，与你确认楼层和饰面后，再出铺贴方案。</p>
      <Timeline items={[['提交方案需求', 'done', dateText(r.createdAt)], ['企业辅助转换图纸', 'now', '通常 1–2 个工作日'], ['确认楼层与饰面', ''], ['排版出图并发布', '']]}/>
      <h2 className="h3">你的方案需求</h2><RequestSummary request={r}/>
    </section>
  </Shell>;
}
function UploadAgainView({ request: r }: { request: FinishRequestView }) {
  const { base, entry } = useClient();
  const queries = useQueryClient(), [op] = useState(operationId);
  const send = useMutation({ mutationFn: (file: File) => clientApi(entry).drawing(r.id, file, op), onSuccess: v => queries.setQueryData(['request', entry, r.id], v) });
  return <Shell back={`${base}/projects`}>
    <section className="status-page">
      <StatusChip kind="assist">待上传图纸</StatusChip>
      <Title a="还差一份" b="户型图纸"/>
      <p className="lede">需求已保存，但图纸没有上传成功。重新选择文件即可继续。</p>
      <label className="btn primary wide" style={{ marginTop: 24 }}><input type="file" className="sr-only" accept=".dxf,.dwg,.pdf,.png,.jpg,.jpeg"
        onChange={e => { const f = e.target.files?.[0]; if (f) send.mutate(f); }}/>{send.isPending ? '正在上传…' : '选择图纸文件'}</label>
      <ErrorLine error={send.error}/>
      <h2 className="h3">你的方案需求</h2><RequestSummary request={r}/>
    </section>
  </Shell>;
}

// ---------- 方案结果（含分享预览） ----------
type ResultUi = { scheme: string | null; level: string | null; view: 'image' | '3d' };
export function ResultView({ request: r, preview, onGate, loadScene }: { request: FinishRequestView; preview?: { member: string }; onGate?: () => void; loadScene?: (schemeId: string) => Promise<SceneSnapshot> }) {
  const { base, entry, workspaceName } = useClient();
  const [ui, setUi] = useStored<ResultUi>(`hestia.client.result.${r.id}`, { scheme: null, level: null, view: 'image' });
  const levels = levelsOf(r), level = levels.find(l => l.id === ui.level)?.id ?? levels[0]?.id ?? null;
  const s = r.schemes.find(x => x.id === ui.scheme) ?? r.schemes.find(x => x.id === r.confirmation?.schemeId) ?? r.schemes[0];
  const here = r.finishes.filter(f => !level || f.levelId === level);
  const main = here.find(f => f.kind === 'floor') ?? here[0];
  const scene = useQuery({ queryKey: ['scene', r.id, s?.id, s?.revision], queryFn: () => (loadScene ?? (id => clientApi(entry).scene(r.id, id)))(s!.id),
    enabled: ui.view === '3d' && !!s, staleTime: Infinity });
  if (!s) return <Shell back={preview ? undefined : `${base}/projects`}><NotFound title="方案" text="这个项目还没有可查看的方案。"/></Shell>;
  const confirmed = r.confirmation?.current ? r.confirmation : null;
  const [a, b] = splitTitle(r.title);
  const issues = s.issues.filter(i => here.some(f => f.id === i.objectId) || !r.finishes.some(f => f.id === i.objectId));
  // Each row yields display content plus plain text, so "相同" compares values rather than markup.
  const cell = (sc: FinishSchemeView) => { const t = main && tilingOf(sc, main.id); return { t, st: stoneOf(sc, t) }; };
  const rows: [string, (sc: FinishSchemeView) => [React.ReactNode, string]][] = [
    ['石材', sc => { const { st } = cell(sc); return st ? [<><SwatchChip stone={st}/>{st.name}</>, st.id] : ['—', '—']; }],
    ['规格', sc => { const { t } = cell(sc), v = t ? (main.kind === 'stair' ? '整板' : tileLabel(t.tile)) : '—'; return [v, v]; }],
    ['铺法', sc => { const { t } = cell(sc), v = t ? patternName[t.pattern] : '—'; return [v, v]; }],
    ['波打线', sc => { const { t } = cell(sc), v = !t ? '—' : t.border ? stoneOf(sc, t.border)?.name ?? '有' : '无'; return [v, v]; }],
  ];
  const dock = preview
    ? <><button className="btn ghost grow" onClick={onGate}><Icon name="lock" size={16}/> 调整</button><button className="btn primary grow" onClick={onGate}><Icon name="lock" size={16}/> 确认方案</button></>
    : confirmed && confirmed.schemeId === s.id
      ? <><Link className="btn ghost grow" href={`${base}/r/${r.id}/adjust`}>继续调整</Link><Link className="btn primary grow" href={`${base}/r/${r.id}/done`}>查看确认</Link></>
      : <><Link className="btn ghost grow" href={`${base}/r/${r.id}/adjust`}>调整</Link><Link className="btn primary grow" href={`${base}/r/${r.id}/confirm`}>确认方案 {s.name}</Link></>;
  const status = requestStatus(r);
  return <Shell back={preview ? undefined : `${base}/projects`} dock={dock}>
    {preview && <div className="preview-banner"><Icon name="eye" size={18}/><div><b>{preview.member}分享给你的方案</b><span>{workspaceName} · 仅预览，登录并绑定后可调整和确认</span></div></div>}
    <section className="result">
      <div className="result-head">
        <Title a={a} b={b} small/>
        <p className="meta"><StatusChip kind={status.kind}>{preview ? '已发布' : status.label}</StatusChip><span>{r.schemes.length} 个铺贴方案 · {r.finishes.length} 处饰面</span></p>
        {confirmed && <p className="confirmed-line"><Icon name="check" size={16}/> 你已确认 方案 {r.schemes.find(x => x.id === confirmed.schemeId)?.name} · 修订 {confirmed.revision}</p>}
        {!preview && r.confirmation && !r.confirmation.current && <p className="alert hint"><Icon name="info" size={16}/><span>你确认过的方案之后又调整过，需要重新确认。</span></p>}
      </div>
      {levels.length > 1 && <div className="seg" role="tablist" aria-label="楼层">{levels.map(l =>
        <button key={l.id} role="tab" aria-selected={l.id === level} onClick={() => setUi(u => ({ ...u, level: l.id }))}>{l.name}</button>)}</div>}
      <figure className="plate">
        <div className="plate-top"><span>{main?.levelName ? `${main.levelName} · ` : ''}{main?.name ?? ''}</span>
          <div className="toggle" role="group" aria-label="查看方式">
            <button aria-pressed={ui.view === 'image'} onClick={() => setUi(u => ({ ...u, view: 'image' }))}><Icon name="image" size={15}/>效果图</button>
            <button aria-pressed={ui.view === '3d'} onClick={() => setUi(u => ({ ...u, view: '3d' }))}><Icon name="cube" size={15}/>3D 查看</button></div></div>
        {ui.view === 'image' ? <SchemeImage scheme={s} alt={`方案 ${s.name} 铺贴效果图（示意）`}/>
          : <SchemeViewer key={`${s.id}:${s.revision}`} scene={scene.data}/>}
        {ui.view === '3d' && scene.error ? <ErrorLine error={scene.error}/> : null}
        <figcaption><span>方案 {s.name} · 修订 {s.revision}{rendering(s) && s.revision > 1 ? ' · 新修订出图中' : ''}</span><span>{ui.view === 'image' ? '效果图' : '实时 3D · 以效果图为准'} · 示意素材</span></figcaption>
      </figure>
      <div className="rail" role="group" aria-label="切换铺贴方案">{r.schemes.map(x => { const t = main && tilingOf(x, main.id), st = stoneOf(x, t); return <button key={x.id} className="rail-item" aria-pressed={x.id === s.id}
        onClick={() => setUi(u => ({ ...u, scheme: x.id }))}><span className="rail-name">{x.ordinal}<b>{x.name}</b></span>
        <small>{st ? <>{st.name}<br/>{main.kind === 'stair' ? '整板' : tileLabel(t!.tile)}<br/>{patternName[t!.pattern]}</> : null}</small></button>; })}</div>
      <p className="scheme-line">{s.summary}</p>
      {main && <section className="compare">
        <h2 className="h3">{main.name}：{r.schemes.length} 个方案的差异</h2>
        <table><thead><tr><th scope="col"><span className="sr-only">项目</span></th>{r.schemes.map(x => <th key={x.id} scope="col" className={x.id === s.id ? 'on' : ''}>方案 {x.name}</th>)}</tr></thead>
          <tbody>{rows.map(([label, fn]) => { const vals = r.schemes.map(fn), same = vals.every(v => v[1] === vals[0][1]); return <tr key={label}>
            <th scope="row">{label}{same ? <small>相同</small> : null}</th>
            {vals.map((v, i) => <td key={r.schemes[i].id} className={`${r.schemes[i].id === s.id ? 'on' : ''}${same ? ' same' : ''}`}>{v[0]}</td>)}</tr>; })}</tbody></table>
      </section>}
      <section className="scheme-facets">
        <h2 className="h3">方案 {s.name}{level && levels.length > 1 ? ` · ${levels.find(l => l.id === level)?.name}` : ''}饰面</h2>
        <ul>{here.map(f => { const t = tilingOf(s, f.id); return <li key={f.id}><SwatchChip stone={stoneOf(s, t)} big/><div><b>{f.name}</b><small>{finishLine(s, f)}</small></div></li>; })}</ul>
        {issues.length > 0 && <div className="checks">{issues.map(i => <p key={i.code + i.objectId} className="alert hint"><Icon name="info" size={16}/><span><b>提示</b>{i.message}</span></p>)}</div>}
      </section>
    </section>
  </Shell>;
}
// The image URL of a scheme always serves its current revision, and is unavailable while a new revision renders.
// Keep the last finished image per scheme so a re-render shows the previous revision (blurred by the caller) instead of a blank plate.
const lastImages = new Map<string, { revision: number; url: string }>();
function SchemeImage({ scheme, alt }: { scheme: FinishSchemeView; alt: string }) {
  const href = scheme.render?.imageHref, failed = scheme.render?.status === 'failed';
  const [url, setUrl] = useState(() => lastImages.get(scheme.id)?.url ?? null);
  useEffect(() => {
    const cached = lastImages.get(scheme.id);
    if (!href) { setUrl(cached?.url ?? null); return; }
    if (cached?.revision === scheme.revision) { setUrl(cached.url); return; }
    let live = true;
    fetch(href, { credentials: 'same-origin', cache: 'no-store' }).then(r => r.ok ? r.blob() : Promise.reject()).then(blob => {
      const next = URL.createObjectURL(blob), old = lastImages.get(scheme.id);
      lastImages.set(scheme.id, { revision: scheme.revision, url: next });
      if (old) setTimeout(() => URL.revokeObjectURL(old.url), 5000);
      if (live) setUrl(next);
    }).catch(() => { if (live) setUrl(cached?.url ?? null); });
    return () => { live = false; };
  }, [href, scheme.id, scheme.revision]);
  return <div className="plate-img">{url ? <img src={url} alt={alt}/> : <div className="placeholder" role="status">
    {failed ? <span>这张效果图暂时没有生成，企业会处理。可以先看 3D。</span> : <><span>正在出图…每张约 1–2 分钟</span><div className="bar-progress"><i style={{ animationDuration: '50s' }}/></div></>}</div>}</div>;
}

// ---------- 选项式调整 ----------
type AdjustUi = { finish: string | null; level: string | null; changes: string[] };
function AdjustView({ request: r }: { request: FinishRequestView }) {
  const { base, entry, toast } = useClient();
  const queries = useQueryClient();
  const [ui, setUi] = useStored<AdjustUi>(`hestia.client.adjust.${r.id}`, { finish: null, level: null, changes: [] });
  const [result] = useStored<ResultUi>(`hestia.client.result.${r.id}`, { scheme: null, level: null, view: 'image' });
  const s = r.schemes.find(x => x.id === result.scheme) ?? r.schemes.find(x => x.id === r.confirmation?.schemeId) ?? r.schemes[0];
  const catalog = useQuery({ queryKey: ['catalog', entry], queryFn: () => clientApi(entry).catalog(), staleTime: 5 * 60_000 });
  const options = useQuery({ queryKey: ['options', r.id, s.id, s.revision], queryFn: () => clientApi(entry).options(r.id, s.id) });
  const [rejected, setRejected] = useState<string | null>(null);
  const levels = levelsOf(r), level = levels.find(l => l.id === ui.level)?.id ?? levels[0]?.id ?? null;
  const here = r.finishes.filter(f => !level || f.levelId === level);
  const finish = here.find(f => f.id === ui.finish) ?? here.find(f => f.kind === 'floor') ?? here[0];
  const opt = options.data?.finishes.find(f => f.finishId === finish?.id);
  const busy = rendering(s);
  const apply = (view: FinishRequestView) => { queries.setQueryData(['request', entry, r.id], view); queries.invalidateQueries({ queryKey: ['requests', entry] }); };
  const adjust = useMutation({
    mutationFn: (change: { label: string; input: Record<string, unknown> }) => clientApi(entry).adjust(r.id, s.id, { operationId: operationId(), expectedRevision: s.revision, finishId: finish!.id, ...change.input }),
    onSuccess: (view, change) => { setRejected(null); apply(view); setUi(u => ({ ...u, changes: [...u.changes, change.label] })); },
    onError: error => {
      const e = error as ClientError;
      if (e.code === 'ADJUSTMENT_REJECTED' || e.code === 'OPTION_NOT_ALLOWED') setRejected(e.message);
      else { toast(e.message); if (e.code === 'SCHEME_REVISION_CONFLICT') queries.invalidateQueries({ queryKey: ['request', entry, r.id] }); }
    },
  });
  const undo = useMutation({
    mutationFn: () => clientApi(entry).undo(r.id, s.id, { operationId: operationId(), expectedRevision: s.revision }),
    onSuccess: view => { setRejected(null); apply(view); setUi(u => ({ ...u, changes: u.changes.slice(0, -1) })); toast('已撤回上一次修改'); },
    onError: error => toast((error as Error).message),
  });
  const stoneSpec = (ref: { stoneId: string; stoneVersion: number }) => catalog.data?.stones.find(x => x.id === ref.stoneId && x.version === ref.stoneVersion) ?? stoneOf(s, ref);
  const current = opt?.current, currentStone = current && opt?.stones.find(x => x.stoneId === current.stoneId && x.stoneVersion === current.stoneVersion);
  const pending = adjust.isPending || undo.isPending;
  const name = (ref?: { stoneId: string; stoneVersion: number }) => (ref && stoneSpec(ref)?.name) ?? '';
  const dock = busy ? <button className="btn primary wide" disabled>重新出图中…</button>
    : <><Link className="btn ghost grow" href={`${base}/r/${r.id}`}>回到方案对比</Link><Link className="btn primary grow" href={`${base}/r/${r.id}/confirm`}>确认修订 {s.revision}</Link></>;
  return <Shell back={`${base}/r/${r.id}`} dock={dock}>
    <section className="adjust">
      <div className="adjust-head">
        <Title a="调整" b={`方案 ${s.name}`} small/>
        <button className="btn ghost small" disabled={s.revision === 1 || pending || busy} onClick={() => undo.mutate()}><Icon name="undo" size={16}/> 撤回</button>
      </div>
      <p className="lede small">只能在给定选项内调整：换石材、规格、铺法和波打线。每次修改都会生成新的修订并重新出图，原方案保留。</p>
      <figure className={`plate compact${busy ? ' is-rendering' : ''}`}>
        <SchemeImage scheme={s} alt="当前修订效果图（示意）"/>
        {busy && <div className="rendering" role="status"><b>重新出图中</b><span>按你的调整重新排版、渲染 · 约 1–2 分钟</span><div className="bar-progress"><i style={{ animationDuration: '50s' }}/></div></div>}
        <figcaption><span>方案 {s.name} · 修订 {s.revision}</span><span>示意素材</span></figcaption>
      </figure>
      {levels.length > 1 && <div className="seg" role="tablist" aria-label="楼层">{levels.map(l =>
        <button key={l.id} role="tab" aria-selected={l.id === level} onClick={() => setUi(u => ({ ...u, level: l.id, finish: null }))}>{l.name}</button>)}</div>}
      <div className="facet-tabs" role="tablist" aria-label="饰面">{here.map(f =>
        <button key={f.id} role="tab" aria-selected={f.id === finish?.id} onClick={() => { setRejected(null); setUi(u => ({ ...u, finish: f.id })); }}>{f.name}</button>)}</div>
      {!opt ? (options.error ? <ErrorLine error={options.error}/> : <Loading/>) : <>
        <fieldset className="opt" disabled={pending || busy}><legend className="h3">石材 <span className="tag">示意素材</span></legend>
          <div className="swatch-row">{opt.stones.map(st => <button key={`${st.stoneId}:${st.stoneVersion}`} className="swatch"
            aria-pressed={current?.stoneId === st.stoneId && current.stoneVersion === st.stoneVersion}
            onClick={() => current?.stoneId === st.stoneId && current.stoneVersion === st.stoneVersion ? null
              : adjust.mutate({ label: `${finish!.name}：${name(current ?? undefined)} → ${st.name}`, input: { stone: { stoneId: st.stoneId, stoneVersion: st.stoneVersion } } })}>
            <Swatch stone={stoneSpec(st)} size={144}/><span>{st.name}</span></button>)}</div></fieldset>
        {finish!.kind === 'stair' ? <p className="small muted">楼梯踏面使用整板踏步，只调整石材。</p> : <>
          <fieldset className="opt" disabled={pending || busy}><legend className="h3">规格 <small>毫米</small></legend>
            <div className="chips">{(currentStone?.sizes ?? []).map(size => { const on = !!current && Math.abs(current.tile.length - size.length) < 1e-9 && Math.abs(current.tile.width - size.width) < 1e-9;
              return <button key={tileLabel(size)} className="chip" aria-pressed={on} onClick={() => on ? null : adjust.mutate({ label: `${finish!.name}：${current ? tileLabel(current.tile) : ''} → ${tileLabel(size)}`, input: { tile: size } })}>
                {tileLabel(size)}{size.length / size.width >= 3 ? <small>条板</small> : null}</button>; })}</div></fieldset>
          <fieldset className="opt" disabled={pending || busy}><legend className="h3">铺法</legend>
            <div className="chips glyphs">{opt.patterns.map(p => <button key={p} className="chip" aria-pressed={current?.pattern === p}
              onClick={() => current?.pattern === p ? null : adjust.mutate({ label: `${finish!.name}：${patternName[current?.pattern ?? ''] ?? ''} → ${patternName[p]}`, input: { pattern: p } })}>
              <PatternGlyph pattern={p}/>{patternName[p]}</button>)}</div></fieldset>
          {opt.border && <fieldset className="opt" disabled={pending || busy}><legend className="h3">波打线</legend>
            <div className="switch-row"><button className="switch" role="switch" aria-checked={!!current?.border} aria-label="波打线"
              onClick={() => adjust.mutate({ label: `${finish!.name}：${current?.border ? '有波打线 → 无波打线' : '无波打线 → 有波打线'}`, input: { border: !current?.border } })}><i/></button>
              <span>{current?.border ? `开 · ${name(tilingOf(s, finish!.id)?.border)}收边，宽 ${Math.round((tilingOf(s, finish!.id)?.border?.width ?? .18) * 100)} cm` : '关 · 石材直接铺到墙边'}</span></div></fieldset>}
        </>}
      </>}
      {pending && <p className="small muted" role="status" style={{ marginTop: 14 }}>正在排版校验…</p>}
      {rejected && <p className="alert danger" role="alert"><Icon name="alert" size={16}/><span><b>冲突 · 不能出图</b>{rejected}方案保持不变，可以换一个选项。</span></p>}
      {s.issues.filter(i => i.objectId === finish?.id).map(i => <p key={i.code} className="alert hint"><Icon name="info" size={16}/><span><b>提示 · 可以继续</b>{i.message}</span></p>)}
      {ui.changes.length > 0 && <section className="changes"><h2 className="h3">本次修改</h2><ol>{ui.changes.map((t, i) => <li key={i}>{t}</li>)}</ol></section>}
    </section>
  </Shell>;
}

// ---------- 确认 + 留言 / 请求联系 ----------
type ConfirmDraft = { message: string; contact: boolean; time: string };
function ConfirmView({ request: r }: { request: FinishRequestView }) {
  const { base, entry, user, workspaceName, go, toast } = useClient();
  const queries = useQueryClient();
  const [result] = useStored<ResultUi>(`hestia.client.result.${r.id}`, { scheme: null, level: null, view: 'image' });
  const [c, setC] = useStored<ConfirmDraft>(`hestia.client.confirm.${r.id}`, { message: '', contact: true, time: '下午' });
  const [op] = useState(operationId);
  const s = r.schemes.find(x => x.id === result.scheme) ?? r.schemes[0];
  const confirm = useMutation({
    mutationFn: () => clientApi(entry).confirm(r.id, { operationId: op, schemeId: s.id, revision: s.revision, message: c.message.trim() || undefined,
      contactRequested: c.contact, preferredTime: c.contact ? c.time : undefined }),
    onSuccess: view => { queries.setQueryData(['request', entry, r.id], view); queries.invalidateQueries({ queryKey: ['requests', entry] }); go(`${base}/r/${r.id}/done`, true); },
    onError: error => { toast((error as Error).message); if ((error as ClientError).code === 'SCHEME_REVISION_CONFLICT') queries.invalidateQueries({ queryKey: ['request', entry, r.id] }); },
  });
  const levels = levelsOf(r);
  return <Shell back={`${base}/r/${r.id}`} dock={<button className="btn primary wide" disabled={confirm.isPending || rendering(s)} onClick={() => confirm.mutate()}>
    {rendering(s) ? '等待出图完成后确认' : confirm.isPending ? '正在提交…' : `确认方案 ${s.name} · 修订 ${s.revision}`}</button>}>
    <section className="confirm">
      <Title a="确认" b={`方案 ${s.name} · 修订 ${s.revision}`}/>
      <p className="lede">确认后，{workspaceName}会收到这一版铺贴方案。之后如果再调整，需要重新确认。</p>
      <figure className="plate compact"><SchemeImage scheme={s} alt="确认的方案效果图（示意）"/><figcaption><span>方案 {s.name}</span><span>示意素材</span></figcaption></figure>
      <details className="spec-list" open><summary className="h3">饰面清单 · {r.finishes.length} 处</summary>
        {(levels.length ? levels : [{ id: null as unknown as string, name: '' }]).map(l => <div key={l.id ?? 'all'}>{l.name && <h3>{l.name}</h3>}<ul>
          {r.finishes.filter(f => !l.id || f.levelId === l.id).map(f => <li key={f.id}><b>{f.name}</b><span>{finishLine(s, f)}</span></li>)}</ul></div>)}
      </details>
      <label className="field"><span>给企业留言（选填）</span><textarea rows={3} maxLength={300} placeholder="例如：二层想再看看深色石材；希望周末看样品。" value={c.message} onChange={e => setC(v => ({ ...v, message: e.target.value }))}/></label>
      <div className="contact">
        <div className="switch-row"><button className="switch" role="switch" aria-checked={c.contact} aria-label="请企业联系我" onClick={() => setC(v => ({ ...v, contact: !v.contact }))}><i/></button><span><b>请企业联系我</b></span></div>
        {c.contact && <><p className="small muted">联系电话 {maskPhone(user?.phoneNumber)}（登录手机号）</p>
          <div className="chips" role="radiogroup" aria-label="方便联系的时间">{['上午', '下午', '晚上', '都可以'].map(t =>
            <button key={t} className="chip" role="radio" aria-checked={c.time === t} onClick={() => setC(v => ({ ...v, time: t }))}>{t}</button>)}</div></>}
      </div>
    </section>
  </Shell>;
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
  if (!conf) return <Shell back={`${base}/r/${r.id}`}><Loading/></Shell>;
  const s = r.schemes.find(x => x.id === conf.schemeId);
  return <Shell back={`${base}/r/${r.id}`}>
    <section className="status-page done">
      <span className="seal" aria-hidden="true"><Icon name="check" size={30}/></span>
      <Title a="已确认" b={`方案 ${s?.name ?? ''} · 修订 ${conf.revision}`}/>
      <p className="lede">{workspaceName}已收到你的确认。{c.contact ? `企业成员会在${c.time === '都可以' ? '方便时' : c.time}联系 ${maskPhone(user?.phoneNumber)}。` : '你没有请求联系，可以随时在这里留言。'}</p>
      {!conf.current && <p className="alert hint"><Icon name="info" size={16}/><span>确认之后方案又调整过，企业看到的仍是修订 {conf.revision}。如需以新修订为准，请重新确认。</span></p>}
      <Timeline items={[['确认方案', 'done', dateText(conf.confirmedAt)], ['企业跟进', 'now', c.contact ? '电话联系' : '查看留言'], ['看样与深化', '']]}/>
      <label className="field"><span>补充留言</span><textarea rows={3} maxLength={300} placeholder="例如：想约周末看样品。" value={note} onChange={e => setNote(e.target.value)}/></label>
      <button className="btn ghost wide" style={{ marginTop: 12 }} disabled={!note.trim() || send.isPending} onClick={() => send.mutate()}>{send.isPending ? '正在发送…' : '发送留言'}</button>
      <div className="stack"><Link className="btn primary wide" href={`${base}/projects`}>我的项目</Link><Link className="btn ghost wide" href={`${base}/r/${r.id}`}>回到方案</Link></div>
    </section>
  </Shell>;
}
