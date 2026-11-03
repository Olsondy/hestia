import type { SpatialState } from '../../contracts/src/project';
import type { SoftStyle } from '../../contracts/src/soft-styles';
import { furnish } from './furnish';

/**
 * K02: the project state as furnished by a soft style, for rendering a scheme revision. Deterministic: the same state
 * and style always give the same furniture. Fixed objects stay fixed facts, layout furniture stays in the layout;
 * extras placed by the style are fixed staging. Without a style the state is returned unchanged.
 */
export function styledState(state: SpatialState, style: SoftStyle | null | undefined): SpatialState {
  if (!style) return state;
  const facts = state.fixedFacts, layoutIds = new Set(state.currentLayout.objects.map(o => o.id));
  const { objects } = furnish({ rooms: facts.rooms, walls: facts.walls, levels: facts.levels, stairs: facts.stairs,
    objects: [...facts.objects, ...state.currentLayout.objects] }, style);
  return { ...state, fixedFacts: { ...facts, objects: objects.filter(o => !layoutIds.has(o.id)) },
    currentLayout: { ...state.currentLayout, objects: objects.filter(o => layoutIds.has(o.id)) } };
}
