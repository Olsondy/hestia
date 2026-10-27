import * as T from 'three';

export const softStyles=[
 {id:'wood',name:'原木风',short:'原木',tag:'浅木 · 棉麻 · 鼠尾草绿',palette:['#c6a77d','#e8e1d1','#97a286','#c9b694'],
  desc:'浅木家具搭配棉麻沙发、米色窗帘和少量绿织物，木色有层次，整体明亮。',
  buying:'优先选纹理清楚的浅木饰面、可拆洗棉麻感面料和短绒或平织地毯。原木风是外观方向，不要求全部购买实木。',
  room:'客厅用浅木茶几与米灰沙发；卧室用浅木床架、绿灰床品；书房保持浅木桌椅。',
  colors:{oak:'#fff0d4',walnut:'#e6cfaa',fabric:'#d8d8c8',linen:'#fff7e7',green:'#9eab91',rug:'#d5c4a8',leather:'#8b9584',brass:'#ad976e'},curtain:'#eee5d3',wood:'oak',pattern:'woven'},
 {id:'cream',name:'奶油风',short:'奶油',tag:'米白 · 燕麦 · 浅暖灰',palette:['#f2eadc','#d8c9b5','#e4d4bd','#c7ad93'],
  desc:'米白沙发、燕麦色床品和浅暖色家具，以低对比的织物和圆角家具表达柔和感。',
  buying:'优先易清洁、可拆洗面料；先拿米白和燕麦色实物小样在家里比对，避免灯下偏黄。木纹仍保留少量，不必把原柜刷白。',
  room:'客厅用奶白织物与浅色茶几；卧室用燕麦床品和米白窗帘；书桌延续浅木，避免全屋纯白。',
  colors:{oak:'#f0e6d7',walnut:'#dfd0ba',fabric:'#fff5e7',linen:'#fffaf1',green:'#dfcdb4',rug:'#eee4d5',leather:'#cec2ae',brass:'#c0ab86'},curtain:'#fff5e6',wood:'cream',pattern:'soft'},
 {id:'chinese',name:'轻中式',short:'轻中式',tag:'深木 · 亚麻 · 墨青',palette:['#6c4d35','#e5dccb','#647a75','#b29b74'],
  desc:'深木家具压住空间，米麻色织物保持明亮，墨青靠垫、床品与细边地毯作点缀。',
  buying:'选线条简洁的深木家具、亚麻感面料和少量陶器。轻中式来自比例、材质与留白，不依赖雕花、满墙木饰面或昂贵红木。',
  room:'客厅用深木茶几与亚麻色沙发；卧室用深木床架、墨青床尾织物；书房用深木桌面和轻巧座椅。',
  colors:{oak:'#af8a67',walnut:'#9f7957',fabric:'#e2dbca',linen:'#f1e6d2',green:'#718b83',rug:'#d4c3a5',leather:'#6f7d73',brass:'#a58b5c'},curtain:'#ded3bc',wood:'walnut',pattern:'border'}
];
const eligible=new Set(['tv','sofa','living-rug','coffee-table','bed','bed-rug','bedside-west','bedside-east','reading-chair','reading-table','curtain-bedroom','curtain-living','curtain-gaming','gaming-desk','gaming-chair','game-shelf','study-desk','study-chair','study-shelf','conversation-chair','cream-sofa','cream-chaise','nesting-tables','chinese-settee','tea-table','bed-bench','tea-chair-west','tea-chair-east','bed-tea-table','study-lowcase']);

function textilePattern(style,surface){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const c=canvas.getContext('2d');
 c.fillStyle='#f6f3ea';c.fillRect(0,0,512,512);
 // Woven texture remains visible on cushions and bedding at close viewing distances.
 for(let i=0;i<512;i+=4){c.fillStyle=i%8?'#665a4812':'#ffffff66';c.fillRect(i,0,1,512);c.fillRect(0,i,512,1);}
 c.strokeStyle=style.pattern==='border'?'#455b5570':'#ad9d832f';
 if(style.pattern==='border'){
  c.lineWidth=surface==='rug'?8:2;
  if(surface==='rug'){c.strokeRect(24,24,464,464);c.lineWidth=2;c.strokeRect(39,39,434,434);}
  else for(let i=12;i<512;i+=54){c.beginPath();c.moveTo(i,0);c.lineTo(i,512);c.stroke();}
 }else if(style.pattern==='woven'){
  c.lineWidth=2;for(let i=16;i<512;i+=32){c.beginPath();c.moveTo(0,i);c.lineTo(512,i);c.stroke();}
 }else if(surface==='rug'){
  c.lineWidth=12;for(let i=70;i<512;i+=95){c.beginPath();c.arc(256,256,i,0,Math.PI*2);c.stroke();}
 }
 const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;return map;
}

export function createSoftStyleController(model,makePattern=textilePattern){
 const entries=[];const patterns=new Map();
 for(const part of model.parts){if(!eligible.has(part.userData.id))continue;
  part.traverse(mesh=>{if(!mesh.isMesh)return;const base=mesh.userData.original,surface=base?.userData.surface;
   if(!surface||!Object.hasOwn(softStyles[0].colors,surface))return;
   entries.push({mesh,base,surface,part:part.userData.id,variants:new Map()});
  });
 }
 return {eligible,entries,apply(id){
  const style=softStyles.find(s=>s.id===id);if(!style)throw new Error('Unknown soft furnishing style: '+id);
  for(const entry of entries){const {mesh,base,surface,part,variants}=entry;let material=variants.get(id);
   if(!material){material=base.clone();material.color.set(part.startsWith('curtain-')&&surface==='linen'?style.curtain:style.colors[surface]);
    if(surface==='oak'||surface==='walnut'){
     material.map=style.wood==='cream'?null:model.materials[style.wood].map;
     material.roughness=style.wood==='cream'?.72:.52;
    }
    if(surface==='rug'||surface==='green'){
     const key=id+'-'+surface;if(!patterns.has(key))patterns.set(key,makePattern(style,surface));material.map=patterns.get(key);
    }
    material.name=style.name+' / '+surface;variants.set(id,material);
   }
   const showingOriginal=mesh.material===mesh.userData.original;
   mesh.userData.original=material;if(showingOriginal)mesh.material=material;
  }
  return style;
 }};
}
