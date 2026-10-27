import type { SceneSnapshot } from '../../contracts/src/scene';
import type { CatalogReference, CatalogSize } from '../../contracts/src/catalog';
import type { FurniturePose } from '../../contracts/src/commands';
import { resolveCatalog } from './catalog';

export function catalogInstance(id: string, reference: CatalogReference, size: CatalogSize, pose: FurniturePose): SceneSnapshot['objects'][number] {
  const { asset, material, size: allowed, reference: ref } = resolveCatalog(reference, size);
  return { id, kind: 'furniture', name: asset.name, position: { x: pose.x, y: 0, z: pose.z }, size: allowed, yaw: pose.yaw,
    color: asset.category === 'table' || asset.category === 'desk' ? material.colors.oak : material.colors.fabric,
    catalog: ref, dimensionSource: 'catalog' };
}
