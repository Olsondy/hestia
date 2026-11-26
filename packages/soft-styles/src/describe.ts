import { roomTypeNames, roomTypes, type SoftStyle } from '../../contracts/src/soft-styles';
import type { SoftStyleRoomView } from '../../contracts/src/finish-requests';

// 软装风格的成员目录描述（W05）：按房间类型说明换款与补充陈设。家具键名只在这里译成中文，未登记的键按原样显示。
const furnitureNames: Record<string, string> = {
  sofa: '沙发', lSofa: 'L 型沙发', curvedSofa: '弧形沙发', armchair: '单椅', lounge: '休闲椅', ringChair: '圈椅', chair: '餐椅',
  coffeeTable: '茶几', roundCoffeeTable: '圆几', teaTable: '长条茶几', longTable: '长餐桌', ovalTable: '椭圆餐桌',
  bed: '床', nightstand: '床头柜', floorLamp: '落地灯', bigPlant: '绿植', wallArt: '挂画', pendantLamp: '线性吊灯',
  chandelier: '吊灯', lantern: '宫灯', screen: '屏风',
};
const nameOf = (key: string) => furnitureNames[key] ?? key;

/** One line per room type that the style changes, e.g.「茶几换圆几；添落地灯 ×2、挂画」. */
export function describeSoftStyle(style: SoftStyle): SoftStyleRoomView[] {
  return roomTypes.flatMap(type => {
    const bySource = new Map<string, string[]>();
    for (const [from, to] of Object.entries(style.swap[type] ?? {})) bySource.set(to, [...(bySource.get(to) ?? []), nameOf(from)]);
    const swaps = [...bySource].map(([to, from]) => `${from.join('、')}换${nameOf(to)}`);
    const counts = new Map<string, number>();
    for (const extra of style.extras[type] ?? []) counts.set(extra.key, (counts.get(extra.key) ?? 0) + 1);
    const extras = [...counts].map(([key, n]) => `${nameOf(key)}${n > 1 ? ` ×${n}` : ''}`);
    const parts = [...swaps, ...(extras.length ? [`添${extras.join('、')}`] : [])];
    return parts.length ? [{ type, name: roomTypeNames[type], summary: parts.join('；') }] : [];
  });
}
