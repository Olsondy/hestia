'use client';
// Small shared pieces of the H5 client: stone swatches, plan drawing, status chip, timeline.
import { useEffect, useState } from 'react';
import type { StoneSpec } from '../../../../packages/contracts/src/finishes';
import type { ClientCatalogView } from './client-api';
import { Icon } from './client-icons';

// Swatches come from the same procedural recipe as the 3D textures (示意素材), rendered once per stone and size.
const swatches = new Map<string, Promise<string>>();
function swatchURL(stone: StoneSpec, size: number) {
  const key = `${stone.id}:${stone.version}:${size}`;
  if (!swatches.has(key)) swatches.set(key, import('../../../../packages/scene-runtime/src/stone-texture').then(({ stonePixels }) => {
    // Sample a 0.6 m crop of the slab so the swatch reads at real scale rather than as a whole slab.
    const full = Math.round(size * stone.texture.slabSize / .6), pixels = stonePixels(stone.texture, full);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const context = canvas.getContext('2d')!, image = context.createImageData(size, size);
    for (let y = 0; y < size; y++) image.data.set(pixels.subarray(y * full * 4, y * full * 4 + size * 4), y * size * 4);
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/jpeg', .86);
  }));
  return swatches.get(key)!;
}
export function useSwatch(stone: StoneSpec | undefined, size = 120) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (stone) swatchURL(stone, size).then(value => { if (live) setUrl(value); }).catch(() => {});
    return () => { live = false; };
  }, [stone, size]);
  return url;
}
export function Swatch({ stone, size = 120, className, alt = '' }: { stone: StoneSpec | undefined; size?: number; className?: string; alt?: string }) {
  const url = useSwatch(stone, size);
  return url ? <img className={className} src={url} alt={alt}/> : <span className={className} style={{ display: 'block', background: stone?.texture.base ?? '#ddd' }} aria-hidden="true"/>;
}
export function SwatchChip({ stone, big = false }: { stone: StoneSpec | undefined; big?: boolean }) {
  const url = useSwatch(stone, big ? 96 : 48);
  return <span className={`sw${big ? ' big' : ''}`} style={{ backgroundImage: url ? `url(${url})` : undefined, backgroundColor: stone?.texture.base }}/>;
}

type Plan = ClientCatalogView['demoVilla']['plan'];
type FinishLite = ClientCatalogView['demoVilla']['finishes'][number];
/** Plan of one level with the selected finishes highlighted: floor areas, the wall face and stair outline. */
export function PlanDrawing({ plan, finishes, levelId, selected, small = false }: { plan: Plan; finishes: FinishLite[]; levelId: string; selected: string[]; small?: boolean }) {
  const rooms = plan.rooms.filter(room => room.levelId === levelId);
  const points = rooms.flatMap(room => room.outline);
  if (!points.length) return null;
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x)), minZ = Math.min(...points.map(p => p.z)), maxZ = Math.max(...points.map(p => p.z));
  const s = 100 / Math.max(maxX - minX, 1), X = (x: number) => (x - minX) * s, Z = (z: number) => (z - minZ) * s;
  const poly = (outline: { x: number; z: number }[]) => outline.map(p => `${X(p.x).toFixed(2)},${Z(p.z).toFixed(2)}`).join(' ');
  const on = new Set(selected);
  const chosen = finishes.filter(finish => on.has(finish.id));
  return <svg className="plan-svg" viewBox={`-1 -1 ${((maxX - minX) * s + 2).toFixed(1)} ${((maxZ - minZ) * s + 2).toFixed(1)}`} role="img" aria-label="平面示意">
    {rooms.map(room => {
      const lit = chosen.some(f => f.kind === 'floor' && f.roomId === room.id);
      return <g key={room.id} className={lit ? 'on' : ''}><polygon points={poly(room.outline)} className="pl-room"/></g>;
    })}
    {chosen.flatMap(finish => finish.kind === 'floor' && finish.outline ? [<polygon key={finish.id} points={poly(finish.outline)} className="pl-area"/>] : [])}
    {plan.stairs.filter(stair => stair.levelId === levelId).map(stair =>
      <polygon key={stair.id} points={poly(stair.outline)} className={chosen.some(f => f.kind === 'stair' && f.stairId === stair.id) ? 'pl-stair on' : 'pl-stair'}/>)}
    {chosen.flatMap(finish => {
      if (finish.kind !== 'wall') return [];
      const wall = plan.walls.find(w => w.id === finish.wallId && w.levelId === levelId);
      if (!wall) return [];
      const length = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z) || 1, t = (d: number) => ({ x: wall.a.x + (wall.b.x - wall.a.x) * d / length, z: wall.a.z + (wall.b.z - wall.a.z) * d / length });
      const a = t(finish.start ?? 0), b = t(finish.end ?? length);
      return [<line key={finish.id} x1={X(a.x)} y1={Z(a.z)} x2={X(b.x)} y2={Z(b.z)} className="pl-wall"/>];
    })}
    {!small && rooms.map(room => {
      if (!room.name) return null;
      const c = room.outline.reduce((sum, p) => ({ x: sum.x + p.x / room.outline.length, z: sum.z + p.z / room.outline.length }), { x: 0, z: 0 });
      return <text key={`t-${room.id}`} x={X(c.x)} y={Z(c.z) + 1.2}>{room.name}</text>;
    })}
  </svg>;
}

export type StatusKind = 'wait' | 'review' | 'assist' | 'ok';
export function StatusChip({ kind, children }: { kind: StatusKind; children: React.ReactNode }) {
  return <span className={`status ${kind}`}>{children}</span>;
}
export function Timeline({ items }: { items: [string, 'done' | 'now' | '', string?][] }) {
  return <ol className="timeline">{items.map(([title, state, sub]) => <li key={title} className={state}>
    <i aria-hidden="true">{state === 'done' ? <Icon name="check" size={12}/> : null}</i>
    <div><b>{title}</b>{sub ? <small>{sub}</small> : null}</div>
  </li>)}</ol>;
}
export const dateText = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
