import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { sceneDocument } from '../../packages/scene-runtime/src/render';
import { sceneSnapshotSchema } from '../../packages/scene-runtime/src/snapshot';

// Offline inspection of the exact saved live-model candidate. No DB, HTTP or model calls.
const directory = new URL('../../.impeccable/review/t17-t21/', import.meta.url);
const sourceUrl = new URL('layout-live-resume-20261027.json', directory);
const sourceBytes = await readFile(sourceUrl), evidence = JSON.parse(sourceBytes.toString('utf8'));
assert.equal(evidence.passed, true); assert.equal(evidence.synthetic, true); assert.equal(evidence.live, true);
const before = sceneSnapshotSchema.parse(evidence.beforeScene), candidate = sceneSnapshotSchema.parse(evidence.candidate.scene);
assert.equal(before.synthetic, true); assert.equal(candidate.synthetic, true); assert.equal(candidate.objects.length, 3);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const output = new URL('birdseye-evidence.json', directory);
await mkdir(directory, { recursive: true });
const guard = await open(output, 'wx'); await guard.writeFile('{"status":"started"}\n'); await guard.close();
const x = candidate.rooms.flatMap(room => room.outline.map(point => point.x));
const z = candidate.rooms.flatMap(room => room.outline.map(point => point.z));
const centerX = (Math.min(...x) + Math.max(...x)) / 2, centerZ = (Math.min(...z) + Math.max(...z)) / 2;
const height = Math.max(Math.max(...x) - Math.min(...x), Math.max(...z) - Math.min(...z)) * 2.3;
const camera = { position: [centerX, height, centerZ + .001], target: [centerX, 0, centerZ] };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
const images: unknown[] = [], pageErrors: string[] = [];
try {
  for (const [name, snapshot] of [['before', before], ['candidate', candidate]] as const) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1100 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent(await sceneDocument(snapshot, true), { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.sceneReady === 'true' || !!document.documentElement.dataset.sceneError, undefined, { timeout: 15000 });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.sceneError), undefined);
    const projected = await page.evaluate(({ camera, ids }) => {
      const view = (window as any).sceneInspection.view; view.setCamera(camera); view.renderer.render(view.scene, view.camera);
      const points: { id: string; x: number; y: number; z: number }[] = [];
      view.scene.traverse((item: any) => { if (ids.includes(item.userData.id)) { const position = item.getWorldPosition(view.camera.position.clone()).project(view.camera); points.push({ id: item.userData.id, x: position.x, y: position.y, z: position.z }); } });
      return { camera: view.getCamera(), points };
    }, { camera, ids: snapshot.objects.map(object => object.id) });
    assert.equal(projected.points.length, snapshot.objects.length);
    assert.ok(projected.points.every(point => Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && point.z > -1 && point.z < 1));
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const path = new URL(`${name}-birdseye-desktop.png`, directory);
    await page.locator('canvas').screenshot({ path: path.pathname.replace(/^\/([A-Za-z]:)/, '$1') });
    images.push({ name, file: `${name}-birdseye-desktop.png`, snapshotSha256: digest(snapshot), geometrySha256: digest({ rooms: snapshot.rooms, walls: snapshot.walls, objects: snapshot.objects }), objects: snapshot.objects.map(object => ({ id: object.id, name: object.name, position: object.position, yaw: object.yaw, size: object.size })), inspection: projected });
    await page.close();
  }
  assert.deepEqual(pageErrors, []);
  await writeFile(output, JSON.stringify({ passed: true, offline: true, sourceFile: 'layout-live-resume-20261027.json', sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'), camera, cameraOnly: true, objectsAddedRemovedOrMovedForImage: false, modelCalls: 0, serviceStarts: 0, images, pageErrors }, null, 2));
  console.log('Exact saved live candidate and source scene rendered from above; no network, DB or model calls.');
} finally { await browser.close(); }
