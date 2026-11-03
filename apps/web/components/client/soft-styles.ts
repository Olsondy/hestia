'use client';
// 软装风格（演示数据）。服务端尚无软装风格（K02），H5 先用这份固定数据展示与切换，选择只保存在本机，
// 不重新出图；界面就近标注「演示」。K02 完成后由 H02 把 softStyleStore 换成服务端接口，组件不变。
import { useCallback, useEffect, useState } from 'react';

export type SoftStyle = { id: string; name: string; line: string; palette: string[] };
export const softStyles: SoftStyle[] = [
  { id: 'modern', name: '现代简约', line: '布艺 L 型沙发、岩板圆几、灰调地毯、线性吊灯', palette: ['#d8d3cb', '#2f2c2a', '#b49c86', '#c7c0b6'] },
  { id: 'luxury', name: '轻奢', line: '弧形丝绒沙发、大理石金属茶几、浅色长毛地毯', palette: ['#ece2d3', '#b08d57', '#3b3230', '#ddd1bf'] },
  { id: 'chinese', name: '新中式', line: '实木圈椅、长条茶几、屏风、暖色地毯', palette: ['#e4d9c6', '#4f3324', '#6f4630', '#b39a79'] },
];
export const softById = Object.fromEntries(softStyles.map(style => [style.id, style])) as Record<string, SoftStyle>;
/** Default style of a scheme: A 现代简约、B 轻奢、C 新中式, the same order as the prototype. */
export const defaultSoft = (ordinal: number) => softStyles[(ordinal - 1) % softStyles.length].id;

/** Reserved interface for the scheme's soft style; local storage until the server supports it (K02 / H02). */
export const softStyleStore = {
  get(requestId: string, schemeId: string, ordinal: number): string {
    if (typeof window === 'undefined') return defaultSoft(ordinal);
    try { return localStorage.getItem(`hestia.client.soft.${requestId}.${schemeId}`) ?? defaultSoft(ordinal); } catch { return defaultSoft(ordinal); }
  },
  set(requestId: string, schemeId: string, styleId: string) {
    try { localStorage.setItem(`hestia.client.soft.${requestId}.${schemeId}`, styleId); } catch { /* memory only */ }
    window.dispatchEvent(new Event('hestia:soft'));
  },
};
export function useSoftStyle(requestId: string, scheme: { id: string; ordinal: number } | undefined) {
  const read = useCallback(() => scheme ? softStyleStore.get(requestId, scheme.id, scheme.ordinal) : softStyles[0].id, [requestId, scheme]);
  const [value, setValue] = useState(read);
  useEffect(() => { setValue(read()); const on = () => setValue(read()); window.addEventListener('hestia:soft', on); return () => window.removeEventListener('hestia:soft', on); }, [read]);
  return softById[value] ?? softStyles[0];
}
