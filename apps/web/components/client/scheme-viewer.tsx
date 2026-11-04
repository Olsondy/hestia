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

export function SchemeViewer({ scene, plan = false }: { scene: SceneSnapshot | undefined; plan?: boolean }) {
  const host = useRef<HTMLDivElement>(null), view = useRef<SpatialScene | null>(null);
  const labels = useRef(new Map<string, HTMLButtonElement>());
  const [rooms, setRooms] = useState<RoomEntry[]>([]);
  const [overview, setOverview] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'overview' });
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(0);
  const [night, setNight] = useState(false);
  const [surface, setSurface] = useState<MaterialMode>('real');
  const planRef = useRef(plan); planRef.current = plan;
  const focus = useRef<(id: string) => void>(() => {});
  useEffect(() => {
    if (!scene) return;
    let disposed = false, unsubscribe = () => {};
    setError(''); setRooms([]); setMode({ kind: 'overview' });
    import('../../../../packages/scene-runtime/src/scene').then(({ SpatialScene }) => {
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
      unsubscribe = instance.onFrame(() => {
        const presentation = instance.getPresentation(), shown = presentation === 'overview' || presentation === 'plan';
        for (const room of list) {
          const label = labels.current.get(room.id); if (!label) continue;
          const p = instance.projectPoint(room.anchor);
          label.hidden = !shown || !p.visible;
          if (!label.hidden) label.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
        }
      });
      if (first) instance.applyCameraPreset(first.id, { interactive: true });
      if (planRef.current) instance.setPlan(true);
      setNight(false); setSurface('real'); setLoaded(n => n + 1);
    }).catch(() => { if (!disposed) setError('此浏览器暂时无法显示 3D。请以效果图为准。'); });
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
      if (instance.getLighting().mode === 'night') { instance.setLighting({ mode: 'day' }); setNight(false); }
      instance.setPlan(true, { animate: true }); setMode({ kind: 'overview' });
    }
    if (!plan && inPlan) {
      instance.setPlan(false); setSurface('real'); setMode({ kind: 'overview' });
      if (overview) instance.applyCameraPreset(overview, { animate: true });
    }
  }, [plan, loaded, overview]);
  const toggleNight = () => { const next = !night; view.current?.setLighting({ mode: next ? 'night' : 'day' }); setNight(next); };
  const pickSurface = (next: MaterialMode) => { view.current?.setMaterialMode(next); setSurface(next); };
  const toOverview = () => { if (!overview) return; try { if (plan) view.current?.setPlan(false); view.current?.applyCameraPreset(overview, { animate: true }); setMode({ kind: 'overview' }); } catch { /* scene was replaced */ } };
  const toRoom = (id: string) => { try { view.current?.focusRoom(id, { animate: true }); setMode({ kind: 'room', id }); } catch { /* not a room of this storey */ } };
  const enter = (room: RoomEntry) => { if (!room.interiorPreset) return; try { view.current?.applyCameraPreset(room.interiorPreset, { animate: true }); setMode({ kind: 'interior', id: room.id }); } catch { /* scene was replaced */ } };
  focus.current = id => { const room = scene && roomOf(scene, id); if (room && rooms.some(item => item.id === room)) toRoom(room); };
  const pick = (room: RoomEntry) => mode.kind === 'interior' && room.interiorPreset ? enter(room) : toRoom(room.id);

  const current = mode.kind === 'overview' ? null : rooms.find(room => room.id === mode.id) ?? null;
  const summary = useMemo(() => current && scene ? roomFinishes(scene, current.id) : [], [current, scene]);
  const rail = useRail<HTMLDivElement>(mode.kind === 'overview' ? 'overview' : mode.id);
  return <>
    <div className="stage__viewer" ref={host}/>
    <div className="stage__labels" aria-hidden={mode.kind === 'interior'}>
      {rooms.map(room => <button key={room.id} hidden ref={node => { if (node) labels.current.set(room.id, node); else labels.current.delete(room.id); }}
        className="room-label" aria-pressed={current?.id === room.id} onClick={() => toRoom(room.id)}>{room.name}</button>)}
    </div>
    {(!scene || error) && <div className="stage__msg" role={error ? 'alert' : 'status'}>{error || '正在打开 3D…'}</div>}
    {mode.kind === 'room' && current && <div className="stage__room" data-stage-ui>
      <div className="stage__room-text"><b>{current.name}</b>{summary.length ? summary.map(line => <small key={line}>{line}</small>) : <small>这个房间没有铺石材</small>}</div>
      {current.interiorPreset && !plan && <button className="stage__room-enter" onClick={() => enter(current)}>入户查看</button>}
    </div>}
    {rooms.length > 0 && plan && <div className="stage__presets" ref={rail} role="group" aria-label="平面图材质">
      {surfaces.map(([id, name]) => <button key={id} className="media-tag" aria-pressed={surface === id} onClick={() => pickSurface(id)}>{name}</button>)}
    </div>}
    {rooms.length > 0 && !plan && <div className="stage__presets" ref={rail} role="group" aria-label="视角">
      <button className="media-tag" aria-pressed={night} onClick={toggleNight}><Icon name={night ? 'moon' : 'sun'} size={14}/>{night ? '夜景' : '日景'}</button>
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
