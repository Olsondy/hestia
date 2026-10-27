import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { pool } from '../../persistence/src/client';
import { createProject, getProject } from '../../projects/src/service';
import { DomainError } from '../../contracts/src/project';
import { MAX_UPLOAD_BYTES, sourceToImage, type SaveUnderlay } from '../../contracts/src/underlay';
import { saveUnderlay,getUnderlay,updateUnderlay,readPrivateImage } from './service';
import { LocalPrivateFileStore, type PrivateFileStore } from './storage';
import { readUnderlayUpload } from './transport';

test('private underlay persistence and scope against PostgreSQL',async t=>{
  const id=randomUUID(),owner={userId:`underlay-${id}`},other={userId:`underlay-other-${id}`};
  const root=path.resolve('.tmp',`underlay-tests-${id}`);await mkdir(root,{recursive:true});
  const store=new LocalPrivateFileStore(root),projects:string[]=[],keys=new Set<string>();
  const tracked:PrivateFileStore={put:async(key,bytes)=>{keys.add(key);await store.put(key,bytes);},read:key=>store.read(key),remove:key=>store.remove(key)};
  const png=await sharp({create:{width:100,height:80,channels:3,background:'#cc2244'}}).png().toBuffer();
  const input=(operationId=randomUUID(),expectedVersion=0):SaveUnderlay=>({operationId,expectedVersion,source:{name:'synthetic.png',kind:'image',sha256:createHash('sha256').update(png).digest('hex'),page:1,pageCount:1,width:100,height:80,coordinateSystem:'rendered-page-pixels',pdfViewportTransform:null},crop:{x:0,y:0,width:100,height:80},rotation:0,display:{offsetX:0,offsetY:0,scale:1,opacity:.85}});
  const rejects=async(work:Promise<unknown>,code:string)=>assert.rejects(work,e=>e instanceof DomainError&&e.code===code);
  try{
    const a=await createProject(owner,{name:'Synthetic A',template:'empty',operationId:randomUUID()});projects.push(a.id);
    const b=await createProject(owner,{name:'Synthetic B',template:'empty',operationId:randomUUID()});projects.push(b.id);
    let ready:Awaited<ReturnType<typeof saveUnderlay>>;
    await t.test('failed file persistence never publishes a ready underlay; retry reuses its logical resource',async()=>{
      const metadata=input();let failedKey='';
      const failure:PrivateFileStore={...tracked,put:async(key,bytes)=>{failedKey=key;await tracked.put(key,bytes);throw new Error('synthetic disk failure');}};
      await rejects(saveUnderlay(owner,a.id,metadata,png,'image/png',failure),'FILE_SAVE_FAILED');
      assert.equal(await getUnderlay(owner,a.id),null);
      const row=(await pool.query('SELECT r.id,r.state FROM resources r JOIN underlay_operations o ON o.resource_id=r.id WHERE o.actor_id=$1 AND o.id=$2',[owner.userId,metadata.operationId])).rows[0];
      assert.equal(row.state,'failed');await rejects(readPrivateImage(owner,a.id,row.id,tracked),'RESOURCE_NOT_READY');await assert.rejects(store.read(failedKey));
      ready=await saveUnderlay(owner,a.id,metadata,png,'image/png',tracked);assert.equal(ready.resourceId,row.id);assert.equal(ready.version,1);
      const actual=await sharp(await readPrivateImage(owner,a.id,ready.resourceId,tracked)).raw().toBuffer();assert.deepEqual([...actual.subarray(0,3)],[204,34,68]);
      assert.equal((await getProject(owner,a.id)).revision,a.revision,'underlay must not overwrite spatial revision');
      const retry=await saveUnderlay(owner,a.id,metadata,png,'image/png',tracked);assert.deepEqual(retry,ready);
      const changed=await sharp({create:{width:100,height:80,channels:3,background:'#229944'}}).png().toBuffer();
      await rejects(saveUnderlay(owner,a.id,metadata,changed,'image/png',tracked),'IDEMPOTENCY_CONFLICT');
      assert.deepEqual([...((await sharp(await readPrivateImage(owner,a.id,ready.resourceId,tracked)).raw().toBuffer()).subarray(0,3))],[204,34,68]);
    });
    await t.test('account and project boundaries apply to reads and writes',async()=>{
      await rejects(readPrivateImage(other,a.id,ready!.resourceId,tracked),'NOT_FOUND');
      await rejects(readPrivateImage(owner,b.id,ready!.resourceId,tracked),'NOT_FOUND');
      await rejects(saveUnderlay(other,a.id,input(),png,'image/png',tracked),'NOT_FOUND');
      await rejects(updateUnderlay(other,a.id,{operationId:randomUUID(),expectedVersion:1,resourceId:ready!.resourceId,display:ready!.display}),'NOT_FOUND');
      await rejects(updateUnderlay(owner,b.id,{operationId:randomUUID(),expectedVersion:1,resourceId:ready!.resourceId,display:ready!.display}),'NOT_FOUND');
      await assert.rejects(saveUnderlay(owner,b.id,{...input(),objectKey:'../../outside'},png,'image/png',tracked));
      assert.throws(()=>store.read('../../outside'));
    });
    await t.test('malformed MIME, damaged bytes, transform mismatch, and actual byte limits reject clearly',async()=>{
      await rejects(saveUnderlay(owner,b.id,input(),png,'application/pdf',tracked),'INVALID_FILE_TYPE');
      await rejects(saveUnderlay(owner,b.id,input(),png,'image/jpeg',tracked),'INVALID_IMAGE');
      await rejects(saveUnderlay(owner,b.id,input(),Buffer.from('not an image'),'image/png',tracked),'INVALID_IMAGE');
      const tooManyPixels=await sharp({create:{width:4001,height:4000,channels:3,background:'#ffffff'}}).png().toBuffer();
      await rejects(saveUnderlay(owner,b.id,input(),tooManyPixels,'image/png',tracked),'INVALID_IMAGE');
      await rejects(saveUnderlay(owner,b.id,{...input(),rotation:90},png,'image/png',tracked),'IMAGE_TRANSFORM_MISMATCH');
      await rejects(saveUnderlay(owner,b.id,input(),new Uint8Array(MAX_UPLOAD_BYTES+1),'image/png',tracked),'FILE_TOO_LARGE');
      const oversized=new Uint8Array(MAX_UPLOAD_BYTES+65537);
      const request=new Request('http://localhost/upload',{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=synthetic','Content-Length':'10'},body:oversized});
      await rejects(readUnderlayUpload(request),'FILE_TOO_LARGE');
    });
    await t.test('a concurrent metadata revision prevents publishing the stale upload after file write',async()=>{
      const metadata=input(randomUUID(),1);let key='';
      const race:PrivateFileStore={...tracked,put:async(k,bytes)=>{key=k;await tracked.put(k,bytes);await updateUnderlay(owner,a.id,{operationId:randomUUID(),expectedVersion:1,resourceId:ready!.resourceId,display:{...ready!.display,opacity:.5}});}};
      await rejects(saveUnderlay(owner,a.id,metadata,png,'image/png',race),'UNDERLAY_VERSION_CONFLICT');
      assert.equal((await getUnderlay(owner,a.id))!.version,2);assert.equal((await getUnderlay(owner,a.id))!.resourceId,ready!.resourceId);
      const state=(await pool.query('SELECT r.state FROM resources r JOIN underlay_operations o ON o.resource_id=r.id WHERE o.actor_id=$1 AND o.id=$2',[owner.userId,metadata.operationId])).rows[0].state;
      assert.equal(state,'failed');await assert.rejects(store.read(key));
      await rejects(updateUnderlay(owner,a.id,{operationId:randomUUID(),expectedVersion:1,resourceId:ready!.resourceId,display:ready!.display}),'UNDERLAY_VERSION_CONFLICT');
    });
    await t.test('crop-before-rotation coordinate provenance is explicit',()=>{
      assert.deepEqual(sourceToImage({x:10,y:20,width:30,height:40},90),[0,1,-1,0,60,-10]);
      assert.deepEqual(sourceToImage({x:10,y:20,width:30,height:40},270),[0,-1,1,0,-20,40]);
    });
    await t.test('a lost final COMMIT acknowledgement never deletes published ready bytes',async()=>{
      const originalConnect=pool.connect.bind(pool);
      const intercepted=t.mock.method(pool,'connect',function(...args:unknown[]){
        // pg Pool.query uses callback acquisition; intercept only saveUnderlay's lease.
        if(args.length)return Reflect.apply(originalConnect,pool,args);
        return originalConnect().then(client=>{
          const originalQuery=client.query,originalRelease=client.release;let commits=0;
          client.query=(async function(...queryArgs:unknown[]){
            const result=await Reflect.apply(originalQuery,client,queryArgs);
            if(queryArgs[0]==='COMMIT'&&++commits===2)throw new Error('synthetic lost COMMIT acknowledgement');
            return result;
          }) as typeof client.query;
          client.release=function(...releaseArgs){client.query=originalQuery;client.release=originalRelease;return originalRelease.apply(client,releaseArgs);};
          return client;
        });
      });
      const metadata=input();
      try{await rejects(saveUnderlay(owner,b.id,metadata,png,'image/png',tracked),'FILE_SAVE_FAILED');}finally{intercepted.mock.restore();}
      const published=(await getUnderlay(owner,b.id))!;assert.equal(published.version,1);
      assert.equal((await readPrivateImage(owner,b.id,published.resourceId,tracked)).length>0,true);
      assert.deepEqual(await saveUnderlay(owner,b.id,metadata,png,'image/png',tracked),published);
    });
  }finally{
    for(const projectId of projects){await pool.query('DELETE FROM project_underlays WHERE project_id=$1',[projectId]);await pool.query('DELETE FROM underlay_operations WHERE project_id=$1',[projectId]);await pool.query('DELETE FROM resources WHERE project_id=$1',[projectId]);await pool.query('DELETE FROM operations WHERE project_id=$1',[projectId]);await pool.query('DELETE FROM project_revisions WHERE project_id=$1',[projectId]);await pool.query('DELETE FROM projects WHERE id=$1',[projectId]);}
    for(const key of keys)await store.remove(key);
    for(const projectId of projects){await rmdir(path.join(root,'projects',projectId,'resources')).catch(()=>{});await rmdir(path.join(root,'projects',projectId)).catch(()=>{});}
    await rmdir(path.join(root,'projects')).catch(()=>{});await rmdir(root);await pool.end();
  }
});
