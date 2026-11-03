'use client';
// Shared pieces of the H5 client: stone swatches, plan drawing and the v2 component set (Badge, Alert, Group…).
import { useEffect, useState } from 'react';
import type { StoneSpec } from '../../../../packages/contracts/src/finishes';
import type { ClientCatalogView } from './client-api';
import { Icon, type IconName } from './client-icons';
import { softStyles, type SoftStyle } from './soft-styles';

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
  return url ? <img className={className ?? 'swatch__img'} src={url} alt={alt}/> : <span className={className ?? 'swatch__img'} style={{ display: 'block', background: stone?.texture.base ?? 'var(--c-surface-2)' }} aria-hidden="true"/>;
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

export const dateText = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---------- 通用组件（类名与 docs/design/H5_UI_DESIGN.md 组件对照一致） ----------
/** wait / done are neutral; act marks a state the customer has to act on (accent); ok is finished (ink dot). */
export type BadgeKind = 'wait' | 'act' | 'ok';
export const Badge = ({ kind = 'wait', children }: { kind?: BadgeKind; children: React.ReactNode }) => <span className={`badge badge--${kind}`}>{children}</span>;
export function Alert({ kind, title, children }: { kind: 'hint' | 'danger' | 'info'; title?: string; children: React.ReactNode }) {
  return <div className={`alert alert--${kind}`} role={kind === 'danger' ? 'alert' : undefined}>
    <Icon name={kind === 'info' ? 'info' : 'alert'} size={16}/><span>{title && <b>{title}</b>}{children}</span></div>;
}
export function Section({ title, aside, children, className = '' }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`section ${className}`}><div className="section__head"><h2 className="section__title">{title}</h2>{aside != null && aside !== '' && <span className="section__aside">{aside}</span>}</div>{children}</section>;
}
export const Group = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => <div className="group" style={style}>{children}</div>;
export const Row = ({ label, value, stack = false }: { label: React.ReactNode; value: React.ReactNode; stack?: boolean }) =>
  <div className={`row${stack ? ' row--stack' : ''}`}><span className="row__label">{label}</span><span className="row__value">{value}</span></div>;
export function RowMain({ icon, title, sub, chevron = false }: { icon?: IconName; title: React.ReactNode; sub?: React.ReactNode; chevron?: boolean }) {
  return <>{icon && <span className="row__icon"><Icon name={icon} size={18}/></span>}<span className="row__main"><b>{title}</b>{sub && <small>{sub}</small>}</span>
    {chevron && <span className="row__chev"><Icon name="right" size={16}/></span>}</>;
}
export function Timeline({ items }: { items: [string, 'done' | 'now' | '', React.ReactNode?][] }) {
  return <ol className="timeline">{items.map(([title, state, sub]) => <li key={title} data-state={state || 'todo'}>
    <i aria-hidden="true">{state === 'done' ? <Icon name="check" size={13}/> : null}</i>
    <div><b>{title}</b>{sub ? <small>{sub}</small> : null}</div>
  </li>)}</ol>;
}
export function Segmented<T extends string | number>({ options, value, onChange, media = false, label }: { options: [T, React.ReactNode, IconName?][]; value: T; onChange: (value: T) => void; media?: boolean; label: string }) {
  return <div className={`segmented${media ? ' segmented--media' : ''}`} role="group" aria-label={label}>{options.map(([v, text, icon]) =>
    <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{icon && <Icon name={icon} size={16}/>}{text}</button>)}</div>;
}
export const Switch = ({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) =>
  <button type="button" className="switch" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange}/>;
export function Stepper({ step, names }: { step: number; names: string[] }) {
  return <ol className="stepper" aria-label={`第 ${step} 步，共 ${names.length} 步`}>{names.map((n, i) =>
    <li key={n} data-state={i + 1 === step ? 'now' : i + 1 < step ? 'done' : 'todo'} aria-current={i + 1 === step ? 'step' : undefined}>{n}</li>)}</ol>;
}
export const Palette = ({ style, mod = '' }: { style: SoftStyle; mod?: string }) =>
  <span className={`palette ${mod}`} aria-hidden="true">{style.palette.map(c => <i key={c} style={{ background: c }}/>)}</span>;
export function StyleOptions({ current, onPick, disabled }: { current?: string; onPick?: (id: string) => void; disabled?: boolean }) {
  return <div className="styles">{softStyles.map(st => {
    const body = <><Palette style={st} mod="palette--tile"/><b>{st.name}</b><small>{st.line.split('、').slice(0, 2).join('、')}</small></>;
    return onPick ? <button key={st.id} type="button" className="style-opt" aria-pressed={current === st.id} disabled={disabled} onClick={() => onPick(st.id)}>{body}</button>
      : <div key={st.id} className="style-opt">{body}</div>;
  })}</div>;
}
