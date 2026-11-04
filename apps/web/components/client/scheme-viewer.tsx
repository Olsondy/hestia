'use client';
// 3D view of one scheme revision inside the scheme Stage: the frozen scene its still was rendered from, through the shared
// scene runtime (same quality tiers and camera presets as background stills). The background still remains the reference.
// One storey only (ADR-0014): the overview is a cut-open dollhouse with room labels; a label (or a room's floor) brings
// that room closer with its stone summary, and 入户查看 goes to the realistic eye-level shot of the room.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SpatialScene, RoomEntry } from '../../../../packages/scene-runtime/src/scene';
import type { SceneSnapshot } from './client-api';
import { pointInPolygon } from '../../../../packages/contracts/src/building';
import { patternName } from './client-icons';
import { useRail } from './rail';

type Mode = { kind: 'overview' } | { kind: 'room'; id: string } | { kind: 'interior'; id: string };

export function SchemeViewer({ scene }: { scene: SceneSnapshot | undefined }) {
  const host = useRef<HTMLDivElement>(null), view = useRef<SpatialScene | null>(null);
  const labels = useRef(new Map<string, HTMLButtonElement>());
  const [rooms, setRooms] = useState<RoomEntry[]>([]);
  const [overview, setOverview] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'overview' });
  const [error, setError] = useState('');
  const focus = useRef<(id: string) => void>(() => {});
  useEffect(() => {
    if (!scene) return;
    let disposed = false, unsubscribe = () => {};
    setError(''); setRooms([]); setMode({ kind: 'overview' });
    import('../../../../packages/scene-runtime/src/scene').then(({ SpatialScene }) => {
      if (disposed || !host.current) return;
      // Clicking a room's floor (or anything in it) in the overview brings that room closer.
      const instance = new SpatialScene(host.current, id => { if (id && instance.getPresentation() === 'overview') focus.current(id); });
      view.current = instance;
      instance.setBackdrop('#ebe6dc'); // Warm off-white behind the model, like a scale model on paper.
      instance.load(scene);
      instance.renderer.domElement.setAttribute('aria-label', '可拖动旋转、双指缩放的方案 3D 视图');
      instance.focusOnDesign();
      const list = instance.rooms().filter(room => room.design), first = instance.mainLevelPresets().find(preset => preset.kind === 'aerial');
      setRooms(list); setOverview(first?.id ?? null);
      unsubscribe = instance.onFrame(() => {
        const shown = instance.getPresentation() === 'overview';
        for (const room of list) {
          const label = labels.current.get(room.id); if (!label) continue;
          const p = instance.projectPoint(room.anchor);
          label.hidden = !shown || !p.visible;
          if (!label.hidden) label.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
        }
      });
      if (first) instance.applyCameraPreset(first.id, { interactive: true });
    }).catch(() => { if (!disposed) setError('此浏览器暂时无法显示 3D。请以效果图为准。'); });
    return () => { disposed = true; unsubscribe(); view.current?.dispose(); view.current = null; };
  }, [scene]);

  // Labels mount after the first frames; draw once more so they appear without waiting for a camera move.
  useEffect(() => { if (rooms.length) view.current?.render(); }, [rooms]);
  const toOverview = () => { if (!overview) return; try { view.current?.applyCameraPreset(overview, { animate: true }); setMode({ kind: 'overview' }); } catch { /* scene was replaced */ } };
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
      {current.interiorPreset && <button className="stage__room-enter" onClick={() => enter(current)}>入户查看</button>}
    </div>}
    {rooms.length > 0 && <div className="stage__presets" ref={rail} role="group" aria-label="视角">
      {overview && <button className="media-tag" aria-pressed={mode.kind === 'overview'} onClick={toOverview}>全层浏览</button>}
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
