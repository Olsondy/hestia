// 软装风格（H02，接 K02）：方案的当前风格与可选风格都来自服务端；切换在调整页累积，与硬装修改一起统一出图。
import type { FinishSchemeView, SoftStyleSummary } from '../../../../packages/contracts/src/finish-requests';

export type SoftStyle = SoftStyleSummary;
export const styleKey = (style: { id: string; version: number }) => `${style.id}@${style.version}`;
/** The scheme's soft style, or null for schemes made before soft styles (the UI then shows hard finishes only). */
export const softOf = (scheme: FinishSchemeView | undefined): SoftStyle | null => scheme?.softStyle ?? null;
