// Navigation owns one continuous image-to-canvas transition. Editing stays immediate.
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = 'cubic-bezier(.16,1,.3,1)';
let transfer = null;
let running = [];

export function prepareTransfer(source, image) {
  if (reduced() || !source || !image) return;
  const rect = source.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  transfer = {rect, image};
}

function animate(el, frames, duration, delay=0) {
  if (!el) return;
  const animation = el.animate(frames, {duration, delay, easing:ease, fill:'backwards'});
  running.push(animation);
  return animation;
}

export function arrive(page, editorial) {
  running.forEach(a => a.cancel());
  running = [];
  document.querySelector('.scene-transfer')?.remove();
  const incoming = transfer;
  transfer = null;
  if (reduced()) return;
  const target = document.querySelector(page === 'show' ? '#show-host' : '#three-host');
  if (incoming && target) {
    const rect = target.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.className = 'scene-transfer';
    layer.setAttribute('aria-hidden','true');
    Object.assign(layer.style, {left:`${rect.left}px`, top:`${rect.top}px`, width:`${rect.width}px`, height:`${rect.height}px`});
    const img = new Image();
    img.src = incoming.image;
    layer.append(img);
    document.body.append(layer);
    const from = incoming.rect;
    const journey = animate(layer, [
      {transform:`translate(${from.left-rect.left}px,${from.top-rect.top}px) scale(${from.width/rect.width},${from.height/rect.height})`, opacity:1},
      {transform:'none', opacity:1, offset:.75},
      {transform:'none', opacity:0}
    ], 850);
    journey.finished.catch(()=>{}).finally(()=>layer.remove());
    animate(target,[{opacity:0},{opacity:1}],220,630);
    const selectors = page === 'show'
      ? ['.show-header','.show-intro','.show-rooms','.show-caption','.show-controls']
      : ['.work-header','.left-panel','.right-panel','.canvas-toolbar','.scene-tools','.canvas-context'];
    selectors.forEach((selector,i)=>animate(document.querySelector(selector), [{opacity:0,transform:'translateY(18px)'},{opacity:1,transform:'none'}], 600, 260+i*65));
    return;
  }
  if (!editorial || page !== 'projects') return;
  animate(document.querySelector('.projects-intro h1'), [{clipPath:'inset(0 0 100% 0)',transform:'translateY(30px)'},{clipPath:'inset(0)',transform:'none'}], 850);
  animate(document.querySelector('.projects-intro p'), [{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'none'}], 700, 120);
  const cover = document.querySelector('.featured .project-cover');
  animate(cover, [{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0)'}], 1000, 180);
  animate(cover?.querySelector('img'), [{transform:'scale(1.12)'},{transform:'scale(1)'}], 1200, 180);
  document.querySelectorAll('.project-card:not(.featured),.featured .project-copy').forEach((el,i)=>animate(el,[{opacity:0,transform:'translateY(26px)'},{opacity:1,transform:'none'}],800,300+i*100));
}

export function captureCamera(engine) {
  if (!engine) return null;
  const target=engine.walking?engine.camera.position.clone().add(engine.camera.getWorldDirection(engine.controls.target.clone()).multiplyScalar(2)):engine.controls.target.clone();
  return {position:engine.camera.position.clone(),target,aspect:engine.camera.aspect,fov:engine.camera.fov,room:engine.room,night:engine.night,mode:engine.mode,furniture:engine.furniture};
}

export function restoreCamera(engine, state) {
  if (!engine || !state) return;
  engine.animation=null;
  engine.room=state.room;
  engine.mode=state.mode;
  engine.furniture=state.furniture;
  engine.setNight(state.night);
  // Keep the same subject and angle while fitting the destination's narrower
  // field of view. Reusing distance alone clips the room in a three-panel editor.
  const fit=Math.min(1,state.aspect||1)/Math.min(1,engine.camera.aspect);
  engine.camera.position.copy(state.position).sub(state.target).multiplyScalar(fit).add(state.target);
  engine.camera.fov=state.fov||38;
  engine.camera.updateProjectionMatrix();
  engine.controls.target.copy(state.target);
  engine.controls.update();
  engine.refresh();
  // The destination host has already resized; queued ResizeObserver callbacks
  // must not replace the user's view with a new overview during the handover.
  engine.preserveViewUntil=performance.now()+1000;
}
