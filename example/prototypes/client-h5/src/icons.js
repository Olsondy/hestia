// 内联 SVG 图标：24×24 viewBox、1.6 描边，与 projects 原型一致。
const paths = {
  arrow: 'M5 12h14m-6-6 6 6-6 6', back: 'M19 12H5m6-6-6 6 6 6', close: 'M5 5l14 14M19 5 5 19', check: 'm4 12 5 5L20 6',
  undo: 'M9 4 3 10l6 6M3 10h10a7 7 0 0 1 7 7', upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6', file: 'M6 2h8l5 5v15H6zM14 2v5h5',
  home: 'M3 10 12 3l9 7M5 9v12h14V9M9 21v-8h6v8', cube: 'm12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9', image: 'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M8 7h.01',
  layers: 'm12 3 10 5-10 5L2 8zM2 13l10 5 10-5M2 18l10 5 10-5', folder: 'M3 7V4h6l3 3h9v13H3z', user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21c1-4 4-6 8-6s7 2 8 6',
  phone: 'M7 2h10v20H7zM11 18h2', lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4', link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
  key: 'M14 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12M9.8 13.2 3 20v2h3v-2h2v-2h2l1.2-1.2M16 7h.01', clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  info: 'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', alert: 'M12 9v5M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  chat: 'M4 4h16v12H8l-4 4z', send: 'm3 3 18 9-18 9 4-9zM7 12h14', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  rotate: 'M20 8V3l-4 4M20 8a9 9 0 1 0 1 7', compass: 'M12 2v3M3 12h3M12 19v3M18 12h3M12 8l3 4-3 4-3-4z', menu: 'M3 6h18M3 12h18M3 18h18', plus: 'M12 5v14M5 12h14',
  chevron: 'm9 5 7 7-7 7', down: 'm6 9 6 6 6-6', logout: 'M15 4h5v16h-5M10 8l-4 4 4 4M6 12h11',
};
export function icon(name, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.cube}"/></svg>`;
}

// 铺法示意：几何图形，不是插画。
export function layoutGlyph(id, size = 34) {
  const s = size, l = '#5c4a42';
  const rect = (x, y, w, h, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${extra}/>`;
  let body = '';
  if (id === 'straight') for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) body += rect(1 + c * 10.6, 1 + r * 10.6, 10.6, 10.6);
  if (id === 'running') for (let r = 0; r < 4; r++) for (let c = -1; c < 3; c++) body += rect(1 + c * 16 + (r % 2 ? 8 : 0), 1 + r * 8, 16, 8);
  if (id === 'diagonal') { for (let r = -3; r < 4; r++) for (let c = -3; c < 4; c++) body += rect(17 + c * 9 - 4.5, 17 + r * 9 - 4.5, 9, 9, 'transform="rotate(45 17 17)"'); }
  if (id === 'herringbone') {
    for (let c = -3; c <= 3; c++) for (let t = -6; t <= 6; t++) {
      const S = 4, L = 12, ox = c * L + t * S, oy = -c * L + t * S;
      body += rect(17 + ox, 17 + oy, L, S, 'transform="rotate(45 17 17)"') + rect(17 + ox, 17 + oy + S, S, L, 'transform="rotate(45 17 17)"');
    }
  }
  return `<svg width="${s}" height="${s}" viewBox="0 0 34 34" aria-hidden="true"><defs><clipPath id="lg-${id}"><rect x="1" y="1" width="32" height="32"/></clipPath></defs><g clip-path="url(#lg-${id})" fill="none" stroke="${l}" stroke-width=".9">${body}</g><rect x="1" y="1" width="32" height="32" fill="none" stroke="${l}" stroke-width="1"/></svg>`;
}
