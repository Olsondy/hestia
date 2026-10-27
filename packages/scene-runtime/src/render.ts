import { build } from 'esbuild';
import { chromium, type Browser } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { sceneSnapshotSchema, type SceneSnapshot } from './snapshot';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
export async function sceneDocument(snapshot: SceneSnapshot, inspection = false) {
  const safe = JSON.stringify(sceneSnapshotSchema.parse(snapshot)).replace(/</g, '\\u003c');
  const compiled = await build({
    stdin: { contents: `import { SpatialScene } from './scene.ts';
      const view = new SpatialScene(document.getElementById('space'), id => { document.getElementById('selection').textContent = id || ''; });
      const snapshot = ${safe};
      view.renderer.domElement.addEventListener('webglcontextlost', () => { document.documentElement.dataset.sceneError = 'WebGL context lost'; });
      view.load(snapshot); document.getElementById('label').textContent = snapshot.label;
      ${inspection ? `// Inspection adapter is included only in the local validation harness, never production output.
        window.sceneInspection = { view };` : ''}
      requestAnimationFrame(() => {
        view.renderer.render(view.scene, view.camera);
        const gl = view.renderer.getContext();
        if (gl.isContextLost()) { document.documentElement.dataset.sceneError = 'WebGL context lost'; return; }
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let varied = false;
        for (let i = 0; i < pixels.length; i += 64) if (Math.abs(pixels[i] - pixels[0]) + Math.abs(pixels[i+1] - pixels[1]) + Math.abs(pixels[i+2] - pixels[2]) > 12) { varied = true; break; }
        if ((snapshot.rooms.length || snapshot.objects.length || snapshot.walls.length) && !varied) { document.documentElement.dataset.sceneError = 'No scene pixels rendered'; return; }
        document.documentElement.dataset.sceneReady = 'true';
      });`,
      resolveDir: sourceDirectory, loader: 'ts' },
    bundle: true, write: false, format: 'iife', target: 'es2022', minify: true,
  });
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hestia 合成空间验证</title>
  <style>html,body{margin:0;height:100%;background:#f3ece2;color:#382b29;font-family:system-ui,sans-serif}#space{position:absolute;inset:64px 0 0}header{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 28px}h1{font-size:18px;font-weight:500;margin:0}span{font-size:13px}</style></head>
  <body><header><h1 id="label"></h1><span>合成测试空间 · 尺寸为测试输入</span></header><div id="space"></div><output id="selection" hidden></output><script>${compiled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

/** Bounded local/headless renderer. Accepts data, not user-provided HTML or scripts. */
export async function renderSnapshotToPng(snapshot: SceneSnapshot, outputPath: string, existingBrowser?: Browser) {
  const html = await sceneDocument(snapshot);
  // Explicit software ANGLE keeps headless jobs independent of desktop GPU availability.
  const browser = existingBrowser ?? await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  try {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.sceneReady === 'true' || !!document.documentElement.dataset.sceneError, undefined, { timeout: 15000 });
    const before = await page.evaluate(() => document.documentElement.dataset.sceneError);
    if (before) throw new Error(before);
    const bytes = await page.locator('canvas').screenshot();
    const after = await page.evaluate(() => document.documentElement.dataset.sceneError);
    if (after) throw new Error(after);
    if (errors.length) throw new Error(errors.join('\n'));
    await writeFile(outputPath, bytes);
  } finally { await page.close(); if (!existingBrowser) await browser.close(); }
}
