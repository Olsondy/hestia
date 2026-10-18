import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createModel,rooms} from './model.js';
import {softStyles,createSoftStyleController} from './soft-styles.js';
import {layouts,createLayoutController,planThumbnail} from './layouts.js';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const state={mode:'real',night:false,furniture:true,cutaway:true,labels:true,view:'3d',room:null,item:null,isolate:false,isolateItem:false,walking:false,previousMode:'real'};
let renderer,scene,camera,perspective,ortho,controls,model,selection,ambient,sun,fill,ground,animation=null,walkYaw=0,walkPitch=0,frame=0;
const world=(x,y,z)=>new T.Vector3(x-5,y,z-4.5),raycaster=new T.Raycaster(),mouse=new T.Vector2(),keys=new Set();
const viewport=$('#viewport'),host=$('#canvas-host'),labelHost=$('#room-labels');
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let lastTime=performance.now(),toastTimer;
const whiteMat=new T.MeshStandardMaterial({color:'#eeeae0',roughness:.8,metalness:0});
const wireSurface=new T.MeshBasicMaterial({color:'#dfe4d8',transparent:true,opacity:.025,depthWrite:false,side:T.DoubleSide});
const edgeMaterial=new T.LineBasicMaterial({color:'#667967',transparent:true,opacity:.7});
const matsByMesh=new WeakMap();
const labels=new Map();
let styleController,layoutController;
state.softStyle='wood';
const el=(tag,cls,content)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(content!==undefined)e.textContent=content;return e;};
function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2800);}
function roomOf(id){return rooms.find(r=>r.id===id);}
function badge(status){return `<span class="detail-badge ${/待测|示意|拟选|提案/.test(status)&&!/已确认/.test(status)?'provisional':''}">${status}</span>`;}

function setupNavigation(){
 const mini=$('#mini-map');
 const shapes={living:'M27.5 0H72V30H110.5V47H27.5Z',gaming:'M72 0H110.5V30H72Z',bedroom:'M27.5 47H110.5V90H27.5Z',study:'M-2.5 0H27.5V24.5H-2.5Z',balcony:'M-11.5 0H-2.5V24.5H-11.5Z',bathroom:'M15.5 47H27.5V90H15.5Z',stairs:'M-2.5 24.5H27.5V47H-2.5Z'};
 for(const r of rooms){const b=el('button','room-nav');b.dataset.room=r.id;b.innerHTML=`<span class="room-index">${r.index}</span><span>${r.name}</span><span class="room-arrow">↗</span>`;b.onclick=()=>selectRoom(r.id);$('#room-list').append(b);
  const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',shapes[r.id]);p.setAttribute('fill','#e3e7da');p.setAttribute('stroke','#8d9984');p.setAttribute('stroke-width','1');p.dataset.room=r.id;p.setAttribute('tabindex','0');p.setAttribute('role','button');p.setAttribute('aria-label','查看'+r.name);p.addEventListener('click',()=>selectRoom(r.id));p.addEventListener('keydown',e=>{if(e.key==='Enter')selectRoom(r.id);});mini.append(p);
  const lab=el('button','room-label');lab.innerHTML=`<small>${r.index}</small>${r.name}`;lab.onclick=()=>selectRoom(r.id);labelHost.append(lab);labels.set(r.id,lab);
 }
}
function renderDetails(){
 const r=roomOf(state.room),item=state.item?model.items.get(state.item):null;
 const detail=$('#details');
 if(item){detail.innerHTML=`<div class="detail-code">${r?r.index:'00'} / OBJECT</div><h2>${item.name}</h2>${badge(item.status)}<p>${item.desc}</p><div class="detail-spec"><span>所属空间</span><span>${roomOf(item.room)?.name||'全屋'}</span><span>规格</span><span>${item.spec}</span></div><div class="detail-actions"><button id="focus-item" class="primary">靠近查看</button><button id="solo-item">${state.isolateItem?'恢复空间':'单独查看物品'}</button></div><p class="detail-note">${item.status.includes('固定')||item.status.includes('保留')?'固定位置按你的描述保留；材质与尺寸仍需现场核实。':'这是装修效果提案。购买和施工前，请按现场净尺寸确认。'}</p>`;
  $('#focus-item').onclick=()=>focusItem(item);$('#solo-item').onclick=()=>{if(state.walking)exitWalk(false);state.isolateItem=!state.isolateItem;state.isolate=false;if(state.view==='plan')setView('3d',false);applyVisibility();renderDetails();focusItem(item);};
 }else if(r){detail.innerHTML=`<div class="detail-code">${r.index} / SPACE</div><h2>${r.name}</h2>${badge('R1.0 · 比例修订示意')}<p>${r.desc}</p><p class="detail-note">${r.note}</p>${r.id==='stairs'?`<svg viewBox="0 0 240 170" role="img" aria-label="一楼向左11级，平平台A，向下5级，平平台B，向右11级到二楼" style="width:100%;margin:0 0 16px;color:var(--ink)"><g fill="none" stroke="currentColor" stroke-width="1.5"><rect x="20" y="28" width="30" height="30"/><rect x="20" y="111" width="30" height="30"/><path d="M210 43H50m8 -5l-8 5 8 5M35 58V111m-5 -8l5 8 5 -8M50 126H210m-8 -5l8 5 -8 5"/></g><g fill="currentColor" font-family="Microsoft YaHei,sans-serif" font-size="11" text-anchor="middle"><text x="130" y="33">11 级 ← 一楼起步</text><text x="35" y="47">A</text><text x="76" y="88">约 5 级 ↓</text><text x="35" y="130">B</text><text x="133" y="117">11 级 → 二楼落点</text><text x="120" y="160">A、B 为平平台 · 示意不按比例</text></g></svg>`:''}<div class="detail-actions"><button id="detail-enter" class="primary">进入${r.name}</button><button id="detail-isolate">${state.isolate?'显示全屋':'单独查看房间'}</button></div>`;$('#detail-enter').onclick=()=>enterRoom(r.id);$('#detail-isolate').onclick=toggleIsolate;
 }else{detail.innerHTML=`<div class="detail-code">00 / WHOLE HOME</div><h2>熟悉的布局，<br>新的日常。</h2>${badge('二层 · 无天花板展示')}<p>独立电竞房、温暖的客厅与安静的卧室。点击空间或物品，探索家具、材质和每一个设计考虑。</p><div class="detail-spec"><span>卧室横向</span><span>暂按 8.3 m 对比</span><span>书房 / 阳台</span><span>约 3 m / 向西凸出</span><span>楼梯顺序</span><span>11＋平台＋5＋平台＋11</span><span>方向</span><span>上北 · 右东临路</span><span>层高</span><span>暂按 2.8 m 展示</span><span>方案依据</span><span>最新口述修订 R1.0</span></div><div class="detail-sub">原位保留</div><p>卧室整排固定柜、东北角空调、客厅电视墙、电竞房柱位、大滑动门及阳台门。</p><p class="detail-note">卧室横向据记忆为 8 米多，8.3 m 是对比假设，包含固定柜深度。原总宽和面积估计需复核。窗洞、楼梯及洁具仍为示意。</p>`;}
 const style=softStyles.find(s=>s.id===state.softStyle);
 if(!r||['living','bedroom','study','gaming'].includes(r.id))detail.insertAdjacentHTML('beforeend',`<section class="style-note"><div class="detail-sub">当前布局 · ${layouts[state.softStyle].title}</div><div class="material-swatches">${style.palette.map((c,i)=>`<i class="swatch" style="background:${c}" title="${style.tag} · 色样 ${i+1}"></i>`).join('')}</div><p>${layouts[state.softStyle].summary}</p><p class="detail-note">取舍：${layouts[state.softStyle].tradeoff}</p><button class="compare-styles">比较家具布局</button></section>`);
 detail.querySelector('.compare-styles')?.addEventListener('click',()=>$('#style-dialog').showModal());
 const list=$('#object-list');list.innerHTML='';
 const entries=[...model.items.values()].filter(i=>i.group.userData.layoutVisible!==false&&(!r||i.room===r.id));
 list.append(el('div','detail-sub',r?'空间里的物品':'先探索这些固定物品'));
 for(const it of (r?entries:entries.filter(x=>['fixed-cabinet','fixed-ac','tv-wall','column','sliding-door','staircase'].includes(x.id)))){const b=el('button','object-entry'+(state.item===it.id?' active':''));b.innerHTML=`<div>${it.name}<small>${/原|已确认|固定/.test(it.status)?'已确认位置':'效果提案 / 示意'}</small></div><span>↗</span>`;b.onclick=()=>selectItem(it.id);list.append(b);}
}
function navUpdate(){
 $$('.room-nav').forEach(b=>b.classList.toggle('active',b.dataset.room===state.room||b.id==='overview'&&!state.room));
 $$('#mini-map path').forEach(p=>p.setAttribute('fill',p.dataset.room===state.room?'#8fa387':'#e3e7da'));
 for(const [id,l] of labels)l.classList.toggle('active',id===state.room);
 $('#enter-room').disabled=!state.room;$('#isolate').disabled=!state.room;$('#isolate').classList.toggle('active',state.isolate);$('#isolate').setAttribute('aria-pressed',String(state.isolate));
 $('#view3d').classList.toggle('active',state.view==='3d');$('#view2d').classList.toggle('active',state.view==='plan');$('#view3d').setAttribute('aria-pressed',String(state.view==='3d'));$('#view2d').setAttribute('aria-pressed',String(state.view==='plan'));
 const r=roomOf(state.room);$('#view-title').textContent=state.walking?`${r.name} · 室内漫游`:state.isolateItem?`${model.items.get(state.item)?.name} · 细节`:state.view==='plan'?'二层 · 平面图':r?`${r.name} · 空间浏览`:'整层 · 拆顶浏览';
 $('#view-kicker').textContent=state.walking?'WALKTHROUGH':state.view==='plan'?'FLOOR PLAN':state.isolateItem?'OBJECT VIEW':'DOLLHOUSE VIEW';
 $('#view-subtitle').textContent=state.walking?'拖拽环顾，用 WASD 或方向键在本房间内移动。':state.view==='plan'?'默认线框展示。拖拽平移，滚轮缩放，点击选择房间或家具。':'拖拽旋转，滚轮缩放，点击物品查看设计讲解。';
 $('#walk-hint').hidden=!state.walking;$('#walk-pad').hidden=!state.walking;
 $('#cutaway').disabled=state.walking||state.view==='plan';
 $('#scene-status').textContent=`${softStyles.find(s=>s.id===state.softStyle).name} · ${state.night?'夜间灯光':'日间光照'} · ${state.mode==='real'?'真实材质':state.mode==='white'?'白模':'线框'} · ${state.furniture?'家具可见':'家具隐藏'}`;
}
function motion(pos,target,duration=850){
 if(reduced){camera.position.copy(pos);controls.target.copy(target);camera.lookAt(target);controls.update();return;}
 animation={start:performance.now(),duration,from:camera.position.clone(),to:pos.clone(),targetFrom:controls.target.clone(),targetTo:target.clone()};
}
function fitOverview(){
 if(state.walking)exitWalk(false);
 if(state.view==='plan'){ortho.position.set(0,25,0);ortho.up.set(0,0,-1);controls.target.set(0,0,0);ortho.lookAt(0,0,0);ortho.zoom=1;resize();controls.update();return;}
 const aspect=host.clientWidth/host.clientHeight;
 const scale=Math.max(1.08,1.2/aspect);
 const offset=new T.Vector3(10.8,12.4,14.1).multiplyScalar(scale);
 motion(new T.Vector3(.1,.2,.1).add(offset),new T.Vector3(.1,.2,.1));
}
function selectRoom(id,doFocus=true){
 if(state.walking)exitWalk(false);state.room=id;state.item=null;state.isolateItem=false;
 selection.visible=false;applyVisibility();renderDetails();navUpdate();
 if(matchMedia('(max-width:1000px)').matches)$('#inspector').classList.add('open');
 const r=roomOf(id);if(doFocus&&state.view==='3d'){const target=world(...[r.center[0],.75,r.center[1]]);motion(target.clone().add(new T.Vector3(...r.focus)),target);}
}
function selectItem(id){
 const i=model.items.get(id);if(!i||i.group.userData.layoutVisible===false)return;
 state.room=i.room;state.item=id;if(state.isolateItem)applyVisibility();
 renderDetails();navUpdate();$('#inspector').classList.add('open');
 selection.setFromObject(i.group);selection.visible=state.furniture||i.group.userData.kind!=='furniture';
}
function focusItem(item){
 if(state.walking)exitWalk(false);if(state.view==='plan')setView('3d',false);
 const b=new T.Box3().setFromObject(item.group),size=b.getSize(new T.Vector3()),center=b.getCenter(new T.Vector3());const len=Math.max(1.4,size.length());
 motion(center.clone().add(new T.Vector3(.75,.55,1).normalize().multiplyScalar(len*1.6)),center,750);selection.setFromObject(item.group);selection.visible=true;navUpdate();
}
function overview(){if(state.walking)exitWalk(false);state.room=null;state.item=null;state.isolate=false;state.isolateItem=false;selection.visible=false;applyVisibility();renderDetails();navUpdate();fitOverview();$('#inspector').classList.remove('open');}
function toggleIsolate(){if(!state.room)return;if(state.walking)exitWalk(false);state.isolate=!state.isolate;state.isolateItem=false;applyVisibility();renderDetails();navUpdate();if(state.view==='3d'){const r=roomOf(state.room),target=world(r.center[0],.6,r.center[1]);motion(target.clone().add(new T.Vector3(...r.focus)),target);}}
function applyVisibility(){
 for(const p of model.parts){const {kind,roomIds,id}=p.userData;let v=true;if(state.isolateItem){v=id===state.item||(kind==='floor'&&roomIds.includes(state.room));}else if(state.isolate){v=roomIds.includes(state.room)&&kind!=='base';}
  if(kind==='furniture'&&!state.furniture)v=false;
  p.visible=v&&p.userData.layoutVisible!==false;
 }
 if(state.item){const i=model.items.get(state.item);selection.visible=i?.group.visible??false;}
}
function setMode(mode){
 state.mode=mode;
 for(const mesh of model.meshes){let map=matsByMesh.get(mesh);if(!map){map={};matsByMesh.set(mesh,map);}
  if(mode==='real')mesh.material=mesh.userData.original;
  else if(mode==='white'){if(!map.white)map.white=whiteMat.clone();mesh.material=map.white;}
  else{if(!map.wire){map.wire=wireSurface.clone();if(mesh.isInstancedMesh){map.wire.opacity=.5;map.wire.wireframe=true;}}
   mesh.material=map.wire;
   if(!mesh.isInstancedMesh&&!mesh.userData.edges){const edge=new T.LineSegments(new T.EdgesGeometry(mesh.geometry,6),edgeMaterial.clone());mesh.add(edge);mesh.userData.edges=edge;edge.renderOrder=1;}
  }
  if(mesh.userData.edges){mesh.userData.edges.visible=mode==='wire';mesh.userData.edges.material.color.set(state.night?'#a4bdad':'#617961');}
 }
 applyCutaway();$$('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});navUpdate();
}
function applyCutaway(){
 const clip=state.cutaway&&!state.walking&&state.view==='3d';
 for(const mesh of model.meshes){if(mesh.userData.cuttable){mesh.material.clippingPlanes=clip?[model.cutPlane]:null;mesh.material.clipShadows=true;mesh.material.needsUpdate=true;if(mesh.userData.edges){mesh.userData.edges.material.clippingPlanes=clip?[model.cutPlane]:null;mesh.userData.edges.material.needsUpdate=true;}}}
}
function setNight(value){state.night=value;document.body.classList.toggle('night',value);scene.background=new T.Color(value?'#172125':'#e8e5dd');ground.material.color.set(value?'#192529':'#dedfd5');ambient.intensity=value?.2:1.45;sun.intensity=value?.12:3.2;fill.intensity=value?.08:.5;scene.environmentIntensity=value?.13:.48;renderer.toneMappingExposure=value?.85:1.05;for(const {light,power}of model.lights)light.intensity=value?power:0;for(const mat of model.glows)mat.emissiveIntensity=value?3:.05;
 $('#night').setAttribute('aria-pressed',String(value));$('#night-label').textContent=value?'切换白天':'切换夜晚';for(const mesh of model.meshes)if(mesh.userData.edges)mesh.userData.edges.material.color.set(value?'#a4bdad':'#617961');navUpdate();}
function setView(view,doFit=true){
 if(state.walking)exitWalk(false);animation=null;
 if(view==='plan'){if(state.view!=='plan')state.previousMode=state.mode;state.view='plan';camera=ortho;controls.object=camera;controls.enableRotate=false;controls.mouseButtons.LEFT=T.MOUSE.PAN;controls.maxPolarAngle=Math.PI;ortho.position.set(0,25,0);ortho.up.set(0,0,-1);controls.target.set(0,0,0);ortho.lookAt(0,0,0);ortho.zoom=1;setMode('wire');}
 else{const wasPlan=state.view==='plan';state.view='3d';camera=perspective;controls.object=camera;controls.enableRotate=true;controls.mouseButtons.LEFT=T.MOUSE.ROTATE;controls.maxPolarAngle=Math.PI*.49;setMode(wasPlan?state.previousMode:state.mode);}
 ground.visible=view!=='plan';resize();applyCutaway();navUpdate();if(doFit)fitOverview();
}
function enterRoom(id){
 const r=roomOf(id);if(!r)return;animation=null;state.room=id;state.item=null;state.isolateItem=false;state.isolate=false;
 if(state.view==='plan')setView('3d',false);
 state.walking=true;controls.enabled=false;camera=perspective;perspective.fov=64;perspective.updateProjectionMatrix();camera.position.copy(world(r.walk[0],1.62,r.walk[1]));const target=world(r.look[0],1.3,r.look[1]);const dir=target.sub(camera.position).normalize();walkYaw=Math.atan2(-dir.x,-dir.z);walkPitch=Math.asin(dir.y);updateWalkCamera();selection.visible=false;applyVisibility();applyCutaway();renderDetails();navUpdate();$('#inspector').classList.remove('open');toast('已进入'+r.name+'，拖拽环顾，WASD 移动');}
function exitWalk(doFit=true){if(!state.walking)return;state.walking=false;perspective.fov=39;perspective.updateProjectionMatrix();keys.clear();controls.enabled=true;controls.target.copy(camera.position).add(new T.Vector3(0,0,-1).applyQuaternion(camera.quaternion));applyCutaway();navUpdate();if(doFit){if(state.room)selectRoom(state.room);else fitOverview();}}
function updateWalkCamera(){camera.rotation.order='YXZ';camera.rotation.set(walkPitch,walkYaw,0,'YXZ');}
function canWalk(x,z){const r=roomOf(state.room),px=x+5,pz=z+4.5,margin=.16;
 const rects=r.id==='stairs'?[[1.55,2.45,1.2,2.25]]:r.rects;
 if(!rects.some(([xx,zz,w,d])=>px>xx+margin&&px<xx+w-margin&&pz>zz+margin&&pz<zz+d-margin))return false;
 if(state.furniture&&model.obstacles.some(([xx,zz,w,d])=>px>xx-.1&&px<xx+w+.1&&pz>zz-.1&&pz<zz+d+.1))return false;
 return true;
}
function walk(dt){if(!state.walking)return;const f=(keys.has('w')||keys.has('arrowup')?1:0)-(keys.has('s')||keys.has('arrowdown')?1:0),s=(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0);if(!f&&!s)return;const v=new T.Vector3(-Math.sin(walkYaw)*f+Math.cos(walkYaw)*s,0,-Math.cos(walkYaw)*f-Math.sin(walkYaw)*s).normalize().multiplyScalar(dt*1.35);const p=camera.position;if(canWalk(p.x+v.x,p.z))p.x+=v.x;if(canWalk(p.x,p.z+v.z))p.z+=v.z;}
function resize(){if(!renderer)return;const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);perspective.aspect=w/h;perspective.updateProjectionMatrix();const halfH=Math.max(6.1,6.8/(w/h));ortho.left=-halfH*w/h;ortho.right=halfH*w/h;ortho.top=halfH;ortho.bottom=-halfH;ortho.updateProjectionMatrix();}
function updateLabels(){
 for(const r of rooms){const label=labels.get(r.id);const show=state.labels&&!state.walking&&!state.isolateItem&&(!state.isolate||r.id===state.room);label.hidden=!show;if(!show)continue;const p=world(r.label[0],state.view==='plan'?.1:.22,r.label[1]);p.project(camera);label.style.left=`${(p.x*.5+.5)*host.clientWidth}px`;label.style.top=`${(-p.y*.5+.5)*host.clientHeight}px`;label.classList.toggle('occluded',p.z>1||p.z< -1||Math.abs(p.x)>.95||Math.abs(p.y)>.93);}
 if(state.view==='3d'&&!state.walking){const v=new T.Vector3(0,0,-1).applyQuaternion(camera.quaternion);const ang=Math.atan2(v.x,-v.z);$('.north-mark svg').style.transform=`rotate(${-ang}rad)`;}else $('.north-mark svg').style.transform='none';
}
function pick(event){const rect=renderer.domElement.getBoundingClientRect();mouse.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(mouse,camera);const hits=raycaster.intersectObjects(model.root.children,true);
 for(const hit of hits){if(!hit.object.isMesh)continue;let v=hit.object,visible=true;while(v){if(!v.visible){visible=false;break;}v=v.parent;}if(!visible)continue;if(hit.object.userData.cuttable&&state.cutaway&&!state.walking&&state.view==='3d'&&hit.point.y>1.12)continue;let parent=hit.object;while(parent&&!parent.userData.id)parent=parent.parent;if(!parent)continue;const d=parent.userData;if(model.items.has(d.id)){if(!state.walking||model.items.get(d.id).room===state.room)selectItem(d.id);return;}if(d.kind==='floor'||d.kind==='wall'){if(!state.walking)selectRoom(d.roomIds.includes(state.room)?state.room:d.roomIds[0],false);return;}}
}
function setSoftStyle(id,announce=true){
 const wasWalking=state.walking;if(wasWalking)exitWalk(false);
 const layout=layoutController.apply(id);const style=styleController.apply(id);state.softStyle=id;
 if(state.item&&model.items.get(state.item)?.group.userData.layoutVisible===false){state.item=null;state.isolateItem=false;selection.visible=false;}
 applyVisibility();setMode(state.mode);renderDetails();
 if(state.item)selection.setFromObject(model.items.get(state.item).group);
 if(wasWalking)enterRoom(state.room);
 $('#style-btn').textContent='布局 · '+style.short;
 $$('[data-soft-style]').forEach(b=>{const active=b.dataset.softStyle===id;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
 if(announce)toast(layout.title+(state.furniture?' · 家具位置与组合已切换':'已选；开启家具查看摆放'));
}
function setupDesign(){
 $('#style-choices').innerHTML=softStyles.map(s=>{layoutController.apply(s.id);const layout=layouts[s.id];return `<button class="style-choice" data-soft-style="${s.id}" aria-pressed="false">${planThumbnail(layoutController.footprints(),layout.title)}<strong>${layout.title}</strong><span>${layout.summary}</span><small>取舍：${layout.tradeoff}</small><span class="style-select-label">查看这个布局 ↗</span></button>`;}).join('');
 $$('[data-soft-style]').forEach(b=>b.onclick=()=>{setSoftStyle(b.dataset.softStyle);$('#style-dialog').close();});
 $('#style-btn').onclick=()=>{keys.clear();$('#style-dialog').showModal();};
 $('#close-style').onclick=()=>$('#style-dialog').close();
}
function bindUI(){
 $('#overview').onclick=overview;$('#view3d').onclick=()=>setView('3d');$('#view2d').onclick=()=>setView('plan');$('#night').onclick=()=>setNight(!state.night);$('#reset-camera').onclick=()=>{if(state.walking)enterRoom(state.room);else if(state.item)focusItem(model.items.get(state.item));else if(state.room&&state.view==='3d')selectRoom(state.room);else fitOverview();};$('#isolate').onclick=toggleIsolate;$('#enter-room').onclick=()=>enterRoom(state.room);$('#exit-walk').onclick=()=>exitWalk();
 $$('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
 for(const name of ['furniture','cutaway','labels'])$('#'+name).onclick=()=>{state[name]=!state[name];$('#'+name).setAttribute('aria-pressed',String(state[name]));$('#'+name+' .switch').classList.toggle('on',state[name]);if(name==='furniture'){if(state.isolateItem&&!state.furniture){state.isolateItem=false;renderDetails();}applyVisibility();}if(name==='cutaway')applyCutaway();navUpdate();};
 $('#help-btn').onclick=()=>$('#help-dialog').showModal();$('#close-help').onclick=$('#help-done').onclick=()=>$('#help-dialog').close();$('#close-detail').onclick=()=>{if(matchMedia('(max-width:1000px)').matches)$('#inspector').classList.remove('open');else if(state.item){state.item=null;state.isolateItem=false;selection.visible=false;applyVisibility();renderDetails();}else overview();};
 const syncOptions=()=>$$('[data-toggle]').forEach(b=>{const on=state[b.dataset.toggle];b.setAttribute('aria-pressed',String(on));b.querySelector('.switch').classList.toggle('on',on);b.disabled=b.dataset.toggle==='cutaway'&&(state.walking||state.view==='plan');});
 $('#display-options').onclick=()=>{syncOptions();$('#display-dialog').showModal();};$('#display-done').onclick=()=>$('#display-dialog').close();
 $$('[data-toggle]').forEach(b=>b.onclick=()=>{$('#'+b.dataset.toggle).click();syncOptions();});
 $('#save-view').onclick=()=>{renderer.render(scene,camera);const a=document.createElement('a');a.href=renderer.domElement.toDataURL('image/png');a.download=`玉山二层-${softStyles.find(s=>s.id===state.softStyle).name}-${state.room||'全屋'}-${state.night?'夜景':'日景'}-${state.mode}.png`;a.click();toast('已保存当前模型画面');};
 let down=null,last=null;
 renderer.domElement.addEventListener('pointerdown',e=>{animation=null;down={x:e.clientX,y:e.clientY};last={x:e.clientX,y:e.clientY};if(state.walking)renderer.domElement.setPointerCapture(e.pointerId);});
 renderer.domElement.addEventListener('pointermove',e=>{if(state.walking&&last){walkYaw-=(e.clientX-last.x)*.004;walkPitch=T.MathUtils.clamp(walkPitch-(e.clientY-last.y)*.003,-1.15,1.15);updateWalkCamera();last={x:e.clientX,y:e.clientY};}});
 renderer.domElement.addEventListener('pointerup',e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<5)pick(e);down=null;last=null;});renderer.domElement.addEventListener('pointercancel',()=>{down=null;last=null;});
 renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
 document.addEventListener('keydown',e=>{if($$('dialog').some(d=>d.open)||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;const k=e.key.toLowerCase();if(state.walking&&['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){e.preventDefault();keys.add(k);}if(e.repeat)return;if(k==='escape'){if(state.walking)exitWalk();else overview();}else if(k==='p')setView(state.view==='3d'?'plan':'3d');else if(k==='n')setNight(!state.night);else if(k==='h')$('#furniture').click();else if(['1','2','3'].includes(k))setMode(['real','white','wire'][+k-1]);});document.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>keys.clear());
 const map={forward:'w',left:'a',back:'s',right:'d'};$$('[data-walk]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();keys.add(map[b.dataset.walk]);b.setPointerCapture(e.pointerId);};b.onpointerup=b.onpointercancel=()=>keys.delete(map[b.dataset.walk]);});
 new ResizeObserver(()=>{resize();if(!state.room&&!state.walking&&state.view==='3d')fitOverview();}).observe(host);
}
function loop(now){requestAnimationFrame(loop);const dt=Math.min((now-lastTime)/1000,.05);lastTime=now;
 if(animation&&!state.walking){let t=Math.min((now-animation.start)/animation.duration,1);t=1-Math.pow(1-t,3);camera.position.lerpVectors(animation.from,animation.to,t);controls.target.lerpVectors(animation.targetFrom,animation.targetTo,t);if(t>=1)animation=null;}
 if(state.walking)walk(dt);else controls.update();updateLabels();renderer.render(scene,camera);if(++frame%120===0)$('#render-status').textContent=`${state.walking?'人眼视高 1.62 m':'无天花板'} · 本地模型`;}
async function init(){
 renderer=new T.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.localClippingEnabled=true;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.outputColorSpace=T.SRGBColorSpace;host.append(renderer.domElement);renderer.domElement.setAttribute('aria-label','3D 住宅场景，使用左侧房间目录可进入各房间');renderer.domElement.tabIndex=0;
 scene=new T.Scene();const env=new RoomEnvironment(),pmrem=new T.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(env,.035).texture;env.dispose();pmrem.dispose();
 perspective=new T.PerspectiveCamera(39,1,.03,150);perspective.position.set(10.8,12.4,14.1);ortho=new T.OrthographicCamera(-8,8,7,-7,.1,100);camera=perspective;
 controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=.65;controls.maxDistance=45;controls.minZoom=.5;controls.maxZoom=6;controls.maxPolarAngle=Math.PI*.49;controls.target.set(.1,.2,.1);controls.addEventListener('start',()=>animation=null);
 ambient=new T.HemisphereLight('#fff8e9','#b9bdaf',1.45);scene.add(ambient);sun=new T.DirectionalLight('#fff4dc',3.2);sun.position.set(10,13,-4);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-10;sun.shadow.camera.right=10;sun.shadow.camera.top=10;sun.shadow.camera.bottom=-10;sun.shadow.camera.near=.5;sun.shadow.camera.far=45;sun.shadow.bias=-.0003;sun.shadow.normalBias=.025;scene.add(sun);fill=new T.DirectionalLight('#f0f4ef',.5);fill.position.set(-6,8,8);scene.add(fill);
 model=createModel(scene,renderer);
 ground=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:'#dedfd5',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-3.0;ground.receiveShadow=true;scene.add(ground);
 selection=new T.BoxHelper(undefined,'#a29164');selection.visible=false;selection.material.depthTest=false;selection.material.transparent=true;selection.material.opacity=.8;scene.add(selection);
 styleController=createSoftStyleController(model);layoutController=createLayoutController(model);
 setupNavigation();setupDesign();bindUI();resize();setNight(false);setSoftStyle('wood',false);fitOverview();
 // First render initializes shadows and texture uploads before dismissing the loader.
 renderer.render(scene,camera);requestAnimationFrame(()=>{$('#loading').style.opacity='0';setTimeout(()=>$('#loading').hidden=true,500);});
 window.__home={state,rooms,softStyles,layouts,layoutController,selectRoom,selectItem,enterRoom,exitWalk,overview,setMode,setView,setNight,setSoftStyle,model,renderer,get camera(){return camera;},get scene(){return scene;},get cameraPosition(){return camera.position.toArray();},testVisibility:()=>model.parts.filter(p=>p.visible).map(p=>p.userData.id)};
 requestAnimationFrame(loop);
}
init().catch(err=>{console.error(err);$('#loading').hidden=true;$('#error').hidden=false;$('#error-message').textContent='请使用支持 WebGL 的新版 Chrome 或 Edge，并开启浏览器硬件加速。错误信息：'+err.message;});
