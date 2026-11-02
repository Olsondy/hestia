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
/** The banner is rasterized into the PNG itself; no external font or viewer label is required. */
export async function labelPng(png: Uint8Array, label: string, sourceLine: string) {
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height || meta.width > 4096 || meta.height > 4096) throw new Error('Invalid render dimensions');
  const width = meta.width, bannerHeight = 112;
  const title = await sharp({ text: { text: `<span foreground="#733b46">${pango(label)}</span>`, font: 'TsangerYuYangT W02 24',
    fontfile: fontFile(), width: width - 56, rgba: true, wrap: 'word' } }).png().toBuffer();
  const subtitle = await sharp({ text: { text: `<span foreground="#62514b">${pango(sourceLine)}</span>`, font: 'TsangerYuYangT W02 16',
    fontfile: fontFile(), width: width - 56, rgba: true, wrap: 'word' } }).png().toBuffer();
  return sharp({ create: { width, height: meta.height + bannerHeight, channels: 4, background: '#f5efe5' } })
    .composite([{ input: title, top: 20, left: 28 }, { input: subtitle, top: 66, left: 28 }, { input: Buffer.from(png), top: bannerHeight, left: 0 }])
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
