import type { Finish, StoneSpec, SurfaceDesign, Tiling, TilePattern } from '../../contracts/src/finishes';
import { surfaceDesignSchema } from '../../contracts/src/finishes';
import { canonical, inspectSurfaceDesign, stoneKey } from '../../finishes/src/plan';
import type { FinishFacts } from '../../finishes/src/surfaces';

// Rule-based scheme generation (no generative AI). Three moods, each a different stone, size and pattern, applied to
// the requested finishes. A tiling that the layout engine rejects falls back to a straight lay of the same stone;
// a scheme that still conflicts is kept but marked, so the request waits for member review.

export type GeneratedScheme = { name: string; summary: string; design: SurfaceDesign; adoptable: boolean; issues: { code: string; objectId: string; message: string }[] };
type Mood = { name: string; summary: string; floor: { size: [number, number]; pattern: TilePattern; border: boolean }[]; wall: [number, number]; joint: number };
const moods: Mood[] = [
  { name: '留白', summary: '大板直铺，深色波打线收边', floor: [{ size: [1.2, 1.2], pattern: 'straight', border: true }, { size: [.8, .8], pattern: 'straight', border: true }], wall: [1.2, .6], joint: .0015 },
  { name: '暖调', summary: '方砖斜铺，柔和过渡', floor: [{ size: [.8, .8], pattern: 'diagonal', border: false }, { size: [.6, .6], pattern: 'diagonal', border: false }], wall: [.9, .6], joint: .002 },
  { name: '肌理', summary: '条板人字铺，纹理有方向感', floor: [{ size: [.6, .2], pattern: 'herringbone', border: false }, { size: [.6, .3], pattern: 'herringbone', border: false }, { size: [1.2, .3], pattern: 'running-bond', border: false }], wall: [1.2, .3], joint: .002 },
];
const fits = (stone: StoneSpec, [length, width]: [number, number]) =>
  length >= stone.sizes.length.min && length <= stone.sizes.length.max && width >= stone.sizes.width.min && width <= stone.sizes.width.max;
const brightness = (stone: StoneSpec) => { const hex = stone.texture.base.slice(1); return [0, 2, 4].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0); };
const jointColor = (stone: StoneSpec) => stone.texture.cloud;

function tilingFor(finish: Finish, stone: StoneSpec, mood: Mood, border: StoneSpec | undefined): Tiling | null {
  const ref = { finishId: finish.id, stoneId: stone.id, stoneVersion: stone.version, joint: { width: mood.joint, color: jointColor(stone) }, origin: 'center' as const, angle: 0 };
  if (finish.kind === 'stair') {
    const size: [number, number] = fits(stone, [1.2, .4]) ? [1.2, .4] : [stone.sizes.length.max, Math.min(.4, stone.sizes.width.max)];
    return { ...ref, origin: 'edge', tile: { length: size[0], width: size[1] }, pattern: 'straight' };
  }
  if (finish.kind === 'wall') {
    const size = fits(stone, mood.wall) ? mood.wall : ([[1.2, .6], [.6, .3]] as [number, number][]).find(s => fits(stone, s));
    return size ? { ...ref, tile: { length: size[0], width: size[1] }, pattern: 'running-bond' } : null;
  }
  const option = mood.floor.find(item => fits(stone, item.size));
  if (!option) return null;
  return { ...ref, tile: { length: option.size[0], width: option.size[1] }, pattern: option.pattern,
    ...(option.border && border && border.id !== stone.id ? { border: { stoneId: border.id, stoneVersion: border.version, width: .18, pieceLength: .6 } } : {}) };
}
function design(tilings: Tiling[], stones: StoneSpec[]): SurfaceDesign {
  const used = new Set(tilings.flatMap(t => [stoneKey(t), ...t.border ? [stoneKey(t.border)] : []]));
  return surfaceDesignSchema.parse({ version: 1, tilings: [...tilings].sort((a, b) => a.finishId.localeCompare(b.finishId)),
    stones: stones.filter(stone => used.has(stoneKey({ stoneId: stone.id, stoneVersion: stone.version }))).sort((a, b) => a.id.localeCompare(b.id)) });
}

/**
 * `preferred` are the customer's stones in order (at least one); `catalog` supplies a border stone. Schemes differ in
 * stone, size or pattern by construction; identical schemes are dropped, so fewer than three may come back.
 */
export function generateSchemes(facts: FinishFacts, finishIds: string[], preferred: StoneSpec[], catalog: StoneSpec[]): GeneratedScheme[] {
  const finishes = finishIds.map(id => facts.finishes?.find(finish => finish.id === id)).filter((f): f is Finish => !!f);
  if (!finishes.length || !preferred.length) return [];
  // Border: the darkest catalog stone, framing light floors.
  const border = [...catalog].sort((a, b) => brightness(a) - brightness(b))[0];
  const lookup = (all: StoneSpec[]) => (ref: { stoneId: string; stoneVersion: number }) => {
    const spec = all.find(stone => stone.id === ref.stoneId && stone.version === ref.stoneVersion);
    return spec ? { status: 'active' as const, spec } : undefined;
  };
  const all = [...new Map([...preferred, ...catalog].map(stone => [stoneKey({ stoneId: stone.id, stoneVersion: stone.version }), stone])).values()];
  const schemes: GeneratedScheme[] = [], seen = new Set<string>();
  moods.forEach((mood, index) => {
    const stone = preferred[index % preferred.length], tilings: Tiling[] = [];
    for (const finish of finishes) {
      let tiling = tilingFor(finish, stone, mood, border);
      if (!tiling) continue;
      // Fall back to a straight lay when the engine rejects this finish's pattern (e.g. a border wider than the room).
      const single = inspectSurfaceDesign(facts, design([tiling], all), lookup(all));
      if (!single.adoptable && finish.kind === 'floor') {
        const fallback = mood.floor.map(f => f.size).find(size => fits(stone, size)) ?? [stone.sizes.length.max, stone.sizes.width.max] as [number, number];
        tiling = { ...tiling, pattern: 'straight', tile: { length: fallback[0], width: fallback[1] }, border: undefined };
        delete tiling.border;
      }
      tilings.push(tiling);
    }
    if (!tilings.length) return;
    const result = design(tilings, all), report = inspectSurfaceDesign(facts, result, lookup(all)), key = canonical(result.tilings.map(({ finishId: _f, ...t }) => t));
    if (seen.has(key)) return;
    seen.add(key);
    schemes.push({ name: mood.name, summary: `${stone.name.replace(/（示意）$/, '')} · ${mood.summary}`, design: result, adoptable: report.adoptable,
      issues: report.issues.map(issue => ({ code: issue.code, objectId: issue.objectId, message: issue.message })) });
  });
  return schemes;
}
