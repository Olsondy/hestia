import { z, ZodError } from 'zod';
import type { FloorplanIssue } from '../../contracts/src/floorplan-imports';
import { buildingCandidateToScene, convertHouseSpecBuilding, isHouseSpecBuilding, type ImportedBuildingCandidate } from './building';
import { FloorplanImportError, type ScaleEvidence } from './house-spec';
import type { SceneSnapshot } from '../../contracts/src/scene';

const mm = z.number().finite();
const opening = z.object({ type: z.string(), from: mm, to: mm }).passthrough();
const wall = z.object({ a: z.tuple([mm, mm]), b: z.tuple([mm, mm]), t: mm.positive(), flush: z.string().optional(),
  openings: z.array(opening).optional() }).passthrough();
/** Output contract of `python/cadvec_dxf.py`; anything else is treated as a converter failure. */
export const dxfConverterOutputSchema = z.object({
  ok: z.literal(true), converter: z.literal('hestia-cadvec-dxf-v1'),
  draft: z.object({ height: mm.positive(), walls: z.array(wall).max(1000), rooms: z.array(z.unknown()).max(300), structs: z.array(z.unknown()).max(500) }).strict(),
  units: z.object({ insunits: z.number().int(), declared: z.boolean(), mmPerUnit: mm.positive(), scaleFrom: z.string() }).strict(),
  dimensionConflicts: z.array(z.record(z.string(), z.unknown())).max(400),
  warnings: z.array(z.object({ code: z.string(), detail: z.string() }).strict()).max(100),
}).passthrough();
export type DxfConverterOutput = z.infer<typeof dxfConverterOutputSchema>;

/**
 * Converter draft → single-storey HouseSpec accepted by `floorplan-import`. Changes are never silent:
 * non-centred `flush` walls keep their centreline (face offset listed for review) and openings that overrun
 * their wall by ≤ 5 mm are clamped.
 */
export function dxfDraftToHouseSpec(output: DxfConverterOutput, name: string) {
  const issues: FloorplanIssue[] = [];
  const walls = output.draft.walls.map((w, index) => {
    const id = `dxf-wall-${index + 1}`;
    const { flush, ...rest } = w;
    if (flush && flush !== 'C') issues.push({ code: 'FLUSH_APPROXIMATED', severity: 'review', objectId: id,
      detail: `墙一侧与相邻墙面齐平（${flush}），按中线放置，墙面位置待核对。` });
    const horizontal = w.a[1] === w.b[1], vertical = w.a[0] === w.b[0];
    const lo = horizontal ? Math.min(w.a[0], w.b[0]) : vertical ? Math.min(w.a[1], w.b[1]) : 0;
    const hi = horizontal ? Math.max(w.a[0], w.b[0]) : vertical ? Math.max(w.a[1], w.b[1]) : Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const openings = (w.openings ?? []).map(o => {
      const from = Math.min(o.from, o.to), to = Math.max(o.from, o.to);
      if ((from < lo && from >= lo - 5) || (to > hi && to <= hi + 5))
        issues.push({ code: 'OPENING_CLAMPED', severity: 'review', objectId: id, detail: `洞口 ${from}–${to} 超出墙端不足 5 mm，已截到墙内。` });
      return { ...o, from: Math.max(from, lo), to: Math.min(to, hi) };
    });
    return { ...rest, id, openings };
  });
  issues.push({ code: 'ASSUMED_STOREY_HEIGHT', severity: 'review', detail: `DXF 平面图不含层高，暂按 ${output.draft.height} mm。` });
  for (const warning of output.warnings) issues.push({ code: warning.code, severity: 'review', detail: warning.detail });
  if (output.dimensionConflicts.length) issues.push({ code: 'DIMENSION_CONFLICTS', severity: 'review',
    detail: `图纸中有 ${output.dimensionConflicts.length} 处标注与图形或其他标注矛盾，见 dimensionConflicts。` });
  const houseSpec = { name, slab: 0, floors: [{ id: 'f1', name: '一层', height: output.draft.height, walls,
    rooms: output.draft.rooms, structs: output.draft.structs }] };
  return { houseSpec, issues };
}

/** Scale evidence for an automatic DXF result: from $INSUNITS only, never upgraded to calibrated here. */
export function dxfScaleEvidence(output: DxfConverterOutput, resourceId: string): ScaleEvidence {
  if (!output.units.declared) return { status: 'missing', evidenceId: `dxf-units-${resourceId}` };
  if (output.dimensionConflicts.length) return { status: 'conflicted', evidenceId: `dxf-dimensions-${resourceId}` };
  return { status: 'estimated', evidenceId: `dxf-units-${resourceId}` };
}

export type FloorplanCandidateResult = {
  valid: boolean; candidate: ImportedBuildingCandidate | null; scene: SceneSnapshot | null; issues: FloorplanIssue[];
};
/**
 * Any HouseSpec (one storey or whole building) → building import candidate and contract-checked preview scene.
 * Rejections become blocking issues rather than exceptions so the result can wait for member review.
 */
export function buildFloorplanCandidate(houseSpec: unknown, sourceId: string, scaleEvidence: ScaleEvidence, label: string): FloorplanCandidateResult {
  const issues: FloorplanIssue[] = [];
  const building = isHouseSpecBuilding(houseSpec) ? houseSpec
    : { slab: 0, floors: [{ id: 'f1', name: '一层', ...(houseSpec as Record<string, unknown>) }] };
  let candidate: ImportedBuildingCandidate;
  try { candidate = convertHouseSpecBuilding(building, { sourceId, sourceFormat: 'housespec-mm-v1', scaleEvidence }); }
  catch (error) {
    if (error instanceof FloorplanImportError) issues.push({ code: error.code, severity: 'blocking', objectId: error.objectId, detail: error.message });
    else if (error instanceof ZodError) issues.push(...error.issues.slice(0, 20).map(i => ({ code: 'INVALID_HOUSESPEC', severity: 'blocking' as const,
      detail: `${i.path.join('.') || '(root)'}: ${i.message}` })));
    else throw error;
    return { valid: false, candidate: null, scene: null, issues };
  }
  for (const warning of candidate.warnings) issues.push({ code: warning.code, severity: 'review', ...(warning.objectId ? { objectId: warning.objectId } : {}), detail: warning.detail });
  let scene: SceneSnapshot;
  try { scene = buildingCandidateToScene(candidate, label, false); }
  catch (error) {
    if (!(error instanceof ZodError)) throw error;
    issues.push(...error.issues.slice(0, 20).map(i => ({ code: String((i as { params?: { code?: string } }).params?.code ?? 'CONTRACT_REJECTED'),
      severity: 'blocking' as const, detail: i.message })));
    return { valid: false, candidate, scene: null, issues };
  }
  if (!scene.rooms.length) issues.push({ code: 'NO_CLOSED_ROOMS', severity: 'blocking', detail: '墙体没有围合出任何房间。' });
  return { valid: !issues.some(i => i.severity === 'blocking'), candidate, scene, issues };
}
