// D03 headless render check: whole building, each storey and a cutaway of the demo villa, plus an unchanged
// single-storey render. Images go to .impeccable/review/d03/ (ignored) for manual review.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { renderSnapshotToPng, sceneDocument } from '../../packages/scene-runtime/src/render';
import { courtyard } from '../../packages/scene-runtime/src/fixtures';
import { convertHouseSpecBuilding, buildingCandidateToScene } from '../../packages/floorplan-import/src/building';
import type { SceneView } from '../../packages/contracts/src/building';
import { labelPng } from '../../packages/renders/src/image';

const directory = path.resolve('.impeccable/review/d03');
await mkdir(directory, { recursive: true });
const source = JSON.parse(await readFile('packages/floorplan-import/fixtures/demo-villa.housespec.json', 'utf8'));
const candidate = convertHouseSpecBuilding(source, { sourceId: 'demo-villa', sourceFormat: 'housespec-mm-v1', scaleEvidence: { status: 'estimated' } });
const scene = buildingCandidateToScene(candidate, '演示别墅 · 三层（演示数据，示意尺寸）', true);
const views: [string, SceneView][] = [['building', { mode: 'building' }],
  ...scene.levels!.map((level, i) => [`level-${i + 1}`, { mode: 'level', levelId: level.id }] as [string, SceneView]),
  ['section-2', { mode: 'section', levelId: scene.levels![1].id }]];
// Background render path with the official canvas launch flags; the labelled artifact mirrors renderArtifact.
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
const records: object[] = [];
try {
  for (const [name, view] of views) {
    const raw = path.join(directory, `${name}.raw.png`), output = path.join(directory, `${name}.png`);
    await renderSnapshotToPng(scene, raw, browser, view);
    await writeFile(output, await labelPng(await readFile(raw), scene.label, `视图：${name} · 改编自 house-plan-designer（MIT）`));
    records.push({ name, view, output });
  }
  // Interactive adapter: switching views keeps the same loaded data and changes what is shown.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent(await sceneDocument(scene, true), { waitUntil: 'load' });
  await page.waitForSelector('html[data-scene-ready="true"]');
  // String evaluation avoids tsx helper names leaking into the page context.
  const shown = await page.evaluate(`(() => {
    const view = window.sceneInspection.view, counts = [];
    for (const next of [null, { mode: 'level', levelId: ${JSON.stringify(scene.levels![0].id)} }, { mode: 'building' }]) {
      if (next) view.setView(next);
      let n = 0; view.scene.traverse(o => { if (o.isMesh) n++; }); counts.push(n);
    }
    return { whole: counts[0], single: counts[1], back: counts[2] };
  })()`) as { whole: number; single: number; back: number };
  assert.ok(shown.single < shown.whole && shown.back === shown.whole); assert.deepEqual(errors, []);
  await page.close();
  const single = path.join(directory, 'single-storey-courtyard.png');
  await renderSnapshotToPng(courtyard, single, browser);
  records.push({ name: 'single-storey-courtyard', output: single, interactiveMeshCounts: shown });
  await writeFile(path.join(directory, 'results.json'), JSON.stringify({ date: new Date().toISOString(), browser: await browser.version(), records }, null, 2));
  console.log(JSON.stringify(records, null, 2));
} finally { await browser.close(); }
