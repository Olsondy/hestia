import { z } from 'zod';

// 软装风格（K01，ADR-0008）：企业工作空间目录中的一套软装搭配，版本不可变。按房间类型给出家具换款（在原家具占地内
// 换成本风格的款式）与补充陈设（落地灯、绿植、挂画、吊灯等），以及布艺、木色、金属与点缀的配色。
// 家具都是 scene-runtime 程序生成的示意素材，不含真实品牌。

export const roomTypes = ['living', 'dining', 'bedroom', 'tea', 'study'] as const;
export type RoomType = (typeof roomTypes)[number];
export const roomTypeNames: Record<RoomType, string> = { living: '客厅', dining: '餐厅', bedroom: '卧室', tea: '茶室', study: '书房' };
/** Room types of a room from its name; a combined room (「餐厅 · 客厅」) has several. */
export function roomTypesOf(name: string | undefined): RoomType[] {
  const n = name ?? '';
  return [
    ...(/客厅|家庭厅|休闲厅|起居/.test(n) ? ['living' as const] : []),
    ...(/餐厅/.test(n) ? ['dining' as const] : []),
    ...(/卧|老人房|儿童房/.test(n) ? ['bedroom' as const] : []),
    ...(/茶室/.test(n) ? ['tea' as const] : []),
    ...(/书房/.test(n) ? ['study' as const] : []),
  ];
}

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,40}$/);
/** Material tones a style gives its furniture; the renderer uses them instead of the neutral defaults. */
export const furnitureTonesSchema = z.object({ fabric: hex, cushion: hex, wood: hex, darkWood: hex, metal: hex, accent: hex }).strict();
export type FurnitureTones = z.infer<typeof furnitureTonesSchema>;
const size = z.number().positive().max(6);
/**
 * Extra piece placed by rule: `beside` an anchor (left or right of it), on the `wall` behind an anchor (wall art),
 * `above` an anchor (pendant), or in a free room `corner` (plants). Anchors are furniture keys in the same room.
 */
export const softExtraSchema = z.object({ key, width: size, depth: size, height: size,
  place: z.enum(['beside', 'wall', 'above', 'corner']), anchor: key.optional() }).strict()
  .refine(extra => extra.place === 'corner' || !!extra.anchor, { message: 'Anchor required' });
export const softStyleSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/), version: z.number().int().positive(),
  name: z.string().trim().min(1).max(40), line: z.string().trim().min(1).max(120),
  /** Four swatches for catalogue cards and the H5 style picker. */
  palette: z.array(hex).min(3).max(6),
  tones: furnitureTonesSchema,
  /** Per room type: furniture key in the scene → this style's key, placed in the same footprint. */
  swap: z.record(z.enum(roomTypes), z.record(key, key)),
  extras: z.record(z.enum(roomTypes), z.array(softExtraSchema).max(12)),
}).strict();
export type SoftStyle = z.infer<typeof softStyleSchema>;
export type SoftExtra = z.infer<typeof softExtraSchema>;
export type SoftStyleReference = { styleId: string; styleVersion: number };
