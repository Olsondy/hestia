import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPlanningInput } from '../../layout-planner/src/fixtures';
import { selectModelProfile } from './profile';

const fixture = () => syntheticPlanningInput().state;
const input = (message: string, selectedObjectId: string | null = 'existing-sofa') => ({ message, selectedObjectId, referenceFrame: 'plan' as const });

test('initial layout and open-ended or mixed conversation use quality even when one object is selected', () => {
  const state = fixture();
  for (const message of ['请为这个房间生成会客和办公布局，保留现有家具', '再舒服一点', '解释这个空间',
    '20厘米等于多少米？把所选家具沿图纸向右移动20厘米', '把所选家具沿图纸向右移动20厘米，并生成办公布局'])
    assert.equal(selectModelProfile(input(message), state), 'design_quality', message);
  assert.equal(selectModelProfile(input('把所选家具沿图纸向右移动20厘米', null), state), 'design_quality');
});

test('only full supported unambiguous single-object moves and rotations use fast independent of prior task scope', () => {
  const state = fixture();
  for (const message of ['把所选家具沿图纸向右移动20厘米', '请将选中的家具按图纸往左平移 0.2 米。',
    '所选家具顺时针旋转90度', '把existing-sofa逆时针转动45°'])
    assert.equal(selectModelProfile(input(message), state), 'edit_fast', message);
  state.currentLayout.lockedObjectIds = ['existing-sofa'];
  assert.equal(selectModelProfile(input('把所选家具沿图纸向右移动20厘米'), state), 'design_quality');
});

test('questions, hypothetical, quotations, other objects and unrecognized grammar cannot earn the fast profile', () => {
  const state = fixture();
  for (const message of ['如果把所选家具沿图纸向右移动20厘米', '把所选家具沿图纸向右移动20厘米吗',
    '“把所选家具沿图纸向右移动20厘米”', '把另一个书桌沿图纸向右移动20厘米', '把所选家具沿图纸向右移动20厘米？',
    '不要把所选家具沿图纸向右移动20厘米', '把所选家具沿图纸向右移动200米', '把所选家具向右移动20厘米'])
    assert.equal(selectModelProfile(input(message), state), 'design_quality', message);
});

test('object labels are matched literally rather than interpreted as regular-expression syntax', () => {
  const state = fixture(); state.currentLayout.objects[0].name = '沙发[1].+';
  assert.equal(selectModelProfile(input('把沙发[1].+沿图纸向右移动20厘米'), state), 'edit_fast');
  assert.equal(selectModelProfile(input('把沙发1xx沿图纸向右移动20厘米'), state), 'design_quality');
});
