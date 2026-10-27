'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stage, Layer, Image as KonvaImage, Rect, Line, Group } from 'react-konva';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type Konva from 'konva';
import { api, ApiError, type ProjectView } from './api';
import { Icon } from './icons';
import { MAX_IMAGE_PIXELS, MAX_UPLOAD_BYTES, type Crop, type UnderlaySource, type UnderlayView, type UnderlayDisplay, type SaveUnderlay } from '../../../packages/contracts/src/underlay';
import './drawing-panel.css';

const defaultDisplay: UnderlayDisplay = {offsetX:0,offsetY:0,scale:1,opacity:.85};
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。';
type Draft = {canvas:HTMLCanvasElement;source:UnderlaySource;crop:Crop;rotation:SaveUnderlay['rotation']};
const clamp = (value:number,min:number,max:number) => Math.min(max,Math.max(min,value));
const contentUrl = (projectId:string,resourceId:string) => `/api/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resourceId)}/content`;
function selectedCanvas(draft:Draft) {
  const {crop,rotation}=draft, result=document.createElement('canvas');
  result.width=rotation%180?crop.height:crop.width;result.height=rotation%180?crop.width:crop.height;
  const context=result.getContext('2d')!;
  if(rotation===90){context.translate(result.width,0);context.rotate(Math.PI/2);}
  if(rotation===180){context.translate(result.width,result.height);context.rotate(Math.PI);}
  if(rotation===270){context.translate(0,result.height);context.rotate(-Math.PI/2);}
  context.drawImage(draft.canvas,crop.x,crop.y,crop.width,crop.height,0,0,crop.width,crop.height);
  return result;
}
async function pngBlob(canvas:HTMLCanvasElement) { return new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('所选区域无法导出，请缩小区域后重试。')),'image/png')); }
async function responseJson<T>(response:Response):Promise<T> {
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new ApiError(data.error?.message||'底图未能保存，请重试。',response.status,data.error?.code);
  return data;
}

export function DrawingPanel({projectId}:{projectId:string}) {
  const client=useQueryClient();
  const query=useQuery({queryKey:['underlay',projectId],queryFn:()=>api<{underlay:UnderlayView|null;storage:string}>(`/api/projects/${projectId}/underlay`)});
  const project=useQuery({queryKey:['project',projectId],queryFn:()=>api<{project:ProjectView}>(`/api/projects/${projectId}`)});
  const input=useRef<HTMLInputElement>(null), pdf=useRef<PDFDocumentProxy|null>(null), render=useRef<RenderTask|null>(null);
  const sequence=useRef(0), fileSequence=useRef(0), operation=useRef(''), displayOperation=useRef('');
  const uploadRequest=useRef<{metadata:SaveUnderlay;blob:Blob}|null>(null), displayRequest=useRef<{operationId:string;expectedVersion:number;resourceId:string;display:UnderlayDisplay}|null>(null);
  const fileDetails=useRef<{name:string;sha256:string}|null>(null);
  const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [page,setPage]=useState(1),[pages,setPages]=useState(0),[previewResult,setPreviewResult]=useState(false);
  const [display,setDisplay]=useState(defaultDisplay),[dirty,setDirty]=useState(false),[showOutline,setShowOutline]=useState(false);
  const underlay=query.data?.underlay;
  const output=useMemo(()=>draft?selectedCanvas(draft):null,[draft]);
  useEffect(()=>{if(!dirty)setDisplay(underlay?.display||defaultDisplay);},[underlay,dirty]);
  useEffect(()=>()=>{sequence.current++;fileSequence.current++;render.current?.cancel();void pdf.current?.loadingTask.destroy();},[]);
  const saved=useMutation({mutationFn:async()=>{
    if(!draft||!output)throw new Error('请先选择图纸。');
    const blob=await pngBlob(output);
    if(blob.size>MAX_UPLOAD_BYTES)throw new Error('所选图像超过 12 MB，请缩小裁切区域后重试。');
    operation.current||=crypto.randomUUID();
    if(uploadRequest.current?.metadata.operationId!==operation.current)uploadRequest.current={metadata:{operationId:operation.current,expectedVersion:underlay?.version||0,source:draft.source,crop:draft.crop,rotation:draft.rotation,display:defaultDisplay},blob};
    const form=new FormData();form.set('metadata',JSON.stringify(uploadRequest.current.metadata));form.set('file',uploadRequest.current.blob,'selected-page.png');
    let response:Response;try{response=await fetch(`/api/projects/${projectId}/underlay`,{method:'POST',body:form});}catch{throw new Error('连接中断，所选图纸仍保留在本页，可点击保存重试。');}
    return responseJson<{underlay:UnderlayView}>(response);
  },onSuccess:data=>{client.setQueryData(['underlay',projectId],{underlay:data.underlay,storage:'local-private-development'});client.invalidateQueries({queryKey:['project',projectId]});client.invalidateQueries({queryKey:['underlay',projectId]});setDraft(null);setDirty(false);setPages(0);operation.current='';void pdf.current?.loadingTask.destroy();pdf.current=null;if(input.current)input.current.value='';}});
  const saveDisplay=useMutation({mutationFn:async()=>{
    if(!underlay)throw new Error('请先保存底图。');displayOperation.current||=crypto.randomUUID();
    if(displayRequest.current?.operationId!==displayOperation.current)displayRequest.current={operationId:displayOperation.current,expectedVersion:underlay.version,resourceId:underlay.resourceId,display};
    let response:Response;try{response=await fetch(`/api/projects/${projectId}/underlay`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(displayRequest.current)});}catch{throw new Error('连接中断，显示设置尚未确认保存，请重试。');}
    return responseJson<{underlay:UnderlayView}>(response);
  },onSuccess:data=>{setDirty(false);displayOperation.current='';client.setQueryData(['underlay',projectId],{underlay:data.underlay,storage:'local-private-development'});}});
  const uploading=saved.isPending||saveDisplay.isPending;
  const changeDisplay=(next:UnderlayDisplay)=>{setDisplay(next);setDirty(true);displayOperation.current='';saveDisplay.reset();};
  const changeDraft=(next:Draft)=>{setDraft(next);operation.current='';saved.reset();};
  async function renderPage(number:number) {
    const document=pdf.current, details=fileDetails.current;if(!document||!details)return;
    const turn=++sequence.current;render.current?.cancel();setBusy(true);setError('');setPage(number);operation.current='';saved.reset();
    try {
      const pdfPage=await document.getPage(number);if(turn!==sequence.current)return;
      const base=pdfPage.getViewport({scale:1});
      const scale=Math.min(2,3000/Math.max(base.width,base.height),Math.sqrt(MAX_IMAGE_PIXELS/(base.width*base.height)));
      const viewport=pdfPage.getViewport({scale});
      const canvas=window.document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      const task=pdfPage.render({canvas,viewport,background:'#ffffff'});render.current=task;await task.promise;
      if(turn!==sequence.current||document!==pdf.current)return;
      setDraft({canvas,crop:{x:0,y:0,width:canvas.width,height:canvas.height},rotation:0,source:{name:details.name,sha256:details.sha256,kind:'pdf',page:number,pageCount:document.numPages,width:canvas.width,height:canvas.height,coordinateSystem:'rendered-page-pixels',pdfViewportTransform:viewport.transform as [number,number,number,number,number,number]}});
      setPreviewResult(false);pdfPage.cleanup();
    }catch(cause){if(turn===sequence.current){setDraft(null);setError('这一页无法读取，PDF 可能已损坏、加密或包含不支持的内容。请换一页或文件。');}}
    finally{if(turn===sequence.current)setBusy(false);}
  }
  async function chooseFile(file:File) {
    const turn=++fileSequence.current;sequence.current++;render.current?.cancel();void pdf.current?.loadingTask.destroy();pdf.current=null;
    setDraft(null);setPages(0);setError('');setBusy(true);operation.current='';saved.reset();
    try {
      if(!file.size||file.size>30*1024*1024)throw new Error('源文件须为非空文件，且不能超过 30 MB。');
      const bytes=await file.arrayBuffer(), header=new Uint8Array(bytes).subarray(0,5);
      const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
      if(turn!==fileSequence.current)return;fileDetails.current={name:file.name,sha256};
      if(new TextDecoder().decode(header)==='%PDF-') {
        const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs';
        const document=await pdfjs.getDocument({data:new Uint8Array(bytes),stopAtErrors:true,maxImageSize:MAX_IMAGE_PIXELS,canvasMaxAreaInBytes:64*1024*1024,useSystemFonts:true,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/'}).promise;
        if(turn!==fileSequence.current){await document.loadingTask.destroy();return;}
        if(document.numPages>200){await document.loadingTask.destroy();throw new Error('PDF 超过 200 页，请先拆分后再导入。');}
        pdf.current=document;setPages(document.numPages);await renderPage(1);return;
      }
      if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请选择 PDF、PNG、JPEG 或 WebP 文件。');
      const image=await createImageBitmap(file);
      if(turn!==fileSequence.current){image.close();return;}
      if(image.width*image.height>MAX_IMAGE_PIXELS||image.width>10000||image.height>10000){image.close();throw new Error('图片不能超过 1600 万像素或单边 10000 像素。');}
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d')!.drawImage(image,0,0);image.close();
      setDraft({canvas,crop:{x:0,y:0,width:canvas.width,height:canvas.height},rotation:0,source:{name:file.name,sha256,kind:'image',page:1,pageCount:1,width:canvas.width,height:canvas.height,coordinateSystem:'rendered-page-pixels',pdfViewportTransform:null}});setPreviewResult(false);
    }catch(cause){if(turn===fileSequence.current)setError(cause instanceof Error&&/源文件|请选择|图片不能|PDF 超过/.test(cause.message)?cause.message:'文件无法读取，可能已损坏或需要密码。请重新选择。');}
    finally{if(turn===fileSequence.current&&!pdf.current)setBusy(false);}
  }
  function cropField(key:keyof Crop,value:number) {
    if(!draft||!Number.isFinite(value))return;
    const crop={...draft.crop,[key]:Math.round(value)};
    crop.x=clamp(crop.x,0,draft.canvas.width-1);crop.y=clamp(crop.y,0,draft.canvas.height-1);
    crop.width=clamp(crop.width,1,draft.canvas.width-crop.x);crop.height=clamp(crop.height,1,draft.canvas.height-crop.y);
    changeDraft({...draft,crop});
  }
  const conflict=saved.error instanceof ApiError&&saved.error.code==='UNDERLAY_VERSION_CONFLICT'||saveDisplay.error instanceof ApiError&&saveDisplay.error.code==='UNDERLAY_VERSION_CONFLICT';
  return <section className="drawing-panel" aria-labelledby="drawing-title"><header className="drawing-heading"><div><h2 id="drawing-title">从图纸，靠近你的空间。</h2><p>先选定需要的一页与区域，再保存为项目底图。</p></div><button className="button secondary" onClick={()=>input.current?.click()} disabled={busy||uploading}><Icon name="plus" size={18}/>{underlay?'更换图纸':'选择图纸'}</button><input ref={input} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void chooseFile(file);}}/></header>
    <div className="drawing-notice"><span>底图未校准 · 未配准</span><p>尺寸仍需校准；上传图纸不会自动识别房间，也不会改变当前空间。</p></div>
    {query.isPending&&<p className="drawing-status" role="status">正在读取项目底图…</p>}
    {query.isError&&<div className="drawing-error" role="alert"><p>{message(query.error)}</p><button className="text-button" onClick={()=>query.refetch()}>重新读取</button></div>}
    {busy&&<p className="drawing-status" role="status">正在本地读取所选页面…</p>}
    {error&&<p className="drawing-error" role="alert">{error}</p>}
    {!draft&&!underlay&&!busy&&!query.isPending&&<div className="drawing-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!uploading&&e.dataTransfer.files[0])void chooseFile(e.dataTransfer.files[0]);}}><Icon name="plus" size={30}/><h3>把图纸放在这里</h3><p>拖入图片或 PDF，也可以点击上方「选择图纸」。</p><small>源文件最多 30 MB。PDF 只在浏览器选页，原文件不上传。</small></div>}
    {draft&&<div className="drawing-editor"><aside className="drawing-controls"><h3>选定需要的部分</h3><p className="drawing-filename" title={draft.source.name}>{draft.source.name}</p>{pages>0&&<label className="field">PDF 页码<select value={page} disabled={uploading} onChange={e=>void renderPage(Number(e.target.value))}>{Array.from({length:pages},(_,index)=><option key={index} value={index+1}>第 {index+1} 页 / 共 {pages} 页</option>)}</select></label>}
      <fieldset disabled={busy||uploading}><legend>裁切区域 · 旋转前像素</legend><div className="drawing-fields">{([['x','左侧 X'],['y','顶部 Y'],['width','宽度'],['height','高度']] as const).map(([key,label])=><label key={key}>{label}<input type="number" aria-label={label} value={draft.crop[key]} min={key==='x'||key==='y'?0:1} step={1} onChange={e=>cropField(key,e.target.valueAsNumber)}/></label>)}</div><button className="text-button" type="button" onClick={()=>changeDraft({...draft,crop:{x:0,y:0,width:draft.canvas.width,height:draft.canvas.height}})}>恢复整页区域</button><button className="button secondary drawing-rotate" type="button" onClick={()=>changeDraft({...draft,rotation:((draft.rotation+90)%360) as Draft['rotation']})}>顺时针旋转 90° <span>{draft.rotation}°</span></button></fieldset>
      <p className="drawing-hint">在选区视图拖动框选，也可输入精确像素。保存只包含选中区域。</p>{saved.isError&&<p className="drawing-error" role="alert">{message(saved.error)}</p>}<button className="button primary drawing-save" disabled={busy||uploading} onClick={()=>saved.mutate()}>{saved.isPending?'正在保存底图…':saved.isError?'重试保存底图':'保存所选底图'}<Icon name="arrow" size={18}/></button></aside>
      <div className="drawing-paper"><div className="drawing-view-tabs" role="group" aria-label="图纸预览"><button aria-pressed={!previewResult} onClick={()=>setPreviewResult(false)}>选区</button><button aria-pressed={previewResult} onClick={()=>setPreviewResult(true)}>保存结果预览</button><span>{output?.width} × {output?.height} px</span></div><CanvasSheet image={previewResult?output!:draft.canvas} display={{...defaultDisplay,opacity:1}} crop={previewResult?undefined:draft.crop} onCrop={previewResult||busy||uploading?undefined:crop=>changeDraft({...draft,crop})}/><p className="drawing-paper-caption">{draft.source.kind==='pdf'?`PDF 第 ${draft.source.page} 页`:'所选图片'} · {previewResult?'实际将保存的区域':'裁切坐标基于当前页渲染像素'}</p></div></div>}
    {underlay&&!draft&&<div className="drawing-editor"><aside className="drawing-controls"><h3>已保存的底图</h3><p className="drawing-filename">{underlay.source.name}</p><p className="drawing-provenance">{underlay.source.kind==='pdf'?`第 ${underlay.source.page} 页 / 共 ${underlay.source.pageCount} 页`:'图片'} · 旋转 {underlay.rotation}°<br/>{underlay.width} × {underlay.height} px · 底图版本 {underlay.version}</p><fieldset disabled={uploading}><legend>叠图显示 · 像素坐标</legend><div className="drawing-fields">{([['offsetX','水平偏移'],['offsetY','垂直偏移']] as const).map(([key,label])=><label key={key}>{label}<input type="number" aria-label={label} value={display[key]} min={-100000} max={100000} onChange={e=>{if(Number.isFinite(e.target.valueAsNumber))changeDisplay({...display,[key]:clamp(e.target.valueAsNumber,-100000,100000)});}}/></label>)}</div><label className="drawing-range">显示缩放 <output>{display.scale.toFixed(2)}×</output><input aria-label="显示缩放" type="range" min={.1} max={3} step={.05} value={display.scale} onChange={e=>changeDisplay({...display,scale:Number(e.target.value)})}/></label><label className="drawing-range">不透明度 <output>{Math.round(display.opacity*100)}%</output><input aria-label="不透明度" type="range" min={.1} max={1} step={.05} value={display.opacity} onChange={e=>changeDisplay({...display,opacity:Number(e.target.value)})}/></label><button className="text-button" onClick={()=>changeDisplay(defaultDisplay)}>重置显示位置</button></fieldset>{!!project.data?.project.scene.rooms.length&&<label className="drawing-outline-toggle"><input type="checkbox" checked={showOutline} onChange={e=>setShowOutline(e.target.checked)}/>显示空间轮廓（未配准）</label>}<p className="drawing-hint">显示缩放不代表真实尺度。虚线轮廓与底图尚未配准，仅供对照。</p>{saveDisplay.isError&&<p className="drawing-error" role="alert">{message(saveDisplay.error)}</p>}<button className="button primary drawing-save" disabled={!dirty||uploading} onClick={()=>saveDisplay.mutate()}>{saveDisplay.isPending?'正在保存…':dirty?'保存显示设置':'显示设置已保存'}<Icon name="check" size={17}/></button></aside><div className="drawing-paper"><div className="drawing-saved-bar"><span>项目底图</span><span>未校准 · 未配准</span></div><SavedSheet url={contentUrl(projectId,underlay.resourceId)} display={display} onDisplay={uploading?undefined:changeDisplay} outlines={showOutline?project.data?.project.scene.rooms.map(room=>room.outline)||[]:[]}/><p className="drawing-paper-caption">拖动底图调整显示位置 · 旋转/裁切：{underlay.crop.x}, {underlay.crop.y}, {underlay.crop.width} × {underlay.crop.height} px</p></div></div>}
    {conflict&&<button className="button secondary" onClick={()=>{setDirty(false);operation.current='';displayOperation.current='';saved.reset();saveDisplay.reset();void query.refetch();}}>读取最新底图后再保存</button>}
    <footer className="drawing-footer"><span>仅选中页与区域保存到项目私有资源。</span></footer>
  </section>;
}

function SavedSheet({url,display,onDisplay,outlines}:{url:string;display:UnderlayDisplay;onDisplay?: (next:UnderlayDisplay)=>void;outlines:{x:number;z:number}[][]}) {
  const [image,setImage]=useState<HTMLImageElement|null>(null),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{let active=true;setImage(null);setError(false);const image=new Image();image.onload=()=>{if(active)setImage(image);};image.onerror=()=>{if(active)setError(true);};image.src=url;return()=>{active=false;image.src='';};},[url,attempt]);
  if(error)return <div className="drawing-image-error" role="alert"><p>已保存的图像暂时无法读取。</p><button className="button secondary" onClick={()=>setAttempt(value=>value+1)}>重新读取图像</button></div>;
  if(!image)return <div className="drawing-image-error" role="status">正在读取私有底图…</div>;
  return <CanvasSheet image={image} display={display} onDisplay={onDisplay} outlines={outlines}/>;
}
function CanvasSheet({image,crop,onCrop,display=defaultDisplay,onDisplay,outlines=[]}:{image:HTMLCanvasElement|HTMLImageElement;crop?:Crop;onCrop?:(crop:Crop)=>void;display?:UnderlayDisplay;onDisplay?:(display:UnderlayDisplay)=>void;outlines?:{x:number;z:number}[][]}) {
  const host=useRef<HTMLDivElement>(null),start=useRef<{x:number;y:number}|null>(null);
  const [size,setSize]=useState({width:600,height:480}),[mounted,setMounted]=useState(false),[selection,setSelection]=useState<Crop|null>(null);
  useEffect(()=>{setMounted(true);const observer=new ResizeObserver(()=>{if(host.current)setSize({width:host.current.clientWidth,height:host.current.clientHeight});});if(host.current)observer.observe(host.current);return()=>observer.disconnect();},[]);
  const imageWidth=image.width,imageHeight=image.height,fit=Math.min((size.width-40)/imageWidth,(size.height-40)/imageHeight),x=(size.width-imageWidth*fit)/2,y=(size.height-imageHeight*fit)/2;
  const shownCrop=selection||crop;
  const point=(stage:Konva.Stage|null)=>{const pointer=stage?.getPointerPosition();return pointer?{x:clamp(Math.round((pointer.x-x)/fit),0,imageWidth-1),y:clamp(Math.round((pointer.y-y)/fit),0,imageHeight-1)}:null;};
  const all=outlines.flat(),minX=Math.min(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.z)),maxX=Math.max(...all.map(p=>p.x)),maxY=Math.max(...all.map(p=>p.z));
  const outlineScale=all.length?Math.min((size.width-80)/(maxX-minX||1),(size.height-80)/(maxY-minY||1)):1;
  return <div ref={host} className={`drawing-canvas ${onCrop?'can-crop':''}`} role="img" aria-label={crop?'当前页裁切预览，亦可使用像素输入框调整':'已保存底图的二维叠图预览'}>{mounted&&<Stage width={size.width} height={size.height} onMouseDown={e=>{if(onCrop)start.current=point(e.target.getStage());}} onTouchStart={e=>{if(onCrop)start.current=point(e.target.getStage());}} onMouseMove={e=>{if(!onCrop||!start.current)return;const end=point(e.target.getStage());if(end)setSelection({x:Math.min(end.x,start.current.x),y:Math.min(end.y,start.current.y),width:Math.max(1,Math.abs(end.x-start.current.x)),height:Math.max(1,Math.abs(end.y-start.current.y))});}} onTouchMove={e=>{if(!onCrop||!start.current)return;const end=point(e.target.getStage());if(end)setSelection({x:Math.min(end.x,start.current.x),y:Math.min(end.y,start.current.y),width:Math.max(1,Math.abs(end.x-start.current.x)),height:Math.max(1,Math.abs(end.y-start.current.y))});}} onMouseUp={()=>{if(selection&&onCrop)onCrop(selection);start.current=null;setSelection(null);}} onTouchEnd={()=>{if(selection&&onCrop)onCrop(selection);start.current=null;setSelection(null);}}><Layer><Rect width={size.width} height={size.height} fill="#eee7dc"/><Group x={x+(crop?0:display.offsetX*fit)} y={y+(crop?0:display.offsetY*fit)} scaleX={fit*(crop?1:display.scale)} scaleY={fit*(crop?1:display.scale)} draggable={!!onDisplay} onDragEnd={e=>onDisplay?.({...display,offsetX:Math.round((e.target.x()-x)/fit),offsetY:Math.round((e.target.y()-y)/fit)})}><KonvaImage image={image} width={imageWidth} height={imageHeight} opacity={crop?1:display.opacity}/></Group>{shownCrop&&<Rect x={x+shownCrop.x*fit} y={y+shownCrop.y*fit} width={shownCrop.width*fit} height={shownCrop.height*fit} stroke="#743c49" strokeWidth={2} dash={[7,4]} fill="#743c4912" listening={false}/>}{outlines.map((outline,index)=><Line key={index} points={outline.flatMap(p=>[(p.x-minX)*outlineScale+(size.width-(maxX-minX)*outlineScale)/2,(p.z-minY)*outlineScale+(size.height-(maxY-minY)*outlineScale)/2])} closed stroke="#743c49" strokeWidth={2} dash={[8,5]} listening={false}/>)}</Layer></Stage>}</div>;
}
