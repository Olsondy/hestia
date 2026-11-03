import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { pool, transaction } from '../../persistence/src/client';
import { auth, authOrigin } from '../../identity/src/auth';
import { acceptInvitation, createInvitation } from '../../identity/src/service';
import { mockSmsSender, setSmsSender } from '../../identity/src/sms';
import { createWorkspace } from '../../workspaces/src/service';
import { addStones } from '../../finishes/src/catalog';
import { demoStones } from '../../finishes/src/demo-stones';
import { initializeRenderQueue } from '../../renders/src/queue';
import { runRender } from '../../renders/src/runner';
import sharp from 'sharp';
import { addSoftStyles, retireSoftStyle } from '../../soft-styles/src/catalog';
import { demoSoftStyles } from '../../soft-styles/src/demo-styles';
import * as authRoute from '../../../apps/web/app/api/auth/[...all]/route';
import * as requestsRoute from '../../../apps/web/app/api/client/[entry]/requests/route';
import * as optionsRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/schemes/[schemeId]/options/route';
import * as adjustRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/schemes/[schemeId]/adjust/route';
import * as softStyleRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/schemes/[schemeId]/soft-style/route';
import * as batchRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/schemes/[schemeId]/adjust-batch/route';
import * as undoRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/schemes/[schemeId]/undo/route';
import * as confirmRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/confirm/route';
import * as messagesRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/messages/route';
import * as leadsRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/leads/route';

// HTTP route handlers + real PostgreSQL + real pg-boss producer. Renders are queued, not executed.
const run = randomUUID().slice(0, 8), slug = `d07-${run}`, password = 'synthetic-d07-password-482!', adminEmail = `d07-admin-${run}@example.test`, phones: string[] = [];
let adminCookie = '', workspaceId = '';
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
type Handler = (request: Request, context: never) => Promise<Response>;
async function call(handler: Handler, params: Record<string, string>, cookie: string, json?: unknown) {
  const response = await handler(new Request(`${authOrigin}/api/test`, { method: json === undefined ? 'GET' : 'POST',
    headers: { Origin: authOrigin, Cookie: cookie, ...(json === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: json === undefined ? undefined : JSON.stringify(json) }), { params: Promise.resolve(params) } as never);
  return { status: response.status, body: await response.json() };
}
async function customer() {
  const phoneNumber = `199${String(randomInt(0, 1e8)).padStart(8, '0')}`; phones.push(`+86${phoneNumber}`);
  const post = (path: string, payload: unknown) => authRoute.POST(new Request(`${authOrigin}/api/auth/${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: authOrigin, 'X-Real-IP': `10.7.${randomInt(0, 255)}.${randomInt(1, 255)}` }, body: JSON.stringify(payload) }));
  const code = (await (await post('phone/send-code', { phoneNumber, entry: slug })).json()).demoCode;
  return cookieOf(await post('phone/sign-in', { phoneNumber, entry: slug, code }));
}
async function published(cookie: string) {
  const created = await call(requestsRoute.POST, { entry: slug }, cookie, { source: 'demo-villa', operationId: randomUUID(),
    finishIds: ['finish-f1-living-floor', 'finish-f1-tv-wall', 'finish-f1-stair'],
    stones: ['demo-white-marble', 'demo-beige-marble'].map(stoneId => ({ stoneId, stoneVersion: 1 })) });
  assert.equal(created.body.request.status, 'published', JSON.stringify(created.body));
  return created.body.request;
}
const renders = (projectId: string) => pool.query('SELECT count(*)::int AS n FROM project_renders WHERE project_id=$1', [projectId]).then(r => r.rows[0].n as number);

before(async () => {
  process.env.HESTIA_OTP_SOURCE_HEADER = 'x-real-ip';
  setSmsSender(mockSmsSender);
  await initializeRenderQueue();
  const invitation = await createInvitation(adminEmail);
  await acceptInvitation(invitation.token, '合成石材企业管理员', password);
  adminCookie = cookieOf(await auth.api.signInEmail({ body: { email: adminEmail, password }, asResponse: true }));
  workspaceId = (await createWorkspace({ kind: 'enterprise', slug, name: '调整验证企业', adminEmail })).workspace.id;
  await transaction(async client => { await addStones(client, workspaceId, demoStones); await addSoftStyles(client, workspaceId, demoSoftStyles); });
});
after(async () => {
  try {
    const users = (await pool.query('SELECT id FROM hestia_auth_user WHERE phone_number=ANY($1) OR email=$2', [phones, adminEmail])).rows.map(row => row.id);
    const workspaces = (await pool.query('SELECT id FROM workspaces WHERE slug=$1 OR personal_user_id=ANY($2)', [slug, users])).rows.map(row => row.id);
    const projects = '(SELECT id FROM projects WHERE workspace_id=ANY($1::uuid[]))';
    await pool.query('DELETE FROM finish_requests WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    for (const table of ['project_renders', 'resources', 'project_revisions', 'operations'])
      await pool.query(`DELETE FROM ${table} WHERE project_id IN ${projects}`, [workspaces]);
    await pool.query('DELETE FROM projects WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM workspace_stones WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM workspace_soft_styles WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM workspaces WHERE id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM phone_otp_challenges WHERE phone_number=ANY($1)', [phones]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=$1', [adminEmail]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
  } finally { await pool.end(); }
});

test('options list allowed stones, sizes and patterns per finish', async () => {
  const cookie = await customer(), request = await published(cookie), scheme = request.schemes[0];
  const { body } = await call(optionsRoute.GET, { entry: slug, requestId: request.id, schemeId: scheme.id }, cookie);
  const byId = Object.fromEntries(body.options.finishes.map((f: { finishId: string }) => [f.finishId, f]));
  assert.deepEqual(byId['finish-f1-stair'].patterns, ['straight']); assert.equal(byId['finish-f1-stair'].border, false);
  assert.deepEqual(byId['finish-f1-tv-wall'].patterns, ['straight', 'running-bond']);
  assert.ok(byId['finish-f1-living-floor'].patterns.includes('herringbone')); assert.equal(byId['finish-f1-living-floor'].border, true);
  assert.ok(byId['finish-f1-living-floor'].stones.every((s: { sizes: unknown[] }) => s.sizes.length > 0));
});

test('an adjustment is a new rendered revision; retries and undo do not render again; invalid options are refused', async () => {
  const cookie = await customer(), request = await published(cookie), scheme = request.schemes[0], params = { entry: slug, requestId: request.id, schemeId: scheme.id };
  const before = await renders(request.projectId), operationId = randomUUID();
  const change = { operationId, expectedRevision: 1, finishId: 'finish-f1-living-floor', stone: { stoneId: 'demo-limestone', stoneVersion: 1 }, tile: { length: .8, width: .8 }, pattern: 'diagonal', border: false };
  const adjusted = await call(adjustRoute.POST, params, cookie, change);
  assert.equal(adjusted.status, 200, JSON.stringify(adjusted.body));
  const revised = adjusted.body.request.schemes.find((s: { id: string }) => s.id === scheme.id);
  assert.equal(revised.revision, 2); assert.equal(revised.render.status, 'queued');
  const living = revised.surfaceDesign.tilings.find((t: { finishId: string }) => t.finishId === 'finish-f1-living-floor');
  assert.equal(living.stoneId, 'demo-limestone'); assert.equal(living.pattern, 'diagonal'); assert.equal(living.border, undefined);
  assert.equal(await renders(request.projectId), before + 1);
  assert.equal((await call(adjustRoute.POST, params, cookie, change)).body.request.schemes.find((s: { id: string }) => s.id === scheme.id).revision, 2, 'retry is idempotent');
  assert.equal(await renders(request.projectId), before + 1, 'retry does not render twice');
  // Refused options leave the scheme unchanged, with a reason.
  const refuse = async (extra: object, code: string) => {
    const result = await call(adjustRoute.POST, params, cookie, { operationId: randomUUID(), expectedRevision: 2, finishId: 'finish-f1-living-floor', ...extra });
    assert.equal(result.body.error?.code, code, JSON.stringify(result.body));
  };
  await refuse({ pattern: 'herringbone' }, 'ADJUSTMENT_REJECTED');
  await refuse({ tile: { length: 1.7, width: 1.1 } }, 'OPTION_NOT_ALLOWED');
  await refuse({ stone: { stoneId: 'no-such', stoneVersion: 1 } }, 'STONE_NOT_AVAILABLE');
  assert.equal((await call(adjustRoute.POST, params, cookie, { operationId: randomUUID(), expectedRevision: 2, finishId: 'finish-f1-stair', pattern: 'diagonal' })).body.error.code, 'OPTION_NOT_ALLOWED');
  assert.equal((await call(adjustRoute.POST, params, cookie, { operationId: randomUUID(), expectedRevision: 1, finishId: 'finish-f1-stair', border: false })).body.error.code, 'SCHEME_REVISION_CONFLICT');
  // Undo returns to revision 1's content and image.
  const undone = await call(undoRoute.POST, params, cookie, { operationId: randomUUID(), expectedRevision: 2 });
  const restored = undone.body.request.schemes.find((s: { id: string }) => s.id === scheme.id);
  assert.equal(restored.revision, 3); assert.deepEqual(restored.surfaceDesign, scheme.surfaceDesign); assert.equal(restored.render.id, scheme.render.id);
  assert.equal(await renders(request.projectId), before + 1, 'undo re-uses the earlier image');
  assert.equal((await call(undoRoute.POST, params, cookie, { operationId: randomUUID(), expectedRevision: 3 })).body.error.code, 'NOTHING_TO_UNDO');
  // Another customer cannot adjust it.
  assert.equal((await call(adjustRoute.POST, params, await customer(), { ...change, operationId: randomUUID() })).status, 404);
});

test('confirmation binds a revision, later changes need re-confirming, and both reach the lead', async () => {
  const cookie = await customer(), request = await published(cookie), scheme = request.schemes[1];
  const params = { entry: slug, requestId: request.id };
  assert.equal((await call(confirmRoute.POST, params, cookie, { operationId: randomUUID(), schemeId: scheme.id, revision: 2 })).body.error.code, 'SCHEME_REVISION_CONFLICT');
  const confirmed = await call(confirmRoute.POST, params, cookie, { operationId: randomUUID(), schemeId: scheme.id, revision: 1, message: '想看看样板', contactRequested: true, preferredTime: '工作日晚上' });
  assert.deepEqual({ ...confirmed.body.request.confirmation, confirmedAt: undefined }, { schemeId: scheme.id, revision: 1, current: true, confirmedAt: undefined });
  const adjusted = await call(adjustRoute.POST, { ...params, schemeId: scheme.id }, cookie, { operationId: randomUUID(), expectedRevision: 1, finishId: 'finish-f1-tv-wall', pattern: 'straight' });
  assert.equal(adjusted.status, 200, JSON.stringify(adjusted.body));
  assert.equal(adjusted.body.request.confirmation.current, false, 'adjusting after confirmation needs a new confirmation');
  await call(messagesRoute.POST, params, cookie, { operationId: randomUUID(), message: '周末方便', contactRequested: true });
  assert.equal((await call(messagesRoute.POST, params, cookie, { operationId: randomUUID(), contactRequested: false })).status, 400);
  const lead = (await call(leadsRoute.GET, { workspaceId }, adminCookie)).body.leads.find((l: { id: string }) => l.id === request.id);
  assert.deepEqual(lead.events.map((e: { kind: string }) => e.kind), ['confirmation', 'message']);
  assert.equal(lead.events[0].schemeRevision, 1); assert.equal(lead.events[0].preferredTime, '工作日晚上'); assert.equal(lead.events[1].message, '周末方便');
});

test('K02: whole schemes carry a soft style; switching is a rendered revision, undoable, needs re-confirming, retired styles are refused', async () => {
  const cookie = await customer(), request = await published(cookie);
  assert.deepEqual(request.schemes.map((s: { softStyle: { name: string } }) => s.softStyle.name), ['现代简约', '轻奢', '新中式'].slice(0, request.schemes.length));
  assert.ok(request.schemes.every((s: { softChoices: unknown[] }) => s.softChoices.length === 3));
  const scheme = request.schemes[0], params = { entry: slug, requestId: request.id, schemeId: scheme.id };
  const before = await renders(request.projectId), operationId = randomUUID();
  const toLuxury = { operationId, expectedRevision: 1, styleId: 'demo-luxury', styleVersion: 1 };
  const switched = await call(softStyleRoute.POST, params, cookie, toLuxury);
  assert.equal(switched.status, 200, JSON.stringify(switched.body));
  const revised = switched.body.request.schemes.find((s: { id: string }) => s.id === scheme.id);
  assert.equal(revised.revision, 2); assert.equal(revised.softStyle.id, 'demo-luxury'); assert.deepEqual(revised.surfaceDesign, scheme.surfaceDesign);
  assert.equal(revised.render.status, 'queued'); assert.notEqual(revised.render.id, scheme.render.id);
  assert.equal((await call(softStyleRoute.POST, params, cookie, toLuxury)).body.request.schemes[0].revision, 2, 'retry is idempotent');
  assert.equal(await renders(request.projectId), before + 1, 'one render for the switch');
  // The queued render's scene is furnished by the chosen style.
  const snapshot = (await pool.query('SELECT snapshot FROM project_renders WHERE id=$1', [revised.render.id])).rows[0].snapshot;
  const objects = snapshot.objects as { name?: string; softStyle?: { styleId: string } }[];
  assert.ok(objects.some(o => o.softStyle?.styleId === 'demo-luxury') && objects.some(o => o.name === 'curvedSofa'));
  assert.ok(!objects.some(o => o.softStyle && o.softStyle.styleId !== 'demo-luxury'), 'no furniture of the previous style remains');
  // Rendering the job twice completes once (re-delivery does not render again).
  const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#ccc' } }).png().toBuffer();
  let calls = 0; const fake = { render: async () => { calls++; return png; } };
  await runRender(revised.render.id, fake); await runRender(revised.render.id, fake);
  assert.equal(calls, 1);
  // Refusals leave the scheme unchanged.
  const refuse = async (extra: object, code: string) => assert.equal((await call(softStyleRoute.POST, params, cookie, { operationId: randomUUID(), expectedRevision: 2, ...extra })).body.error?.code, code);
  await refuse({ styleId: 'no-such', styleVersion: 1 }, 'SOFT_STYLE_NOT_OFFERED');
  await refuse({ styleId: 'demo-luxury', styleVersion: 1 }, 'NO_CHANGE');
  assert.equal((await call(softStyleRoute.POST, params, cookie, { ...toLuxury, operationId: randomUUID(), styleId: 'demo-chinese' })).body.error.code, 'SCHEME_REVISION_CONFLICT');
  // Undo returns to the previous style and its image.
  const undone = (await call(undoRoute.POST, params, cookie, { operationId: randomUUID(), expectedRevision: 2 })).body.request.schemes.find((s: { id: string }) => s.id === scheme.id);
  assert.equal(undone.revision, 3); assert.equal(undone.softStyle.id, 'demo-modern'); assert.equal(undone.render.id, scheme.render.id);
  // Confirming binds the revision with its soft style; switching afterwards needs re-confirming.
  const confirmed = await call(confirmRoute.POST, { entry: slug, requestId: request.id }, cookie, { operationId: randomUUID(), schemeId: scheme.id, revision: 3 });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body)); assert.equal(confirmed.body.request.confirmation.current, true);
  const again = await call(softStyleRoute.POST, params, cookie, { operationId: randomUUID(), expectedRevision: 3, styleId: 'demo-chinese', styleVersion: 1 });
  assert.equal(again.body.request.confirmation.current, false);
  // A retired style is no longer offered for switching, but schemes using it still show it.
  await transaction(client => retireSoftStyle(client, workspaceId, { styleId: 'demo-luxury', styleVersion: 1 }));
  assert.equal((await call(softStyleRoute.POST, params, cookie, { operationId: randomUUID(), expectedRevision: 4, styleId: 'demo-luxury', styleVersion: 1 })).body.error.code, 'SOFT_STYLE_RETIRED');
  const lead = (await call(leadsRoute.GET, { workspaceId }, adminCookie)).body.leads.find((l: { id: string }) => l.id === request.id);
  assert.equal(lead.schemes.find((s: { ordinal: number }) => s.ordinal === 2)?.softStyle?.name, '轻奢');
  // Another customer cannot switch it.
  assert.equal((await call(softStyleRoute.POST, params, await customer(), { operationId: randomUUID(), expectedRevision: 4, styleId: 'demo-modern', styleVersion: 1 })).status, 404);
});

test('ADR-0010: a batch of changes with a soft style is one revision and one render; a conflict refuses the whole batch', async () => {
  const cookie = await customer(), request = await published(cookie), scheme = request.schemes[0], params = { entry: slug, requestId: request.id, schemeId: scheme.id };
  const before = await renders(request.projectId);
  const batch = { operationId: randomUUID(), expectedRevision: 1, softStyle: { styleId: 'demo-chinese', styleVersion: 1 }, changes: [
    { finishId: 'finish-f1-living-floor', stone: { stoneId: 'demo-limestone', stoneVersion: 1 }, tile: { length: .8, width: .8 } },
    { finishId: 'finish-f1-living-floor', pattern: 'diagonal' },
    { finishId: 'finish-f1-tv-wall', stone: { stoneId: 'demo-beige-marble', stoneVersion: 1 } } ] };
  const done = await call(batchRoute.POST, params, cookie, batch);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const revised = done.body.request.schemes.find((s: { id: string }) => s.id === scheme.id);
  assert.equal(revised.revision, 2, 'one revision for the whole batch'); assert.equal(revised.softStyle.id, 'demo-chinese');
  const living = revised.surfaceDesign.tilings.find((t: { finishId: string }) => t.finishId === 'finish-f1-living-floor');
  assert.deepEqual([living.stoneId, living.pattern, living.tile.length], ['demo-limestone', 'diagonal', .8]);
  assert.equal(revised.surfaceDesign.tilings.find((t: { finishId: string }) => t.finishId === 'finish-f1-tv-wall').stoneId, 'demo-beige-marble');
  assert.equal(await renders(request.projectId), before + 1, 'one render for the whole batch');
  assert.equal((await call(batchRoute.POST, params, cookie, batch)).body.request.schemes[0].revision, 2, 'retry is idempotent');
  // A conflicting change refuses the whole batch: nothing applied, no render.
  const refused = await call(batchRoute.POST, params, cookie, { operationId: randomUUID(), expectedRevision: 2, changes: [
    { finishId: 'finish-f1-tv-wall', stone: { stoneId: 'demo-white-marble', stoneVersion: 1 } }, { finishId: 'finish-f1-living-floor', pattern: 'herringbone' } ] });
  assert.equal(refused.body.error.code, 'ADJUSTMENT_REJECTED', JSON.stringify(refused.body));
  const after = (await call(batchRoute.POST, params, cookie, { operationId: randomUUID(), expectedRevision: 2, changes: [], softStyle: { styleId: 'demo-chinese', styleVersion: 1 } })).body;
  assert.equal(after.error.code, 'NO_CHANGE');
  assert.equal(await renders(request.projectId), before + 1);
  assert.equal((await call(batchRoute.POST, params, cookie, { operationId: randomUUID(), expectedRevision: 2, changes: [] })).status, 400, 'an empty batch is invalid');
});
