'use client';
// Hero stage of the site entry (ADR-0015): a floor plan whose rooms are tiled stone by stone, then re-tiled with the
// next scheme. It shows what Hestia does — lay finishes on a plan, compare schemes — rather than decorate.
// Synthetic plan and illustrative stones; not any real home or supplier material.
import { useEffect, useMemo, useRef, useState } from 'react';

type Pattern = 'straight' | 'running' | 'diagonal';
type Scheme = { id: string; name: string; stone: string; pattern: Pattern; label: string; base: [number, number, number]; size: number };

const schemes: Scheme[] = [
  { id: 'A', name: '留白', stone: '鱼肚白', pattern: 'straight', label: '直铺 600×600', base: [233, 226, 214], size: 26 },
  { id: 'B', name: '暖调', stone: '奶咖洞石', pattern: 'running', label: '工字铺 900×450', base: [214, 193, 164], size: 34 },
  { id: 'C', name: '肌理', stone: '灰木纹', pattern: 'diagonal', label: '斜铺 600×600', base: [150, 141, 132], size: 26 },
];

/** Synthetic two-bedroom plan, in plan units (1 unit ≈ 2.5 cm). Order = the order rooms are tiled in. */
const rooms = [
  { name: '玄关', x: 20, y: 130, w: 70, h: 150 },
  { name: '客厅', x: 90, y: 130, w: 170, h: 150 },
  { name: '餐厅', x: 90, y: 20, w: 110, h: 110 },
  { name: '厨房', x: 200, y: 20, w: 60, h: 110 },
  { name: '主卧', x: 260, y: 20, w: 120, h: 140 },
  { name: '次卧', x: 260, y: 160, w: 120, h: 120 },
  { name: '卫生间', x: 20, y: 20, w: 70, h: 110 },
];

const LAY_MS = 2200, HOLD_MS = 2600;

function rand(seed: number) { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); }

/** Tiles of one room for a pattern: rect list with a lay delay that sweeps from the room's door side. */
function tiles(room: (typeof rooms)[number], scheme: Scheme, roomIndex: number) {
  const out: { x: number; y: number; w: number; h: number; fill: string; delay: number; rotate: boolean }[] = [];
  const s = scheme.size, [r, g, b] = scheme.base;
  const tone = (seed: number) => { const v = (rand(seed) - .5) * 18; return `rgb(${Math.round(r + v)},${Math.round(g + v)},${Math.round(b + v * .9)})`; };
  const start = roomIndex * 150;
  if (scheme.pattern === 'diagonal') {
    // A rotated grid covering the room's bounding circle, clipped to the room.
    const cx = room.x + room.w / 2, cy = room.y + room.h / 2, reach = Math.hypot(room.w, room.h) / 2 + s;
    for (let i = -reach; i < reach; i += s) for (let j = -reach; j < reach; j += s) {
      out.push({ x: cx + i, y: cy + j, w: s - 1.4, h: s - 1.4, fill: tone(roomIndex * 977 + i * 31 + j), delay: start + ((i + reach) + (j + reach)) * 4.2, rotate: true });
    }
    return out;
  }
  const w = scheme.pattern === 'running' ? s * 2 : s, h = s;
  for (let row = 0, y = room.y; y < room.y + room.h; row++, y += h) {
    const offset = scheme.pattern === 'running' && row % 2 ? -w / 2 : 0;
    for (let x = room.x + offset; x < room.x + room.w; x += w) {
      out.push({ x, y, w: w - 1.4, h: h - 1.4, fill: tone(roomIndex * 977 + row * 131 + x), delay: start + (x - room.x) * 3.2 + row * 46, rotate: false });
    }
  }
  return out;
}

export function TilingStage() {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'laying' | 'done'>('laying');
  const [auto, setAuto] = useState(true);
  const [still, setStill] = useState(false);
  const root = useRef<HTMLDivElement>(null), visible = useRef(true);
  const scheme = schemes[index];

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)'), sync = () => setStill(media.matches);
    sync(); media.addEventListener('change', sync);
    const observer = new IntersectionObserver(([entry]) => { visible.current = entry.isIntersecting; }, { threshold: .2 });
    if (root.current) observer.observe(root.current);
    return () => { media.removeEventListener('change', sync); observer.disconnect(); };
  }, []);

  // Lay → hold → next scheme. Paused off screen, in a background tab, after the visitor picks a scheme, and when
  // reduced motion is asked for (the stage then shows the finished scheme A).
  useEffect(() => {
    if (still) { setPhase('done'); return; }
    setPhase('laying');
    const timers: ReturnType<typeof setTimeout>[] = [setTimeout(() => setPhase('done'), LAY_MS)];
    const step = () => {
      if (!visible.current || document.hidden) { timers.push(setTimeout(step, 600)); return; }
      setIndex(i => (i + 1) % schemes.length);
    };
    if (auto) timers.push(setTimeout(step, LAY_MS + HOLD_MS));
    return () => timers.forEach(clearTimeout);
  }, [index, auto, still]);

  const laid = useMemo(() => rooms.map((room, i) => tiles(room, scheme, i)), [scheme]);
  const pick = (i: number) => { setAuto(false); setIndex(i); };

  return <div className="stage" ref={root} data-still={still || undefined}>
    <div className="stage__sheet">
      <div className="stage__meta"><span>示例户型 · 两室两厅</span><span className="stage__scale">1 : 100 · 示意</span></div>
      <svg className="stage__plan" viewBox="0 0 400 300" role="img" aria-label={`示例户型平面图，正在演示方案 ${scheme.id}：${scheme.stone}，${scheme.label}`}>
        <defs>{rooms.map((room, i) => <clipPath key={room.name} id={`room-${i}`}><rect x={room.x} y={room.y} width={room.w} height={room.h}/></clipPath>)}</defs>
        <rect x="20" y="20" width="360" height="260" className="stage__slab"/>
        {/* key on the scheme restarts every tile's lay animation when the scheme changes */}
        <g key={scheme.id}>
          {laid.map((list, i) => <g key={rooms[i].name} clipPath={`url(#room-${i})`}>
            {list.map((t, k) => <rect key={k} className="tile" x={t.x} y={t.y} width={t.w} height={t.h} fill={t.fill}
              transform={t.rotate ? `rotate(45 ${t.x + t.w / 2} ${t.y + t.h / 2})` : undefined}
              style={{ animationDelay: `${Math.round(t.delay)}ms` }}/>)}
          </g>)}
        </g>
        <g className="stage__walls">
          <rect x="20" y="20" width="360" height="260"/>
          {/* Interior walls with door openings; the entrance hall opens onto the living room. */}
          <path d="M20 130H40M70 130H90M90 20V130M90 130V150M90 260V280M200 130H215M245 130H260M200 20V90M260 20V120M260 150V200M260 230V280M260 160H380"/>
        </g>
        {rooms.map(room => <text key={room.name} className="stage__room" x={room.x + room.w / 2} y={room.y + room.h / 2 + 4}>{room.name}</text>)}
      </svg>
    </div>
    <div className="stage__bar">
      <div className="stage__now" aria-live="polite">
        <small>{phase === 'laying' ? '正在铺贴' : '方案已生成'}</small>
        <b>方案 {scheme.id} · {scheme.name}</b>
        <span>{scheme.stone} · {scheme.label}</span>
      </div>
      <div className="stage__pick" role="group" aria-label="切换示例方案">
        {schemes.map((item, i) => <button key={item.id} type="button" aria-pressed={i === index} onClick={() => pick(i)}
          style={{ ['--swatch' as string]: `rgb(${item.base.join(',')})` }}><i aria-hidden="true"/>{item.id}</button>)}
      </div>
    </div>
  </div>;
}
