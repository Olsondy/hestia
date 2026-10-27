import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { sceneDocument, renderSnapshotToPng } from '../../packages/scene-runtime/src/render';
import { syntheticScenes } from '../../packages/scene-runtime/src/fixtures';

const directory = path.resolve('.tmp/validation/t03');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const records: object[] = [];
try {
  for (const [index, snapshot] of syntheticScenes.entries()) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent(await sceneDocument(snapshot, true), { waitUntil: 'load' });
    await page.waitForSelector('html[data-scene-ready="true"]');
    const id = snapshot.objects[0].id;
    const projection = await page.evaluate(id => (window as any).sceneInspection.view.project(id), id);
    const canvas = await page.locator('canvas').boundingBox();
    assert.ok(canvas);
    await page.mouse.click(canvas.x + projection.x, canvas.y + projection.y);
    assert.equal(await page.locator('#selection').textContent(), id);
    const before = await page.evaluate(() => (window as any).sceneInspection.view.getCamera());
    const x = snapshot.objects[0].position.x + .2;
    const after = await page.evaluate(({ id, x }) => {
      const view = (window as any).sceneInspection.view;
      const previousNode = view.getObject(id);
      view.updateObject(id, { x });
      const result = { sameNode: previousNode === view.getObject(id), snapshot: view.getSnapshot(), camera: view.getCamera() };
      view.load(result.snapshot, true);
      return { ...result, comparisonCamera: view.getCamera() };
    }, { id, x });
    assert.equal(after.sameNode, true);
    assert.equal(after.snapshot.objects[0].position.x, x);
    assert.deepEqual(after.camera, before); assert.deepEqual(after.comparisonCamera, before);
    const file = path.join(directory, `interactive-${index + 1}.png`);
    await page.screenshot({ path: file });
    await page.close();
    // A fresh page is created after the interactive session was closed.
    const output = path.join(directory, `headless-${index + 1}.png`);
    await renderSnapshotToPng(after.snapshot, output, browser);
    assert.deepEqual(errors, []);
    records.push({ label: snapshot.label, selectedId: id, updatedX: x, cameraPreserved: true, headlessOutput: output, pageErrors: errors });
  }
  await writeFile(path.join(directory, 'results.json'), JSON.stringify({ date: new Date().toISOString(), browser: await browser.version(), records }, null, 2));
  console.log(JSON.stringify(records, null, 2));
} finally { await browser.close(); }
