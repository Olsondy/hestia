import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {makeMaterials} from './textures.js';

// Nominal wall-position spans; the stair sequence is diagrammatic, not construction geometry.
export const dimensions={bedroomWest:2.75,bedroomSpan:8.3,east:11.05,balconyWest:-1.15,studyWest:-.25,studyWidth:3};
const EAST=dimensions.east,DX=EAST-10,BED_SHIFT=.6;
export const rooms=[
 {id:'living',name:'客厅',index:'01',rects:[[2.75,0,4.45,3],[2.75,3,8.3,1.7]],label:[4.15,2.93],center:[5.4,2.1],walk:[4.15,3.72],look:[4.6,1.3],desc:'保留西侧电视墙，沙发朝西，南侧的连续通道连接楼梯、卧室与独立电竞房。东侧保持低家具，减少对采光的遮挡。',note:'电视墙位置已确认；电视、饰面、灯具与沙发外观为效果提案。',focus:[3.7,4.8,5]},
 {id:'gaming',name:'电竞房',index:'02',rects:[[7.2,0,3.85,3]],label:[8.825,2.22],center:[9.125,1.5],walk:[10.4,2.5],look:[8.925,.55],desc:'保留两面后砌墙和西南角柱位。电竞桌朝北，东窗侧向采光；夜间关门、使用耳机。隔声重点是房门、墙顶和穿线孔。',note:'柱位与独立空间已确认。展示的吸声饰面主要减混响，实际隔声构造、通风与空调须另行深化。',focus:[2.5,3.1,3.3]},
 {id:'bedroom',name:'卧室',index:'03',rects:[[2.75,4.7,8.3,4.3]],label:[6.775,8.25],center:[6.9,6.85],walk:[8.275,8.12],look:[6.775,5.6],desc:'床、两侧床头柜与地毯靠东摆放，远离门口，床头朝北侧内墙。西侧整排固定柜与东北角原挂式空调原位保留，东窗前保持通透。',note:'西墙到东窗墙据记忆为 8 米多，本版暂按墙位跨度 8.3 m 对比，包含柜深，非实测净尺寸。南侧墙夏季傍晚很热（据述），床头仍靠内墙。',focus:[4.4,5.4,5.5]},
 {id:'study',name:'书房',index:'04',rects:[[-.25,0,3,2.45]],label:[1.25,1.56],center:[1.25,1.22],walk:[2.2,1.85],look:[1.25,.38],desc:'书桌靠北，左下角阳台门与南侧书房门之间留出通行空间。西侧补充面向阳台的玻璃窗，阳台门保留；窗型尺寸暂拟，以工作灯补足照度。',note:'书房与下方楼梯、过道整块等宽；阳台从西侧凸出。左右暂按 3 m 对比，南北距离暂沿用。旧床与横摆柜子的记忆仅作尺度线索；阳台门开向及实际采光待确认。',focus:[2.3,3,3.4]},
 {id:'bathroom',name:'卫生间',index:'05',rects:[[1.55,4.7,1.2,4.3]],label:[2.15,7.1],center:[2.15,6.85],walk:[2.17,5.2],look:[2.16,7.2],desc:'保留现有湿区与管线关系。这里展示浅灰瓷砖、洗漱、坐便与淋浴的材质概念，不据此改动现有洁具位置。',note:'洁具数量、位置、设备型号均为演示占位，需量房后按现有排水修正。',focus:[2.5,4,4.5]},
 {id:'balcony',name:'阳台',index:'06',rects:[[-1.15,0,.9,2.45]],label:[-.71,1.22],center:[-.7,1.22],walk:[-.71,1.85],look:[-.72,.4],desc:'通过书房左下角的阳台门到达。以浅色地砖和少量绿植表达休闲角，保留门口通行。',note:'向西凸出主体的关系已确认；凸出深度暂沿用 0.9 m。栏杆及开放或封闭形式仍是展示假设。',focus:[2,2.6,3.1]},
 {id:'stairs',name:'楼梯与过道',index:'07',rects:[[-.25,2.45,3,2.25]],label:[2.14,3.55],center:[1.25,3.6],walk:[2.16,3.92],look:[1.05,3.5],desc:'左侧是梯段，右侧是二层过道。卫生间门正对书房门；靠卫生间端上到二楼，靠书房端继续通往三楼。客厅大滑门位于过道东侧。',note:'一楼至二楼：11 级 → 平平台 A → 约 5 级 → 平平台 B → 11 级。27 级在暂定范围内压缩示意，不能据此读取踏步进深、级高或净空。上楼梯段已恢复，级数暂拟；下层扶手经二楼过道护栏连续接到上层。住宅共四层，各层按同样方式延续；仅展示一个代表层及连接梯段。',focus:[3,3.5,4]}
];

export function createModel(scene,renderer){
 const root=new T.Group();root.position.set(-5,0,-4.5);scene.add(root);
 const {mats:m,floorMaterial,std}=makeMaterials(renderer);
 const items=new Map(),parts=[],meshes=[],lights=[],glows=[],obstacles=[];
 const boxGeo=new T.BoxGeometry(1,1,1),sphereGeo=new T.SphereGeometry(1,24,16),cylGeo=new T.CylinderGeometry(.5,.5,1,24),cutPlane=new T.Plane(new T.Vector3(0,-1,0),1.12);
 function group(id,roomIds,kind='architecture',data={}){const g=new T.Group();g.userData={id,roomIds:[].concat(roomIds),kind,...data};root.add(g);parts.push(g);return g;}
 function item(id,room,name,status,desc,spec,x,z,build){const g=group(id,room,'furniture');g.position.set(x,0,z);const data={id,room,name,status,desc,spec,group:g};items.set(id,data);build(g);return g;}
 function add(g,geo,mat,x,y,z,scale,cut=false){const mesh=new T.Mesh(geo,cut?mat.clone():mat);mesh.position.set(x,y,z);if(scale)mesh.scale.set(...scale);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.original=mesh.material;mesh.userData.cuttable=cut;g.add(mesh);meshes.push(mesh);return mesh;}
 const box=(g,x,y,z,w,h,d,mat=m.oak,cut=false)=>add(g,boxGeo,mat,x,y,z,[w,h,d],cut);
 const round=(g,x,y,z,w,h,d,mat=m.fabric,r=.06)=>add(g,new RoundedBoxGeometry(w,h,d,3,Math.min(r,w/3,h/3,d/3)),mat,x,y,z);
 const cyl=(g,x,y,z,r,h,mat=m.metal)=>add(g,cylGeo,mat,x,y,z,[r*2,h,r*2]);
 const ellipsoid=(g,x,y,z,rx,ry,rz,mat)=>add(g,sphereGeo,mat,x,y,z,[rx,ry,rz]);
 const rod=(g,a,b,r=.014,mat=m.metal)=>{const va=new T.Vector3(...a),vb=new T.Vector3(...b),mid=va.clone().add(vb).multiplyScalar(.5);const o=cyl(g,...mid.toArray(),r,va.distanceTo(vb),mat);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),vb.sub(va).normalize());return o;};
 const tube=(g,pts,r=.012,mat=m.metal)=>add(g,new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(p=>new T.Vector3(...p))),Math.max(12,pts.length*8),r,6,false),mat,0,0,0);
 function lampLight(g,x,y,z,power=25,range=5){const l=new T.PointLight('#ffd6a0',0,range,2);l.position.set(x,y,z);g.add(l);lights.push({light:l,power});return l;}
 function luminous(g,x,y,z,w,h,d){const mat=m.emissive.clone();const o=box(g,x,y,z,w,h,d,mat);glows.push(mat);o.castShadow=false;return o;}
 function book(g,x,y,z,w=.16,d=.22,color='#74806a',rot=0){const b=new T.Group();b.position.set(x,y,z);b.rotation.y=rot;g.add(b);box(b,0,.017,0,w,.034,d,std(color,.85));box(b,0,.017,.004,w-.01,.02,d-.012,m.linen);return b;}
 function cup(g,x,y,z,mat=m.ceramic){cyl(g,x,y+.055,z,.04,.11,mat);const h=add(g,new T.TorusGeometry(.033,.008,8,20),mat,x+.047,y+.06,z);h.rotation.y=Math.PI/2;}
 function plant(g,x,y,z,size=.45){cyl(g,x,y+size*.22,z,size*.2,size*.44,m.stone);cyl(g,x,y+size*.44,z,size*.18,.012,m.soil);for(let i=0;i<9;i++){const a=i*2.4,hh=size*(.65+(i%3)*.17);rod(g,[x,y+size*.4,z],[x+Math.cos(a)*size*.16,y+hh,z+Math.sin(a)*size*.16],.006,m.leaf);const leaf=ellipsoid(g,x+Math.cos(a)*size*.25,y+hh,z+Math.sin(a)*size*.25,size*.14,size*.27,size*.04,m.leaf);leaf.rotation.set(.5*Math.sin(a),a,.55*Math.cos(a));}}
 function deskLamp(g,x,y,z){cyl(g,x,y+.015,z,.1,.03,m.brass);rod(g,[x,y+.02,z],[x,y+.32,z],.012,m.brass);rod(g,[x,y+.32,z],[x+.1,y+.44,z],.012,m.brass);const shade=add(g,new T.ConeGeometry(.105,.14,24,1,true),m.brass,x+.1,y+.41,z);shade.rotation.z=-.25;luminous(g,x+.1,y+.355,z,.12,.006,.12);lampLight(g,x+.1,y+.34,z,6,1.7);}
 function tableLamp(g,x,y,z){cyl(g,x,y+.018,z,.105,.035,m.brass);cyl(g,x,y+.19,z,.012,.32,m.brass);const shade=add(g,new T.CylinderGeometry(.115,.16,.21,32,1,true),m.linen,x,y+.41,z);shade.material.side=T.DoubleSide;const bulb=ellipsoid(g,x,y+.32,z,.035,.045,.035,m.emissive.clone());glows.push(bulb.material);lampLight(g,x,y+.33,z,9,2.3);}
 function officeChair(g,x,z,mat=m.leather){const q=new T.Group();q.position.set(x,0,z);g.add(q);cyl(q,0,.27,0,.025,.42,m.metal);for(let i=0;i<5;i++){const a=i*Math.PI*2/5;rod(q,[0,.12,0],[Math.sin(a)*.28,.08,Math.cos(a)*.28],.018,m.metal);const wheel=cyl(q,Math.sin(a)*.28,.045,Math.cos(a)*.28,.035,.045,m.black);wheel.rotation.z=Math.PI/2;}round(q,0,.49,0,.5,.12,.48,mat,.04);round(q,0,.82,.21,.48,.57,.1,mat,.045);for(const xx of [-.29,.29]){rod(q,[xx,.45,.1],[xx,.68,.1],.012,m.metal);round(q,xx,.69,.02,.065,.04,.27,m.black,.015);}return q;}
 function roomFloor(room,x,z,w,d,kind){const g=group('floor-'+room+'-'+x,room,'floor');box(g,x+w/2,-.04,z+d/2,w,.075,d,floorMaterial(w,d,kind));return g;}
 // Continuous slab with a diagrammatic stair opening; no ceiling is constructed.
 const sh=new T.Shape();[[-1.15,0],[EAST,0],[EAST,9],[1.55,9],[1.55,4.7],[-.25,4.7],[-.25,2.45],[-1.15,2.45]].forEach(([x,z],i)=>i?sh.lineTo(x,-z):sh.moveTo(x,-z));sh.closePath();
 const hole=new T.Path();[[-.18,2.53],[-.18,4.67],[1.55,4.67],[1.55,2.53]].forEach(([x,z],i)=>i?hole.lineTo(x,-z):hole.moveTo(x,-z));hole.closePath();sh.holes.push(hole);
 const base=group('base',rooms.map(r=>r.id),'base');const slab=add(base,new T.ExtrudeGeometry(sh,{depth:.18,bevelEnabled:false}),m.stone,0,-.24,0);slab.rotation.x=-Math.PI/2;
 for(const r of rooms)for(const [x,z,w,d] of r.rects){if(r.id==='stairs')roomFloor(r.id,1.55,2.45,1.2,2.25,'tile');else roomFloor(r.id,x,z,w,d,['bathroom','balcony'].includes(r.id)?'tile':'wood');}
 function wall(id,roomIds,x1,z1,x2,z2,{h=2.8,th=.16,openings=[]}={}){const g=group(id,roomIds,'wall');const len=Math.hypot(x2-x1,z2-z1),dx=(x2-x1)/len,dz=(z2-z1)/len;const seg=(a,b,low,high)=>{if(b-a<.005||high-low<.005)return;const mid=(a+b)/2;const o=box(g,x1+mid*dx,(low+high)/2,z1+mid*dz,b-a,high-low,th,m.wall,true);o.rotation.y=-Math.atan2(dz,dx);};let at=0;for(const o of openings.sort((a,b)=>a.a-b.a)){seg(at,o.a,0,h);seg(o.a,o.b,0,o.low||0);seg(o.a,o.b,o.high||2.15,h);at=o.b;}seg(at,len,0,h);
  // skirting follows the solid wall runs; openings stay clear.
  let s=0;for(const o of [...openings,{a:len,b:len}]){if(o.a>s){const mid=(s+o.a)/2;const sk=box(g,x1+mid*dx,.045,z1+mid*dz,o.a-s,.09,th+.015,m.trim,true);sk.rotation.y=-Math.atan2(dz,dx);}s=o.b;}return g;}
 wall('north-study','study',-.25,0,2.75,0,{th:.22});wall('north-living','living',2.75,0,7.2,0,{th:.22});wall('north-gaming','gaming',7.2,0,EAST,0,{th:.22});
 wall('weststairs','stairs',-.25,2.45,-.25,4.7,{th:.22});wall('notch','stairs',-.25,4.7,1.55,4.7,{th:.22});wall('bathwest','bathroom',1.55,4.7,1.55,9,{th:.22});wall('south-bath','bathroom',1.55,9,2.75,9,{th:.22});wall('south-bedroom','bedroom',2.75,9,EAST,9,{th:.22});
 wall('balcony-divider',['study','balcony'],-.25,0,-.25,2.45,{openings:[{a:.2,b:1.4,low:.9,high:2.25},{a:1.55,b:2.35}]});
 wall('study-south',['study','stairs'],-.25,2.45,2.75,2.45,{openings:[{a:2.08,b:2.87}]});
 wall('living-west-study',['study','living'],2.75,0,2.75,2.45);
 wall('living-west-stairs',['stairs','living'],2.75,2.45,2.75,4.7,{openings:[{a:.15,b:1.95}]});
 wall('bath-divider',['bathroom','bedroom'],2.75,4.7,2.75,9);
 wall('bath-north',['bathroom','stairs'],1.55,4.7,2.75,4.7,{openings:[{a:.27,b:1.03}]});
 wall('bed-north',['living','bedroom'],2.75,4.7,EAST,4.7,{openings:[{a:.45,b:1.27}]});
 wall('game-west',['gaming','living'],7.2,0,7.2,3);wall('game-south',['gaming','living'],7.2,3,EAST,3,{openings:[{a:1.83+DX,b:2.65+DX}]});
 wall('east','gaming',EAST,0,EAST,3,{th:.22,openings:[{a:.55,b:2.35,low:.88,high:2.36}]});
 wall('east-living','living',EAST,3,EAST,4.7,{th:.22,openings:[{a:.26,b:1.42,low:.88,high:2.36}]});
 wall('east-bedroom','bedroom',EAST,4.7,EAST,9,{th:.22,openings:[{a:1.05,b:3.62,low:.88,high:2.36}]});
 function windowUnit(room,z1,z2){const g=group('window-'+room,room,'window');g.userData.note='东侧窗洞数量、位置与尺寸均为展示假设';const zm=(z1+z2)/2;for(const z of [z1,z2,zm])box(g,EAST,1.62,z,.12,1.48,.035,m.metal,true);for(const y of [.9,2.34])box(g,EAST,y,zm,.12,.04,z2-z1,m.metal,true);box(g,EAST,1.62,zm,.02,1.4,z2-z1-.05,m.glass,true);box(g,EAST-.04,.87,zm,.35,.05,z2-z1+.14,m.stone,true);return g;}
 windowUnit('gaming',.55,2.35);windowUnit('living',3.26,4.42);windowUnit('bedroom',5.75,8.32);
 // Requested balcony-side window: retain the separate southwest balcony door.
 const studyWindow=group('window-study-balcony',['study','balcony'],'window');
 for(const z of [.2,.8,1.4])box(studyWindow,-.25,1.575,z,.12,1.35,.035,m.metal);
 for(const y of [.92,2.23])box(studyWindow,-.25,y,.8,.12,.04,1.2,m.metal);
 for(const z of [.5,1.1])box(studyWindow,-.25,1.575,z,.018,1.27,.565,m.glass);
 box(studyWindow,-.22,.88,.8,.3,.04,1.32,m.stone);
 for(const z of [.74,.86])box(studyWindow,-.175,1.5,z,.025,.12,.018,m.brass);
 items.set('window-study-balcony',{id:'window-study-balcony',room:'study',name:'书房阳台侧窗',status:'按要求补充 · 尺寸暂拟',desc:'在书房西侧、面向阳台的墙上补充双扇玻璃窗。左下角阳台门保留，窗与门之间留墙垛；窗型、开启方式和尺寸为展示假设。',spec:'窗约 1200 × 1350 mm；窗台约 900 mm',group:studyWindow});
 // Balcony form is a visual placeholder, not a confirmed parapet design.
 const balconyRail=group('balcony-railing','balcony','wall');for(const [a,b] of [[[-1.15,0],[-.25,0]],[[-1.15,0],[-1.15,2.45]],[[-1.15,2.45],[-.25,2.45]]]){rod(balconyRail,[a[0],1.05,a[1]],[b[0],1.05,b[1]],.025,m.metal);const count=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.18);for(let i=0;i<=count;i++){const f=i/count;rod(balconyRail,[a[0]+(b[0]-a[0])*f,.05,a[1]+(b[1]-a[1])*f],[a[0]+(b[0]-a[0])*f,1.05,a[1]+(b[1]-a[1])*f],.012,m.metal);}}
 function hingedDoor(id,room,name,x,z,w,angle,glass=false){const g=group(id,room,'door');g.position.set(x,0,z);const pivot=new T.Group();pivot.rotation.y=angle;g.add(pivot);box(pivot,w/2,1.06,0,w,2.12,.045,glass?m.glass:m.oak,true);for(const xx of [0,w])box(pivot,xx,1.06,0,.035,2.14,.06,m.walnut,true);for(const yy of [.035,2.09])box(pivot,w/2,yy,0,w,.035,.06,m.walnut,true);box(pivot,w-.09,1.0,.04,.1,.016,.023,m.brass,true);items.set(id,{id,room:[].concat(room)[0],name,status:'原门位置 · 开启示意',desc:'保留现有门洞。门扇外观与精确开启角度用于效果展示，需与现场实测一致。',spec:'门扇尺寸为暂拟值',group:g});return g;}
 hingedDoor('study-door',['study','stairs'],'书房门',1.83,2.45,.79,Math.PI/2,true);
 hingedDoor('balcony-door',['balcony','study'],'阳台门',-.25,2.35,.8,Math.PI,true);
 hingedDoor('game-door',['gaming','living'],'电竞房密封门',9.03,3,.82,Math.PI/2);
 hingedDoor('bed-door',['bedroom','living'],'卧室内开门',3.2,4.7,.82,-Math.PI/2);
 hingedDoor('bath-door',['bathroom','stairs'],'卫生间门',2.58,4.7,.76,-Math.PI/2);
 const sliding=group('sliding-door',['living','stairs'],'door');for(const yy of [.02,2.18])box(sliding,2.75,yy,3.5,.15,.035,1.8,m.metal,true);for(const xx of [2.71,2.79]){box(sliding,xx,1.08,3.08,.028,2.12,.87,m.glass,true);for(const zz of [2.65,3.51])box(sliding,xx,1.08,zz,.04,2.12,.025,m.metal,true);box(sliding,xx+.025,1.06,3.4,.018,.22,.018,m.brass,true);}
 items.set('sliding-door',{id:'sliding-door',room:'living',name:'客厅大滑动门',status:'位置已确认 · 原位保留',desc:'连接二层过道与客厅，和卧室门斜对。当前展示部分开启状态；门洞宽度、扇数及轨道形式待实测。',spec:'门洞暂按 1.8 m 表达，非实测',group:sliding});
 const column=group('column',['gaming','living'],'structure');box(column,7.2,1.4,3,.28,2.8,.28,m.wall,true);items.set('column',{id:'column',room:'gaming',name:'电竞房西南角柱',status:'位置已确认 · 尺寸待测',desc:'按原位置保留，不据此判断柱截面或结构作用。装修饰面及固定件避让方案需现场核实。',spec:'截面仅为视觉占位',group:column});
 // TV wall and detailed furniture.
 const tvwall=group('tv-wall','living','architecture');box(tvwall,2.86,1.25,1.65,.08,2.5,2.05,m.stone,true);for(let i=0;i<9;i++)box(tvwall,2.93,1.3,.58+i*.055,.07,2.6,.027,m.walnut,true);
 items.set('tv-wall',{id:'tv-wall',room:'living',name:'原电视墙',status:'位置已确认 · 饰面提案',desc:'保留客厅西侧电视墙位置。浅石材与木格栅用于材质展示，东窗配窗帘控制屏幕反射。',spec:'墙面饰材外观为提案',group:tvwall});
 item('tv','living','电视与悬浮电视柜','拟选家具','电视面向东侧沙发，柜体保持轻薄。配件与陈设均为效果示意。','拟选 65 英寸级别；型号未定',3.02,1.62,g=>{box(g,0,1.44,0,.07,.83,1.45,m.black);const screen=box(g,.042,1.44,0,.004,.78,1.39,m.screen);box(g,.07,.38,0,.4,.28,1.92,m.walnut);for(const zz of [-.63,0,.63])box(g,.276,.38,zz,.008,.19,.56,m.oak);plant(g,.1,.53,.67,.27);book(g,.11,.53,-.55,.18,.25);});
 item('sofa','living','三人位织物沙发','拟选家具','面向西侧电视墙，背侧留过渡空间，南侧主通道保持连续。','约 2200 × 950 mm',6.1,1.6,g=>{round(g,0,.3,0,.95,.34,2.2,m.fabric,.1);round(g,.36,.67,0,.24,.77,2.04,m.fabric,.1);for(const zz of [-.68,0,.68]){round(g,-.12,.53,zz,.65,.18,.64,m.linen,.07);const b=round(g,.2,.83,zz,.19,.53,.65,m.fabric,.08);b.rotation.z=-.13;}for(const zz of [-1.03,1.03])round(g,-.04,.62,zz,.82,.46,.16,m.fabric,.06);for(const xx of [-.32,.32])for(const zz of [-.91,.91])cyl(g,xx,.1,zz,.025,.2,m.walnut);const p=round(g,-.16,.79,-.71,.26,.39,.38,m.green,.08);p.rotation.x=.1;p.rotation.z=.35;});obstacles.push([5.63,.5,.95,2.2]);
 item('living-rug','living','平织地毯','拟选软装','柔和的织物纹理界定会客区，不占用南侧主要通道。','约 2750 × 2050 mm',5.125,1.925,g=>{round(g,0,.014,0,2.75,.025,2.05,m.rug,.02);for(let i=0;i<37;i++){const z=-.98+i*.054;rod(g,[-1.4,.019,z],[-1.35,.019,z],.003,m.linen);rod(g,[1.35,.019,z],[1.4,.019,z],.003,m.linen);}});
 item('coffee-table','living','小型木质茶几','拟选家具','小体量茶几留出沙发前通行空间，边角采用圆角表达。','约 550 × 900 mm',4.625,1.63,g=>{round(g,0,.4,0,.55,.065,.9,m.oak,.05);for(const xx of [-.2,.2])for(const zz of [-.34,.34])cyl(g,xx,.2,zz,.022,.38,m.walnut);book(g,-.06,.44,-.17,.19,.27,'#75826f',.12);cup(g,.12,.44,.19);});obstacles.push([4.35,1.18,.55,.9]);
 // Bedroom with fixed cabinet and AC.
 item('bed','bedroom','双人床','拟选家具','床头朝北侧内墙，西侧留出原固定柜的操作空间，东窗前保持开敞。','床垫 1800 × 2000 mm；床架另计',5.6,6.15,g=>{round(g,0,.25,0,1.9,.35,2.13,m.walnut,.06);for(const xx of [-.75,.75])for(const zz of [-.85,.85])cyl(g,xx,.085,zz,.04,.17,m.walnut);round(g,0,.53,0,1.8,.28,2,m.linen,.11);round(g,0,.82,-1.1,1.94,1.15,.12,m.fabric,.05);for(const xx of [-.44,.44]){const p=round(g,xx,.73,-.64,.71,.17,.45,m.linen,.1);p.rotation.z=xx>0?-.035:.035;}const geo=new T.PlaneGeometry(1.92,1.23,48,32);const pos=geo.attributes.position;for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getY(i);const drape=Math.max(0,Math.abs(x)-.82);pos.setZ(i,.012*Math.sin(x*22+z*8)+.009*Math.cos(z*29)-drape*1.6);}geo.computeVertexNormals();const quilt=add(g,geo,m.green,0,.69,.38);quilt.rotation.x=-Math.PI/2;quilt.material=m.green.clone();quilt.material.side=T.DoubleSide;quilt.userData.original=quilt.material;for(const xx of [-.7,0,.7])tube(g,[[xx,.7,-.17],[xx+.02,.71,.27],[xx,.7,.95]],.003,m.linen);});obstacles.push([4.65,5.02,1.92,2.16]);
 item('bed-rug','bedroom','卧室织物地毯','拟选软装','床尾与两侧的柔和落脚区域。','约 2500 × 2050 mm',5.6,6.62,g=>round(g,0,.012,0,2.5,.025,2.05,m.rug,.02));
 for(const [id,x] of [['bedside-west',4.345],['bedside-east',6.875]])item(id,'bedroom',id.endsWith('west')?'西侧床头柜与台灯':'东侧床头柜与台灯','拟选家具','抽屉、拉手与暖光台灯构成睡前照明。夜间模式自动开启。','约 450 × 450 mm',x,5.385,g=>{round(g,0,.29,0,.45,.5,.45,m.oak,.025);box(g,0,.38,.23,.39,.18,.018,m.walnut);box(g,0,.16,.23,.39,.18,.018,m.walnut);for(const yy of [.17,.39])box(g,0,yy,.249,.12,.012,.015,m.brass);tableLamp(g,.04,.55,-.015);});
 const wardrobe=item('fixed-cabinet','bedroom','原有整排固定柜','已确认固定位置','沿卧室西侧、靠卫生间的整面墙保留，柜端只避让内开门。木色、分缝和拉手是展示用外观，不表示要求替换原柜。','原柜保留；长度、高度、深度待实测',3.15,7.265,g=>{box(g,0,1.23,0,.6,2.46,3.23,m.walnut);box(g,.305,.065,0,.018,.13,3.13,m.black);for(let i=0;i<6;i++){const z=-1.345+i*.538;box(g,.315,1.32,z,.035,2.22,.525,m.oak);box(g,.34,1.22,z+.19,.025,.32,.012,m.brass);}});obstacles.push([2.85,5.65,.65,3.23]);
 const ac=group('fixed-ac','bedroom','equipment');box(ac,8.5,2.38,4.88,.9,.28,.23,m.white);round(ac,8.5,2.36,5.015,.86,.22,.04,m.white,.03);box(ac,8.5,2.285,5.04,.76,.022,.015,m.black);for(let i=0;i<7;i++)box(ac,8.18+i*.1,2.29,5.052,.002,.027,.015,m.trim);luminous(ac,8.8,2.39,5.042,.035,.009,.006);
 items.set('fixed-ac',{id:'fixed-ac',room:'bedroom',name:'原挂式空调',status:'已确认固定位置',desc:'保留卧室东北角内墙的挂式空调，距窗约 1.5 m（据述）。窗洞未测，模型采用近似定位。保留送风和检修空间。',spec:'位置保留；机身尺寸及精确距窗待测',group:ac});
 item('reading-chair','bedroom','窗边休闲椅','拟选家具','低位座椅保留东窗采光，窗帘开启后形成阅读角。','约 720 × 800 mm',8.91,7.52,g=>{round(g,0,.47,0,.72,.17,.72,m.linen,.1);round(g,0,.76,.29,.71,.65,.15,m.fabric,.09);for(const xx of [-.31,.31]){round(g,xx,.63,0,.1,.24,.65,m.oak,.04);rod(g,[xx,.05,-.24],[xx,.5,-.24],.025,m.walnut);rod(g,[xx,.05,.27],[xx,.5,.27],.025,m.walnut);}});obstacles.push([8.55,7.12,.72,.8]);
 item('reading-table','bedroom','阅读边几','拟选家具','小圆几与书籍陈设，不占窗边通道。','直径约 400 mm',8.08,7.67,g=>{cyl(g,0,.48,0,.2,.045,m.oak);cyl(g,0,.24,0,.025,.46,m.brass);cyl(g,0,.02,0,.13,.03,m.brass);book(g,0,.51,0,.16,.22,'#9a7958',.15);});
 // Draped curtain panels with modeled folds, separate from the assumed window.
 for(const [room,z1,z2] of [['bedroom',5.75,8.32],['living',3.26,4.42],['gaming',.55,2.35]])item('curtain-'+room,room,'东窗帘组','拟选软装 · 窗洞待测','纱帘与遮光帘控制晨光和眩光。精确宽度、轨道与窗边家具应按实测窗洞调整。','两侧收拢状态；未封闭通风口',9.74,0,g=>{rod(g,[0,2.5,z1-.12],[0,2.5,z2+.12],.014,m.brass);for(const [start,end] of [[z1-.15,z1+.27],[z2-.27,z2+.15]]){const geo=new T.PlaneGeometry(end-start,2.23,30,24),pos=geo.attributes.position;for(let i=0;i<pos.count;i++){pos.setZ(i,Math.sin(pos.getX(i)*65)*.035);}geo.computeVertexNormals();const mm=m.linen.clone();mm.side=T.DoubleSide;const o=add(g,geo,mm,0,1.35,(start+end)/2);o.rotation.y=Math.PI/2;}});
 // Gaming: monitor, keyboard, speakers, PC tower, upholstered chair.
 item('gaming-desk','gaming','北向电竞工作台','拟选家具','桌面靠北，屏幕获得东侧侧光。独立房间保留实墙，夜间使用耳机；设备散热与通风需配合。','1600 × 700 mm',8.42,.59,g=>{round(g,0,.76,0,1.6,.065,.7,m.walnut,.025);for(const xx of [-.67,.67]){box(g,xx,.38,0,.045,.72,.55,m.metal);box(g,xx,.035,0,.25,.035,.59,m.metal);}box(g,0,1.13,-.17,.82,.43,.035,m.black);box(g,0,1.13,-.146,.77,.38,.006,m.screen);cyl(g,0,.88,-.17,.018,.19,m.metal);box(g,0,.805,-.17,.22,.02,.14,m.metal);box(g,-.08,.805,.17,.43,.025,.15,m.black);const keyGeo=new T.BoxGeometry(.023,.008,.022),keys=new T.InstancedMesh(keyGeo,m.trim,56);for(let i=0;i<56;i++){const matrix=new T.Matrix4().makeTranslation(-.265+(i%14)*.028,.825,.12+Math.floor(i/14)*.03);keys.setMatrixAt(i,matrix);}keys.userData.original=m.trim;g.add(keys);meshes.push(keys);ellipsoid(g,.32,.818,.17,.045,.022,.06,m.black);box(g,.61,.98,-.12,.18,.36,.4,m.black);box(g,.707,.98,-.12,.008,.3,.34,m.glass);for(const yy of [.88,1.06]){const fan=add(g,new T.TorusGeometry(.055,.007,8,24),m.brass,.61,yy,.086);fan.rotation.x=0;}deskLamp(g,-.62,.795,-.21);cup(g,.58,.795,.2,m.stone);});obstacles.push([7.62,.24,1.6,.7]);
 item('gaming-chair','gaming','人体工学游戏椅','拟选家具','椅后预留起身与进出空间。脚轮与设备减振有助于减少结构传声。','尺寸为展示示意',8.43,1.45,g=>officeChair(g,0,0));obstacles.push([8.1,1.1,.65,.65]);
 item('game-shelf','gaming','矮柜与陈设','拟选家具','矮柜不遮挡窗户与门口，展示储物与设备收纳。','约 350 × 750 mm',7.54,2.03,g=>{box(g,0,.46,0,.35,.84,.75,m.walnut);for(const yy of [.22,.5,.76])box(g,.185,yy,0,.01,.2,.64,m.oak);plant(g,0,.9,-.15,.28);book(g,0,.9,.18,.16,.22);});
 const acoustic=group('acoustic','gaming','architecture');for(let i=0;i<16;i++)box(acoustic,7.32,1.44,.18+i*.145,.025,1.65,.07,i%3?m.fabric:m.walnut,true);items.set('acoustic',{id:'acoustic',room:'gaming',name:'室内吸声饰面提案',status:'效果提案 · 非隔声保证',desc:'织物和木格栅减轻房内混响。实际避免打扰卧室，仍须处理门缝、墙顶、管线孔和通风侧向传声。',spec:'构造厚度及材料性能待深化',group:acoustic});
 // Study.
 item('study-desk','study','书房工作桌','拟选家具','书桌靠北，南侧通道连接书房门与左下角阳台门。任务灯用于补充工作照明。','1400 × 600 mm',1.78,.46,g=>{round(g,0,.75,0,1.4,.055,.6,m.oak,.02);for(const xx of [-.6,.6])for(const zz of [-.22,.22])rod(g,[xx,.04,zz],[xx,.72,zz],.023,m.walnut);box(g,0,.8,.03,.35,.018,.25,m.metal);const screen=box(g,0,.93,-.06,.35,.24,.014,m.screen);screen.rotation.x=-.16;deskLamp(g,-.52,.78,-.14);for(let i=0;i<3;i++)book(g,.45,.78+i*.04,.02,.2,.25,['#7c8b6f','#b5a186','#8d7964'][i],.05*i);});obstacles.push([1.08,.16,1.4,.6]);
 item('study-chair','study','书房座椅','拟选家具','轻量座椅，保持书房与阳台门之间的通行。','尺寸为展示示意',1.725,1.125,g=>{round(g,0,.46,0,.45,.075,.45,m.linen,.04);round(g,0,.73,.19,.43,.43,.07,m.oak,.025);for(const xx of [-.18,.18])for(const zz of [-.17,.17])rod(g,[xx,.03,zz],[xx,.44,zz],.017,m.walnut);});
 item('study-shelf','study','壁挂书架','拟选家具','北墙书架与桌面留出工作空间，不侵占阳台门通道。','陈设示意',1.78,.12,g=>{for(const yy of [1.58,2.02]){box(g,0,yy,0,1.35,.035,.23,m.oak);for(let i=0;i<7;i++){const h=.16+(i%3)*.025;box(g,-.5+i*.085,yy+h/2+.02,-.02,.05,h,.15,std(['#a48a64','#71816a','#d2c5aa'][i%3],.8));}}});
 // Bathroom objects are explicitly provisional, retained wet-zone location.
 const bathDesc='洁具位置仅用于材质与尺度演示，不代表改动原管线或现有洁具。现场量房后应按实际设施替换。';
 item('vanity','bathroom','洗漱台（示意）','待测占位',bathDesc,'约 380 × 720 mm',1.83,5.92,g=>{box(g,0,.44,0,.38,.66,.72,m.walnut);box(g,.01,.8,0,.42,.06,.76,m.stone);const basin=add(g,new T.TorusGeometry(.135,.024,12,40),m.ceramic,.04,.845,0);basin.rotation.x=-Math.PI/2;ellipsoid(g,.04,.82,0,.14,.045,.19,m.ceramic);rod(g,[-.12,.83,0],[-.12,1.03,0],.012,m.brass);rod(g,[-.12,1.03,0],[.01,1.03,0],.012,m.brass);box(g,-.22,1.48,0,.015,.77,.6,m.mirror);});obstacles.push([1.6,5.55,.45,.76]);
 item('toilet','bathroom','坐便器（示意）','待测占位',bathDesc,'现有洁具应以现场为准',2.15,6.92,g=>{round(g,0,.35,-.22,.39,.7,.18,m.ceramic,.06);ellipsoid(g,0,.31,.07,.2,.23,.31,m.ceramic);const ring=add(g,new T.TorusGeometry(.145,.032,12,36),m.ceramic,0,.49,.08);ring.rotation.x=-Math.PI/2;ring.scale.y=1.4;ellipsoid(g,0,.465,.08,.13,.012,.2,m.stone);});obstacles.push([1.94,6.65,.43,.6]);
 item('shower','bathroom','淋浴区（示意）','待测占位',bathDesc+' 排水坡度与防水不由本模型确定。','玻璃与五金为饰面提案',2.15,8.37,g=>{box(g,0,.014,0,.98,.025,1.0,m.tile);rod(g,[0,.6,.44],[0,2.1,.44],.016,m.brass);rod(g,[0,2.1,.44],[0,2.1,.16],.016,m.brass);cyl(g,0,2.08,.16,.105,.02,m.brass);box(g,-.23,1.1,-.55,.5,2.2,.015,m.glass);rod(g,[-.48,0,-.55],[-.48,2.2,-.55],.012,m.brass);box(g,.25,.02,.18,.2,.012,.08,m.metal);});
 item('balcony-plant','balcony','阳台绿植','拟选软装','少量绿植与浅色地砖保留窄阳台的通行。具体植物依实际日照选择。','展示陈设',.43,.46,g=>plant(g,0,0,0,.65));
 // Alternative furniture is modeled explicitly, then selected by the layout controller.
 const variant=(id,room,name,spec,layouts,x,z,build)=>{const g=item(id,room,name,'拟选家具 · 布局方案', '随所选布局显示；具体摆放和使用取舍见当前方案说明。',spec,x,z,build);g.userData.layouts=layouts;return g;};
 const loungeChair=(g,woodFrame=false)=>{
  round(g,0,.44,0,.7,.16,.68,m.linen,.07);round(g,0,.76,.27,.71,.65,.13,m.fabric,.06);
  for(const x of [-.32,.32]){round(g,x,.62,0,.08,.12,.7,woodFrame?m.walnut:m.oak,.025);for(const z of [-.26,.27])rod(g,[x,.03,z],[x,.62,z],.023,m.walnut);}
 };
 variant('conversation-chair','living','会客单椅','约 720 × 760 mm',['wood','chinese'],4.35,.65,g=>loungeChair(g,true));
 variant('cream-sofa','living','圆角双人模块沙发','约 950 × 1900 mm；另配贵妃模块',['cream'],6,1.25,g=>{
  round(g,0,.28,0,.95,.42,1.9,m.fabric,.17);round(g,.34,.62,0,.24,.65,1.77,m.fabric,.1);
  for(const z of [-.45,.45]){round(g,-.12,.53,z,.67,.18,.84,m.linen,.1);round(g,.18,.77,z,.22,.4,.8,m.fabric,.09);}
  round(g,-.06,.58,-.87,.76,.35,.17,m.fabric,.07);
 });
 variant('cream-chaise','living','可分离贵妃模块','约 1450 × 750 mm',['cream'],5.72,2.575,g=>{round(g,0,.27,0,1.45,.4,.75,m.fabric,.13);round(g,-.03,.51,0,1.34,.16,.69,m.linen,.09);round(g,.61,.64,0,.18,.6,.69,m.fabric,.07);});
 variant('nesting-tables','living','高低圆几组合','主几直径 650；副几直径 420 mm',['cream'],4.45,1.35,g=>{for(const [x,z,r,h]of [[0,0,.325,.4],[-.27,.53,.21,.3]]){cyl(g,x,h,z,r,.055,m.oak);cyl(g,x,h/2,z,r*.58,h-.04,m.walnut);}cup(g,.04,.44,0);});
 variant('chinese-settee','living','木框双人坐榻','约 860 × 1800 mm',['chinese'],6.04,1.45,g=>{
  box(g,0,.31,0,.86,.13,1.8,m.walnut);for(const x of [-.34,.34])for(const z of [-.77,.77])box(g,x,.16,z,.055,.32,.055,m.walnut);
  for(const z of [-.81,.81]){box(g,0,.63,z,.81,.055,.045,m.walnut);for(const x of [-.34,.34])box(g,x,.48,z,.045,.3,.045,m.walnut);}
  box(g,.36,.75,0,.06,.07,1.74,m.walnut);for(let i=0;i<9;i++)box(g,.36,.55,-.7+i*.175,.035,.35,.028,m.walnut);
  for(const z of [-.43,.43]){round(g,-.03,.43,z,.7,.13,.74,m.linen,.035);round(g,.23,.64,z,.14,.38,.68,m.fabric,.03);}
 });
 variant('tea-table','living','长方木茶桌','约 700 × 1000 mm',['chinese'],4.7,2,g=>{box(g,0,.46,0,.7,.06,1,m.walnut);for(const x of [-.29,.29])for(const z of [-.43,.43])box(g,x,.23,z,.04,.46,.04,m.walnut);box(g,0,.505,0,.35,.025,.45,m.oak);cup(g,.08,.53,.1);cup(g,-.08,.53,-.08);});
 variant('bed-bench','bedroom','床尾长凳','约 1300 × 420 mm',['cream'],7.15,8.05,g=>{round(g,0,.43,0,1.3,.18,.42,m.fabric,.09);for(const x of [-.49,.49])box(g,x,.18,0,.09,.36,.3,m.oak);});
 for(const [id,x]of [['tea-chair-west',8.3],['tea-chair-east',10.3]])variant(id,'bedroom',id.endsWith('west')?'对坐休闲椅 · 西':'对坐休闲椅 · 东','约 720 × 760 mm',['chinese'],x,8.05,g=>loungeChair(g,true));
 variant('bed-tea-table','bedroom','双椅间圆边几','直径约 400 mm',['chinese'],9.3,8.05,g=>{cyl(g,0,.48,0,.2,.045,m.walnut);for(const x of [-.12,.12])rod(g,[x,0,0],[x,.47,0],.018,m.walnut);cup(g,0,.51,0);});
 variant('study-lowcase','study','书房东侧矮书柜','约 350 × 1000 × 850 mm',['wood','chinese'],2.4,1.05,g=>{box(g,0,.43,0,.35,.84,1,m.walnut);for(const y of [.25,.61]){box(g,-.181,y,0,.012,.3,.92,m.oak);for(let i=0;i<6;i++)box(g,-.205,y-.04,-.35+i*.12,.05,.15,.065,m.linen);}});
 // Three flights and two distinct, level landings. Plan runs and rise are compressed placeholders.
 const stair=group('staircase','stairs','structure');
 const treadParts=[],landingParts=[],rise=.1,startY=-2.7;
 const tread=(flight,number,x,z,w,d)=>{const top=startY+number*rise;const o=box(stair,x,top-.035,z,w,.07,d,m.oak);o.userData.stair={type:'tread',flight,number,top};treadParts.push(o);return top;};
 const landing=(name,x,z,w,d,top)=>{const o=box(stair,x,top-.045,z,w,.09,d,m.stone);o.userData.stair={type:'landing',name,top};landingParts.push(o);};
 const northZ=2.83,southZ=4.37,westX=.12,turnEdge=.4,corridorEdge=1.55,run=(corridorEdge-turnEdge)/11;
 for(let i=0;i<11;i++)tread(1,i+1,corridorEdge-(i+.5)*run,northZ,run,.56);
 landing('A',westX,northZ,.56,.56,startY+11*rise);
 const midStart=3.11,midEnd=4.09,midRun=(midEnd-midStart)/5;
 for(let i=0;i<5;i++)tread(2,12+i,westX,midStart+(i+.5)*midRun,.56,midRun);
 landing('B',westX,southZ,.56,.56,startY+16*rise);
 for(let i=0;i<11;i++)tread(3,17+i,turnEdge+(i+.5)*run,southZ,run,.56);
 // Handrails follow the edges facing the central stairwell, including both landing corners.
 const rail=[];
 const innerNorth=northZ+.26,innerWest=westX+.26,innerSouth=southZ-.26;
 for(const o of treadParts.filter(t=>t.userData.stair.flight===1)){const {top}=o.userData.stair;rail.push([o.position.x,top+.85,innerNorth]);}
 rail.push([innerWest,startY+11*rise+.85,innerNorth],[innerWest,startY+11*rise+.85,midStart]);
 for(const o of treadParts.filter(t=>t.userData.stair.flight===2))rail.push([innerWest,o.userData.stair.top+.85,o.position.z]);
 rail.push([innerWest,startY+16*rise+.85,midEnd],[innerWest,startY+16*rise+.85,innerSouth]);
 for(const o of treadParts.filter(t=>t.userData.stair.flight===3))rail.push([o.position.x,o.userData.stair.top+.85,innerSouth]);
 for(let i=0;i<rail.length-1;i++)rod(stair,rail[i],rail[i+1],.014,m.walnut);
 for(let i=0;i<rail.length;i+=3){const [x,y,z]=rail[i];rod(stair,[x,y-.85,z],[x,y,z],.01,m.metal);}
 stair.userData.sequence=[11,'landing A',5,'landing B',11];
 stair.userData.handrailSide='central void';
 stair.userData.handrailPath=rail;
 items.set('staircase',{id:'staircase',room:'stairs',name:'三跑楼梯与两处平平台',status:'口述顺序已确认 · 尺寸示意',desc:'一楼起步向左 11 级，到平平台 A；转向后约 5 级，到平平台 B；再转向向右 11 级，到二楼卫生间门前。扶手沿朝向中间空隙的内侧设置，在平台内角衔接，并经二楼过道护栏连续接到上楼梯段。两个平台分别保持水平，不计入 27 级。踏步在暂定轮廓内压缩表达，不能按模型尺寸施工。',spec:'11 级＋平平台＋约 5 级＋平平台＋11 级',group:stair});
 // Restore the upper stair volume. Repeated treads are visual placeholders, not confirmed counts.
 const upper=group('staircase-upper','stairs','structure'),floorRise=2.7;
 for(const o of [...treadParts,...landingParts]){const n=add(upper,o.geometry,o.material,o.position.x,o.position.y+floorRise,o.position.z,o.scale.toArray());n.userData.stair={...o.userData.stair,top:o.userData.stair.top+floorRise,scope:'second-to-third',assumed:true};}
 const upperRail=rail.map(([x,y,z])=>[x,y+floorRise,z]);
 for(let i=0;i<upperRail.length-1;i++)rod(upper,upperRail[i],upperRail[i+1],.014,m.walnut);
 for(let i=0;i<upperRail.length;i+=3){const [x,y,z]=upperRail[i];rod(upper,[x,y-.85,z],[x,y,z],.01,m.metal);}
 upper.userData.handrailPath=upperRail;
 items.set('staircase-upper',{id:'staircase-upper',room:'stairs',name:'二楼通往三楼的楼梯',status:'上楼梯段恢复 · 级数暂拟',desc:'书房门前起步，暂沿用相同的三跑、两平台折返形状展示上楼梯段。扶手朝向中间空隙，并与二楼过道护栏连续连接。上层具体级数、层间高差及尺寸未确认；此处重复下层形状只用于体积对比。更高层沿同样方式延续，模型不推定顶楼层数。',spec:'上层形状与级数暂拟；层间高差暂按 2.7 m',group:upper});
 // One connected rail path: lower flight -> second-floor corridor -> upper flight.
 const corridorRail=group('stair-corridor-rail','stairs','structure');
 const connector=[rail.at(-1),[corridorEdge,.85,innerSouth],[corridorEdge,.85,innerNorth],upperRail[0]];
 for(let i=0;i<connector.length-1;i++)rod(corridorRail,connector[i],connector[i+1],.014,m.walnut);
 for(const z of [innerNorth,3.43,3.77,innerSouth])rod(corridorRail,[corridorEdge,0,z],[corridorEdge,.85,z],.01,m.metal);
 corridorRail.userData.handrailPath=connector;
 items.set('stair-corridor-rail',{id:'stair-corridor-rail',room:'stairs',name:'二楼过道连续扶手',status:'连续关系已确认 · 尺寸示意',desc:'下层梯段内侧扶手在二楼落点转入过道护栏，沿中间洞口边缘连续延伸，再接通往三楼的梯段扶手。材质、杆件间距与高度仍为展示假设。',spec:'连接下层梯段、二楼过道与上楼梯段',group:corridorRail});
 // Sconces are proposed fixtures; automatic night illumination in every space.
 for(const [id,room,x,z] of [['light-living','living',4.5,.16],['light-game','gaming',9.45,.16],['light-bedroom','bedroom',7.45,4.86],['light-study','study',2.4,.16],['light-bath','bathroom',1.72,7.6],['light-balcony','balcony',.74,.8],['light-stairs','stairs',.15,3.7]]){const g=group(id,room,'lightfixture');const west=id==='light-bath'||id==='light-stairs';box(g,x,2.18,z,west?.07:.16,.26,west?.16:.07,m.brass,true);const glow=luminous(g,x+(west?.045:0),2.18,z+(west?0:.045),west?.015:.12,.19,west?.12:.015);glow.userData.cuttable=true;lampLight(g,x+(west?.22:0),2.12,z+(west?0:.22),room==='bedroom'?55:room==='living'?60:22,room==='bedroom'?7:5);}
 // Area-like fill lights support a readable roofless night visualization.
 for(const r of rooms){const g=group('fill-'+r.id,r.id,'lightfixture');lampLight(g,r.center[0],2.45,r.center[1],r.id==='bedroom'?42:r.id==='living'?38:16,6);}
 // Retain far-side backing surfaces so wall-mounted details remain legible in the dollhouse view.
 for(const p of parts)if(p.userData.id.startsWith('north-')||['tv-wall','acoustic','balcony-divider'].includes(p.userData.id))p.traverse(o=>{if(o.isMesh)o.userData.cuttable=false;});
 const move=(id,dx)=>{const p=parts.find(g=>g.userData.id===id);if(!p)throw Error('Missing placement '+id);p.position.x+=dx;};
 for(const id of ['fixed-ac','game-door','curtain-bedroom','curtain-living','curtain-gaming','reading-chair','reading-table'])move(id,DX);
 for(const id of ['bed','bed-rug','bedside-west','bedside-east','gaming-desk','gaming-chair'])move(id,DX/2);
 for(const id of ['bed','bed-rug','bedside-west','bedside-east'])move(id,BED_SHIFT);
 for(const id of ['study-desk','study-chair','study-shelf'])move(id,-.53);
 for(const id of ['balcony-plant','light-balcony'])move(id,-1.15);
 move('light-game',DX);move('light-bedroom',DX/2);
 for(const b of obstacles){if(Math.abs(b[0]-4.65)<.001)b[0]+=DX/2+BED_SHIFT;else if([7.62,8.1].some(x=>Math.abs(b[0]-x)<.001))b[0]+=DX/2;else if(Math.abs(b[0]-8.55)<.001)b[0]+=DX;else if(Math.abs(b[0]-1.08)<.001)b[0]-=.53;}
 const warmLights=lights;
 return {root,rooms,items,parts,meshes,lights:warmLights,glows,obstacles,cutPlane,materials:m};
}
