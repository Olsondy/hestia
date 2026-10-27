import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createModel,rooms} from './sample/model.js';
import {createLayoutController} from './sample/layouts.js';
import {createSoftStyleController} from './sample/soft-styles.js';

export class HomeScene {
  constructor(onSelect=()=>{}){
    this.renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFShadowMap;this.renderer.localClippingEnabled=true;this.renderer.toneMapping=T.ACESFilmicToneMapping;
    this.scene=new T.Scene();this.scene.background=new T.Color('#e9eef0');
    const env=new RoomEnvironment(),pm=new T.PMREMGenerator(this.renderer);this.scene.environment=pm.fromScene(env,.04).texture;env.dispose();pm.dispose();
    this.camera=new T.PerspectiveCamera(38,1,.05,120);this.camera.position.set(12,14,16);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.09;this.controls.maxPolarAngle=Math.PI*.49;this.controls.minDistance=1;this.controls.maxDistance=45;
    this.ambient=new T.HemisphereLight('#fffcf5','#9cabb3',2);this.scene.add(this.ambient);
    this.sun=new T.DirectionalLight('#fff3e1',3.2);this.sun.position.set(3,16,9);this.sun.castShadow=true;Object.assign(this.sun.shadow.camera,{left:-12,right:12,top:12,bottom:-12,near:1,far:45});this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.bias=-.0004;this.sun.shadow.normalBias=.03;this.scene.add(this.sun);
    this.model=createModel(this.scene,this.renderer);this.layouts=createLayoutController(this.model);this.styles=createSoftStyleController(this.model);
    this.custom=new T.Group();this.custom.position.copy(this.model.root.position);this.scene.add(this.custom);
    const g=new T.Mesh(new T.PlaneGeometry(2000,2000),new T.MeshStandardMaterial({color:'#e5ebed',roughness:1}));g.rotation.x=-Math.PI/2;g.position.y=-3.05;g.receiveShadow=true;this.scene.add(g);this.ground=g;
    this.selection=new T.BoxHelper(undefined,'#1f8b87');this.selection.visible=false;this.selection.material.depthTest=false;this.scene.add(this.selection);
    this.cache=new WeakMap();this.mode='real';this.furniture=true;this.cut=true;this.room=null;this.walking=false;this.onSelect=onSelect;
    this.ray=new T.Raycaster();this.mouse=new T.Vector2();this.keys=new Set();
    this.renderer.domElement.addEventListener('pointerdown',e=>{this.down={x:e.clientX,y:e.clientY};this.last=this.down;});
    this.renderer.domElement.addEventListener('pointermove',e=>{if(this.walking&&e.buttons){this.yaw-=(e.clientX-this.last.x)*.005;this.pitch=Math.max(-1,Math.min(1,this.pitch-(e.clientY-this.last.y)*.004));this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');}this.last={x:e.clientX,y:e.clientY};});
    this.renderer.domElement.addEventListener('pointerup',e=>{if(!this.walking&&this.down&&Math.hypot(e.clientX-this.down.x,e.clientY-this.down.y)<5)this.pick(e);this.down=null;});
    window.addEventListener('keydown',e=>{if(!e.target.closest('input,textarea,select'))this.keys.add(e.key.toLowerCase());});window.addEventListener('keyup',e=>this.keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>this.keys.clear());
    this.observer=new ResizeObserver(()=>this.resize());this.renderer.domElement.tabIndex=0;this.renderer.domElement.setAttribute('aria-label','可旋转缩放的三维住宅模型');
    this.previous=performance.now();this.tick=this.tick.bind(this);requestAnimationFrame(this.tick);
  }
  mount(host){this.host=host;host.append(this.renderer.domElement);this.observer.disconnect();this.observer.observe(host);this.resize();}
  resize(){if(!this.host)return;const {clientWidth:w,clientHeight:h}=this.host;if(!w||!h)return;const oldAspect=this.camera.aspect;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();if(this.folioView&&this.project)this.magazineView(this.folioView,false);else if(performance.now()>(this.preserveViewUntil||0)&&this.project&&!this.walking&&!this.room&&Math.abs(oldAspect-w/h)>.06)this.overview(false);}
  tick(now){const dt=Math.min((now-this.previous)/1000,.05);this.previous=now;if(this.host?.isConnected&&this.host.offsetWidth&&this.host.offsetHeight){
      if(this.walking){const f=Number(this.keys.has('w')||this.keys.has('arrowup'))-Number(this.keys.has('s')||this.keys.has('arrowdown'));const s=Number(this.keys.has('d')||this.keys.has('arrowright'))-Number(this.keys.has('a')||this.keys.has('arrowleft'));const v=new T.Vector3(-Math.sin(this.yaw)*f+Math.cos(this.yaw)*s,0,-Math.cos(this.yaw)*f-Math.sin(this.yaw)*s).multiplyScalar(dt*1.3);const p=this.camera.position;const r=rooms.find(r=>r.id===this.room);const rects=this.project.kind==='sample'?r?.rects:[[0,0,this.project.width,this.project.depth]];const inside=(x,z)=>rects?.some(([a,b,w,d])=>x+5>a+.2&&x+5<a+w-.2&&z+4.5>b+.2&&z+4.5<b+d-.2)&&!this.footprints().some(o=>x+5>o.x-.1&&x+5<o.x+o.w+.1&&z+4.5>o.z-.1&&z+4.5<o.z+o.d+.1);if(inside(p.x+v.x,p.z))p.x+=v.x;if(inside(p.x,p.z+v.z))p.z+=v.z;
      }else if(this.animation){const a=this.animation,t=Math.min(1,(now-a.start)/700),k=1-Math.pow(1-t,4);this.camera.position.lerpVectors(a.from,a.to,k);this.controls.target.lerpVectors(a.targetFrom,a.targetTo,k);if(t===1)this.animation=null;this.controls.update();}else this.controls.update();
      this.renderer.render(this.scene,this.camera);
    }requestAnimationFrame(this.tick);}
  apply(project){this.project=project;this.selected=null;this.selection.visible=false;this.room=null;this.custom.clear();this.model.root.visible=project.kind==='sample';this.custom.visible=project.kind!=='sample';this.layouts.apply(project.layout);this.styles.apply(project.material||'wood');
    this.activeItems=new Map();
    if(project.kind==='sample'){
      for(const [id,pos]of Object.entries(project.overrides)){const g=this.model.items.get(id)?.group;if(g){g.position.x=pos.x;g.position.z=pos.z;g.rotation.y=pos.yaw;}}
      for(const [id,item]of this.model.items)if(item.group.userData.layoutVisible!==false)this.activeItems.set(id,item);
    }else{
      const base=new T.Mesh(new T.BoxGeometry(project.width,.12,project.depth),new T.MeshStandardMaterial({color:'#dfd5c4',roughness:.85}));base.position.set(project.width/2,-.06,project.depth/2);base.receiveShadow=true;base.userData.original=base.material;this.custom.add(base);
      for(const w of project.walls){const len=Math.hypot(w.x2-w.x1,w.z2-w.z1);const m=new T.Mesh(new T.BoxGeometry(len,2.7,.16),new T.MeshStandardMaterial({color:'#f8f7f1',roughness:.8}));m.position.set((w.x1+w.x2)/2,1.35,(w.z1+w.z2)/2);m.rotation.y=-Math.atan2(w.z2-w.z1,w.x2-w.x1);m.userData={id:w.id,cuttable:true,original:m.material};m.castShadow=m.receiveShadow=true;this.custom.add(m);}
      for(const o of project.objects){const template=this.model.items.get(o.type);if(!template)continue;const materials=[];template.group.traverse(m=>{if(m.isMesh)materials.push(m.userData.original||m.material);});const group=template.group.clone(true);let materialIndex=0;group.traverse(m=>{if(m.isMesh){m.material=materials[materialIndex++];m.userData={cuttable:!!m.userData.cuttable,original:m.material};}if(m.isLineSegments)m.visible=false;});group.position.set(o.x,0,o.z);group.rotation.y=o.yaw;group.visible=true;group.userData={id:o.id,kind:'furniture',roomIds:['custom']};this.custom.add(group);this.activeItems.set(o.id,{...template,id:o.id,name:o.name,room:'custom',group});}
    }this.refresh();
  }
  items(){return [...this.activeItems.values()];}
  footprints(){(this.project.kind==='sample'?this.model.root:this.custom).updateMatrixWorld(true);return this.items().filter(i=>i.group.userData.kind==='furniture'&&!/rug|curtain|shelf|ac$|tv$/.test(i.id)).map(i=>{const b=new T.Box3().setFromObject(i.group);return {id:i.id,name:i.name,x:b.min.x+5,z:b.min.z+4.5,w:b.max.x-b.min.x,d:b.max.z-b.min.z,px:i.group.position.x,pz:i.group.position.z,yaw:i.group.rotation.y};}).filter(i=>i.w<15&&i.d<15);}
  walls(){if(this.project.kind!=='sample')return this.project.walls;const out=[];for(const p of this.model.parts.filter(p=>p.userData.kind==='wall'))for(const m of p.children){if(!m.isMesh)continue;m.updateWorldMatrix(true,false);const b=new T.Box3().setFromObject(m);if(b.min.y>.15||b.max.y<.5)continue;out.push({id:p.userData.id,x:b.min.x+5,z:b.min.z+4.5,w:b.max.x-b.min.x,d:b.max.z-b.min.z});}return out;}
  refresh(){const selected=this.activeItems.get(this.selected);this.selection.visible=!!selected&&this.furniture;if(selected)this.selection.setFromObject(selected.group);
    const all=this.project.kind==='sample'?this.model.parts:this.custom.children;
    for(const p of all){if(this.project.kind==='sample')p.visible=p.userData.layoutVisible!==false&&(!this.room||p.userData.kind!=='base'&&p.userData.roomIds?.includes(this.room))&&!(p.userData.kind==='furniture'&&!this.furniture);else p.visible=!(p.userData.kind==='furniture'&&!this.furniture);}
    const root=this.project.kind==='sample'?this.model.root:this.custom;
    root.traverse(m=>{if(!m.isMesh)return;const original=m.userData.original||m.material;let cache=this.cache.get(m);if(!cache){cache={white:new T.MeshStandardMaterial({color:'#f7f8f7',roughness:.9}),wire:new T.MeshBasicMaterial({color:'#80959e',wireframe:true,transparent:true,opacity:.35})};this.cache.set(m,cache);}m.material=this.mode==='real'?original:cache[this.mode];m.material.clippingPlanes=m.userData.cuttable&&this.cut&&!this.walking?[this.model.cutPlane]:null;m.material.clipShadows=true;m.material.needsUpdate=true;});
    for(const {light,power} of this.model.lights)light.intensity=this.night?power:0;
  }
  select(id){this.selected=id;this.refresh();}
  motion(to,target){if(matchMedia('(prefers-reduced-motion: reduce)').matches){this.camera.position.copy(to);this.controls.target.copy(target);this.controls.update();return;}this.animation={start:performance.now(),from:this.camera.position.clone(),to,targetFrom:this.controls.target.clone(),targetTo:target};}
  magazineView(view,animate=true){
    this.folioView=view;this.walking=false;this.controls.enabled=true;this.camera.fov=38;this.camera.updateProjectionMatrix();this.mode='real';
    this.room=view==='living'&&this.project.kind==='sample'?'living':null;this.refresh();
    let bounds;
    if(this.room){const r=rooms.find(r=>r.id===this.room);bounds=new T.Box3();const [x,z,w,d]=r.rects[0];bounds.expandByPoint(new T.Vector3(x-5,0,z-4.5));bounds.expandByPoint(new T.Vector3(x+w-5,2.4,z+d-4.5));}
    else{const root=this.project.kind==='sample'?this.model.root:this.custom;root.updateMatrixWorld(true);bounds=new T.Box3();root.traverseVisible(m=>{if(!m.isMesh)return;const box=new T.Box3().setFromObject(m);box.min.y=Math.max(box.min.y,-.15);if(m.userData.cuttable)box.max.y=Math.min(box.max.y,1.12);if(!box.isEmpty())bounds.union(box);});}
    if(bounds.isEmpty())bounds.set(new T.Vector3(-5,0,-4),new T.Vector3(5,1,4));
    const target=bounds.getCenter(new T.Vector3());
    const direction=new T.Vector3(...(view==='plan'?[0,1,.001]:view==='living'?[8,10,12]:[11,16,17])).normalize();
    const right=new T.Vector3().crossVectors(new T.Vector3(0,1,0),direction).normalize(),up=new T.Vector3().crossVectors(direction,right);
    const tanY=Math.tan(T.MathUtils.degToRad(this.camera.fov/2)),tanX=tanY*this.camera.aspect;let distance=1;
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const delta=new T.Vector3(x,y,z).sub(target);distance=Math.max(distance,delta.dot(direction)+Math.max(Math.abs(delta.dot(right))/(tanX*.88),Math.abs(delta.dot(up))/(tanY*.78)));}
    this.controls.maxDistance=Math.max(45,distance*1.6);this.camera.far=Math.max(120,distance*3);this.camera.updateProjectionMatrix();
    const position=target.clone().addScaledVector(direction,distance);
    if(animate)this.motion(position,target);else{this.animation=null;this.camera.position.copy(position);this.controls.target.copy(target);this.controls.update();}
  }
  overview(animate=true){
    this.walking=false;this.keys.clear();this.controls.enabled=true;this.camera.fov=38;this.camera.updateProjectionMatrix();this.room=null;this.refresh();
    const root=this.project.kind==='sample'?this.model.root:this.custom,bounds=new T.Box3();root.updateMatrixWorld(true);
    root.traverseVisible(mesh=>{if(!mesh.isMesh)return;const box=new T.Box3().setFromObject(mesh);if(mesh.userData.cuttable&&this.cut)box.max.y=Math.min(box.max.y,1.12);if(!box.isEmpty())bounds.union(box);});
    if(bounds.isEmpty())bounds.set(new T.Vector3(-5,0,-4.5),new T.Vector3(5,2.7,3.5));
    const target=bounds.getCenter(new T.Vector3()),direction=new T.Vector3(12.8,15,16.5).normalize(),right=new T.Vector3().crossVectors(new T.Vector3(0,1,0),direction).normalize(),up=new T.Vector3().crossVectors(direction,right);
    const tanY=Math.tan(T.MathUtils.degToRad(this.camera.fov/2)),tanX=tanY*this.camera.aspect;let distance=1;
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const delta=new T.Vector3(x,y,z).sub(target);distance=Math.max(distance,delta.dot(direction)+Math.max(Math.abs(delta.dot(right))/(tanX*.84),Math.abs(delta.dot(up))/(tanY*.78)));}
    // OrbitControls must not clamp a valid portrait fit back into the model.
    this.controls.maxDistance=Math.max(45,distance*1.6);this.camera.far=Math.max(120,distance*3);this.camera.updateProjectionMatrix();
    const position=target.clone().addScaledVector(direction,distance);if(animate)this.motion(position,target);else{this.animation=null;this.camera.position.copy(position);this.controls.target.copy(target);this.controls.update();}
  }
  focus(room,walk=false){const r=rooms.find(r=>r.id===room);if(!r)return;this.walking=false;this.controls.enabled=true;this.room=room;this.refresh();const target=new T.Vector3(r.center[0]-5,.4,r.center[1]-4.5);if(walk){this.animation=null;this.room=room;this.walking=true;this.controls.enabled=false;this.camera.fov=65;this.camera.updateProjectionMatrix();this.camera.position.set(r.walk[0]-5,1.62,r.walk[1]-4.5);const direction=new T.Vector3(r.look[0]-5,1.4,r.look[1]-4.5).sub(this.camera.position).normalize();this.yaw=Math.atan2(-direction.x,-direction.z);this.pitch=Math.asin(direction.y);this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');this.refresh();}else this.motion(target.clone().add(new T.Vector3(...r.focus).multiplyScalar(1.2)),target);}
  setNight(value){this.night=value;this.scene.background.set(value?'#192b35':this.theme==='editorial'?'#c9b8a7':'#e9eef0');this.ground.material.color.set(value?'#192b35':this.theme==='editorial'?'#c9b8a7':'#e5ebed');this.ambient.intensity=value?.22:1.25;this.sun.intensity=value?.12:2.2;this.scene.environmentIntensity=value?.16:.4;this.renderer.toneMappingExposure=value?.9:.95;for(const m of this.model.glows)m.emissiveIntensity=value?3:.05;if(this.project)this.refresh();}
  setTheme(theme){this.theme=theme;this.selection.material.color.set(theme==='editorial'?'#763b46':'#1f8b87');this.setNight(this.night);}
  pick(event){const rect=this.renderer.domElement.getBoundingClientRect();this.mouse.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);this.ray.setFromCamera(this.mouse,this.camera);const root=this.project.kind==='sample'?this.model.root:this.custom;for(const hit of this.ray.intersectObject(root,true)){if(!hit.object.isMesh)continue;let obj=hit.object,visible=true;while(obj){if(!obj.visible)visible=false;obj=obj.parent;}if(!visible||hit.object.userData.cuttable&&this.cut&&hit.point.y>1.12)continue;obj=hit.object;while(obj&&!this.activeItems.has(obj.userData.id))obj=obj.parent;if(obj){this.onSelect(obj.userData.id);return;}}}
  screenshot(){this.renderer.render(this.scene,this.camera);return this.renderer.domElement.toDataURL('image/png');}
  thumbnail(project){const oldHost=this.host;const oldAspect=this.camera.aspect;this.apply(project);this.camera.aspect=1.6;this.camera.updateProjectionMatrix();this.renderer.setSize(800,500);this.overview(false);this.camera.position.sub(this.controls.target).multiplyScalar(.76).add(this.controls.target);this.controls.update();if(this.theme==='editorial'&&project.kind==='sample'&&project.layout!=='wood'){const r=rooms.find(r=>r.id==='living');this.room='living';this.refresh();const target=new T.Vector3(r.center[0]-5,.3,r.center[1]-4.5);this.controls.target.copy(target);this.camera.position.copy(target).add(new T.Vector3(...(project.layout==='cream'?[5.2,7.2,7.8]:[-6,7,7.2])));this.controls.update();}this.setNight(false);this.renderer.render(this.scene,this.camera);const result=this.renderer.domElement.toDataURL('image/jpeg',.82);this.camera.aspect=oldAspect;if(oldHost)this.resize();return result;}
}
