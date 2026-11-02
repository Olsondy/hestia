import type { Finish, StoneReference, StoneSpec, SurfaceDesign, Tiling } from '../../contracts/src/finishes';
import { layoutSurface, type LayoutOptions, type Piece, type RegionLayout } from './layout';
import { finishSurfaces, type FinishFacts, type FinishSurface } from './surfaces';

export type PlanIssue = { code: string; severity: 'conflict' | 'hint'; objectId: string; message: string };
export type FinishLayout = {
  finishId: string; tiling: Tiling;
  surfaces: { surface: FinishSurface; layout: RegionLayout }[];
  counts: RegionLayout['counts'] & { total: number };
  issues: PlanIssue[];
};
export type PlanOptions = Pick<LayoutOptions, 'narrowWidth'>;
export const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  : JSON.stringify(value);
export const stoneKey = (ref: StoneReference) => `${ref.stoneId}@${ref.stoneVersion}`;
export function stoneOf(design: SurfaceDesign, ref: StoneReference) {
  return design.stones.find(stone => stone.id === ref.stoneId && stone.version === ref.stoneVersion);
}

/** Lays one tiling on its finish. Pure: the same facts and tiling always give the same pieces. */
export function layoutFinish(finish: Finish, facts: FinishFacts, tiling: Tiling, options: PlanOptions = {}): FinishLayout {
  const surfaces = finishSurfaces(finish, facts).map(surface => ({ surface, layout: layoutSurface(surface.polygon, {
    tile: tiling.tile, pattern: tiling.pattern, joint: tiling.joint.width, origin: tiling.origin, angle: tiling.angle,
    // Stair parts are narrow by nature; a border only applies to floors and walls.
    ...(tiling.border && (surface.part === 'floor' || surface.part === 'wall') ? { border: { width: tiling.border.width, pieceLength: tiling.border.pieceLength } } : {}),
  }, { ...options, seedKey: `${finish.id}|${surface.key}` }) }));
  const counts = { whole: 0, cut: 0, narrow: 0, borderWhole: 0, borderCut: 0, total: 0 };
  const issues = new Map<string, PlanIssue>();
  for (const { layout } of surfaces) {
    for (const key of ['whole', 'cut', 'narrow', 'borderWhole', 'borderCut'] as const) counts[key] += layout.counts[key];
    for (const issue of layout.issues) {
      const previous = issues.get(issue.code);
      // One issue per code and finish keeps reports short; narrow-strip counts are summed below.
      if (!previous) issues.set(issue.code, { ...issue, objectId: finish.id });
    }
  }
  counts.total = counts.whole + counts.cut + counts.borderWhole + counts.borderCut;
  if (counts.narrow) issues.set('NARROW_CUT', { code: 'NARROW_CUT', severity: 'hint', objectId: finish.id,
    message: `${counts.narrow} 块切块窄于 ${((options.narrowWidth ?? .05) * 1000).toFixed(0)} mm，施工易崩边，建议调整起铺点或规格。` });
  if (!surfaces.length || surfaces.every(item => !item.layout.pieces.length) && !issues.size)
    issues.set('FINISH_EMPTY', { code: 'FINISH_EMPTY', severity: 'conflict', objectId: finish.id, message: '饰面没有可铺贴的区域。' });
  return { finishId: finish.id, tiling, surfaces, counts, issues: [...issues.values()] };
}

/** Catalog state of a referenced stone version, supplied by the caller (workspace catalog lookup). */
export type CatalogStatus = { status: 'active' | 'retired'; spec: StoneSpec } | undefined;

/**
 * Full surface-design inspection: layout per finish plus catalog and size-range checks.
 * Retired or missing catalog versions are conflicts for tilings the candidate changes and hints for inherited ones.
 */
export function inspectSurfaceDesign(facts: FinishFacts, design: SurfaceDesign, catalog: (ref: StoneReference) => CatalogStatus,
  options: PlanOptions & { changedFinishIds?: string[] } = {}) {
  const layouts: FinishLayout[] = [], issues: PlanIssue[] = [];
  for (const tiling of design.tilings) {
    const finish = facts.finishes?.find(item => item.id === tiling.finishId);
    if (!finish) { issues.push({ code: 'TILING_UNKNOWN_FINISH', severity: 'conflict', objectId: tiling.finishId, message: '铺贴方案指向不存在的饰面。' }); continue; }
    const changed = !options.changedFinishIds || options.changedFinishIds.includes(finish.id);
    for (const [ref, role] of [[tiling, 'field'], ...(tiling.border ? [[tiling.border, 'border']] : [])] as [StoneReference, string][]) {
      const embedded = stoneOf(design, ref), entry = catalog(ref), label = role === 'border' ? '波打线石材' : '石材';
      if (!entry) issues.push({ code: 'STONE_NOT_FOUND', severity: changed ? 'conflict' : 'hint', objectId: finish.id, message: `${label} ${stoneKey(ref)} 不在工作空间石材目录中。` });
      else if (entry.status === 'retired') issues.push({ code: 'STONE_VERSION_RETIRED', severity: changed ? 'conflict' : 'hint', objectId: finish.id, message: `${label} ${stoneKey(ref)} 的目录版本已失效，请换用当前版本。` });
      else if (!embedded || canonical(embedded) !== canonical(entry.spec)) issues.push({ code: 'STONE_SPEC_MISMATCH', severity: 'conflict', objectId: finish.id, message: `${label} ${stoneKey(ref)} 与目录记录不一致。` });
    }
    const stone = stoneOf(design, tiling);
    if (stone) {
      const { length, width } = stone.sizes, { tile } = tiling;
      if (tile.length < length.min - 1e-9 || tile.length > length.max + 1e-9 || tile.width < width.min - 1e-9 || tile.width > width.max + 1e-9)
        issues.push({ code: 'TILE_SIZE_OUT_OF_RANGE', severity: 'conflict', objectId: finish.id,
          message: `规格 ${Math.round(tile.length * 1000)}×${Math.round(tile.width * 1000)} mm 超出该石材可供规格范围。` });
    }
    const layout = layoutFinish(finish, facts, tiling, options);
    layouts.push(layout); issues.push(...layout.issues);
  }
  return { layouts, issues, adoptable: !issues.some(issue => issue.severity === 'conflict') };
}
export type { Piece };
