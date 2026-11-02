import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping';
import type { TilePattern } from '../../contracts/src/finishes';
import { signedArea } from '../../contracts/src/finishes';

// Pure layout engine (排版引擎). No rendering: surface coordinates in metres, output pieces with geometry and counts.

export type Vec2 = [number, number];
export type LayoutSpec = {
  tile: { length: number; width: number }; pattern: TilePattern; joint: number;
  origin: 'center' | 'edge'; angle: number;
  border?: { width: number; pieceLength: number };
};
export type LayoutOptions = {
  /** Cut pieces whose smallest extent (in the tile's own axes) is below this are narrow strips. Default 0.05 m. */
  narrowWidth?: number;
  /** Stable salt for per-piece texture seeds. */
  seedKey?: string;
};
/** A piece of stone: a whole tile, or the part of a tile left after cutting to the surface. */
export type Piece = {
  role: 'field' | 'border'; kind: 'whole' | 'cut';
  /** Outer ring, counter-clockwise, then holes. */
  polygon: Ring[];
  /** Uncut tile this piece is taken from: centre, direction of its length, nominal size. */
  tile: { center: Vec2; angle: number; length: number; width: number };
  area: number; minExtent: number; narrow: boolean; seed: number;
};
export type LayoutIssue = { code: string; severity: 'conflict' | 'hint'; message: string };
export type RegionLayout = {
  pieces: Piece[];
  counts: { whole: number; cut: number; narrow: number; borderWhole: number; borderCut: number };
  /** Area of the surface and of laid stone (joints excluded). */
  area: number; stoneArea: number;
  issues: LayoutIssue[];
};

const EPS = 1e-9;
export function hashSeed(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const rotate = ([x, y]: Vec2, angle: number): Vec2 => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const scale = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const open = (ring: Ring): Vec2[] => {
  const points = ring.map(p => [p[0], p[1]] as Vec2);
  if (points.length > 1 && Math.abs(points[0][0] - points.at(-1)![0]) < EPS && Math.abs(points[0][1] - points.at(-1)![1]) < EPS) points.pop();
  return points;
};
export const polygonArea = (polygon: Ring[]) => Math.abs(signedArea(open(polygon[0]))) - polygon.slice(1).reduce((s, h) => s + Math.abs(signedArea(open(h))), 0);
export const multiArea = (polygons: MultiPolygon) => polygons.reduce((s, p) => s + polygonArea(p), 0);
const ccw = (ring: Vec2[]) => signedArea(ring) < 0 ? [...ring].reverse() : ring;

/** Mitred inward offset of a simple ring. Returns null when the offset collapses or flips. */
export function insetRing(ring: Vec2[], distance: number): Vec2[] | null {
  const points = ccw(ring), n = points.length, normals: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const d = sub(points[(i + 1) % n], points[i]), length = Math.hypot(d[0], d[1]);
    if (length < EPS) return null;
    normals.push([-d[1] / length, d[0] / length]); // inward for counter-clockwise rings
  }
  const result: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = normals[(i + n - 1) % n], b = normals[i], cos = dot(a, b);
    if (cos < -.95) return null;
    result.push(add(points[i], scale(add(a, b), distance / (1 + cos))));
  }
  // Every offset edge must keep its direction; otherwise the border is wider than the surface allows.
  for (let i = 0; i < n; i++) {
    const before = sub(points[(i + 1) % n], points[i]), after = sub(result[(i + 1) % n], result[i]);
    if (dot(before, after) <= EPS) return null;
  }
  if (signedArea(result) <= EPS) return null;
  const check = polygonClipping.difference([result] as Polygon, [points] as Polygon);
  return multiArea(check) > 1e-6 ? null : result;
}

function insideRing([x, y]: Vec2, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function nearRing([x, y]: Vec2, ring: Ring, tolerance: number) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
    if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= tolerance) return true;
  }
  return false;
}
/** Inside the surface or on its boundary (holes excluded). */
export function onSurface(p: Vec2, surface: MultiPolygon, tolerance = 1e-6) {
  return surface.some(polygon => polygon.some(ring => nearRing(p, ring, tolerance))
    || insideRing(p, polygon[0]) && !polygon.slice(1).some(hole => insideRing(p, hole)));
}

type TileCandidate = { center: Vec2; angle: number; length: number; width: number; key: string };
/** Tiles in pattern coordinates (a along the laying direction), covering the rectangle [a0,a1]×[b0,b1]. */
function patternTiles(pattern: TilePattern, L: number, W: number, j: number, origin: 'center' | 'edge', box: [number, number, number, number]): TileCandidate[] {
  const [a0, a1, b0, b1] = box, tiles: TileCandidate[] = [], pa = L + j, pb = W + j;
  if (pattern === 'herringbone') {
    // Lattice coordinates: horizontal tile H(k,m) at (k·pb − m·pa, k·pb + m·pa), vertical V beside it.
    // The staircase runs along (1,1); rotating by −45° makes the herringbone axis follow the laying direction.
    const toPattern = (p: Vec2) => rotate(p, -Math.PI / 4), toLattice = (p: Vec2) => rotate(p, Math.PI / 4);
    const corners = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(p => toLattice(p as Vec2));
    const reach = L + W + 2 * j;
    // k counts along the staircase, m across bands: u = k·pb (along (1,1)/√2 scaled), solve bounds generously.
    const along = corners.map(([x, y]) => (x + y) / (2 * pb)), across = corners.map(([x, y]) => (y - x) / (2 * pa));
    const kMin = Math.floor(Math.min(...along) - reach / pb) - 1, kMax = Math.ceil(Math.max(...along) + reach / pb) + 1;
    const mMin = Math.floor(Math.min(...across) - reach / pa) - 1, mMax = Math.ceil(Math.max(...across) + reach / pa) + 1;
    const shift: Vec2 = origin === 'center' ? [-(L + W) / 4, -(L + W) / 4] : [0, 0];
    for (let m = mMin; m <= mMax; m++) for (let k = kMin; k <= kMax; k++) {
      const o: Vec2 = add([k * pb - m * pa, k * pb + m * pa], shift);
      const h = toPattern(add(o, [L / 2, W / 2])), v = toPattern(add(o, [pa + W / 2, pb - pa + L / 2]));
      tiles.push({ center: h, angle: -Math.PI / 4, length: L, width: W, key: `h${k},${m}` });
      tiles.push({ center: v, angle: Math.PI / 4, length: L, width: W, key: `v${k},${m}` });
    }
    return tiles.filter(t => t.center[0] > a0 - reach && t.center[0] < a1 + reach && t.center[1] > b0 - reach && t.center[1] < b1 + reach);
  }
  const ca = origin === 'center' ? 0 : a0 + L / 2, cb = origin === 'center' ? 0 : b0 + W / 2;
  const rMin = Math.floor((b0 - cb) / pb) - 1, rMax = Math.ceil((b1 - cb) / pb) + 1;
  for (let r = rMin; r <= rMax; r++) {
    const offset = pattern === 'running-bond' && Math.abs(r) % 2 === 1 ? pa / 2 : 0;
    const cMin = Math.floor((a0 - ca - offset) / pa) - 1, cMax = Math.ceil((a1 - ca - offset) / pa) + 1;
    for (let c = cMin; c <= cMax; c++) tiles.push({ center: [ca + offset + c * pa, cb + r * pb], angle: 0, length: L, width: W, key: `${c},${r}` });
  }
  return tiles;
}
const tileRing = (center: Vec2, angle: number, L: number, W: number): Vec2[] =>
  ([[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]] as Vec2[]).map(p => add(center, rotate(p, angle)));
function extents(polygon: Ring[], center: Vec2, angle: number) {
  const u: Vec2 = [Math.cos(angle), Math.sin(angle)], v: Vec2 = [-u[1], u[0]];
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const p of open(polygon[0])) {
    const d = sub(p as Vec2, center), a = dot(d, u), b = dot(d, v);
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  return Math.min(a1 - a0, b1 - b0);
}
function bounds(polygons: MultiPolygon) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const polygon of polygons) for (const [x, y] of polygon[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, x1, y0, y1 };
}
function normalize(polygon: Ring[]): Ring[] {
  return polygon.map((ring, index) => { const points = open(ring), turned = signedArea(points) < 0 === (index === 0) ? [...points].reverse() : points; return turned; });
}

/** Cut one tile against the surface; returns 0..n pieces. */
function cutTile(field: MultiPolygon, fieldBox: ReturnType<typeof bounds>, tile: TileCandidate, role: Piece['role'], narrowWidth: number, seed: number): Piece[] {
  const ring = tileRing(tile.center, tile.angle, tile.length, tile.width);
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  if (Math.max(...xs) < fieldBox.x0 || Math.min(...xs) > fieldBox.x1 || Math.max(...ys) < fieldBox.y0 || Math.min(...ys) > fieldBox.y1) return [];
  const full = tile.length * tile.width;
  return polygonClipping.intersection(field, [ring] as Polygon).flatMap(raw => {
    const polygon = normalize(raw), area = polygonArea(polygon);
    if (area < 1e-7) return [];
    const whole = area >= full * (1 - 1e-6), minExtent = whole ? tile.width : extents(polygon, tile.center, tile.angle);
    return [{ role, kind: whole ? 'whole' : 'cut', polygon, tile: { center: tile.center, angle: tile.angle, length: tile.length, width: tile.width },
      area, minExtent, narrow: !whole && minExtent < narrowWidth - 1e-9, seed } as Piece];
  });
}

/** Border band: mitred strips along every outer edge, cut into pieces with joints between pieces and at mitres. */
function borderPieces(outer: Vec2[], inner: Vec2[], width: number, pieceLength: number, joint: number, narrowWidth: number, seedKey: string): Piece[] {
  const n = outer.length, pieces: Piece[] = [];
  const mitres = joint > 0 ? outer.map((p, i) => {
    const q = inner[i], d = sub(q, p), length = Math.hypot(d[0], d[1]), u = scale(d, 1 / length), v: Vec2 = [-u[1] * joint / 2, u[0] * joint / 2];
    const a = sub(p, scale(u, joint)), b = add(q, scale(u, joint));
    return [[sub(a, v), add(a, v), add(b, v), sub(b, v)]] as Polygon;
  }) : [];
  for (let i = 0; i < n; i++) {
    const p0 = outer[i], p1 = outer[(i + 1) % n], q0 = inner[i], q1 = inner[(i + 1) % n];
    const edge = sub(p1, p0), length = Math.hypot(edge[0], edge[1]), u = scale(edge, 1 / length), angle = Math.atan2(u[1], u[0]);
    let band: MultiPolygon = [[[p0, p1, q1, q0]]];
    if (mitres.length) band = polygonClipping.difference(band, ...mitres);
    const box = bounds(band);
    // Pieces run from the edge start; one more piece on each side covers the mitred corners.
    for (let k = -1; k * (pieceLength + joint) < length + width + joint; k++) {
      const center = add(add(p0, scale(u, k * (pieceLength + joint) + pieceLength / 2)), scale([-u[1], u[0]], width / 2));
      pieces.push(...cutTile(band, box, { center, angle, length: pieceLength, width, key: '' }, 'border', narrowWidth, hashSeed(`${seedKey}|b${i},${k}`)));
    }
  }
  return pieces;
}

/**
 * Lays one surface. `surface` is a multipolygon in surface coordinates (outer rings + holes such as wall openings).
 * The border, when present, follows every outer ring; holes are cut without a border.
 */
export function layoutSurface(surface: MultiPolygon, spec: LayoutSpec, options: LayoutOptions = {}): RegionLayout {
  const narrowWidth = options.narrowWidth ?? .05, seedKey = options.seedKey ?? '', issues: LayoutIssue[] = [];
  const L = spec.tile.length, W = spec.tile.width, j = spec.joint, pieces: Piece[] = [];
  const total = multiArea(surface);
  if (spec.pattern === 'herringbone' && L < W * 1.5 - 1e-9)
    issues.push({ code: 'PATTERN_NEEDS_PLANK', severity: 'conflict', message: '人字铺需要长宽比至少 1.5 的条形石材。' });
  let field: MultiPolygon = surface;
  if (spec.border) {
    const inner: MultiPolygon = [];
    for (const [index, polygon] of surface.entries()) {
      const outer = ccw(open(polygon[0])), band = insetRing(outer, spec.border.width), fieldRing = insetRing(outer, spec.border.width + j);
      if (!band || !fieldRing) {
        issues.push({ code: 'BORDER_EXCEEDS_FINISH', severity: 'conflict', message: `波打线宽度 ${spec.border.width} m 超出饰面范围，无法在内侧留下铺贴区域。` });
        continue;
      }
      pieces.push(...borderPieces(outer, band, spec.border.width, spec.border.pieceLength, j, narrowWidth, `${seedKey}|${index}`));
      const clipped = polygonClipping.difference([fieldRing] as Polygon, ...polygon.slice(1).map(hole => [hole] as Polygon));
      inner.push(...clipped);
    }
    field = inner;
  }
  if (field.length && !issues.some(issue => issue.severity === 'conflict')) {
    const box = bounds(field), anchorCenter: Vec2 = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
    // Pattern frame: a along the laying direction. Herringbone/diagonal turn inside the pattern generator.
    const angle = spec.angle + (spec.pattern === 'diagonal' ? Math.PI / 4 : 0);
    const local = field.flatMap(polygon => open(polygon[0]).map(p => rotate(sub(p, anchorCenter), -angle)));
    const la = local.map(p => p[0]), lb = local.map(p => p[1]);
    const patternBox: [number, number, number, number] = [Math.min(...la), Math.max(...la), Math.min(...lb), Math.max(...lb)];
    const fieldBox = bounds(field);
    for (const tile of patternTiles(spec.pattern === 'diagonal' ? 'straight' : spec.pattern, L, W, j, spec.origin, patternBox)) {
      const center = add(anchorCenter, rotate(tile.center, angle));
      pieces.push(...cutTile(field, fieldBox, { ...tile, center, angle: angle + tile.angle }, 'field', narrowWidth, hashSeed(`${seedKey}|${tile.key}`)));
    }
  }
  const stoneArea = pieces.reduce((s, p) => s + p.area, 0);
  // Invariant: stone never leaves the finish. Joints make the laid area strictly smaller than the surface.
  // Checked per vertex: a global polygon difference over hundreds of pieces is numerically fragile.
  const outside = pieces.filter(piece => piece.polygon.some(ring => ring.some(p => !onSurface(p as Vec2, surface)))).length;
  if (outside) issues.push({ code: 'TILING_EXCEEDS_FINISH', severity: 'conflict', message: `排版有 ${outside} 块超出饰面。` });
  const field_ = pieces.filter(p => p.role === 'field'), border = pieces.filter(p => p.role === 'border');
  const counts = { whole: field_.filter(p => p.kind === 'whole').length, cut: field_.filter(p => p.kind === 'cut').length,
    narrow: pieces.filter(p => p.narrow).length, borderWhole: border.filter(p => p.kind === 'whole').length, borderCut: border.filter(p => p.kind === 'cut').length };
  if (counts.narrow) issues.push({ code: 'NARROW_CUT', severity: 'hint', message: `有 ${counts.narrow} 块切块窄于 ${(narrowWidth * 1000).toFixed(0)} mm，施工易崩边，建议调整起铺点或规格。` });
  return { pieces, counts, area: total, stoneArea, issues };
}
