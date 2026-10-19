import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,change,undo,redo,setPlacement,parseDemo,saveStore,loadStore} from '../src/store.js';

test('a rejected edit leaves the project and undo history intact',()=>{
  const p=blankProject();
  assert.throws(()=>change(p,q=>{q.width=99;setPlacement(q,'fixed-cabinet',1,2,0);}),/锁定/);
  assert.equal(p.width,10);assert.equal(p.history.length,0);
});
test('furniture movement survives persistence, undo and redo; branching clears redo',()=>{
  const p=blankProject();p.objects.push({id:'bed-1',type:'bed',x:2,z:3,yaw:0});
  change(p,q=>setPlacement(q,'bed-1',2.3,3,0));
  const memory=new Map(),storage={setItem:(k,v)=>memory.set(k,v),getItem:k=>memory.get(k)};
  saveStore({version:1,projects:[p]},storage);
  const q=loadStore(storage).projects[0];
  assert.equal(q.objects[0].x,2.3);assert.ok(undo(q));assert.equal(q.objects[0].x,2);
  assert.ok(redo(q));assert.equal(q.objects[0].x,2.3);
  undo(q);change(q,r=>setPlacement(r,'bed-1',2,4,Math.PI/2));assert.equal(redo(q),false);
});
test('locked custom furniture and non-finite coordinates cannot be applied',()=>{
  const p=blankProject();p.objects.push({id:'desk-1',x:1,z:1,yaw:0});p.locks.push('desk-1');
  assert.throws(()=>setPlacement(p,'desk-1',2,1,0),/锁定/);
  p.locks=[];assert.throws(()=>setPlacement(p,'desk-1',NaN,1,0),/有效/);
  assert.equal(p.objects[0].x,1);
});
test('demo commands use metres internally and reject excessive movement',()=>{
  assert.deepEqual(parseDemo('床向右移动30厘米'),{type:'move',item:'bed',name:'床',axis:'x',amount:.3});
  assert.equal(parseDemo('沙发向北移动0.5米').amount,-.5);
  assert.equal(parseDemo('床向左移动3000厘米').type,'invalid');
  assert.equal(parseDemo('帮我自动识别图纸').type,'help');
});
