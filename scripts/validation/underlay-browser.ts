import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from '@playwright/test';
import { createInvitation, acceptInvitation } from '../../packages/identity/src/service';
import { createProject, reserveResource } from '../../packages/projects/src/service';
import { pool } from '../../packages/persistence/src/client';
import { privateStore } from '../../packages/files/src/storage';

/** Generated vectors only: distinct pages and asymmetric colour regions make page/crop errors observable. */
function syntheticPdf() {
  const first='0.6 0.6 0.6 rg 0 0 400 300 re f\nBT /F1 16 Tf 10 12 Td (SYNTHETIC PAGE 1) Tj ET';
  const second='1 0 0 rg 0 150 200 150 re f\n0 1 0 rg 200 150 200 150 re f\n0 0 1 rg 0 0 200 150 re f\n1 1 0 rg 200 0 200 150 re f\n0 0 0 rg BT /F1 16 Tf 10 12 Td (SYNTHETIC PAGE 2) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',`<< /Length ${Buffer.byteLength(first)} >>\nstream\n${first}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',`<< /Length ${Buffer.byteLength(second)} >>\nstream\n${second}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 8\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n `).join('\n')}\ntrailer << /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
const base=process.env.BETTER_AUTH_URL||'http://127.0.0.1:3000', run=randomUUID();
const work=path.resolve('.tmp',`underlay-browser-${run}`),review=path.resolve('.impeccable/review/t09');
await mkdir(work,{recursive:true});await mkdir(review,{recursive:true});
const pdfPath=path.join(work,'synthetic-two-pages.pdf');await writeFile(pdfPath,syntheticPdf());
const identities:{userId:string;email:string;password:string;invitationId:string}[]=[],projectIds:string[]=[];
const browser=await chromium.launch({headless:true});
try{
  for(let index=0;index<2;index++){const email=`underlay-ui-${run}-${index}@example.test`,password=`synthetic-${randomUUID()}-A9!`;const invitation=await createInvitation(email);const accepted=await acceptInvitation(invitation.token,`图纸测试${index+1}`,password);identities.push({...accepted,password,invitationId:invitation.id});}
  const principal={userId:identities[0].userId};
  const a=await createProject(principal,{name:'图纸与空间',template:'courtyard',operationId:randomUUID()});projectIds.push(a.id);
  const b=await createProject(principal,{name:'独立测试项目',template:'empty',operationId:randomUUID()});projectIds.push(b.id);
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(15000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',entry=>{if(/Text components|TypeError|ReactKonva/.test(entry.text()))errors.push(entry.text());});
  await page.goto(base);await page.getByLabel('邮箱').fill(identities[0].email);await page.getByLabel('密码',{exact:true}).fill(identities[0].password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.folio').waitFor();
  await page.goto(`${base}/?project=${a.id}&view=drawing`);await page.locator('.drawing-panel').waitFor();
  await page.locator('.drawing-panel input[type=file]').setInputFiles(pdfPath);
  await page.getByLabel('PDF 页码').waitFor();await page.getByLabel('PDF 页码').selectOption('2');await page.locator('.drawing-paper-caption').filter({hasText:'PDF 第 2 页'}).waitFor();
  // Fast selections must not allow an earlier render to replace the latest chosen page.
  await page.getByLabel('PDF 页码').selectOption('1');await page.getByLabel('PDF 页码').selectOption('2');await page.locator('.drawing-paper-caption').filter({hasText:'PDF 第 2 页'}).waitFor();
  for(const [label,value] of [['左侧 X','80'],['顶部 Y','60'],['宽度','480'],['高度','360']])await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button',{name:/顺时针旋转/}).click();await page.getByRole('button',{name:'保存结果预览',exact:true}).click();await page.locator('.drawing-canvas canvas').waitFor();assert.equal(await page.locator('.drawing-canvas canvas').evaluate((canvas:HTMLCanvasElement)=>{const data=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;for(let i=0;i<data.length;i+=4)if(data[i]>240&&data[i+1]<20&&data[i+2]<20)return true;return false;}),true,'Konva preview must contain actual red fixture pixels');
  for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'1100',width:1100,height:900},{name:'mobile',width:390,height:844}]){await page.setViewportSize(viewport);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(350);await page.screenshot({path:path.join(review,`crop-${viewport.name}.png`),fullPage:true});const overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,class:el.className,right:el.getBoundingClientRect().right})));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,JSON.stringify(overflow));}
  let committed='',uploadSignature='';
  await page.route('**/underlay',async route=>{if(route.request().method()==='POST'){const bytes=route.request().postDataBuffer()!;const form=await new Response(new Uint8Array(bytes),{headers:{'content-type':route.request().headers()['content-type']}}).formData();const file=form.get('file') as File;uploadSignature=Buffer.from(await file.arrayBuffer()).subarray(0,8).toString('hex');assert.equal(file.type,'image/png');const response=await route.fetch();assert.equal(response.status(),201);committed=(await response.json()).underlay.resourceId;await route.abort('failed');await page.unroute('**/underlay');}else await route.continue();});
  await page.getByRole('button',{name:'保存所选底图',exact:true}).click();await page.locator('.drawing-error').filter({hasText:'连接中断'}).waitFor();await page.getByRole('button',{name:'重试保存底图',exact:true}).click();await page.getByRole('heading',{name:'已保存的底图'}).waitFor();
  assert.equal(uploadSignature,'89504e470d0a1a0a','only selected raster was uploaded');
  let underlay=(await (await context.request.get(`${base}/api/projects/${a.id}/underlay`)).json()).underlay;
  assert.equal(underlay.resourceId,committed);assert.equal(underlay.source.page,2);assert.equal(underlay.rotation,90);assert.equal(underlay.width,360);assert.equal(underlay.height,480);assert.deepEqual(underlay.sourceToImage,[0,1,-1,0,420,-80]);
  const downloaded=await context.request.get(`${base}/api/projects/${a.id}/resources/${underlay.resourceId}/content`);assert.equal(downloaded.status(),200);
  const bytes=await downloaded.body(),decoded=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const pixel=(x:number,y:number)=>[...decoded.data.subarray((y*decoded.info.width+x)*3,(y*decoded.info.width+x)*3+3)];
  assert.deepEqual(pixel(330,30),[255,0,0]);assert.deepEqual(pixel(330,450),[0,255,0]);assert.deepEqual(pixel(30,30),[0,0,255]);assert.deepEqual(pixel(30,450),[255,255,0]);
  await page.getByLabel('水平偏移',{exact:true}).fill('12');await page.getByLabel('垂直偏移',{exact:true}).fill('-8');await page.getByLabel('不透明度',{exact:true}).focus();await page.getByLabel('不透明度',{exact:true}).press('End');for(let i=0;i<9;i++)await page.getByLabel('不透明度',{exact:true}).press('ArrowLeft');await page.getByRole('button',{name:'保存显示设置',exact:true}).click();await page.getByRole('button',{name:'显示设置已保存',exact:true}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'已保存的底图'}).waitFor();assert.equal(await page.getByLabel('水平偏移',{exact:true}).inputValue(),'12');assert.equal(await page.getByLabel('垂直偏移',{exact:true}).inputValue(),'-8');assert.equal(await page.getByLabel('不透明度',{exact:true}).inputValue(),'0.55');
  await page.getByLabel('显示空间轮廓（未配准）').check();await page.emulateMedia({reducedMotion:'reduce'});
  for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'1100',width:1100,height:900},{name:'mobile',width:390,height:844}]){await page.setViewportSize(viewport);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(review,`saved-${viewport.name}.png`),fullPage:true});}
  assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
  const contextB=await browser.newContext();const signed=await contextB.request.post(`${base}/api/auth/sign-in/email`,{headers:{Origin:base},data:{email:identities[1].email,password:identities[1].password}});assert.equal(signed.status(),200);
  assert.equal((await contextB.request.get(`${base}/api/projects/${a.id}/resources/${underlay.resourceId}/content`)).status(),404);
  assert.equal((await context.request.get(`${base}/api/projects/${b.id}/resources/${underlay.resourceId}/content`)).status(),404);
  const displayInput={operationId:randomUUID(),expectedVersion:2,resourceId:underlay.resourceId,display:underlay.display};
  assert.equal((await contextB.request.patch(`${base}/api/projects/${a.id}/underlay`,{headers:{Origin:base},data:displayInput})).status(),404);
  assert.equal((await context.request.patch(`${base}/api/projects/${b.id}/underlay`,{headers:{Origin:base},data:displayInput})).status(),404);
  const pending=await reserveResource(principal,a.id,{id:randomUUID(),mediaType:'image/png'});assert.equal((await context.request.get(`${base}/api/projects/${a.id}/resources/${pending.id}/content`)).status(),409);
  const metadata={operationId:randomUUID(),expectedVersion:0,source:{name:'synthetic.png',kind:'image',sha256:'a'.repeat(64),page:1,pageCount:1,width:100,height:80,coordinateSystem:'rendered-page-pixels',pdfViewportTransform:null},crop:{x:0,y:0,width:100,height:80},rotation:0,display:{offsetX:0,offsetY:0,scale:1,opacity:1}};
  const png=await sharp({create:{width:100,height:80,channels:3,background:'#cc2244'}}).png().toBuffer();
  const postImage=(request:typeof context.request,projectId:string,buffer:Buffer,mimeType:string)=>request.post(`${base}/api/projects/${projectId}/underlay`,{headers:{Origin:base},multipart:{metadata:JSON.stringify(metadata),file:{name:'synthetic.png',mimeType,buffer}}});
  assert.equal((await postImage(contextB.request,a.id,png,'image/png')).status(),404);
  assert.equal((await postImage(context.request,b.id,png,'image/jpeg')).status(),400);
  assert.equal((await postImage(context.request,b.id,Buffer.from('broken image'),'image/png')).status(),400);
  assert.equal((await postImage(context.request,b.id,png,'application/pdf')).status(),415);
  assert.equal((await postImage(context.request,b.id,Buffer.alloc(12*1024*1024+1),'image/png')).status(),413);
  await page.locator('.drawing-panel input[type=file]').setInputFiles({name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF- broken synthetic')});await page.locator('.drawing-error').filter({hasText:'文件无法读取'}).waitFor();
  await page.screenshot({path:path.join(review,'invalid-pdf-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.fonts.check('400 14px "Tsanger YuYang"')),true);
  await page.goto(`${base}/?project=${b.id}&view=drawing`);await page.locator('.drawing-panel input[type=file]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});await page.getByRole('button',{name:'保存所选底图',exact:true}).click();await page.getByRole('heading',{name:'已保存的底图'}).waitFor();await page.reload();await page.getByRole('heading',{name:'已保存的底图'}).waitFor();
  const imageUnderlay=(await (await context.request.get(`${base}/api/projects/${b.id}/underlay`)).json()).underlay;assert.equal(imageUnderlay.source.kind,'image');assert.equal(imageUnderlay.width,100);assert.equal(imageUnderlay.height,80);
  assert.deepEqual(errors,[]);
  underlay=(await (await context.request.get(`${base}/api/projects/${a.id}/underlay`)).json()).underlay;assert.equal(underlay.version,2);assert.equal(underlay.source.page,2);
  console.log('Underlay browser verification passed: PDF page/crop pixel proof, retry, reopen, overlays, scope, malformed PDF, three widths, reduced motion.');
  await writeFile(path.join(review,'browser-result.json'),JSON.stringify({passed:true,page:2,rotation:90,output:[360,480],pixelSamples:['red','green','blue','yellow'],version:2,display:underlay.display,widths:[1440,1100,390],pageErrors:errors,sourcePdfUploaded:false},null,2));
}finally{
  await browser.close();const store=privateStore();
  for(const projectId of projectIds){const resources=(await pool.query('SELECT object_key FROM resources WHERE project_id=$1',[projectId])).rows;await pool.query('DELETE FROM project_underlays WHERE project_id=$1',[projectId]);await pool.query('DELETE FROM underlay_operations WHERE project_id=$1',[projectId]);await pool.query('DELETE FROM resources WHERE project_id=$1',[projectId]);await pool.query('DELETE FROM operations WHERE project_id=$1',[projectId]);await pool.query('DELETE FROM project_revisions WHERE project_id=$1',[projectId]);await pool.query('DELETE FROM projects WHERE id=$1',[projectId]);for(const resource of resources)if(resource.object_key.startsWith(`projects/${projectId}/resources/`))await store.remove(resource.object_key);}
  for(const identity of identities){await pool.query('DELETE FROM hestia_invitation WHERE id=$1 AND user_id=$2',[identity.invitationId,identity.userId]);await pool.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2',[identity.userId,identity.email]);}
  await unlink(pdfPath);await rmdir(work);await pool.end();
}
