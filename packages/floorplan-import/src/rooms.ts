/** Closed-room detection from HouseSpec wall centrelines (millimetres, diagram x right / y down). */
export type Mm = readonly [number, number];
export type Face = { outline: [number, number][]; area: number };

/** HouseSpec joins wall ends that fall within 40 mm of another wall's centreline. */
export const SNAP_MM = 40;
const MIN_ROOM_AREA_MM2 = 50_000;

/**
 * Splits centrelines at junctions and crossings, prunes dangling stubs, and returns every bounded face of the
 * resulting planar graph. Faces are what the walls actually enclose; labels never create geometry.
 */
export function enclosedFaces(segments: { a: Mm; b: Mm }[], snap = SNAP_MM): Face[] {
  const vertices: [number, number][] = [];
  const vertex = (p: readonly [number, number]) => {
    const found = vertices.findIndex(v => Math.hypot(v[0] - p[0], v[1] - p[1]) <= snap);
    if (found >= 0) return found;
    vertices.push([p[0], p[1]]); return vertices.length - 1;
  };
  const cuts = segments.map(() => new Set<number>([0, 1]));
  const param = (s: { a: Mm; b: Mm }, p: readonly [number, number]) => {
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], l = dx * dx + dy * dy;
    const t = ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / l;
    const distance = Math.hypot(s.a[0] + t * dx - p[0], s.a[1] + t * dy - p[1]);
    return { t, distance, length: Math.sqrt(l) };
  };
  segments.forEach((s, i) => segments.forEach((o, j) => {
    if (i === j) return;
    for (const end of [o.a, o.b]) {
      const { t, distance, length } = param(s, end);
      if (distance <= snap && t * length >= -snap && (t - 1) * length <= snap) cuts[i].add(Math.max(0, Math.min(1, t)));
    }
    // Proper crossing of two centrelines (cross walls).
    const r = [s.b[0] - s.a[0], s.b[1] - s.a[1]], q = [o.b[0] - o.a[0], o.b[1] - o.a[1]];
    const denominator = r[0] * q[1] - r[1] * q[0];
    if (Math.abs(denominator) < 1e-9) return;
    const t = ((o.a[0] - s.a[0]) * q[1] - (o.a[1] - s.a[1]) * q[0]) / denominator;
    const u = ((o.a[0] - s.a[0]) * r[1] - (o.a[1] - s.a[1]) * r[0]) / denominator;
    if (t > 0 && t < 1 && u > 0 && u < 1) cuts[i].add(t);
  }));
  const edges = new Set<string>();
  segments.forEach((s, i) => {
    const ids = [...cuts[i]].sort((a, b) => a - b)
      .map(t => vertex([s.a[0] + t * (s.b[0] - s.a[0]), s.a[1] + t * (s.b[1] - s.a[1])]));
    for (let k = 1; k < ids.length; k++) if (ids[k] !== ids[k - 1]) edges.add(ids[k] < ids[k - 1] ? `${ids[k]},${ids[k - 1]}` : `${ids[k - 1]},${ids[k]}`);
  });
  const neighbours = new Map<number, Set<number>>();
  for (const key of edges) {
    const [a, b] = key.split(',').map(Number);
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    if (!neighbours.has(b)) neighbours.set(b, new Set());
    neighbours.get(a)!.add(b); neighbours.get(b)!.add(a);
  }
  // Free-standing wall ends (e.g. a TV wall stopping short) do not bound any room.
  for (let changed = true; changed;) {
    changed = false;
    for (const [v, set] of neighbours) if (set.size < 2) {
      for (const n of set) neighbours.get(n)?.delete(v);
      neighbours.delete(v); changed = true;
    }
  }
  const angle = (from: number, to: number) => Math.atan2(vertices[to][1] - vertices[from][1], vertices[to][0] - vertices[from][0]);
  const sorted = new Map([...neighbours].map(([v, set]) => [v, [...set].sort((a, b) => angle(v, a) - angle(v, b))]));
  const visited = new Set<string>(), faces: Face[] = [];
  for (const [start, around] of sorted) for (const first of around) {
    if (visited.has(`${start},${first}`)) continue;
    const loop: number[] = [];
    let u = start, v = first;
    while (!visited.has(`${u},${v}`)) {
      visited.add(`${u},${v}`); loop.push(u);
      const list = sorted.get(v)!, index = list.indexOf(u);
      const next = list[(index - 1 + list.length) % list.length];
      u = v; v = next;
    }
    const outline = simplify(loop.map(i => vertices[i]));
    const area = signedArea(outline);
    // Bounded faces trace with positive signed area; the unbounded outer face is negative.
    if (area > MIN_ROOM_AREA_MM2) faces.push({ outline, area });
  }
  return faces;
}

export function signedArea(points: readonly (readonly [number, number])[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}
function simplify(points: [number, number][]) {
  return points.filter((p, i) => {
    const a = points[(i - 1 + points.length) % points.length], b = points[(i + 1) % points.length];
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-6;
  });
}
export function insideMm(p: Mm, polygon: readonly (readonly [number, number])[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
