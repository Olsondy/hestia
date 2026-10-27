import type { SpatialScene, CameraState } from '../../../packages/scene-runtime/src/scene';

const ease = 'cubic-bezier(.16,1,.3,1)';
const scenes = new Map<string, SpatialScene>();
type Transfer = { projectId: string; camera: CameraState; aspect: number; rect: DOMRect; mode: 'open' | 'switch'; layer?: HTMLDivElement; expiry?: ReturnType<typeof setTimeout> };
let transfer: Transfer | undefined;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function registerScene(id: string, scene: SpatialScene) { scenes.set(id, scene); }
export function unregisterScene(id: string, scene: SpatialScene) { if (scenes.get(id) === scene) scenes.delete(id); }

export function fitRememberedCamera(camera: CameraState, sourceAspect: number, destinationAspect: number): CameraState {
  const scale = Math.min(1, sourceAspect) / Math.min(1, destinationAspect);
  return { target: [...camera.target], position: camera.position.map((coordinate, index) => camera.target[index] + (coordinate - camera.target[index]) * scale) };
}

/** Capture the actual visible canvas before React replaces it; never use a sample image. */
export function prepareSceneTransfer(sourceId: string, destinationId: string, mode: 'open' | 'switch') {
  if (transfer) { clearTimeout(transfer.expiry); transfer.layer?.remove(); transfer = undefined; }
  const scene = scenes.get(sourceId);
  if (!scene) return;
  const canvas = scene.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  const next: Transfer = { projectId: destinationId, camera: scene.getCamera(), aspect: scene.camera.aspect, rect, mode };
  if (!reduced() && rect.width && rect.height) {
    const layer = document.createElement('div');
    layer.className = 'scene-transfer'; layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const image = new Image(); image.src = canvas.toDataURL('image/png'); layer.append(image); document.body.append(layer);
    next.layer = layer;
  }
  next.expiry = setTimeout(() => { next.layer?.remove(); if (transfer === next) transfer = undefined; }, 5000);
  transfer = next;
}

export function arriveScene(id: string, scene: SpatialScene) {
  const incoming = transfer;
  if (!incoming || incoming.projectId !== id) return;
  transfer = undefined; clearTimeout(incoming.expiry);
  scene.setCamera(fitRememberedCamera(incoming.camera, incoming.aspect, scene.camera.aspect));
  const layer = incoming.layer;
  if (reduced() || !layer) { layer?.remove(); return; }
  const animate = (element: Element | null, frames: Keyframe[], duration: number, delay = 0) => element?.animate(frames, { duration, delay, easing: ease, fill: 'backwards' });
  if (incoming.mode === 'switch') {
    animate(document.querySelector('.folio-story h1'), [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], 700);
    animate(document.querySelector('.folio-reading'), [{ opacity: 0 }, { opacity: 1 }], 900);
    const reveal = animate(layer, [{ clipPath: 'inset(0)' }, { clipPath: 'inset(0 0 0 100%)' }], 850);
    reveal?.finished.catch(() => {}).finally(() => layer.remove());
  } else {
    const rect = scene.renderer.domElement.getBoundingClientRect();
    Object.assign(layer.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const from = incoming.rect;
    const journey = animate(layer, [
      { transform: `translate(${from.left - rect.left}px,${from.top - rect.top}px) scale(${from.width / rect.width},${from.height / rect.height})`, opacity: 1 },
      { transform: 'none', opacity: 1, offset: .75 }, { transform: 'none', opacity: 0 },
    ], 850);
    journey?.finished.catch(() => {}).finally(() => layer.remove());
    animate(scene.renderer.domElement, [{ opacity: 0 }, { opacity: 1 }], 220, 630);
    ['.workspace-header', '.space-outline', '.space-details', '.canvas-toolbar'].forEach((selector, index) => animate(document.querySelector(selector), [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], 600, 260 + index * 65));
  }
}
