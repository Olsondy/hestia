// K01 visual review: the demo villa furnished by each demo soft style, interactive SpatialScene at interior cameras.
// Images go to .impeccable/review/k01/ (ignored) for review. Run: node --import tsx scripts/validation/soft-styles-render.ts
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { demoVillaScene } from '../../packages/finishes/src/demo-villa-scene';
import { demoSoftStyles } from '../../packages/soft-styles/src/demo-styles';
import { furnish } from '../../packages/soft-styles/src/furnish';

const directory = path.resolve('.impeccable/review/k01');
await mkdir(directory, { recursive: true });
const villa = demoVillaScene('演示别墅 · 软装风格（示意素材，示意尺寸）');
const [l1, l2, l3] = villa.levels!.map(level => level.id);
type Shot = { name: string; level: string; position: [number, number, number]; target: [number, number, number] };
const shots: Shot[] = [
  { name: 'living', level: l1, position: [11.2, 1.45, 5.0], target: [12.3, .7, 9.4] },
  { name: 'living-sofa-wall', level: l1, position: [12.3, 1.4, 6.0], target: [12.3, 1.1, 10.9] },
  { name: 'dining', level: l1, position: [14.7, 1.6, 4.0], target: [12.8, .8, 1.6] },
  { name: 'family-room', level: l2, position: [12.9, 1.5, 4.4], target: [12.9, .6, .7] },
  { name: 'master-bedroom', level: l2, position: [8.8, 1.6, 5.8], target: [8.8, .7, 10.4] },
  { name: 'tea-room', level: l3, position: [10.6, 1.5, 4.6], target: [8.9, .6, 1.6] },
];
const compiled = await build({
  stdin: { contents: `import { SpatialScene } from './scene.ts';
    const view = new SpatialScene(document.getElementById('space'));
    window.harness = { view, load(scene, levelId) { view.load(scene, false, { mode: 'level', levelId }); } };
    document.documentElement.dataset.ready = 'true';`,
  resolveDir: path.resolve('packages/scene-runtime/src'), loader: 'ts' }, bundle: true, write: false, format: 'iife', target: 'es2022',
});
const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}#space{position:absolute;inset:0}</style></head>
<body><div id="space"></div><script>${compiled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent(html, { waitUntil: 'load' }); await page.waitForSelector('html[data-ready="true"]', { timeout: 60000 });
  for (const style of demoSoftStyles) {
    const scene = { ...villa, objects: furnish(villa, style).objects };
    for (const level of [l1, l2, l3]) {
      await page.evaluate(([s, l]) => (window as unknown as { harness: { load: (s: unknown, l: string) => void } }).harness.load(s, l as string), [scene, level] as const);
      for (const shot of shots.filter(s => s.level === level)) {
        // Camera heights are per storey; lift them by the storey's floor level.
        const up = villa.levels!.find(l => l.id === level)!.elevation, lift = (p: number[]) => [p[0], p[1] + up, p[2]];
        await page.evaluate(`window.harness.view.setCamera(${JSON.stringify({ position: lift(shot.position), target: lift(shot.target) })})`);
        await page.waitForTimeout(600);
        await page.locator('canvas').screenshot({ path: path.join(directory, `${style.id}-${shot.name}.png`) });
      }
    }
  }
  process.stdout.write(`${demoSoftStyles.length * shots.length} images in ${path.relative(process.cwd(), directory)}; page errors: ${errors.length ? errors.join(' | ') : 'none'}\n`);
} finally { await browser.close(); }
