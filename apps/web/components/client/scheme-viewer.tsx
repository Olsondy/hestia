'use client';
// 3D view of one scheme revision inside the scheme Stage: the frozen scene its still was rendered from, through the shared
// scene runtime (same quality tiers and camera presets as background stills). The background still remains the reference.
// One storey only (ADR-0014): the overview is a cut-open dollhouse with room labels; a label (or a room's floor) brings
// that room closer with its stone summary, and 入户查看 goes to the realistic eye-level shot of the room. `plan` shows
// the same model as a floor plan (straight down, sectioned at 1.2 m) in real, white-model or line surfaces.
// 夜景 switches to night lighting with the lamps on.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SpatialScene, RoomEntry, MaterialMode } from '../../../../packages/scene-runtime/src/scene';
import type { SceneSnapshot } from './client-api';
import { pointInPolygon } from '../../../../packages/contracts/src/building';
import { Icon, patternName } from './client-icons';
import { useRail } from './rail';

type Mode = { kind: 'overview' } | { kind: 'room'; id: string } | { kind: 'interior'; id: string };

const surfaces: [MaterialMode, string][] = [['real', '真实材质'], ['white', '白模'], ['line', '线框']];

/**
 * `night` / `onNightChange` let the page own the 日景 / 夜景 switch (H5 puts it in the stage's top row); without them
 * the viewer shows its own switch (workbench).
 */
export function SchemeViewer({ scene, plan = false, night: nightProp, onNightChange }: { scene: SceneSnapshot | undefined; plan?: boolean; night?: boolean; onNightChange?: (night: boolean) => void }) {
  const host = useRef<HTMLDivElement>(null), view = useRef<SpatialScene | null>(null);
  const labels = useRef(new Map<string, HTMLButtonElement>());
  const [rooms, setRooms] = useState<RoomEntry[]>([]);
  const [overview, setOverview] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'overview' });
  const [error, setError] = useState('');
  /** Visible loading step: the first open builds textures on the main thread, so every step must paint first. */
  const [step, setStep] = useState<{ label: string; progress: number } | null>({ label: '正在下载 3D 场景', progress: .05 });
  const [loaded, setLoaded] = useState(0);
  const [ownNight, setOwnNight] = useState(false);
  const controlled = onNightChange !== undefined, night = controlled ? !!nightProp : ownNight;
  const setNight = (value: boolean) => { if (controlled) onNightChange(value); else setOwnNight(value); };
  const [surface, setSurface] = useState<MaterialMode>('real');
  const planRef = useRef(plan); planRef.current = plan;
  const focus = useRef<(id: string) => void>(() => {});
  const selected = useRef<string | null>(null);
  useEffect(() => {
    if (!scene) return;
    let disposed = false, unsubscribe = () => {};
    setError(''); setRooms([]); setMode({ kind: 'overview' }); setStep({ label: '载入 3D 引擎', progress: .12 });
    import('../../../../packages/scene-runtime/src/scene').then(async ({ SpatialScene, warmScene }) => {
      if (disposed || !host.current) return;
      // Textures first, one per frame with a visible step, so taps keep getting feedback on slow phones.
      await warmScene(scene, ({ label, done, total }) => { if (!disposed) setStep({ label, progress: .15 + .75 * done / Math.max(1, total) }); });
      if (disposed || !host.current) return;
      // Clicking a room's floor (or anything in it) in the overview brings that room closer.
      const instance = new SpatialScene(host.current, id => { const shown = instance.getPresentation(); if (id && (shown === 'overview' || shown === 'plan')) focus.current(id); });
      view.current = instance;
      instance.setBackdrop('#ebe6dc'); // Warm off-white behind the model, like a scale model on paper.
      instance.load(scene);
      instance.renderer.domElement.setAttribute('aria-label', '可拖动旋转、双指缩放的方案 3D 视图');
      instance.focusOnDesign();
      const list = instance.rooms().filter(room => room.design), first = instance.mainLevelPresets().find(preset => preset.kind === 'aerial');
      setRooms(list); setOverview(first?.id ?? null);
      // Label priority on crowded (phone) screens: stone-floored rooms, then larger rooms; the selected room first.
      const tiled = new Set(scene.surfaceDesign?.tilings.map(tiling => tiling.finishId) ?? []);
      const weight = new Map(list.map(room => {
        const outline = scene.rooms.find(item => item.id === room.id)?.outline ?? [];
        const stone = (scene.finishes ?? []).some(finish => finish.kind === 'floor' && finish.roomId === room.id && tiled.has(finish.id));
        return [room.id, (stone ? 1000 : 0) + polygonArea(outline)] as const;
      }));
      const ordered = [...list].sort((a, b) => weight.get(b.id)! - weight.get(a.id)!), widths = new Map<string, number>();
      unsubscribe = instance.onFrame(() => {
        const presentation = instance.getPresentation(), shown = presentation === 'overview' || presentation === 'plan';
        const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
        const order = selected.current ? [...ordered].sort((a, b) => Number(b.id === selected.current) - Number(a.id === selected.current)) : ordered;
        for (const room of order) {
          const label = labels.current.get(room.id); if (!label) continue;
          const p = instance.projectPoint(room.anchor);
          label.hidden = !shown || !p.visible;
          if (label.hidden) continue;
          // A label that would overlap one already placed shrinks to a dot (still tappable).
          if (!label.classList.contains('room-label--dot')) widths.set(room.id, label.offsetWidth);
          const w = (widths.get(room.id) ?? 60) / 2 + 3, h = 16;
          const box = { x0: p.x - w, y0: p.y - h, x1: p.x + w, y1: p.y + h };
          const crowded = placed.some(other => box.x0 < other.x1 && box.x1 > other.x0 && box.y0 < other.y1 && box.y1 > other.y0);
          label.classList.toggle('room-label--dot', crowded);
          if (!crowded) placed.push(box);
          label.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
        }
      });
      instance.setSafeArea(overlayInsets(host.current));
      if (first) instance.applyCameraPreset(first.id, { interactive: true });
      if (planRef.current) instance.setPlan(true);
      setOwnNight(false); setSurface('real'); setLoaded(n => n + 1); setStep(null);
    }).catch(() => { if (!disposed) { setStep(null); setError('此浏览器暂时无法显示 3D。请以效果图为准。'); } });
    return () => { disposed = true; unsubscribe(); view.current?.dispose(); view.current = null; };
  }, [scene]);

  // Labels mount after the first frames; draw once more so they appear without waiting for a camera move.
  useEffect(() => { if (rooms.length) view.current?.render(); }, [rooms]);
  // 3D ⇄ 平面图 on the same loaded scene: no reload, the camera eases between the two.
  useEffect(() => {
    const instance = view.current; if (!instance || !loaded) return;
    const inPlan = instance.getPresentation() === 'plan';
    if (plan && !inPlan) {
      // A plan reads in daylight; the 夜景 toggle belongs to the 3D view.
      if (night) setNight(false);
      instance.setPlan(true, { animate: true }); setMode({ kind: 'overview' });
    }
    if (!plan && inPlan) {
      instance.setPlan(false); setSurface('real'); setMode({ kind: 'overview' });
      if (overview) instance.applyCameraPreset(overview, { animate: true });
    }
  }, [plan, loaded, overview]);
  const toggleNight = () => setNight(!night);
  // Lighting follows the switch (whoever owns it), including right after the scene has loaded.
  useEffect(() => {
    const instance = view.current; if (!instance || !loaded) return;
    if ((instance.getLighting().mode === 'night') !== night) instance.setLighting({ mode: night ? 'night' : 'day' });
  }, [night, loaded]);
  const pickSurface = (next: MaterialMode) => { view.current?.setMaterialMode(next); setSurface(next); };
  const toOverview = () => { if (!overview) return; try { if (plan) view.current?.setPlan(false); if (host.current) view.current?.setSafeArea(overlayInsets(host.current)); view.current?.applyCameraPreset(overview, { animate: true }); setMode({ kind: 'overview' }); } catch { /* scene was replaced */ } };
  const toRoom = (id: string) => { try { view.current?.focusRoom(id, { animate: true }); setMode({ kind: 'room', id }); } catch { /* not a room of this storey */ } };
  const enter = (room: RoomEntry) => { if (!room.interiorPreset) return; try { view.current?.applyCameraPreset(room.interiorPreset, { animate: true }); setMode({ kind: 'interior', id: room.id }); } catch { /* scene was replaced */ } };
  focus.current = id => { const room = scene && roomOf(scene, id); if (room && rooms.some(item => item.id === room)) toRoom(room); };
  const pick = (room: RoomEntry) => mode.kind === 'interior' && room.interiorPreset ? enter(room) : toRoom(room.id);

  const current = mode.kind === 'overview' ? null : rooms.find(room => room.id === mode.id) ?? null;
  selected.current = current?.id ?? null;
  const summary = useMemo(() => current && scene ? roomFinishes(scene, current.id) : [], [current, scene]);
  const rail = useRail<HTMLDivElement>(mode.kind === 'overview' ? 'overview' : mode.id);
  return <>
    <div className="stage__viewer" ref={host}/>
    <div className="stage__labels" aria-hidden={mode.kind === 'interior'}>
      {rooms.map(room => <button key={room.id} hidden ref={node => { if (node) labels.current.set(room.id, node); else labels.current.delete(room.id); }}
        className="room-label" aria-pressed={current?.id === room.id} aria-label={room.name} onClick={() => toRoom(room.id)}><span>{room.name}</span></button>)}
    </div>
    {error ? <div className="stage__msg" role="alert">{error}</div>
      : (!scene || step) && <div className="stage__msg stage__loading" role="status" aria-live="polite">
        <span className="stage__spinner" aria-hidden="true"/>
        <span>{scene ? step?.label : '正在下载 3D 场景'}…</span>
        <span className="stage__progress" aria-hidden="true"><i style={{ transform: `scaleX(${scene ? step?.progress ?? 1 : .05})` }}/></span>
      </div>}
    {!controlled && !plan && rooms.length > 0 && <button type="button" className="media-tag stage__light" aria-pressed={night} onClick={toggleNight}>
      <Icon name={night ? 'moon' : 'sun'} size={14}/>{night ? '夜景' : '日景'}</button>}
    {mode.kind === 'room' && current && <div className="stage__room" data-stage-ui>
      <div className="stage__room-text"><b>{current.name}</b>{summary.length ? summary.map(line => <small key={line}>{line}</small>) : <small>这个房间没有铺石材</small>}</div>
      {current.interiorPreset && !plan && <button className="stage__room-enter" onClick={() => enter(current)}>入户查看</button>}
    </div>}
    {rooms.length > 0 && plan && <div className="stage__presets" ref={rail} role="group" aria-label="平面图材质">
      {surfaces.map(([id, name]) => <button key={id} className="media-tag" aria-pressed={surface === id} onClick={() => pickSurface(id)}>{name}</button>)}
    </div>}
    {rooms.length > 0 && !plan && <div className="stage__presets" ref={rail} role="group" aria-label="视角">
      {overview && <button className="media-tag" aria-pressed={mode.kind === 'overview'} onClick={toOverview}>全层立体浏览</button>}
      {rooms.map(room => <button key={room.id} className="media-tag" aria-pressed={current?.id === room.id} onClick={() => pick(room)}>
        {mode.kind === 'interior' && current?.id === room.id ? `入户 · ${room.name}` : room.name}</button>)}
    </div>}
  </>;
}

/** Room that a picked scene ID belongs to: the room itself, its floor finish, or furniture standing in it. */
function roomOf(scene: SceneSnapshot, id: string) {
  if (scene.rooms.some(room => room.id === id)) return id;
  const finish = scene.finishes?.find(item => item.id === id);
  if (finish?.kind === 'floor' && finish.roomId) return finish.roomId;
  const object = scene.objects.find(item => item.id === id);
  return object ? scene.rooms.find(room => (room.levelId ?? null) === (object.levelId ?? null) && pointInPolygon(object.position, room.outline))?.id ?? null : null;
}

/** Stone summary of a room's floor finishes, e.g. “鱼肚白 · 800×800 · 直铺”. */
function roomFinishes(scene: SceneSnapshot, roomId: string) {
  const design = scene.surfaceDesign; if (!design) return [];
  const stone = (ref: { stoneId: string; stoneVersion: number }) => design.stones.find(item => item.id === ref.stoneId && item.version === ref.stoneVersion)?.name ?? '石材';
  const mm = (m: number) => Math.round(m * 1000);
  return (scene.finishes ?? []).filter(finish => finish.kind === 'floor' && finish.roomId === roomId).flatMap(finish => {
    const tiling = design.tilings.find(item => item.finishId === finish.id); if (!tiling) return [];
    const border = tiling.border ? ` · ${stone(tiling.border)}波打线` : '';
    return [`${stone(tiling)} · ${mm(tiling.tile.length)}×${mm(tiling.tile.width)} · ${patternName[tiling.pattern] ?? tiling.pattern}${border}`];
  });
}

function polygonArea(points: { x: number; z: number }[]) {
  return Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.z - q.x * p.z; }, 0) / 2);
}

/**
 * Canvas pixels covered by the page's own controls: the top tag row (H5) or caption (workbench), and the bottom bar
 * plus the view-chip row above it. The overview frames the model in the band between them.
 */
function overlayInsets(host: HTMLElement) {
  const scope = host.closest('.canvas') ?? host.closest('.stage') ?? host.parentElement;
  if (!scope) return { top: 0, bottom: 0 };
  const box = host.getBoundingClientRect(), chips = 52;
  let top = 0, bottom = 0;
  scope.querySelectorAll('.stage__top, .caption').forEach(el => { const r = el.getBoundingClientRect(); if (r.height) top = Math.max(top, r.bottom - box.top); });
  scope.querySelectorAll('.stage__bottom, .toolbar').forEach(el => { const r = el.getBoundingClientRect(); if (r.height) bottom = Math.max(bottom, box.bottom - r.top); });
  return { top, bottom: bottom ? bottom + chips : chips };
}
