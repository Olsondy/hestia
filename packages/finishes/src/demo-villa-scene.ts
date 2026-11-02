import { readFileSync } from 'node:fs';
import { sceneSnapshotSchema, type SceneSnapshot } from '../../contracts/src/scene';
import { convertHouseSpecBuilding, buildingCandidateToScene } from '../../floorplan-import/src/building';
import { demoVillaDesign, demoVillaFinishes } from './demo-villa';

/** Demo villa preview scene (demo data, illustrative sizes) with demo finishes and the example surface design. */
export function demoVillaScene(label = '演示别墅（演示数据，示意尺寸，示意素材）'): SceneSnapshot {
  const source = JSON.parse(readFileSync(new URL('../../floorplan-import/fixtures/demo-villa.housespec.json', import.meta.url), 'utf8'));
  const candidate = convertHouseSpecBuilding(source, { sourceId: 'demo-villa', sourceFormat: 'housespec-mm-v1', scaleEvidence: { status: 'estimated' } });
  return sceneSnapshotSchema.parse({ ...buildingCandidateToScene(candidate, label, true), finishes: demoVillaFinishes, surfaceDesign: demoVillaDesign() });
}
