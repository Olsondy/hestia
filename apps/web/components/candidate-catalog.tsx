'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { CandidateCommand, CandidateView } from '../../../packages/contracts/src/candidates';
import type { CatalogView } from '../../../packages/contracts/src/catalog';
import { api } from './api';
import { objectName } from './furniture-inspector';

type Props={candidate:CandidateView;busy:boolean;onBusy:(value:boolean)=>void;onDraftChange:(value:boolean)=>void;post:<T>(path:string,data:Record<string,unknown>)=>Promise<T>;onSaved:(value:{candidate:CandidateView})=>void};
const labels={width:'宽',depth:'深',height:'高'};
export function CandidateCatalog({candidate,busy,onBusy,onDraftChange,post,onSaved}:Props){
  const catalog=useQuery({queryKey:['catalog'],queryFn:()=>api<CatalogView>('/api/catalog')});
  const [mode,setMode]=useState<'add'|'replace'|'remove'>('add'),[assetId,setAssetId]=useState(''),[materialId,setMaterialId]=useState('');
  const [targetId,setTargetId]=useState(''),[changed,setChanged]=useState(false);
  const [size,setSize]=useState({width:'',depth:'',height:''}),[x,setX]=useState(''),[z,setZ]=useState(''),[yaw,setYaw]=useState('0');
  const asset=catalog.data?.assets.find(item=>item.id===assetId),material=catalog.data?.materials.find(item=>item.id===materialId);
  const eligible=candidate.scene.objects.filter(item=>item.kind==='furniture'&&item.dimensionSource!=='measured'&&!candidate.lockedObjectIds.includes(item.id));
  const target=eligible.find(item=>item.id===targetId);
  const reliable=candidate.scale==='calibrated'||candidate.scale==='synthetic';
  useEffect(()=>{onDraftChange(changed);return()=>onDraftChange(false);},[changed,onDraftChange]);
  const mutation=useMutation({mutationFn:()=>{
    let command:CandidateCommand;
    if(mode==='remove'){if(!target)throw new Error('请先选择允许删除的家具。');command={type:'remove-furniture',objectId:target.id};}
    else{
      if(!asset||!material)throw new Error('请先选择目录家具和材质。');
      const params={assetId:asset.id,assetVersion:asset.version,materialId:material.id,materialVersion:material.version,size:{width:Number(size.width),depth:Number(size.depth),height:Number(size.height)}};
      if(mode==='replace'){if(!target)throw new Error('请先选择允许替换的家具。');command={type:'replace-furniture',objectId:target.id,...params};}
      else command={type:'add-furniture',...params,x:Number(x),z:Number(z),yaw:Number(yaw)*Math.PI/180};
    }
    return post<{candidate:CandidateView}>(`/api/projects/${candidate.projectId}/candidates/${candidate.id}/commands`,{expectedCandidateRevision:candidate.revision,command});
  },onMutate:()=>onBusy(true),onSettled:()=>onBusy(false),onSuccess:onSaved});
  function reset(){setAssetId('');setMaterialId('');setTargetId('');setSize({width:'',depth:'',height:''});setX('');setZ('');setYaw('0');setChanged(false);mutation.reset();}
  function selectAsset(id:string){setAssetId(id);const value=catalog.data?.assets.find(item=>item.id===id);setMaterialId(value?.defaultMaterialId||'');setSize(value?{width:String(value.defaultSize.width),depth:String(value.defaultSize.depth),height:String(value.defaultSize.height)}:{width:'',depth:'',height:''});setChanged(!!id||!!targetId);mutation.reset();}
  function edit(work:()=>void){work();setChanged(true);mutation.reset();}
  const submit=(event:FormEvent)=>{event.preventDefault();mutation.mutate();};
  const disabled=busy||mutation.isPending||!reliable;
  const protectedObjects=candidate.scene.objects.filter(item=>item.kind==='fixed'||item.dimensionSource==='measured'||candidate.lockedObjectIds.includes(item.id));
  return <section className="candidate-catalog" aria-labelledby="catalog-title"><header><div><h3 id="catalog-title">探索家具组合</h3><p>目录家具为内置示意资产，不对应真实商品。增删与替换只写入这份候选。</p></div><span>目录版本 {catalog.data?.version??'—'}</span></header>
    {catalog.isPending&&<p role="status">正在读取家具目录…</p>}{catalog.isError&&<div className="candidate-feedback" role="alert"><p>家具目录暂时无法读取。</p><button className="text-button" onClick={()=>catalog.refetch()}>重新读取目录</button></div>}
    {catalog.data&&<form onSubmit={submit}><fieldset disabled={disabled}><legend className="catalog-mode-label">组合操作</legend><div className="catalog-modes">{([['add','新增家具'],['replace','替换家具'],['remove','删除家具']] as const).map(([value,label])=><label key={value}><input type="radio" name={`catalog-mode-${candidate.id}`} checked={mode===value} onChange={()=>{reset();setMode(value);}}/>{label}</label>)}</div>
      <div className="catalog-form-grid"><div className="catalog-selection">
        {mode!=='add'&&<label className="field">{mode==='replace'?'要替换的家具':'要删除的家具'}<select aria-label={mode==='replace'?'要替换的家具':'要删除的家具'} value={targetId} onChange={event=>edit(()=>setTargetId(event.target.value))}><option value="">选择候选中的家具</option>{eligible.map(item=><option key={item.id} value={item.id}>{item.name||objectName(item.id)} · {item.id}</option>)}</select></label>}
        {mode!=='add'&&eligible.length===0&&<p className="catalog-note">这份候选没有可{mode==='replace'?'替换':'删除'}的家具。固定设施、锁定物品和已测实物会保留。</p>}
        {mode!=='remove'&&<><label className="field">目录家具<select aria-label="目录家具" value={assetId} onChange={event=>selectAsset(event.target.value)}><option value="">选择内置示意家具</option>{catalog.data.assets.map(item=><option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}</select></label>{catalog.data.assets.length===0&&<p className="catalog-note">目录中暂时没有可选家具。</p>}
          {asset&&<><p className="catalog-note">内置示意家具；尺寸范围为应用选型参数，不是厂商规格或实测数据。</p><label className="field">目录材质<select aria-label="目录材质" value={materialId} onChange={event=>edit(()=>setMaterialId(event.target.value))}>{catalog.data.materials.filter(item=>asset.materialIds.includes(item.id)).map(item=><option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}</select></label>{material&&<p className="catalog-material"><span style={{backgroundColor:material.swatch}} aria-hidden="true"/>{material.name} · 示意材质</p>}<p className="catalog-provenance">资产 {asset.id} · v{asset.version}<br/>材质 {material?.id} · v{material?.version}</p></>}
        </>}
        {mode==='remove'&&target&&<p className="catalog-remove-summary">将从候选中移除「{target.name||objectName(target.id)}」。当前方案暂不改变，采用前仍需检查并查看差异。</p>}
      </div><div className="catalog-parameters">
        {asset&&mode!=='remove'&&<><h4>目录尺寸 · 米</h4><div className="catalog-size-fields">{(['width','depth','height'] as const).map(key=><label className="field" key={key}>{labels[key]}<input aria-label={`目录${labels[key]}度（米）`} type="number" required min={asset.sizeRange[key].min} max={asset.sizeRange[key].max} step={asset.sizeRange[key].step} value={size[key]} onChange={event=>edit(()=>setSize({...size,[key]:event.target.value}))}/><small>{asset.sizeRange[key].min}–{asset.sizeRange[key].max} m · 步长 {asset.sizeRange[key].step}</small></label>)}</div><p className="catalog-note">这是新目录家具的可选尺寸，不会缩小已测实物来消除冲突。</p></>}
        {mode==='add'&&asset&&<><h4>放入候选的位置</h4><div className="catalog-pose-fields"><label className="field">新增 X（米）<input type="number" min="-1000" max="1000" step="0.001" required value={x} onChange={event=>edit(()=>setX(event.target.value))}/></label><label className="field">新增 Z（米）<input type="number" min="-1000" max="1000" step="0.001" required value={z} onChange={event=>edit(()=>setZ(event.target.value))}/></label><label className="field">新增角度（度）<input type="number" min="-360" max="360" step="0.01" required value={yaw} onChange={event=>edit(()=>setYaw(event.target.value))}/></label></div></>}
        {mode==='replace'&&target&&<p className="catalog-note">替换保留这件家具的位置与朝向（X {target.position.x} / Z {target.position.z} m）；尺寸变化后重新检查是否放得下。</p>}
      </div></div><div className="catalog-submit-row"><button className="button secondary" disabled={mode==='remove'?!target:!asset||!material||(mode==='replace'&&!target)}>{mutation.isPending?'正在保存组合…':mode==='add'?'加入候选':mode==='replace'?'替换候选家具':'从候选删除'}</button>{changed&&<button className="text-button" type="button" onClick={reset}>还原未保存组合</button>}<span>保存组合后，旧检查会失效。</span></div>
    </fieldset></form>}
    {!reliable&&<p className="candidate-feedback">空间尺度尚未确认，请先补充可靠尺度，再增删或替换家具。</p>}
    {!!protectedObjects.length&&<p className="catalog-protection">保留不动：{protectedObjects.map(item=>`${item.name||objectName(item.id)}（${item.kind==='fixed'?'固定设施':candidate.lockedObjectIds.includes(item.id)?'已锁定':'已测实物'}）`).join('、')}。此处不能删除或替换。</p>}
    {mutation.isError&&<p className="candidate-feedback" role="alert">{mutation.error.message}</p>}
  </section>;
}

type ObjectView=CandidateView['scene']['objects'][number];
const displayMetres = (value: number) => Number(value.toFixed(3));
function ObjectFacts({item}:{item:ObjectView|null}){return item?<div><strong>{item.name||objectName(item.id)}</strong><span>{item.size.width} × {item.size.depth} × {item.size.height} m（宽 × 深 × 高）</span><span>X {displayMetres(item.position.x)} / Z {displayMetres(item.position.z)} m · {(item.yaw%(Math.PI*2)*180/Math.PI).toFixed(2)}°</span><span>{item.dimensionSource==='measured'?'已测实物':item.catalog?'目录尺寸':'尺寸来源未确认'}</span>{item.catalog?<small>资产 {item.catalog.assetId} v{item.catalog.assetVersion}<br/>材质 {item.catalog.materialId} v{item.catalog.materialVersion}</small>:<small>原有物品 · 颜色 {item.color}</small>}</div>:<p>无此家具</p>;}
export function CandidateObjectChanges({candidate}:{candidate:CandidateView}){return candidate.objectChanges.length?<ul className="candidate-object-changes">{candidate.objectChanges.map(change=><li key={change.objectId}><div className="candidate-change-title"><strong>{({added:'新增',removed:'删除',replaced:'替换',moved:'移动'})[change.kind]}</strong><span>{change.objectId}</span></div><div className="candidate-change-pair"><section><h4>创建时</h4><ObjectFacts item={change.before}/></section><section><h4>候选中</h4><ObjectFacts item={change.after}/></section></div></li>)}</ul>:<p>家具摆放与组合尚未变化。</p>;}
