import { create } from 'zustand';
import type { CameraState } from '../../../packages/scene-runtime/src/scene';

type RememberedCamera = CameraState & { aspect: number };
type ViewState = { selected: Record<string, string | null>; cameras: Record<string, RememberedCamera>; select: (project: string, object: string | null) => void; rememberCamera: (project: string, camera: RememberedCamera) => void; clear: () => void };
export const useViewState = create<ViewState>(set => ({
  selected: {}, cameras: {}, select: (project, object) => set(state => ({ selected: { ...state.selected, [project]: object } })),
  rememberCamera: (project, camera) => set(state => ({ cameras: { ...state.cameras, [project]: camera } })), clear: () => set({ selected: {}, cameras: {} }),
}));
