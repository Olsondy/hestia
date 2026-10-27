import type { CatalogAsset, CatalogMaterial, CatalogReference, CatalogSize, CatalogView } from '../../contracts/src/catalog';
import { catalogReferenceSchema, catalogSizeSchema } from '../../contracts/src/catalog';
import { DomainError } from '../../contracts/src/project';

// Versioned, in-repository procedural assets, not vendor products or measured household possessions.
const sourcePath = 'example/prototypes/projects/src/sample/model.js';
const stylePath = 'example/prototypes/projects/src/sample/soft-styles.js';
const materials: CatalogMaterial[] = [
  { id: 'prototype-wood', version: 1, name: '浅木与棉麻', swatch: '#d8d8c8', source: { path: stylePath, styleId: 'wood' }, colors: { oak: '#fff0d4', walnut: '#e6cfaa', fabric: '#d8d8c8', linen: '#fff7e7', green: '#9eab91', rug: '#d5c4a8', leather: '#8b9584', brass: '#ad976e' } },
  { id: 'prototype-cream', version: 1, name: '奶油与燕麦', swatch: '#fff5e7', source: { path: stylePath, styleId: 'cream' }, colors: { oak: '#f0e6d7', walnut: '#dfd0ba', fabric: '#fff5e7', linen: '#fffaf1', green: '#dfcdb4', rug: '#eee4d5', leather: '#cec2ae', brass: '#c0ab86' } },
  { id: 'prototype-chinese', version: 1, name: '深木与亚麻', swatch: '#e2dbca', source: { path: stylePath, styleId: 'chinese' }, colors: { oak: '#af8a67', walnut: '#9f7957', fabric: '#e2dbca', linen: '#f1e6d2', green: '#718b83', rug: '#d4c3a5', leather: '#6f7d73', brass: '#a58b5c' } },
];
function asset(id: string, name: string, category: CatalogAsset['category'], itemId: string, defaultSize: CatalogSize, width: [number, number, number], depth: [number, number, number]): CatalogAsset {
  return { id, version: 1, name, category, defaultSize,
    sizeRange: { width: { min: width[0], max: width[1], step: width[2] }, depth: { min: depth[0], max: depth[1], step: depth[2] }, height: { min: defaultSize.height, max: defaultSize.height, step: .001 } },
    materialIds: materials.map(m => m.id), defaultMaterialId: 'prototype-wood',
    source: { kind: 'builtin-prototype', path: sourcePath, itemId, dimensionBasis: 'synthetic-template', note: '复用原型程序模型；默认宽深来自原型标称尺寸，高度包含可见部件的模板包络。范围为应用允许的选型参数，非厂商规格或实测尺寸。' } };
}
const assets: CatalogAsset[] = [
  asset('prototype-sofa', '三人位织物沙发', 'sofa', 'sofa', { width: 2.2, depth: .95, height: 1.11 }, [1.9, 2.6, .1], [.85, 1.1, .05]),
  asset('prototype-coffee-table', '圆角木质茶几', 'table', 'coffee-table', { width: .9, depth: .55, height: .55 }, [.7, 1.2, .1], [.45, .75, .05]),
  asset('prototype-reading-chair', '木扶手休闲椅', 'chair', 'reading-chair', { width: .72, depth: .8, height: 1.09 }, [.62, .82, .05], [.7, .9, .05]),
  asset('prototype-study-desk', '木质工作桌', 'desk', 'study-desk', { width: 1.4, depth: .6, height: 1.26 }, [1.2, 1.8, .1], [.5, .8, .05]),
];
export function getCatalog(): CatalogView { return structuredClone({ version: 1, assets, materials }); }
export function resolveCatalog(reference: CatalogReference, size: CatalogSize) {
  const ref = catalogReferenceSchema.parse(reference), dimensions = catalogSizeSchema.parse(size);
  const asset = assets.find(item => item.id === ref.assetId && item.version === ref.assetVersion);
  if (!asset) throw new DomainError('CATALOG_ASSET_UNKNOWN', '此家具资产或版本不在当前受控目录中。');
  const material = materials.find(item => item.id === ref.materialId && item.version === ref.materialVersion);
  if (!material || !asset.materialIds.includes(ref.materialId)) throw new DomainError('CATALOG_MATERIAL_UNKNOWN', '此材质或版本不可用于所选家具。');
  for (const axis of ['width', 'depth', 'height'] as const) {
    const rule = asset.sizeRange[axis], steps = (dimensions[axis] - rule.min) / rule.step;
    if (dimensions[axis] < rule.min - 1e-8 || dimensions[axis] > rule.max + 1e-8 || Math.abs(steps - Math.round(steps)) > 1e-7)
      throw new DomainError('CATALOG_SIZE_REJECTED', '尺寸超出该目录版本允许的范围或步进。', 400, { axis, allowed: rule });
  }
  return { asset, material, size: dimensions, reference: ref };
}
