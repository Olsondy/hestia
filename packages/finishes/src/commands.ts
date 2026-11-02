import { DomainError } from '../../contracts/src/project';
import { emptySurfaceDesign, surfaceDesignSchema, type SurfaceDesign, type TilingChange, type TilingCommand } from '../../contracts/src/finishes';
import { activeStone, type StoneCatalog } from './catalog';
import { canonical, stoneKey } from './plan';

/** Applies a surface-design command. Stones are resolved from the active workspace catalog and embedded. */
export function applyTilingCommand(finishes: { id: string }[] | undefined, design: SurfaceDesign | undefined, command: TilingCommand, catalog: StoneCatalog): SurfaceDesign {
  const before = design ?? emptySurfaceDesign();
  if (!finishes?.some(finish => finish.id === command.finishId)) throw new DomainError('TILING_UNKNOWN_FINISH', '饰面不存在。', 404);
  let tilings = before.tilings.filter(tiling => tiling.finishId !== command.finishId);
  if (command.type === 'clear-tiling') {
    if (tilings.length === before.tilings.length) throw new DomainError('NO_CHANGE', '该饰面没有铺贴方案。');
  } else {
    const { type: _type, ...tiling } = command;
    const previous = before.tilings.find(item => item.finishId === command.finishId);
    if (previous && canonical(previous) === canonical(tiling)) throw new DomainError('NO_CHANGE', '铺贴方案没有变化。');
    tilings = [...tilings, tiling];
  }
  // The changed tiling takes active catalog versions; inherited tilings keep their embedded copies.
  const fresh = command.type === 'set-tiling' ? new Set([command, ...command.border ? [command.border] : []].map(stoneKey)) : new Set<string>();
  const refs = new Map(tilings.flatMap(t => [t, ...t.border ? [t.border] : []]).map(ref => [stoneKey(ref), ref]));
  const embedded = (key: string) => before.stones.find(stone => stoneKey({ stoneId: stone.id, stoneVersion: stone.version }) === key);
  const stones = [...refs].map(([key, ref]) => fresh.has(key) ? activeStone(catalog, ref) : embedded(key) ?? activeStone(catalog, ref))
    .sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`));
  return surfaceDesignSchema.parse({ version: 1, stones,
    tilings: tilings.sort((a, b) => a.finishId.localeCompare(b.finishId)) });
}
export function tilingChanges(before: SurfaceDesign | undefined, after: SurfaceDesign | undefined): TilingChange[] {
  const ids = new Set([...before?.tilings ?? [], ...after?.tilings ?? []].map(t => t.finishId)), changes: TilingChange[] = [];
  for (const finishId of [...ids].sort()) {
    const a = before?.tilings.find(t => t.finishId === finishId) ?? null, b = after?.tilings.find(t => t.finishId === finishId) ?? null;
    if (canonical(a) !== canonical(b)) changes.push({ finishId, before: a, after: b });
  }
  return changes;
}
