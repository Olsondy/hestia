// Inline SVG icons (24 grid, 1.7 stroke) and pattern glyphs, same set as the v2 prototype.
const paths = {
  back: 'M15 5l-7 7 7 7', left: 'M15 5l-7 7 7 7', right: 'm9 5 7 7-7 7', home: 'M3 10 12 3l9 7M5 9v12h14V9', close: 'M5 5l14 14M19 5 5 19', check: 'm4 12 5 5L20 6',
  undo: 'M9 4 3 10l6 6M3 10h10a7 7 0 0 1 7 7', upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6', file: 'M6 2h8l5 5v15H6zM14 2v5h5',
  cube: 'm12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9', image: 'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5',
  folder: 'M3 7V4h6l3 3h9v13H3z', user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21c1-4 4-6 8-6s7 2 8 6',
  phone: 'M7 2h10v20H7zM11 18h2', lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4', link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
  clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  info: 'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', alert: 'M12 9v5M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  plus: 'M12 5v14M5 12h14', logout: 'M15 4h5v16h-5M10 8l-4 4 4 4M6 12h11',
  sun: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z', system: 'M3 4h18v12H3zM8 20h8M12 16v4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M21 21l-5-5', panel: 'M3 4h18v16H3zM9 4v16',
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20, strokeWidth = 1.7 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}

export function PatternGlyph({ pattern, size = 22 }: { pattern: string; size?: number }) {
  const rects: React.ReactNode[] = [];
  const r = (key: string, x: number, y: number, w: number, h: number, rotate = false) =>
    rects.push(<rect key={key} x={x} y={y} width={w} height={h} transform={rotate ? 'rotate(45 17 17)' : undefined}/>);
  if (pattern === 'straight') for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r(`${i}-${j}`, 1 + j * 10.6, 1 + i * 10.6, 10.6, 10.6);
  if (pattern === 'running-bond') for (let i = 0; i < 4; i++) for (let j = -1; j < 3; j++) r(`${i}-${j}`, 1 + j * 16 + (i % 2 ? 8 : 0), 1 + i * 8, 16, 8);
  if (pattern === 'diagonal') for (let i = -3; i < 4; i++) for (let j = -3; j < 4; j++) r(`${i}-${j}`, 17 + j * 9 - 4.5, 17 + i * 9 - 4.5, 9, 9, true);
  if (pattern === 'herringbone') for (let c = -3; c <= 3; c++) for (let t = -6; t <= 6; t++) {
    const S = 4, L = 12, ox = c * L + t * S, oy = -c * L + t * S;
    r(`a${c}${t}`, 17 + ox, 17 + oy, L, S, true); r(`b${c}${t}`, 17 + ox, 17 + oy + S, S, L, true);
  }
  const clip = `pg-${pattern}`;
  return <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
    <defs><clipPath id={clip}><rect x="1" y="1" width="32" height="32"/></clipPath></defs>
    <g clipPath={`url(#${clip})`} fill="none" stroke="currentColor" strokeWidth=".9">{rects}</g>
    <rect x="1" y="1" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1"/>
  </svg>;
}
export const patternName: Record<string, string> = { straight: '直铺', 'running-bond': '工字铺', herringbone: '人字铺', diagonal: '斜铺' };
