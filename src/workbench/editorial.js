import {icon} from './icons.js';
import {captureCamera,restoreCamera} from './motion.js';

let activeId=null;
let cleanup=()=>{};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notes={
  wood:{title:'为相聚，留出位置。',body:'沙发与单椅面对面，留出一条穿过客厅的通道。坐下来，比摆满更重要。'},
  cream:{title:'把空白，留给日常。',body:'展开的座位与轻巧边几，让客厅可以会客，也可以独处。试着换一个角度，看看留白。'},
  chinese:{title:'围坐，也是一种风景。',body:'围合的座位把阅读与对话放在中央。看见家具之间的关系，再决定自己的生活方式。'}
};

export function disposeMagazine(){cleanup();cleanup=()=>{};}

export function renderMagazine({projects,engine,brand,onAction,onOpen}){
  disposeMagazine();
  let current=projects.find(p=>p.id===activeId)||projects[0];
  let viewpoint=current?.kind==='sample'?'living':'whole',switching=false;
  const root=document.querySelector('#app');
  root.innerHTML=`<main class="folio">
    <header class="folio-header">${brand}<span class="folio-purpose">空间设计工作室</span><nav aria-label="项目导航"><button data-folio="index">项目索引 <span>${projects.length}</span></button><button data-folio="new" class="folio-new">${icon('plus',16)} 导入图纸</button><button data-folio="settings" class="folio-icon" aria-label="模型与连接">${icon('settings',18)}</button></nav></header>
    ${current?`<section class="folio-spread" aria-label="当前空间作品">
      <div class="folio-story"><div class="folio-heading"><h1 id="folio-title"></h1><p id="folio-description"></p></div>
        <div class="folio-reading"><span class="folio-rule"></span><h2 id="folio-note-title"></h2><p id="folio-note"></p><div class="folio-facts" id="folio-facts"></div></div>
        <div class="folio-actions"><button class="folio-design" data-folio="edit">继续设计 <span>${icon('arrow',24)}</span></button><button class="folio-preview" data-folio="show">进入空间展示 ${icon('expand',15)}</button></div>
      </div>
      <div class="folio-plate"><div class="folio-plate-top"><span id="folio-scene-title">整层空间</span><span class="folio-live">${icon('cube',14)} 可交互 3D</span></div><div id="folio-stage" aria-label="空间作品交互区域"></div>
        <div class="folio-object-note" hidden><span></span><button aria-label="关闭家具说明">${icon('close',14)}</button></div>
        <div class="folio-views" role="group" aria-label="观察视角"><button data-vantage="whole" class="active" aria-pressed="true">${icon('home',16)} 整层</button><button data-vantage="living" aria-pressed="false">${icon('sofa',16)} 客厅</button><button data-vantage="plan" aria-pressed="false">${icon('layers',16)} 俯视</button></div>
        <div class="folio-plate-bottom"><span>拖动旋转 · 滚轮靠近 · 点击家具</span><button data-folio="light" aria-label="切换昼夜">${icon('moon',18)}<span>看夜晚</span></button></div>
      </div>
    </section>
    <footer class="folio-shelf"><div class="folio-shelf-label"><span>你的空间提案</span><small>切换作品，继续探索</small></div><div class="folio-projects" role="group" aria-label="切换空间作品">${projects.map(p=>`<button class="folio-project" data-project="${p.id}" aria-pressed="false"><span>${esc(p.name)}</span><small>${p.kind==='sample'?'示例住宅':'手动设计'} <i>·</i> ${p.kind==='sample'?'家具布局提案':p.walls.length+' 段墙体'}</small>${icon('arrow',19)}</button>`).join('')}</div><button class="folio-add" data-folio="new" aria-label="新建项目">${icon('plus',24)}</button></footer>`:`<section class="folio-empty"><h1>从一张图纸，<br>开始你的空间。</h1><p>导入平面图，校准尺寸，再慢慢摆成自己的家。</p><button class="button primary" data-folio="new">新建项目 ${icon('arrow')}</button></section>`}
    <div class="folio-colophon"><span>项目保存在此浏览器 · 演示助手</span><button data-folio="compare">切换设计方向 ${icon('layers',14)}</button></div>
  </main>
  <dialog class="folio-index" id="folio-index" aria-labelledby="folio-index-title"><header><h2 id="folio-index-title">项目索引</h2><button class="folio-icon" data-close-index aria-label="关闭项目索引">${icon('close',22)}</button></header><p>整理你的空间，或者从一张新图纸开始。</p><label class="folio-search">${icon('search',18)}<input type="search" placeholder="搜索项目" aria-label="搜索项目"></label><div class="folio-index-list"></div><footer><button class="button primary" data-index-new>${icon('plus',18)} 新建项目</button><span>本地保存，无需登录</span></footer></dialog>`;
  const $=s=>root.querySelector(s);
  const dialog=$('#folio-index');
  const previousSelect=engine?.onSelect;
  const stage=$('#folio-stage');
  let indexTrigger=null;
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animate=(el,frames,duration=700)=>{if(el&&!reduced())return el.animate(frames,{duration,easing:'cubic-bezier(.16,1,.3,1)'});};
  function updateCopy(){
    activeId=current.id;
    const name=esc(current.name);
    $('#folio-title').innerHTML=current.kind==='sample'&&[...current.name].length===4?`${esc(current.name.slice(0,2))}<br><em>${esc(current.name.slice(2))}</em>`:name;
    $('#folio-title').title=current.name;
    $('#folio-title').classList.toggle('long-title',[...current.name].length>8);
    $('#folio-description').textContent=current.description||'从图纸开始，慢慢画成一个家。';
    const note=current.kind==='sample'?notes[current.layout]:{title:'从轮廓，到生活。',body:current.walls.length?'墙体与家具来自你的手动设计。进入工作台，继续校正尺度和空间关系。':'空间还是空白。导入底图、校准比例，再画下第一面墙。'};
    $('#folio-note-title').textContent=note.title;
    $('#folio-note').textContent=note.body;
    $('#folio-facts').textContent=current.kind==='sample'?'示例住宅 / 单层 / 尺寸待实测':'自定义空间 / 手动描绘';
    root.querySelectorAll('[data-project]').forEach(b=>{const yes=b.dataset.project===current.id;b.classList.toggle('active',yes);b.setAttribute('aria-pressed',yes);});
    $('[data-vantage="living"]').hidden=current.kind!=='sample';
    $('.folio-object-note').hidden=true;
  }
  function setVantage(value,animateCamera=true){
    viewpoint=value;engine?.magazineView(value,animateCamera);
    root.querySelectorAll('[data-vantage]').forEach(b=>{const yes=b.dataset.vantage===value;b.classList.toggle('active',yes);b.setAttribute('aria-pressed',yes);});
    $('#folio-scene-title').textContent=({whole:'整层空间',living:'客厅 / 相聚的中心',plan:'俯视 / 空间关系'})[value];
    $('.folio-object-note').hidden=true;
  }
  async function choose(id){
    const next=projects.find(p=>p.id===id);if(!next||next===current||switching)return;
    switching=true;
    const retainedView=current.kind==='sample'&&next.kind==='sample'?captureCamera(engine):null;
    const image=document.createElement('img');
    if(engine&&!reduced()){image.src=engine.screenshot();image.className='folio-turn';$('.folio-plate').append(image);}
    current=next;updateCopy();engine?.apply(current);setVantage(current.kind==='sample'?viewpoint:'whole',false);
    if(retainedView)restoreCamera(engine,retainedView);
    animate($('.folio-heading'),[{opacity:0,transform:'translateY(18px)'},{opacity:1,transform:'none'}]);
    animate($('.folio-reading'),[{opacity:0},{opacity:1}],900);
    const turn=animate(image,[{clipPath:'inset(0)'},{clipPath:'inset(0 0 0 100%)'}],850);
    if(turn)await turn.finished.catch(()=>{});image.remove();switching=false;
  }
  function renderIndex(query=''){
    const list=projects.filter(p=>p.name.toLowerCase().includes(query.toLowerCase()));
    $('.folio-index-list').innerHTML=list.length?list.map(p=>`<article><button class="folio-index-open" data-index-open="${p.id}"><span>${esc(p.name)}</span><small>${p.kind==='sample'?'示例方案':'我的设计'} · ${new Date(p.updated).toLocaleDateString('zh-CN')}</small>${icon('arrow',18)}</button><div class="folio-index-tools"><button data-manage="rename" data-id="${p.id}" aria-label="重命名${esc(p.name)}">${icon('edit',15)} 重命名</button><button data-manage="duplicate" data-id="${p.id}">${icon('copy',15)} 复制</button><button data-manage="delete" data-id="${p.id}">${icon('trash',15)} 删除</button></div></article>`).join(''):'<p class="folio-no-results">没有找到这个项目，试试其他关键词。</p>';
  }
  function closeIndex(){dialog.close();indexTrigger?.focus();}
  root.onclick=e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.project){choose(b.dataset.project);return;}
    if(b.dataset.vantage){setVantage(b.dataset.vantage);return;}
    if(b.hasAttribute('data-close-index')){closeIndex();return;}
    if(b.dataset.indexOpen){closeIndex();choose(b.dataset.indexOpen);return;}
    if(b.dataset.manage){closeIndex();onAction(b.dataset.manage,b.dataset.id);return;}
    if(b.hasAttribute('data-index-new')){closeIndex();onAction('new');return;}
    if(b.closest('.folio-object-note')){$('.folio-object-note').hidden=true;return;}
    const action=b.dataset.folio;
    if(action==='index'){indexTrigger=b;renderIndex($('.folio-search input').value);dialog.showModal();animate(dialog,[{transform:'translateX(100%)'},{transform:'none'}],550);}
    else if(action==='edit'||action==='show')onOpen(current,action==='edit'?'editor':'show');
    else if(action==='light'){engine?.setNight(!engine.night);$('.folio-plate').classList.toggle('night',engine.night);b.innerHTML=`${icon(engine.night?'sun':'moon',18)}<span>${engine.night?'看白天':'看夜晚'}</span>`;}
    else if(action)onAction(action);
  };
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeIndex();}});
  $('.folio-search input').oninput=e=>renderIndex(e.target.value);
  if(current&&engine){
    engine.folioView=null;engine.mount(stage);engine.apply(current);engine.mode='real';engine.furniture=true;engine.setNight(false);setVantage(viewpoint,false);
    engine.onSelect=id=>{const item=engine.activeItems.get(id);if(!item)return;const note=$('.folio-object-note');note.querySelector('span').textContent=`${item.name} · ${['fixed-cabinet','fixed-ac','tv-wall'].includes(id)?'固定设施保留':'进入工作台可查看属性'}`;note.hidden=false;};
    updateCopy();
    animate($('.folio-heading'),[{clipPath:'inset(0 0 100% 0)',transform:'translateY(25px)'},{clipPath:'inset(0)',transform:'none'}],1000);
    animate($('.folio-reading'),[{opacity:0,transform:'translateY(15px)'},{opacity:1,transform:'none'}],1100);
    animate($('.folio-shelf'),[{opacity:0,transform:'translateY(24px)'},{opacity:1,transform:'none'}],900);
  }else if(current){stage.innerHTML='<div class="folio-render-error">三维加载失败，请检查浏览器硬件加速。<br>仍可进入工作台使用二维编辑。</div>';updateCopy();}
  cleanup=()=>{root.onclick=null;if(dialog.open)dialog.close();if(engine){engine.onSelect=previousSelect;engine.folioView=null;}};
}
