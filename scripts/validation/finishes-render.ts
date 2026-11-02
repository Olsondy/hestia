// D04 visual review: the demo villa with its example surface design, rendered through the background path
// (renderSnapshotToPng) and the interactive SpatialScene at close-up cameras. Images go to .impeccable/review/d04/
// (ignored) for manual review. `--env` adds a harness-only RoomEnvironment to preview polished stone under an
// environment map; production lighting and environment remain owned by the renderer (V01), not by this script.
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { renderSnapshotToPng } from '../../packages/scene-runtime/src/render';
import { demoVillaScene } from '../../packages/finishes/src/demo-villa-scene';

const directory = path.resolve('.impeccable/review/d04');
await mkdir(directory, { recursive: true });
const scene = demoVillaScene('演示别墅 · 一层石材铺贴（示意素材，示意尺寸）');
const level1 = scene.levels![0].id;
type Shot = { name: string; position: [number, number, number]; target: [number, number, number] };
const shots: Shot[] = [
  { name: 'living-floor-close', position: [10.1, 1.25, 10.55], target: [11.2, 0, 8.6] },
  { name: 'living-border-joint', position: [14.75, .55, 10.6], target: [14.95, 0, 9.9] },
  { name: 'tv-wall', position: [12.6, 1.45, 8.3], target: [12.5, 1.5, 4.2] },
  { name: 'tv-wall-oblique', position: [10.2, 1.5, 6.4], target: [13.2, 1.4, 4.2] },
  { name: 'stair', position: [16.9, 1.65, 5.4], target: [16.9, .7, 1.4] },
  { name: 'stair-treads-close', position: [17.9, 1.5, 3.7], target: [17.9, .6, 2.1] },
  { name: 'dining-herringbone', position: [14.8, 1.6, 4.1], target: [12.6, 0, 1.6] },
  { name: 'hall-diagonal', position: [15.6, 1.6, 5.7], target: [17.6, 0, 3.6] },
  { name: 'overview', position: [6.5, 9, 16], target: [13.5, 0, 5] },
];
const env = process.argv.includes('--env');
const compiled = await build({
  stdin: { contents: `import { SpatialScene } from './scene.ts';
    import * as T from 'three';
    import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
    const view = new SpatialScene(document.getElementById('space'));
    view.load(${JSON.stringify(scene).replace(/</g, '\\u003c')}, false, { mode: 'level', levelId: ${JSON.stringify(level1)} });
    window.harness = { view, env() { const pmrem = new T.PMREMGenerator(view.renderer);
      view.scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture; view.scene.environmentIntensity = .55; } };
    document.documentElement.dataset.ready = 'true';`,
  resolveDir: path.resolve('packages/scene-runtime/src'), loader: 'ts' }, bundle: true, write: false, format: 'iife', target: 'es2022',
});
const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}#space{position:absolute;inset:0}</style></head>
<body><div id="space"></div><script>${compiled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
try {
  // Background output path, default camera, single storey.
  const background = path.join(directory, 'background-level-1.png');
  const started = Date.now();
  await renderSnapshotToPng(scene, background, browser, { mode: 'level', levelId: level1 });
  const backgroundMs = Date.now() - started;
  const page = await browser.newPage({ viewport: { width: 1280, height: 836 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent(html, { waitUntil: 'load' }); await page.waitForSelector('html[data-ready="true"]', { timeout: 60000 });
  // Interactive adapter at the same default camera as the background renderer: same pixels.
  const interactive = await page.locator('canvas').screenshot();
  if (env) await page.evaluate('window.harness.env()');
  const records: object[] = [{ name: 'background-level-1', ms: backgroundMs, sha: sha(await readFile(background)) }, { name: 'interactive-default', sha: sha(interactive) }];
  for (const shot of shots) {
    await page.evaluate(`window.harness.view.setCamera(${JSON.stringify({ position: shot.position, target: shot.target })})`);
    const file = path.join(directory, `${shot.name}${env ? '-env' : ''}.png`);
    await writeFile(file, await page.locator('canvas').screenshot()); records.push({ name: shot.name, file });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(path.join(directory, `results${env ? '-env' : ''}.json`), JSON.stringify({ date: new Date().toISOString(), browser: browser.version(), records }, null, 2));
  console.log(JSON.stringify(records, null, 2));
} finally { await browser.close(); }
