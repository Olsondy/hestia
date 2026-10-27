import type { DisplayLightPreset, StyleCatalog } from '../../contracts/src/styles';
import { getCatalog } from '../../catalog/src/catalog';
import { DomainError } from '../../contracts/src/project';

// Display illumination only. These values are not electrical design or a sun/daylight simulation.
const lighting: DisplayLightPreset[] = [
  { id: 'display-warm', version: 1, name: '暖纸柔光', description: '暖色环境光与柔和主光，沿用当前空间默认展示。',
    hemisphere: { sky: '#fff8eb', ground: '#a6a6a0', intensity: 2.4 }, directional: { color: '#fff2db', intensity: 3.2, position: [4, 16, 10] }, exposure: 1 },
  { id: 'display-neutral', version: 1, name: '中性明光', description: '中性色展示照明，便于比较材质。',
    hemisphere: { sky: '#ffffff', ground: '#aaa9a6', intensity: 2.4 }, directional: { color: '#ffffff', intensity: 3.2, position: [4, 16, 10] }, exposure: 1 },
  { id: 'display-soft', version: 1, name: '静谧柔光', description: '降低主光对比的暖色展示照明。',
    hemisphere: { sky: '#fff5e9', ground: '#a6a29b', intensity: 2.1 }, directional: { color: '#ffe7cd', intensity: 1.7, position: [-4, 12, 8] }, exposure: 1 },
];
export function getStyleCatalog(): StyleCatalog { return { version: 1, materials: getCatalog().materials, lighting: structuredClone(lighting) }; }
export function resolveMaterial(id: string, version: number) {
  const material = getCatalog().materials.find(item => item.id === id && item.version === version);
  if (!material) throw new DomainError('STYLE_MATERIAL_UNKNOWN', '此材质或版本不在受控目录中。');
  return material;
}
export function resolveLighting(id: string, version: number) {
  const preset = lighting.find(item => item.id === id && item.version === version);
  if (!preset) throw new DomainError('STYLE_LIGHTING_UNKNOWN', '此展示灯光或版本不在受控目录中。');
  return structuredClone(preset);
}
