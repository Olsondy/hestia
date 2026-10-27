import { DomainError, type SpatialState } from '../../contracts/src/project';
import { defaultVisualStyle, visualStyleSchema, type VisualStyle, type StyleChange, type StyleCommand } from '../../contracts/src/styles';
import { resolveLighting, resolveMaterial } from './catalog';
import { resolveCatalog } from '../../catalog/src/catalog';

export const styleOf = (style?: VisualStyle | null): VisualStyle => visualStyleSchema.parse(style ?? defaultVisualStyle());
export function styleChanges(before: VisualStyle | undefined | null, after: VisualStyle | undefined | null): StyleChange[] {
  const a = styleOf(before), b = styleOf(after), changes: StyleChange[] = [];
  for (const objectId of [...new Set([...a.materials, ...b.materials].map(item => item.objectId))].sort()) {
    const x = a.materials.find(item => item.objectId === objectId) ?? null, y = b.materials.find(item => item.objectId === objectId) ?? null;
    if (JSON.stringify(x) !== JSON.stringify(y)) changes.push({ kind: 'material', objectId, before: x, after: y });
  }
  if (JSON.stringify(a.lighting) !== JSON.stringify(b.lighting)) changes.push({ kind: 'lighting', before: a.lighting, after: b.lighting });
  return changes;
}
export function validateStyle(base: SpatialState, objects: SpatialState['currentLayout']['objects'], input: VisualStyle) {
  const style = styleOf(input); resolveLighting(style.lighting.presetId, style.lighting.presetVersion);
  for (const override of style.materials) {
    if (base.fixedFacts.objects.some(object => object.id === override.objectId)) throw new DomainError('FIXED_FACT', '风格不能改变固定设施的材质。');
    const object = objects.find(item => item.id === override.objectId);
    if (!object) throw new DomainError('OBJECT_NOT_FOUND', '材质范围内的家具不存在。', 404);
    resolveMaterial(override.materialId, override.materialVersion);
    if (object.catalog) resolveCatalog({ ...object.catalog, materialId: override.materialId, materialVersion: override.materialVersion }, object.size);
  }
  for (const change of styleChanges(base.visualStyle, style)) {
    if (change.kind === 'material' && base.currentLayout.lockedObjectIds.includes(change.objectId))
      throw new DomainError('OBJECT_LOCKED', '锁定家具不能更换材质。');
  }
  return style;
}
export function applyStyleCommand(base: SpatialState, objects: SpatialState['currentLayout']['objects'], current: VisualStyle, command: StyleCommand) {
  const next = structuredClone(styleOf(current));
  if (command.type === 'set-display-lighting') {
    resolveLighting(command.presetId, command.presetVersion);
    next.lighting = { presetId: command.presetId, presetVersion: command.presetVersion };
  } else {
    if (base.fixedFacts.objects.some(object => object.id === command.objectId)) throw new DomainError('FIXED_FACT', '风格不能改变固定设施的材质。');
    if (base.currentLayout.lockedObjectIds.includes(command.objectId)) throw new DomainError('OBJECT_LOCKED', '锁定家具不能更换材质。');
    const object = objects.find(item => item.id === command.objectId);
    if (!object) throw new DomainError('OBJECT_NOT_FOUND', '家具不存在。', 404);
    next.materials = next.materials.filter(item => item.objectId !== command.objectId);
    if (command.type === 'set-material') {
      resolveMaterial(command.materialId, command.materialVersion);
      // Selecting an object's base palette is represented by no override, so a visual no-op is not a new style.
      if (!object.catalog || object.catalog.materialId !== command.materialId || object.catalog.materialVersion !== command.materialVersion)
        next.materials.push({ objectId: command.objectId, materialId: command.materialId, materialVersion: command.materialVersion });
    }
    next.materials.sort((a, b) => a.objectId.localeCompare(b.objectId));
  }
  validateStyle(base, objects, next);
  if (!styleChanges(current, next).length) throw new DomainError('NO_CHANGE', '视觉风格没有变化。');
  return next;
}
