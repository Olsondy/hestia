import type { SpatialState } from '../../contracts/src/project';
import type { ConversationState, ModelProfile } from '../../contracts/src/tasks';
import type { Decision } from './model';
import { exactLocalCommand } from './intent';

const escaped = (value: string) => [...value].map(char => '^$.*+?()[]{}|'.includes(char) || char.charCodeAt(0) === 92
  ? String.fromCharCode(92) + char : char).join('');

/** A conservative parameter choice only. All messages still go through the same model
 * interpretation and write-boundary validation; this function never executes a command. */
export function selectModelProfile(input: ConversationState['input'], state: SpatialState): ModelProfile {
  const object = state.currentLayout.objects.find(item => item.id === input.selectedObjectId);
  if (!object || object.kind !== 'furniture' || state.currentLayout.lockedObjectIds.includes(object.id)) return 'design_quality';
  const targets = ['所选家具', '选中的家具', '所选物品', '选中的物品', '所选物体', '选中的物体',
    object.id, ...(object.name ? [object.name, `所选${object.name}`, `选中的${object.name}`] : [])];
  const target = `(?:${[...new Set(targets)].map(escaped).join('|')})`;
  const message = input.message.trim(), start = `^(?:请\\s*)?(?:(?:把|将)\\s*)?${target}\\s*`;
  const move = new RegExp(`${start}(?:沿|按)图纸\\s*(?:向|往)(右|左|上|下)\\s*(?:移动|平移|挪动)\\s*(\\d+(?:\\.\\d+)?)\\s*(毫米|厘米|公分|米|mm|cm|m)\\s*[。！!]?$`, 'iu').exec(message);
  const rotate = new RegExp(`${start}(顺时针|逆时针)\\s*(?:旋转|转动)\\s*(\\d+(?:\\.\\d+)?)\\s*(度|°|degrees?)\\s*[。！!]?$`, 'iu').exec(message);
  let decision: Decision;
  if (move) {
    const directions = { 右: 'right', 左: 'left', 上: 'up', 下: 'down' } as const;
    const units: Record<string, 'mm' | 'cm' | 'm'> = { 毫米: 'mm', 厘米: 'cm', 公分: 'cm', 米: 'm', mm: 'mm', cm: 'cm', m: 'm' };
    decision = { kind: 'move', userAct: 'explicit_request', evidenceQuote: message, direction: directions[move[1] as keyof typeof directions],
      distanceText: move[2], unit: units[move[3].toLowerCase()] };
  } else if (rotate) decision = { kind: 'rotate', userAct: 'explicit_request', evidenceQuote: message,
    direction: rotate[1] === '顺时针' ? 'clockwise' : 'counterclockwise', degreesText: rotate[2] };
  else return 'design_quality';
  return 'command' in exactLocalCommand(input, state, decision) ? 'edit_fast' : 'design_quality';
}
