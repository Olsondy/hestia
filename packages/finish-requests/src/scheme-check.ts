import { surfaceDesignSchema, type StoneSpec, type SurfaceDesign, type Tiling } from '../../contracts/src/finishes';
import type { SpatialState } from '../../contracts/src/project';
import type { SoftStyle, SoftStyleReference } from '../../contracts/src/soft-styles';
import type { SchemeCandidateIssue, SchemeDecision } from '../../contracts/src/agent-schemes';
import { inspectSurfaceDesign, stoneKey, type CatalogStatus } from '../../finishes/src/plan';
import { furnish } from '../../soft-styles/src/furnish';

// K03 (ADR-0019): pure check of an Agent whole-scheme proposal against a space and the enterprise's active catalogs.
// No database access, so it is unit-tested with the demo villa.

type Resolved = { design: SurfaceDesign; style: SoftStyle; choices: SoftStyleReference[]; issues: SchemeCandidateIssue[] };
export const lookupOf = (stones: StoneSpec[]) => (ref: { stoneId: string; stoneVersion: number }): CatalogStatus => {
  const spec = stones.find(stone => stone.id === ref.stoneId && stone.version === ref.stoneVersion);
  return spec ? { status: 'active', spec } : undefined;
};

/**
 * Pure check of a proposal against the space and the enterprise's active catalogs. Unknown finishes, stones or styles
 * and borders on walls or stairs are conflicts; so is any tiling the layout engine rejects (size range, pattern fit).
 */
export function resolveScheme(state: Pick<SpatialState, 'fixedFacts' | 'currentLayout'>, decision: SchemeDecision, stones: StoneSpec[], styles: SoftStyle[], requestedIds: string[]): Resolved | { issues: SchemeCandidateIssue[] } {
  const facts = state.fixedFacts, issues: SchemeCandidateIssue[] = [], seen = new Set<string>(), tilings: Tiling[] = [];
  const conflict = (code: string, message: string, objectId?: string) => issues.push({ code, message, severity: 'conflict', ...(objectId ? { objectId } : {}) });
  const stone = (id: string, role: string) => {
    const found = stones.find(item => item.id === id);
    if (!found) conflict('STONE_NOT_IN_CATALOG', `${role}「${id}」不在本企业在用的石材目录里。`);
    return found;
  };
  for (const group of decision.tilings) {
    const field = stone(group.stoneId, '石材'), border = group.border ? stone(group.border.stoneId, '波打线石材') : undefined;
    const length = Math.max(group.tile.lengthMm, group.tile.widthMm) / 1000, width = Math.min(group.tile.lengthMm, group.tile.widthMm) / 1000;
    for (const finishId of group.finishIds) {
      const finish = facts.finishes?.find(item => item.id === finishId);
      if (!finish) { conflict('FINISH_NOT_IN_SPACE', `饰面「${finishId}」不属于这个空间。`, finishId); continue; }
      if (seen.has(finishId)) { conflict('FINISH_DUPLICATE', `饰面「${finish.name ?? finishId}」被指定了两种铺贴。`, finishId); continue; }
      seen.add(finishId);
      if (group.border && finish.kind !== 'floor') { conflict('BORDER_FLOOR_ONLY', `波打线只能用于地面，「${finish.name ?? finishId}」不是地面。`, finishId); continue; }
      if (!field || (group.border && !border)) continue;
      tilings.push({ finishId, stoneId: field.id, stoneVersion: field.version, tile: { length, width }, pattern: group.pattern,
        joint: { width: .002, color: field.texture.cloud }, origin: finish.kind === 'stair' ? 'edge' : 'center', angle: 0,
        ...(border ? { border: { stoneId: border.id, stoneVersion: border.version, width: group.border!.widthMm / 1000, pieceLength: .6 } } : {}) });
    }
  }
  const style = styles.find(item => item.id === decision.softStyleId);
  if (!style) conflict('SOFT_STYLE_NOT_IN_CATALOG', `软装风格「${decision.softStyleId}」不在本企业在用的软装风格里。`);
  const choiceIds = [...new Set([decision.softStyleId, ...decision.softChoices])].slice(0, 3), choices: SoftStyleReference[] = [];
  for (const id of choiceIds) {
    const choice = styles.find(item => item.id === id);
    if (!choice) { if (id !== decision.softStyleId) conflict('SOFT_STYLE_NOT_IN_CATALOG', `可切换的软装风格「${id}」不在本企业在用的软装风格里。`); continue; }
    choices.push({ styleId: choice.id, styleVersion: choice.version });
  }
  if (issues.length || !style) return { issues };
  const used = new Set(tilings.flatMap(t => [stoneKey(t), ...t.border ? [stoneKey(t.border)] : []]));
  const design = surfaceDesignSchema.parse({ version: 1, tilings: [...tilings].sort((a, b) => a.finishId.localeCompare(b.finishId)),
    stones: stones.filter(item => used.has(stoneKey({ stoneId: item.id, stoneVersion: item.version }))).sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`)) });
  for (const issue of inspectSurfaceDesign(facts, design, lookupOf(stones)).issues)
    issues.push({ code: issue.code, objectId: issue.objectId, message: `${facts.finishes?.find(f => f.id === issue.objectId)?.name ?? issue.objectId}：${issue.message}`, severity: issue.severity });
  const missing = requestedIds.filter(id => !seen.has(id)).map(id => facts.finishes?.find(f => f.id === id)?.name ?? id);
  if (missing.length) issues.push({ code: 'FINISH_NOT_COVERED', severity: 'hint', message: `客户需求里的${missing.join('、')}没有铺贴。` });
  // Furnishing per level and room type (K01); extras that do not fit are hints, the furniture itself stays in place.
  const { skipped } = furnish({ rooms: facts.rooms, walls: facts.walls, levels: facts.levels, stairs: facts.stairs,
    objects: [...facts.objects, ...state.currentLayout.objects] }, style);
  for (const item of skipped) issues.push({ code: 'SOFT_EXTRA_SKIPPED', severity: 'hint', objectId: item.roomId,
    message: `${facts.rooms.find(room => room.id === item.roomId)?.name ?? item.roomId}放不下 ${item.key}：${item.reason}` });
  return { design, style, choices, issues };
}

