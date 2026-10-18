import fs from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const out='output/3d/';
fs.mkdirSync(out,{recursive:true});
import * as T from 'three';
// Material/geometry logic checks only: no browser rendering or texture raster validation.
globalThis.document={createElement(){return {width:0,height:0,getContext(){return new Proxy({},{get:()=>()=>{},set:()=>true});}};}};
const {createModel}=await import('../src/model.js');
const {createLayoutController,layouts,planThumbnail}=await import('../src/layouts.js');
const {createSoftStyleController}=await import('../src/soft-styles.js');
const model=createModel(new T.Scene(),{capabilities:{getMaxAnisotropy:()=>8}}),controller=createLayoutController(model),style=createSoftStyleController(model);
const app=fs.readFileSync('src/app.js','utf8');
const state={furniture:true,room:null,item:null,isolate:false,isolateItem:false,mode:'real',night:false,cutaway:true,walking:false,view:'3d'};
const applySource=app.slice(app.indexOf('function applyVisibility()'),app.indexOf('function setMode(mode)'));
const applyVisibility=new Function('model','state','selection',applySource+';return applyVisibility;')(model,state,{visible:false});
const fixedIds=['fixed-cabinet','fixed-ac','tv-wall','column','sliding-door','staircase','staircase-upper','stair-corridor-rail'];
const transform=p=>JSON.stringify([p.position.toArray(),p.rotation.toArray(),p.scale.toArray()]);
const fixed=new Map(model.parts.filter(p=>fixedIds.includes(p.userData.id)||['wall','door','window'].includes(p.userData.kind)).map(p=>[p,{transform:transform(p),materials:p.children.filter(o=>o.isMesh).map(o=>o.userData.original)}]));
assert(fixed.size>=fixedIds.length);
const modeSource=app.slice(app.indexOf('function setMode(mode)'),app.indexOf('function applyCutaway()'));
const cutSource=app.slice(app.indexOf('function applyCutaway()'),app.indexOf('function setNight('));
const setMode=new Function('T','model','state','matsByMesh','whiteMat','wireSurface','edgeMaterial','$$','navUpdate',cutSource+modeSource+';return setMode;')(T,model,state,new WeakMap(),new T.MeshStandardMaterial(),new T.MeshBasicMaterial(),new T.LineBasicMaterial(),()=>[],()=>{});
const all={},configurations={};
for(const id of Object.keys(layouts)){
 controller.apply(id);style.apply(id);applyVisibility();const feet=controller.footprints();all[id]=feet;
 for(const [p,b]of fixed){assert.equal(transform(p),b.transform);assert.deepEqual(p.children.filter(o=>o.isMesh).map(o=>o.userData.original),b.materials);}
 for(let i=0;i<feet.length;i++)for(let j=i+1;j<feet.length;j++){
  const a=feet[i],b=feet[j];if(a.room!==b.room)continue;
  const dx=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x),dz=Math.min(a.z+a.d,b.z+b.d)-Math.max(a.z,b.z);
  assert(!(dx>.025&&dz>.025),`${id}: ${a.id} overlaps ${b.id}`);
 }
 assert(!feet.filter(f=>f.room==='living').some(f=>f.z+f.d>3.05&&f.z<4.6));
 for(const r of model.rooms.filter(r=>['living','gaming','bedroom','study'].includes(r.id))){const [x,z]=r.walk;assert(!model.obstacles.some(([xx,zz,w,d])=>x>xx-.1&&x<xx+w+.1&&z>zz-.1&&z<zz+d+.1),id+' walk spawn '+r.id);}
 for(const mode of ['white','wire','real']){setMode(mode);assert(model.parts.filter(p=>p.visible&&p.userData.kind==='furniture').every(p=>p.userData.layoutVisible!==false));}
 for(const p of model.parts.filter(p=>p.userData.layouts))assert.equal(p.visible,p.userData.layouts.includes(id));
 state.furniture=false;applyVisibility();assert(model.parts.filter(p=>p.userData.kind==='furniture').every(p=>!p.visible));state.furniture=true;
 state.room='study';state.isolate=true;applyVisibility();assert(model.parts.filter(p=>p.visible).every(p=>p.userData.roomIds.includes('study')));state.isolate=false;state.room=null;applyVisibility();
 configurations[id]=model.parts.filter(p=>p.visible&&p.userData.kind==='furniture').map(p=>[p.userData.id,transform(p)]);
 assert(planThumbnail(feet,layouts[id].title).includes('<svg'));
}
assert.notDeepEqual(configurations.wood,configurations.cream);assert.notDeepEqual(configurations.wood,configurations.chinese);assert.notDeepEqual(configurations.cream,configurations.chinese);
controller.apply('wood');assert.deepEqual(controller.footprints(),all.wood);
const html=fs.readFileSync(out+'ideal-home-3d.html','utf8');
assert(!/15 万|150,000|150000|预算|implementationText|guide-dialog/.test(html.replace(/\/\*.*?\*\//gs,'')),'budget content removed');
assert(html.includes('FURNITURE LAYOUT STUDIES'));assert(!html.includes('INLINE_APP'));
const report={revision:'R1.0',layouts:Object.keys(layouts),distinctFurnitureConfigurations:true,solidFurnitureBoundingBoxOverlaps:0,fixedGeometryAndMaterialsPreserved:true,livingCirculationClear:true,roomEntryPointsClear:true,whiteWireAndRealModesPassed:true,furnitureToggleAndRoomIsolationPassed:true,resetWithoutCumulativeMovement:true,budgetRemovedFromActiveHTML:true,geometryCheck:'real Three.js scene; canvas drawing stubbed',browserVisualReview:'not run; existing local-file browser access restriction'};
fs.writeFileSync(out+'qa-r10.json',JSON.stringify(report,null,2));fs.writeFileSync(out+'layout-footprints-r10.json',JSON.stringify(all,null,2));
console.log(JSON.stringify(report,null,2));
