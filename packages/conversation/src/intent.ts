import type { Command } from '../../contracts/src/commands';
import type { SpatialState } from '../../contracts/src/project';
import type { ConversationState } from '../../contracts/src/tasks';
import type { Decision } from './model';

/** This is a write-boundary veto, not a keyword router or a second conversational entry. */
export function exactLocalCommand(input: ConversationState['input'], state: SpatialState, decision: Decision):
  { command: Command; objectId: string } | { clarification: string } {
  const clarify = (clarification: string) => ({ clarification });
  if (decision.kind !== 'move' && decision.kind !== 'rotate') return clarify('本轮没有需要应用的局部修改。');
  const quote = decision.evidenceQuote, original = input.message;
  const sentenceText = (value: string) => value.trim().replace(/[。！？!?；;\n]+$/u, '').trim();
  const sourceSentence = [...original.matchAll(/[^。！？!?；;\n]+[。！？!?；;\n]*/gu)]
    .map(match => match[0].trim()).find(sentence => sentenceText(sentence) === sentenceText(quote));
  // Consider the entire source, not only a model-selected substring inside a hypothetical or quotation.
  if (!original.includes(quote) || !sourceSentence || /如果|假如|假设|假定|要是|举例|示例|例如|引用|不要|别动|别移动|先别|暂不|不执行|并非|不是让|未选中|没选中|未选择|另一个|其他|其它|另外|[“”「」『』"'`]/u.test(original)
    || /[?？]|是否|能否|可否|可以.*吗|会.*吗|想知道/u.test(sourceSentence))
    return clarify('这条消息含有问题、假设、引用或不执行的意思。请直接说明是否要修改所选家具及准确变化。');
  if (!input.selectedObjectId) return clarify('请先选中要调整的家具。');
  const object = state.currentLayout.objects.find(item => item.id === input.selectedObjectId);
  if (!object || object.kind !== 'furniture' || state.currentLayout.lockedObjectIds.includes(object.id))
    return clarify('所选对象不是可调整的家具，或已锁定；本轮没有修改空间。');
  const labels: Record<string, string> = { sofa: '沙发', table: '茶几', desk: '书桌', bed: '床', fixed: '固定柜' };
  const names = (item: typeof object) => [item.id, item.name, labels[item.id.split('-')[0]]].filter((name): name is string => !!name);
  const selectedNames = new Set(names(object));
  if ([...state.currentLayout.objects, ...state.fixedFacts.objects].filter(item => item.id !== object.id)
    .some(item => names(item).some(name => !selectedNames.has(name) && quote.includes(name))))
    return clarify('指令提到了当前选中对象之外的物品。请先选中实际要修改的家具，再明确本次变化。');
  let x = object.position.x, z = object.position.z, yaw = object.yaw;
  if (decision.kind === 'move') {
    const matches = [...quote.matchAll(/(\d+(?:\.\d+)?)\s*(毫米|厘米|公分|米|mm|cm|m)(?![A-Za-z])/giu)];
    const units: Record<string, string> = { 毫米: 'mm', 厘米: 'cm', 公分: 'cm', 米: 'm', mm: 'mm', cm: 'cm', m: 'm' };
    const directionWords = { right: /向右|往右|右移/u, left: /向左|往左|左移/u, up: /向上|往上|上移/u, down: /向下|往下|下移/u };
    if (matches.length !== 1 || matches[0][1] !== decision.distanceText || units[matches[0][2].toLowerCase()] !== decision.unit
      || !directionWords[decision.direction].test(quote) || !/移|挪/u.test(quote) || !/图纸/u.test(quote))
      return clarify('请明确写出沿图纸的方向和移动距离，例如“把所选家具沿图纸向右移动 20 厘米”。');
    const delta = Number(decision.distanceText) * ({ m: 1, cm: .01, mm: .001 }[decision.unit]);
    if (!(delta > 0 && delta <= 100)) return clarify('请给出有效的局部移动距离。');
    if (decision.direction === 'right') x += delta; if (decision.direction === 'left') x -= delta;
    if (decision.direction === 'up') z -= delta; if (decision.direction === 'down') z += delta;
  } else {
    const matches = [...quote.matchAll(/(\d+(?:\.\d+)?)\s*(度|°|degrees?)/giu)];
    const clockwise = /顺时针/u.test(quote) && !/逆时针/u.test(quote), counterclockwise = /逆时针/u.test(quote);
    if (matches.length !== 1 || matches[0][1] !== decision.degreesText || !/转/u.test(quote)
      || (decision.direction === 'clockwise' ? !clockwise : !counterclockwise)) return clarify('请明确写出顺时针或逆时针及旋转角度。');
    const degrees = Number(decision.degreesText);
    if (!(degrees > 0 && degrees <= 360)) return clarify('请给出 0 到 360 度以内的非零旋转角度。');
    yaw += degrees * Math.PI / 180 * (decision.direction === 'clockwise' ? -1 : 1);
  }
  return { objectId: object.id, command: { type: 'move-furniture', objectId: object.id,
    x: Number(x.toFixed(9)), z: Number(z.toFixed(9)), yaw: yaw % (2 * Math.PI) } };
}
