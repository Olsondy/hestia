import { createHash } from 'node:crypto';
import { spatialStateSchema, type SpatialState } from '../../contracts/src/project';
import type { CandidateCheck, CandidateView } from '../../contracts/src/candidates';
import type { FurniturePose } from '../../contracts/src/commands';
import { validatePlacement } from '../../geometry/src/placement';
import { catalogInstance } from '../../catalog/src/instances';
import { sceneSnapshotSchema } from '../../contracts/src/scene';

export const CHECKER_VERSION = 'furniture-layout-3-style';
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const pose = (object: SpatialState['currentLayout']['objects'][number]): FurniturePose => ({ x: object.position.x, z: object.position.z, yaw: object.yaw });
export function differences(base: SpatialState, objects: SpatialState['currentLayout']['objects']): CandidateView['differences'] {
  return objects.flatMap(object => {
    const original = base.currentLayout.objects.find(item => item.id === object.id);
    if (!original || hash(pose(original)) === hash(pose(object))) return [];
    return [{ objectId: object.id, before: pose(original), after: pose(object) }];
  });
}
export function objectChanges(base: SpatialState, objects: SpatialState['currentLayout']['objects']): CandidateView['objectChanges'] {
  const before = new Map(base.currentLayout.objects.map(object => [object.id, object])), after = new Map(objects.map(object => [object.id, object]));
  return [...new Set([...before.keys(), ...after.keys()])].flatMap(objectId => {
    const a = before.get(objectId) ?? null, b = after.get(objectId) ?? null;
    if (hash(a) === hash(b)) return [];
    const immutable = (o: NonNullable<typeof a>) => ({ ...o, position: { ...o.position, x: 0, z: 0 }, yaw: 0 });
    const kind = !a ? 'added' : !b ? 'removed' : hash(immutable(a)) === hash(immutable(b)) ? 'moved' : 'replaced';
    return [{ objectId, kind, before: a, after: b } as CandidateView['objectChanges'][number]];
  });
}
export function hasLayoutChange(base: SpatialState, objects: SpatialState['currentLayout']['objects']) {
  return objectChanges(base, objects).some(change => !change.before || !change.after || hash(pose(change.before)) !== hash(pose(change.after))
    || hash(change.before.size) !== hash(change.after.size) || change.before.catalog?.assetId !== change.after.catalog?.assetId || change.before.catalog?.assetVersion !== change.after.catalog?.assetVersion);
}
/** Full final-state validation; draft edits may overlap while the final batch can be valid. */
export function inspectLayout(base: SpatialState, objects: SpatialState['currentLayout']['objects']): Pick<CandidateCheck, 'adoptable' | 'checks' | 'issues'> {
  const checks: CandidateCheck['checks'] = [], issues: CandidateCheck['issues'] = [];
  const add = (code: string, status: CandidateCheck['checks'][number]['status'], required: boolean, objectId?: string) => checks.push({ code, status, required, ...(objectId ? { objectId } : {}) });
  const state = spatialStateSchema.safeParse({ ...base, currentLayout: { ...base.currentLayout, objects } });
  const scene = sceneSnapshotSchema.safeParse({ version: 1, unit: 'm', plane: 'xz', label: 'Candidate check', synthetic: base.synthetic, rooms: base.fixedFacts.rooms, walls: base.fixedFacts.walls, objects: [...base.fixedFacts.objects, ...objects] });
  if (!state.success || !scene.success) return { adoptable: false, checks: [{ code: 'input', status: 'failed', required: true }], issues: [{ code: 'INVALID_CANDIDATE', message: '候选数据不符合当前空间契约。' }] };
  const original = new Map(base.currentLayout.objects.map(object => [object.id, object]));
  const immutable = (object: SpatialState['currentLayout']['objects'][number]) => ({ ...object, position: { ...object.position, x: 0, z: 0 }, yaw: 0 });
  for (const previous of original.values()) {
    const object = objects.find(item => item.id === previous.id);
    if (previous.dimensionSource === 'measured' && (!object || hash(immutable(object)) !== hash(immutable(previous))))
      issues.push({ code: 'MEASURED_FURNITURE_PROTECTED', objectId: previous.id, message: '实测家具不能被缩小、删除或换件；请保留原实物尺寸。' });
  }
  for (const object of objects) {
    const previous = original.get(object.id);
    // Old or tampered drafts can contain a palette-only catalog replacement. Never classify it as
    // a pure style adoption and then silently discard the visible object change, even when light/pose also changed.
    if (previous?.catalog && object.catalog && previous.catalog.assetId === object.catalog.assetId && previous.catalog.assetVersion === object.catalog.assetVersion
      && hash(previous.size) === hash(object.size) && (previous.catalog.materialId !== object.catalog.materialId || previous.catalog.materialVersion !== object.catalog.materialVersion))
      issues.push({ code: 'STYLE_REQUIRES_OVERRIDE', objectId: object.id, message: '此候选包含家具记录内的材质变化；请恢复原家具材质并通过独立视觉风格修改。' });
    if (object.catalog) {
      try {
        const expected = catalogInstance(object.id, object.catalog, object.size, pose(object)); expected.position.y = previous?.position.y ?? 0;
        if (previous?.dimensionSource === 'measured') expected.dimensionSource = 'measured';
        if (hash(immutable(object)) !== hash(immutable(expected))) throw new Error('Catalog instance fields differ');
      } catch { issues.push({ code: 'INVALID_CATALOG_INSTANCE', objectId: object.id, message: '家具资产、材质、尺寸或来源不符合记录的目录版本。' }); }
    } else if (!previous || hash(immutable(object)) !== hash(immutable(previous))) {
      issues.push({ code: 'CANDIDATE_SCOPE', objectId: object.id, message: '新增或换件必须来自受控目录，不能直接改变已有实物尺寸。' });
    }
  }
  for (const objectId of base.currentLayout.lockedObjectIds) {
    const object = objects.find(item => item.id === objectId);
    if (!object || hash(object) !== hash(original.get(objectId))) issues.push({ code: 'OBJECT_LOCKED', objectId, message: '候选不能改变锁定家具。' });
  }
  add('scope-and-locks', issues.length ? 'failed' : 'passed', true);
  const scaled = base.scale === 'calibrated' || (base.scale === 'synthetic' && base.synthetic);
  add('scale', scaled ? 'passed' : 'not-checked', true);
  if (!scaled) issues.push({ code: 'SCALE_UNCONFIRMED', message: '尺寸未确认，候选仅供概念预览，不能采用。' });
  if (!objects.length) { add('furniture-geometry', 'not-applicable', true); }
  for (const object of objects) {
    if (!scaled) { add('furniture-geometry', 'not-checked', true, object.id); continue; }
    const report = validatePlacement({ rooms: base.fixedFacts.rooms, walls: base.fixedFacts.walls, objects: [...base.fixedFacts.objects, ...objects] }, object.id, pose(object), base.fixedFacts.openingClearances);
    for (const check of report.checks) add(check.code, check.status, true, object.id);
    issues.push(...report.issues);
    // A thrown/early-return geometry failure must never appear covered by partial successful rows.
    if (!report.valid && !report.checks.some(check => check.status === 'failed')) add('geometry-completed', 'failed', true, object.id);
  }
  add('human-use-clearance', 'not-checked', false);
  add('transport-path', 'not-checked', false);
  add('structural-safety', 'not-checked', false);
  return { adoptable: issues.length === 0 && checks.every(check => !check.required || ['passed', 'not-applicable'].includes(check.status)), checks, issues };
}
