// V01 render quality check: renders the demo villa from fixed shots and the generated camera presets through the
// headless background renderer document, then measures interactive frame rate in a phone viewport.
// Images go to .impeccable/review/v01/<run>/ (ignored) for manual review.
//   node --import tsx scripts/validation/render-quality.ts [run-name] [--fps] [--chrome]
import { chromium, type Browser } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sceneDocument } from '../../packages/scene-runtime/src/render';
import { convertHouseSpecBuilding, buildingCandidateToScene } from '../../packages/floorplan-import/src/building';
import type { SceneView } from '../../packages/contracts/src/building';

const args = process.argv.slice(2), run = args.find(arg => !arg.startsWith('--')) ?? 'after';
const directory = path.resolve('.impeccable/review/v01', run);
await mkdir(directory, { recursive: true });
const source = JSON.parse(await readFile('packages/floorplan-import/fixtures/demo-villa.housespec.json', 'utf8'));
const candidate = convertHouseSpecBuilding(source, { sourceId: 'demo-villa', sourceFormat: 'housespec-mm-v1', scaleEvidence: { status: 'estimated' } });
const scene = buildingCandidateToScene(candidate, '演示别墅 · 三层（演示数据，示意尺寸）', true);
const [l1, l2] = scene.levels!;
type Shot = { name: string; view: SceneView; camera?: { position: number[]; target: number[]; fov: number }; lighting?: 'day' | 'night'; floor?: 'polished' | 'honed' };
// Fixed cameras shared by the before/after comparison; world metres, y up.
const shots: Shot[] = [
  { name: 'aerial', view: { mode: 'building' }, camera: { position: [27, 22, 32], target: [10.4, 2.5, 8.5], fov: 38 } },
  { name: 'living-l1', view: { mode: 'building' }, camera: { position: [12.9, 1.45, 4.8], target: [11.2, 1.0, 9.8], fov: 62 } },
  { name: 'stair-l1', view: { mode: 'building' }, camera: { position: [17.9, 1.55, 5.6], target: [16.6, 1.9, 1.2], fov: 62 } },
  { name: 'bedroom-l2', view: { mode: 'building' }, camera: { position: [10.85, l2.elevation + 1.55, 5.2], target: [7.8, l2.elevation + .55, 9.8], fov: 62 } },
  { name: 'living-l1-night', view: { mode: 'building' }, camera: { position: [12.9, 1.45, 4.8], target: [11.2, 1.0, 9.8], fov: 62 }, lighting: 'night' },
  { name: 'aerial-night', view: { mode: 'building' }, camera: { position: [27, 22, 32], target: [10.4, 2.5, 8.5], fov: 38 }, lighting: 'night' },
  // Finish hand-off check: a stand-in MeshPhysicalMaterial on the living floor, polished vs honed (D04 owns real stone).
  { name: 'floor-polished', view: { mode: 'building' }, camera: { position: [12.9, 1.45, 4.8], target: [11.2, .6, 9.8], fov: 62 }, floor: 'polished' },
  { name: 'floor-honed', view: { mode: 'building' }, camera: { position: [12.9, 1.45, 4.8], target: [11.2, .6, 9.8], fov: 62 }, floor: 'honed' },
  { name: 'section-l1', view: { mode: 'section', levelId: l1.id } },
];

async function shoot(browser: Browser, shot: Shot, preset?: string) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const started = Date.now();
    await page.setContent(await sceneDocument(scene, true, shot.view), { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction(() => document.documentElement.dataset.sceneReady === 'true' || !!document.documentElement.dataset.sceneError, undefined, { timeout: 120000 });
    // String evaluation keeps tsx helpers out of the page. Optional calls let the same script capture the old renderer.
    const applied = await page.evaluate(`(() => {
      const view = window.sceneInspection.view, camera = ${JSON.stringify(shot.camera ?? null)}, preset = ${JSON.stringify(preset ?? null)};
      if (view.setLighting) view.setLighting({ mode: ${JSON.stringify(shot.lighting ?? 'day')} });
      const floor = ${JSON.stringify(shot.floor ?? null)};
      if (floor && window.sceneInspection.THREE) {
        const THREE = window.sceneInspection.THREE, mesh = view.getObject(${JSON.stringify(scene.rooms.find(room => room.name?.includes('客厅'))!.id)});
        mesh.material = new THREE.MeshPhysicalMaterial(floor === 'polished' ? { color: '#e9e3d9', roughness: .06, clearcoat: 1, clearcoatRoughness: .04 } : { color: '#e9e3d9', roughness: .62 });
      }
      if (preset) view.applyCameraPreset(preset);
      else if (camera) { view.camera.fov = camera.fov; view.camera.updateProjectionMatrix(); view.setCamera(camera); }
      if (view.render) view.render(); else view.renderer.render(view.scene, view.camera);
      return { nightSupported: !!view.setLighting, quality: view.getQuality ? view.getQuality() : 'legacy' };
    })()`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const output = path.join(directory, `${preset ? `preset-${preset}` : shot.name}.png`);
    await page.locator('canvas').screenshot({ path: output });
    const error = await page.evaluate(() => document.documentElement.dataset.sceneError);
    if (error || errors.length) throw new Error(error || errors.join('\n'));
    return { name: preset ? `preset-${preset}` : shot.name, output, ms: Date.now() - started, ...applied as object };
  } finally { await page.close(); }
}

/** Phone viewport, interactive tier, continuous orbit for a fixed time; counts presented frames. */
async function measureFps(browser: Browser, label: string) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent(await sceneDocument(scene, true, undefined, { quality: 'medium' }), { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.sceneReady === 'true' || !!document.documentElement.dataset.sceneError, undefined, { timeout: 120000 });
    const result = await page.evaluate(`(async () => {
      const view = window.sceneInspection.view;
      const runFor = async (seconds, setup) => {
        setup();
        const start = view.getCamera(), t0 = performance.now(); let frames = 0, worst = 0, last = t0;
        while (performance.now() - t0 < seconds * 1000) {
          await new Promise(requestAnimationFrame);
          const now = performance.now(), angle = (now - t0) / 1000 * 0.8;
          const dx = start.position[0] - start.target[0], dz = start.position[2] - start.target[2];
          view.setCamera({ target: start.target, position: [start.target[0] + dx * Math.cos(angle) - dz * Math.sin(angle), start.position[1], start.target[2] + dx * Math.sin(angle) + dz * Math.cos(angle)] });
          frames++; worst = Math.max(worst, now - last); last = now;
        }
        return { fps: Math.round(frames / ((performance.now() - t0) / 1000) * 10) / 10, worstFrameMs: Math.round(worst) };
      };
      const gl = view.renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
      const out = { renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown', pixelRatio: view.renderer.getPixelRatio(),
        quality: view.getQuality ? view.getQuality() : 'legacy', drawCalls: 0, aerial: null, interior: null };
      out.aerial = await runFor(6, () => {});
      out.drawCalls = view.renderer.info.render.calls;
      out.interior = await runFor(6, () => view.applyCameraPreset ? view.applyCameraPreset(view.cameraPresets().find(p => p.kind === 'interior').id)
        : view.setCamera({ position: [14.85, 1.5, 10.6], target: [10.6, 1.05, 5.2] }));
      return out;
    })()`);
    if (errors.length) throw new Error(errors.join('\n'));
    return { label, ...result as object };
  } finally { await page.close(); }
}

const records: object[] = [];
// Stills use the background renderer's SwiftShader flags unless --gpu (faster local iteration) is given.
const softwareBrowser = await chromium.launch(args.includes('--gpu') ? { headless: true, channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] }
  : { headless: true, args: ['--use-angle=swiftshader'] });
try {
  for (const shot of shots) records.push(await shoot(softwareBrowser, shot));
  const presets = await (async () => {
    const page = await softwareBrowser.newPage();
    try {
      await page.setContent(await sceneDocument(scene, true), { waitUntil: 'load' });
      await page.waitForFunction(() => document.documentElement.dataset.sceneReady === 'true', undefined, { timeout: 120000 });
      return await page.evaluate(`window.sceneInspection.view.cameraPresets ? window.sceneInspection.view.cameraPresets().map(p => ({ id: p.id, name: p.name, view: p.view })) : []`) as { id: string; name: string; view: SceneView }[];
    } finally { await page.close(); }
  })();
  for (const preset of presets) records.push({ preset: preset.name, ...await shoot(softwareBrowser, { name: preset.id, view: preset.view }, preset.id) });
} finally { await softwareBrowser.close(); }
const fps: object[] = [];
if (args.includes('--fps')) {
  // GPU-backed local Chrome approximates a device; SwiftShader numbers only show the CPU fallback floor.
  const gpu = await chromium.launch({ headless: true, ...(args.includes('--chrome') ? { channel: 'chrome' } : {}), args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
  try { fps.push(await measureFps(gpu, args.includes('--chrome') ? 'Google Chrome (GPU)' : 'Playwright Chromium (GPU)')); } finally { await gpu.close(); }
}
await writeFile(path.join(directory, 'results.json'), JSON.stringify({ date: new Date().toISOString(), run, records, fps }, null, 2));
console.log(JSON.stringify({ records, fps }, null, 2));
