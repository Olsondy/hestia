// Historical T07 UI capture script. The production tasks view now uses ConversationPanel.
// For the current interface run scripts/validation/conversation-ui.ts; T07 backend/process evidence remains historical.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createInvitation, acceptInvitation } from '../../packages/identity/src/service';
import { createProject, getProject } from '../../packages/projects/src/service';
import { pool } from '../../packages/persistence/src/client';

// Runs only against existing Next/Postgres. It never starts or invokes a Worker.
const base=process.env.BETTER_AUTH_URL||'http://127.0.0.1:3000',run=randomUUID(),review=path.resolve('.impeccable/review/t07');
await mkdir(review,{recursive:true});
const email=`task-ui-${run}@example.test`,password=`synthetic-${randomUUID()}-A9!`;
const invitation=await createInvitation(email),identity=await acceptInvitation(invitation.token,'任务测试',password),projectIds:string[]=[];
const principal={userId:identity.userId},browser=await chromium.launch({headless:true});
try{
  const a=await createProject(principal,{name:'任务与空间',template:'courtyard',operationId:randomUUID()});projectIds.push(a.id);
  const b=await createProject(principal,{name:'待确认的空间',template:'empty',operationId:randomUUID()});projectIds.push(b.id);
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(15000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.getByLabel('邮箱').fill(email);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.folio').waitFor();
  await page.goto(`${base}/?project=${a.id}&view=tasks`);await page.locator('.task-panel').waitFor();await page.getByText('这里会留下执行记录。').waitFor();
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(review,'empty-desktop.png'),fullPage:true});
  let committed='',posts=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname===`/api/projects/${a.id}/tasks`)posts++;});
  await page.route(`**/api/projects/${a.id}/tasks`,async route=>{
    if(route.request().method()!=='POST')return route.continue();
    const response=await route.fetch();assert.equal(response.status(),202);committed=(await response.json()).task.id;await route.abort('failed');await page.unroute(`**/api/projects/${a.id}/tasks`);
  });
  await page.getByRole('button',{name:'提交测试任务',exact:true}).click();await page.getByRole('button',{name:'重试同一条任务',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(review,'retry-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'重试同一条任务',exact:true}).click();await page.locator('#task-state-title').filter({hasText:'等待执行'}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('task'),committed);assert.equal(posts,2);
  let tasks=(await (await context.request.get(`${base}/api/projects/${a.id}/tasks`)).json()).tasks;assert.equal(tasks.length,1);assert.equal(tasks[0].status,'queued');assert.equal(tasks[0].checkpoint.nextStep,0);
  await page.reload();await page.locator('#task-state-title').filter({hasText:'等待执行'}).waitFor();assert.equal(posts,2,'refresh must not resubmit');
  const reopened=await context.newPage();await reopened.goto(page.url());await reopened.locator('#task-state-title').filter({hasText:'等待执行'}).waitFor();assert.equal(new URL(reopened.url()).searchParams.get('task'),committed);await reopened.close();
  for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'1100',width:1100,height:900},{name:'mobile',width:390,height:844}]){
    await page.setViewportSize(viewport);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(review,`queued-${viewport.name}.png`),fullPage:true});
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'取消任务',exact:true}).click();await page.locator('#task-state-title').filter({hasText:'已取消'}).waitFor();await page.screenshot({path:path.join(review,'cancelled-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
  // The move option captures a clear bounded command, but is cancelled while queued.
  await page.getByRole('button',{name:'3D 空间',exact:true}).click();await page.locator('.object-list').getByRole('button',{name:'沙发',exact:true}).click();await page.getByRole('button',{name:'任务记录',exact:true}).click();await page.getByRole('radio',{name:/文字与固定移动/}).check();
  await page.getByRole('button',{name:'提交测试任务',exact:true}).click();await page.locator('#task-state-title').filter({hasText:'等待执行'}).waitFor();
  const secondId=new URL(page.url()).searchParams.get('task')!;assert.notEqual(secondId,committed);
  const row=(await pool.query('SELECT steps,next_step,status FROM design_tasks WHERE id=$1 AND actor_id=$2',[secondId,identity.userId])).rows[0];
  const sofa=a.scene.objects.find(object=>object.id==='sofa-a')!;assert.equal(row.steps[1].command.objectId,sofa.id);assert.equal(row.steps[1].command.x,Number((sofa.position.x+.2).toFixed(6)));assert.equal(row.status,'queued');assert.equal(row.next_step,0);
  await page.getByRole('button',{name:'取消任务',exact:true}).click();await page.locator('#task-state-title').filter({hasText:'已取消'}).waitFor();assert.equal((await getProject(principal,a.id)).revision,a.revision,'queued test cannot modify scene');
  await page.goto(`${base}/?project=${b.id}&view=tasks`);await page.locator('.task-panel').waitFor();assert.equal(await page.getByRole('radio',{name:/文字与固定移动/}).isDisabled(),true);assert.equal(await page.getByRole('radio',{name:/仅文字/}).isChecked(),true);
  assert.equal(await page.evaluate(()=>document.fonts.check('400 14px "Tsanger YuYang"')),true);assert.deepEqual(errors,[]);
  tasks=(await (await context.request.get(`${base}/api/projects/${a.id}/tasks`)).json()).tasks;assert.equal(tasks.length,2);assert.equal(tasks.every((task:{status:string;checkpoint:{nextStep:number}})=>task.status==='cancelled'&&task.checkpoint.nextStep===0),true);
  await writeFile(path.join(review,'browser-result.json'),JSON.stringify({passed:true,scope:'accept-reopen-subscribe-cancel only; Worker not started or invoked',tasks:2,executedSteps:0,unchangedSceneRevision:true,widths:[1440,1100,390],reducedMotion:true,fontLoaded:true,pageErrors:errors},null,2));
  console.log('Task UI verification passed: acceptance retry, same-ID reopen, queued-only SSE, cancellation, explicit synthetic command, non-synthetic guard. No Worker was started or invoked.');
}finally{
  await browser.close();
  for(const projectId of projectIds){const tasks=(await pool.query('SELECT id FROM design_tasks WHERE project_id=$1 AND actor_id=$2',[projectId,identity.userId])).rows;for(const task of tasks)await pool.query('DELETE FROM hestia_jobs.job WHERE id=$1 AND data->>\'taskId\'=$2',[task.id,task.id]);await pool.query('DELETE FROM design_tasks WHERE project_id=$1 AND actor_id=$2',[projectId,identity.userId]);await pool.query('DELETE FROM operations WHERE project_id=$1',[projectId]);await pool.query('DELETE FROM project_revisions WHERE project_id=$1',[projectId]);await pool.query('DELETE FROM projects WHERE id=$1 AND created_by=$2',[projectId,identity.userId]);}
  await pool.query('DELETE FROM hestia_invitation WHERE id=$1 AND user_id=$2',[invitation.id,identity.userId]);await pool.query('DELETE FROM hestia_auth_user WHERE id=$1 AND email=$2',[identity.userId,email]);await pool.end();
}
