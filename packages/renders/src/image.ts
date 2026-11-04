import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { SceneSnapshot } from '../../contracts/src/scene';
import { renderSnapshotToPng, type RenderOptions } from '../../scene-runtime/src/render';
import { cameraPresets } from '../../scene-runtime/src/cameras';
import type { SceneView } from '../../scene-runtime/src/scene';
import { fontFile } from './versions';

const pango = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
/**
 * Small translucent watermark in the bottom-right corner, rasterized into the PNG itself (no external font or viewer):
 * the disclaimer part of the label ("合成示例 · 非实测住宅", "概念草稿 · 尺寸未校准", …) travels with a saved or
 * forwarded image. The full label and trace (revision, snapshot, asset and renderer versions) are shown by the app's
 * scheme info overlay instead of a banner, so phone crops lose nothing. `sourceLine` is kept for callers; unused.
 */
export async function labelPng(png: Uint8Array, label: string, _sourceLine?: string) {
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height || meta.width > 4096 || meta.height > 4096) throw new Error('Invalid render dimensions');
  const scale = meta.width / 1280, state = label.split('　|　')[1]?.trim() || label;
  const text = await sharp({ text: { text: `<span foreground="#4a3f38">${pango(`效果示意 · ${state}`)}</span>`, font: `TsangerYuYangT W02 ${Math.round(14 * scale)}`,
    fontfile: fontFile(), rgba: true } }).png().toBuffer();
  const size = await sharp(text).metadata(), padX = Math.round(10 * scale), padY = Math.round(5 * scale), inset = Math.round(16 * scale);
  const w = (size.width ?? 0) + padX * 2, h = (size.height ?? 0) + padY * 2;
  const pill = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${h / 2}" fill="#fffdf8" fill-opacity=".62"/></svg>`);
  const left = Math.max(0, meta.width - w - inset), top = Math.max(0, meta.height - h - inset);
  return sharp(Buffer.from(png))
    .composite([{ input: pill, left, top }, { input: text, left: left + padX, top: top + padY }])
    .png().toBuffer();
}
/**
 * Tiling schemes are shown from eye level: the interior preset of the level carrying most tiled finishes (main room
 * before the stair hall). Falls back to the default aerial when the scene has no interior shot.
 */
export function schemeShot(scene: SceneSnapshot): string | undefined {
  const interiors = cameraPresets(scene).filter(preset => preset.kind === 'interior');
  const tiled = new Set(scene.surfaceDesign?.tilings.map(tiling => tiling.finishId) ?? []);
  const rooms = new Map(scene.rooms.map(room => [room.id, room.levelId]));
  const weight = (levelId: string | undefined) => (scene.finishes ?? []).filter(finish => tiled.has(finish.id) && (
    finish.kind === 'floor' ? (finish.levelId ?? (finish.roomId ? rooms.get(finish.roomId) : undefined)) === levelId : false)).length;
  return [...interiors].sort((a, b) => weight(rooms.get(b.roomId)) - weight(rooms.get(a.roomId)))[0]?.id;
}
export async function renderArtifact(scene: SceneSnapshot, label: string, sourceLine: string, view?: SceneView, options?: RenderOptions) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'hestia-render-')), output = path.join(temporary, 'canvas.png');
  try { await renderSnapshotToPng(scene, output, undefined, view, options); return await labelPng(await readFile(output), label, sourceLine); }
  finally { await unlink(output).catch(error => { if (error.code !== 'ENOENT') throw error; }); await rmdir(temporary); }
}
