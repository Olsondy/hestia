import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test',
  'packages/scene-runtime/src/scene.test.ts',
  'packages/model-validation/src/restricted-turn.test.ts',
  'packages/floorplan-import/src/house-spec.test.ts',
  'packages/geometry/src/placement.test.ts',
  'packages/catalog/src/catalog.test.ts',
  'packages/layout-planner/src/planner.test.ts',
  'packages/tasks/src/budget.unit.test.ts',
  'packages/conversation/src/layout-decision.test.ts',
  'packages/conversation/src/profile.test.ts',
], { stdio: 'inherit' });
process.exit(result.status ?? 1);
