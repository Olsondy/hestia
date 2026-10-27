import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { courtyard } from '../../packages/scene-runtime/src/fixtures';
import { sceneDocument, renderSnapshotToPng } from '../../packages/scene-runtime/src/render';
import { catalogInstance } from '../../packages/catalog/src/instances';
import { getCatalog } from '../../packages/catalog/src/catalog';
import { defaultVisualStyle } from '../../packages/contracts/src/styles';
import type { SceneSnapshot } from '../../packages/contracts/src/scene';

// Finite synthetic image validation, no HTTP server, Worker, queue, account or user resource.
const directory = path.resolve('.impeccable/review/t16'); await mkdir(directory, { recursive: true });
const asset = getCatalog().assets[0], reference = { assetId: asset.id, assetVersion: 1, materialId: 'prototype-wood', materialVersion: 1 };
const base: SceneSnapshot = { ...structuredClone(courtyard), objects: [
  catalogInstance('styled-sofa', reference, asset.defaultSize, { x: 2, z: 1.3, yaw: 0 }),
  catalogInstance('untouched-sofa', reference, asset.defaultSize, { x: 4, z: 3.4, yaw: 0 }),
  structuredClone(courtyard.objects.find(object => object.kind === 'fixed')!),
] };
const material: SceneSnapshot = { ...base, visualStyle: { ...defaultVisualStyle(), materials: [{ objectId: 'styled-sofa', materialId: 'prototype-chinese', materialVersion: 1 }] } };
const styled: SceneSnapshot = { ...material, visualStyle: { ...material.visualStyle!, lighting: { presetId: 'display-soft', presetVersion: 1 } } };
const pixels = async (file: string) => sharp(await readFile(file)).ensureAlpha().raw().toBuffer();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
try {
  for (const [name, snapshot] of [['base', base], ['material', material], ['styled', styled]] as const)
    await renderSnapshotToPng(snapshot, path.join(directory, `render-${name}.png`), browser);
  assert.notDeepEqual(await pixels(path.join(directory, 'render-base.png')), await pixels(path.join(directory, 'render-material.png')));
  assert.notDeepEqual(await pixels(path.join(directory, 'render-material.png')), await pixels(path.join(directory, 'render-styled.png')));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(await sceneDocument(base, true), { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.sceneReady === 'true');
    const colors = () => page.evaluate(() => {
      const view = (window as any).sceneInspection.view;
      return Object.fromEntries(['styled-sofa', 'untouched-sofa', 'fixed-a'].map(id => {
        const values: string[] = []; view.getObject(id).traverse((node: any) => { if (node.isMesh) values.push(node.material.color.getHexString()); });
        return [id, values];
      }));
    });
    const before = await colors();
    await page.evaluate(snapshot => (window as any).sceneInspection.view.load(snapshot, true), material);
    const after = await colors();
    assert.notDeepEqual(after['styled-sofa'], before['styled-sofa']); assert.deepEqual(after['untouched-sofa'], before['untouched-sofa']); assert.deepEqual(after['fixed-a'], before['fixed-a']);
    await page.evaluate(snapshot => (window as any).sceneInspection.view.load(snapshot, true), styled);
    const afterLight = await colors(); assert.deepEqual(afterLight, after);
    const file = path.join(directory, 'render-interactive.png'); await page.locator('canvas').screenshot({ path: file });
    assert.deepEqual(await pixels(file), await pixels(path.join(directory, 'render-styled.png')));
    const snapshot = await page.evaluate(() => (window as any).sceneInspection.view.getSnapshot()); assert.deepEqual(snapshot, styled);
  } finally { await page.close(); }
  console.log(JSON.stringify({ status: 'passed', evidence: 'real-software-WebGL-pixels', checks: ['material changes pixels', 'display lighting changes pixels', 'untouched and fixed material values unchanged', 'light does not rewrite material values', 'interactive preserved-camera pixels equal static snapshot PNG', 'rendered snapshot retains independent style'], directory }, null, 2));
} finally { await browser.close(); }
