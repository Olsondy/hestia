export const STORAGE_KEY = 'idealhome.studio.v1';
export const clone = value => structuredClone(value);
export const uid = () => crypto.randomUUID?.() || `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;
export const titles = {wood:'原木会客',cream:'舒展日常',chinese:'围坐时光'};
export const fixedIds = new Set(['fixed-cabinet','fixed-ac','tv-wall','column','sliding-door','staircase','staircase-upper','stair-corridor-rail','game-door','bed-door','bath-door','study-door','balcony-door','window-study-balcony','acoustic','vanity','toilet','shower']);
export function blankProject(name = '未命名的家') {
  return {id:uid(),name,kind:'custom',layout:'wood',material:'wood',created:Date.now(),updated:Date.now(),walls:[],objects:[],overrides:{},locks:[],image:null,calibration:null,width:10,depth:8,history:[],future:[],messages:[]};
}
export function seedProjects(){return ['原木会客','舒展日常','围坐时光'].map((name,i)=>({...blankProject(name),id:`sample-${i+1}`,kind:'sample',layout:['wood','cream','chinese'][i],material:['wood','cream','chinese'][i],description:['为相聚留一处舒服的位置','给日常多一点自由的留白','把阅读与对话安放在一起'][i],updated:Date.now()-i*86400000}));}
export function loadStore(storage = localStorage) {
  const raw=storage.getItem(STORAGE_KEY);
  if(!raw)return {version:1,projects:seedProjects()};
  const data=JSON.parse(raw);
  if(data.version!==1||!Array.isArray(data.projects))throw Error('项目数据格式不兼容');
  return data;
}
export function saveStore(data,storage=localStorage){storage.setItem(STORAGE_KEY,JSON.stringify(data));}
const fields=['layout','material','walls','objects','overrides','locks','image','calibration','width','depth'];
export function snapshot(p){return Object.fromEntries(fields.map(k=>[k,clone(p[k])]));}
export function change(p,fn){const previous=snapshot(p);try{fn(p);}catch(error){Object.assign(p,previous);throw error;}p.history.push(previous);if(p.history.length>25)p.history.shift();p.future=[];p.updated=Date.now();}
export function undo(p){if(!p.history.length)return false;p.future.push(snapshot(p));Object.assign(p,p.history.pop());p.updated=Date.now();return true;}
export function redo(p){if(!p.future.length)return false;p.history.push(snapshot(p));Object.assign(p,p.future.pop());p.updated=Date.now();return true;}
export function isLocked(p,id){return fixedIds.has(id)||p.locks.includes(id);}
export function setPlacement(p,id,x,z,yaw){if(isLocked(p,id))throw Error('此物品位置已锁定，请先解除自定义锁定');if(![x,z,yaw].every(Number.isFinite))throw Error('请输入有效的坐标');if(Math.abs(x)>30||Math.abs(z)>30)throw Error('位置超出原型可编辑范围');if(p.kind==='sample')p.overrides[id]={x,z,yaw};else{const item=p.objects.find(o=>o.id===id);if(!item)throw Error('未找到物品');Object.assign(item,{x,z,yaw});}}
export function parseDemo(text) {
  if(/撤销/.test(text))return {type:'undo'};
  if(/方案|布局|原木|舒展|围坐|奶油|中式/.test(text))return {type:'layout',layout:/舒展|奶油/.test(text)?'cream':/围坐|中式/.test(text)?'chinese':'wood'};
  if(/夜|灯/.test(text))return {type:'night'};
  const match=text.match(/(床|沙发|书桌|茶几).*?(左|右|东|西|南|北|上|下).*?(\d+(?:\.\d+)?)\s*(厘米|cm|米|m)?/i);
  if(match){const number=Number(match[3])/(match[4]==='厘米'||match[4]?.toLowerCase()==='cm'?100:1);if(number>3||number<=0)return {type:'invalid',message:'演示中单次移动支持 0–3 米，请说明家具、方向和距离。'};return {type:'move',item:{床:'bed',沙发:'sofa',书桌:'study-desk',茶几:'coffee-table'}[match[1]],name:match[1],axis:/左|右|东|西/.test(match[2])?'x':'z',amount:number*(/左|西|上|北/.test(match[2])?-1:1)};}
  return {type:'help'};
}
