/** Pure metadata formatting: safe to import in API routes without a renderer/browser dependency. */
export function artifactLabel(source: { kind: string; revision: number }, scale: string, synthetic: boolean) {
  const kind = source.kind === 'candidate' ? '候选方案 · 未采用' : '当前方案快照';
  const state = !['calibrated', 'synthetic'].includes(scale) ? `概念草稿 · 尺寸未校准${synthetic ? ' · 合成示例' : ''}` : synthetic ? '合成示例 · 非实测住宅' : '已校准尺寸 · 设计参考';
  return `${kind} · 版本 ${source.revision}　|　${state}`;
}
