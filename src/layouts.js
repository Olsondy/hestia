import * as T from 'three';

// Plan coordinates: east +x, south +z. Fixed architecture never enters this placement map.
export const layouts={
 wood:{title:'A · 原木会客',summary:'三人沙发＋单椅围合，卧室保留独立阅读角，书房增加矮柜。',tradeoff:'座位与收纳较多；客厅家具也更多。',
  notes:{living:'三人沙发朝西侧电视墙，北侧增加朝南单椅；茶几移到两组座位之间，南侧主过道留空。',bedroom:'床保持已确认的内墙床头位置；东侧单椅与边几构成独立阅读角，床尾不增加家具。',study:'书桌仍靠北，东侧放矮书柜；南侧留出书房门到阳台门的通行路线。',gaming:'保留北墙电竞桌，东侧窗提供侧光，矮柜在西墙。'},
  placements:{sofa:[6.1,1.55], 'coffee-table':[4.65,1.95], 'living-rug':[5.05,1.6], 'conversation-chair':[4.35,.65,Math.PI], 'reading-chair':[9.8,7.5], 'reading-table':[9.05,7.7], 'study-lowcase':[2.4,1.05]},hide:[],
  specs:{},walk:{study:[1.3,1.95],bedroom:[8.3,8.4]}},
 cream:{title:'B · 奶油舒展',summary:'双人沙发＋贵妃模块，圆几替代长茶几；卧室用床尾凳，书桌转向东墙。',tradeoff:'客厅适合躺坐，独立会客座位减少；卧室东侧留空。',
  notes:{living:'用圆角双人沙发和可分离贵妃模块组成 L 形，面向原电视墙。两只圆几放在西侧，南侧主过道留空。',bedroom:'床与两侧床头柜整体向东再移约 43 cm，床头仍靠内墙；移除东侧阅读椅，增加床尾长凳，东侧形成开敞活动区。',study:'书桌与壁架转到东墙，座椅从西侧使用；取消东侧矮柜，西侧阳台窗前留空。',gaming:'电竞桌转到西墙，椅子朝西，矮柜移到北墙；东窗与东南入口之间留出活动空间。'},
  placements:{bed:[7.15,6.15], 'bed-rug':[7.15,6.62], 'bedside-west':[5.895,5.385], 'bedside-east':[8.425,5.385], 'living-rug':[5.2,1.55,0,1,.95], 'study-desk':[2.3,.95,-Math.PI/2], 'study-chair':[1.5,.95,-Math.PI/2], 'study-shelf':[2.63,.95,-Math.PI/2], 'gaming-desk':[7.65,1.23,Math.PI/2], 'gaming-chair':[8.55,1.23,Math.PI/2], 'game-shelf':[9.3,.4,Math.PI/2]},
  hide:['sofa','coffee-table','reading-chair','reading-table'],specs:{},walk:{study:[1.1,1.9],bedroom:[9.5,7.1],gaming:[9.7,2.35]}},
 chinese:{title:'C · 轻中式对坐',summary:'木框坐榻＋单椅＋茶桌；卧室东南双椅对坐，书桌离墙摆放。',tradeoff:'增加聊天与阅读座位；卧室东南侧不再是整块空地。',
  notes:{living:'三人软沙发换为木框双人坐榻，北侧单椅朝南，与茶桌构成会客区；电视墙保持原位。',bedroom:'床头与原柜位置保留；东南侧设置两把相向休闲椅和中间小圆几，形成双人阅读、喝茶的位置。南侧热墙不作床头。',study:'书桌向南移约 49 cm，北侧保留壁架，桌子可从侧边绕行；东侧矮柜缩到北段，避让南侧门口。',gaming:'桌仍靠北墙，矮柜挪到西墙更靠北的位置；保持独立房间和东南入口。'},
  placements:{'conversation-chair':[4.35,.65,Math.PI], 'living-rug':[5.05,1.65], 'study-desk':[1.25,.95], 'study-chair':[1.25,1.65], 'study-lowcase':[2.4,.7], 'game-shelf':[7.54,1.6], 'tea-chair-west':[8.3,8.05,-Math.PI/2], 'tea-chair-east':[10.3,8.05,Math.PI/2]},
  hide:['sofa','coffee-table','reading-chair','reading-table'],specs:{},walk:{study:[1.15,2.08],bedroom:[8.3,7.3]}}
};
const solidIds=new Set(['sofa','coffee-table','bed','bedside-west','bedside-east','fixed-cabinet','reading-chair','reading-table','gaming-desk','gaming-chair','game-shelf','study-desk','study-chair','vanity','toilet','shower','conversation-chair','cream-sofa','cream-chaise','nesting-tables','chinese-settee','tea-table','bed-bench','tea-chair-west','tea-chair-east','bed-tea-table','study-lowcase']);
export function createLayoutController(model){
 const snapshots=new Map(model.parts.map(p=>[p,{position:p.position.clone(),rotation:p.rotation.clone(),scale:p.scale.clone()}]));
 const itemText=new Map([...model.items].map(([id,item])=>[id,{desc:item.desc,spec:item.spec}]));
 const roomText=new Map(model.rooms.map(r=>[r.id,{desc:r.desc,walk:[...r.walk]}]));
 const byId=new Map(model.parts.map(p=>[p.userData.id,p]));
 function footprints(){model.root.updateMatrixWorld(true);return model.parts.filter(p=>p.userData.layoutVisible!==false&&solidIds.has(p.userData.id)).map(p=>{const b=new T.Box3().setFromObject(p);return {id:p.userData.id,room:p.userData.roomIds[0],x:b.min.x+5,z:b.min.z+4.5,w:b.max.x-b.min.x,d:b.max.z-b.min.z};});}
 return {footprints,apply(id){const layout=layouts[id];if(!layout)throw Error('Unknown layout '+id);
  for(const p of model.parts){const base=snapshots.get(p);p.position.copy(base.position);p.rotation.copy(base.rotation);p.scale.copy(base.scale);p.userData.layoutVisible=(!p.userData.layouts||p.userData.layouts.includes(id))&&!layout.hide.includes(p.userData.id);}
  for(const [key,[x,z,yaw=0,sx=1,sz=1]]of Object.entries(layout.placements)){const p=byId.get(key);if(!p)throw Error('Missing furniture '+key);p.position.x=x;p.position.z=z;p.rotation.y=yaw;p.scale.x=sx;p.scale.z=sz;}
  for(const [key,item]of model.items){Object.assign(item,itemText.get(key));if(layout.notes[item.room]&&solidIds.has(key)&&key!=='fixed-cabinet')item.desc=layout.notes[item.room];}
  for(const room of model.rooms){room.desc=layout.notes[room.id]||roomText.get(room.id).desc;room.walk=[...(layout.walk?.[room.id]||roomText.get(room.id).walk)];}
  model.obstacles=footprints().map(({x,z,w,d})=>[x,z,w,d]);return layout;
 }};
}

// Small plan thumbnails use the same transformed solid footprints as the 3D scene.
export function planThumbnail(footprints,title){
 const rects=footprints.map(f=>`<rect x="${f.x}" y="${f.z}" width="${f.w}" height="${f.d}" rx=".04" fill="${f.id==='fixed-cabinet'?'#777c74':'#b4bda9'}" stroke="#52624e" stroke-width=".025"/>`).join('');
 return `<svg class="layout-thumbnail" viewBox="-1.6 -.5 13.2 10" role="img" aria-label="${title}家具平面缩略图"><path d="M-.25 0H11.05V9H1.55V4.7H-.25Z" fill="#f5f2e9" stroke="#586452" stroke-width=".09"/><path d="M-.25 2.45H2.75M2.75 0V9M2.75 4.7H11.05M7.2 0V3H11.05M1.55 4.7V9" fill="none" stroke="#586452" stroke-width=".055"/><path d="M2.9 3.6H10.4" stroke="#9a8971" stroke-width=".06" stroke-dasharray=".15 .12"/>${rects}<text x="2.9" y="4.3" font-size=".27" fill="#67715f">南侧主过道</text></svg>`;
}
