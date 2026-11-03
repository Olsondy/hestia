import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { pool, transaction } from '../../persistence/src/client';
import { auth, authOrigin } from '../../identity/src/auth';
import { acceptInvitation, createInvitation } from '../../identity/src/service';
import { mockSmsSender, setSmsSender } from '../../identity/src/sms';
import { createWorkspace } from '../../workspaces/src/service';
import { addStones } from '../../finishes/src/catalog';
import { demoStones } from '../../finishes/src/demo-stones';
import { initializeRenderQueue } from '../../renders/src/queue';
import { initializeImportQueue } from '../../drawing-imports/src/queue';
import { runRender } from '../../renders/src/runner';
import { runImport } from '../../drawing-imports/src/runner';
import { generateForImport } from './service';
import * as authRoute from '../../../apps/web/app/api/auth/[...all]/route';
import * as catalogRoute from '../../../apps/web/app/api/client/[entry]/catalog/route';
import * as requestsRoute from '../../../apps/web/app/api/client/[entry]/requests/route';
import * as requestRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/route';
import * as drawingRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/drawing/route';
import * as imageRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/schemes/[schemeId]/image/route';
import * as leadsRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/leads/route';
import * as handOverRoute from '../../../apps/web/app/api/client/[entry]/requests/[requestId]/hand-over/route';
import * as generateRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/leads/[requestId]/generate/route';
import * as houseSpecRoute from '../../../apps/web/app/api/projects/[id]/floorplan-imports/[importId]/housespec/route';
import * as importRoute from '../../../apps/web/app/api/projects/[id]/floorplan-imports/[importId]/route';
import * as publishRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/leads/[requestId]/publish/route';

// HTTP route handlers + real PostgreSQL + real pg-boss producers. Renders run through the real runner with an injected
// PNG (no browser); DXF conversion runs the real `python -I` converter.
const run = randomUUID().slice(0, 8), slug = `d06-${run}`, reviewSlug = `d06r-${run}`, password = 'synthetic-d06-password-482!';
const adminEmail = `d06-admin-${run}@example.test`, phones: string[] = [];
let adminCookie = '', workspaceId = '', reviewWorkspaceId = '';
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
type Handler = (request: Request, context: never) => Promise<Response>;
async function call(handler: Handler, params: Record<string, string>, init: { cookie?: string; json?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = { Origin: authOrigin, ...(init.cookie ? { Cookie: init.cookie } : {}) };
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  const request = new Request(`${authOrigin}/api/test`, { method: init.json !== undefined || init.form ? 'POST' : 'GET', headers,
    body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined) });
  const response = await handler(request, { params: Promise.resolve(params) } as never);
  return { status: response.status, response, body: response.headers.get('content-type')?.includes('json') ? await response.json() : null };
}
async function customer(entry = slug) {
  const phoneNumber = `199${String(randomInt(0, 1e8)).padStart(8, '0')}`; phones.push(`+86${phoneNumber}`);
  const post = async (path: string, payload: unknown) => authRoute.POST(new Request(`${authOrigin}/api/auth/${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: authOrigin, 'X-Real-IP': `10.6.${randomInt(0, 255)}.${randomInt(1, 255)}` }, body: JSON.stringify(payload) }));
  const code = (await (await post('phone/send-code', { phoneNumber, entry })).json()).demoCode;
  return cookieOf(await post('phone/sign-in', { phoneNumber, entry, code }));
}
const png = () => sharp({ create: { width: 8, height: 6, channels: 3, background: '#e8e1d6' } }).png().toBuffer();
const renderAll = async (projectId: string) => {
  const ids = (await pool.query("SELECT id FROM project_renders WHERE project_id=$1 AND status='queued'", [projectId])).rows.map(row => row.id);
  const bytes = await png();
  for (const id of ids) await runRender(id, { render: async () => bytes });
  return ids.length;
};

before(async () => {
  process.env.HESTIA_OTP_SOURCE_HEADER = 'x-real-ip';
  setSmsSender(mockSmsSender);
  await initializeRenderQueue(); await initializeImportQueue();
  const invitation = await createInvitation(adminEmail);
  await acceptInvitation(invitation.token, '合成石材企业管理员', password);
  adminCookie = cookieOf(await auth.api.signInEmail({ body: { email: adminEmail, password }, asResponse: true }));
  workspaceId = (await createWorkspace({ kind: 'enterprise', slug, name: '演示石材企业', adminEmail })).workspace.id;
  reviewWorkspaceId = (await createWorkspace({ kind: 'enterprise', slug: reviewSlug, name: '审核石材企业', adminEmail })).workspace.id;
  await transaction(async client => {
    for (const id of [workspaceId, reviewWorkspaceId]) await addStones(client, id, demoStones);
    await client.query(`UPDATE workspaces SET settings=settings||'{"reviewAllRequests":true}'::jsonb WHERE id=$1`, [reviewWorkspaceId]);
  });
});
after(async () => {
  try {
    const users = (await pool.query('SELECT id FROM hestia_auth_user WHERE phone_number=ANY($1) OR email=$2', [phones, adminEmail])).rows.map(row => row.id);
    const workspaces = (await pool.query('SELECT id FROM workspaces WHERE slug=ANY($1) OR personal_user_id=ANY($2)', [[slug, reviewSlug], users])).rows.map(row => row.id);
    await pool.query('DELETE FROM operations WHERE project_id IN (SELECT id FROM projects WHERE workspace_id=ANY($1::uuid[]))', [workspaces]);
    await pool.query('DELETE FROM finish_requests WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM floorplan_imports WHERE project_id IN (SELECT id FROM projects WHERE workspace_id=ANY($1::uuid[]))', [workspaces]);
    await pool.query('DELETE FROM project_renders WHERE project_id IN (SELECT id FROM projects WHERE workspace_id=ANY($1::uuid[]))', [workspaces]);
    await pool.query('DELETE FROM resources WHERE project_id IN (SELECT id FROM projects WHERE workspace_id=ANY($1::uuid[]))', [workspaces]);
    await pool.query('DELETE FROM project_revisions WHERE project_id IN (SELECT id FROM projects WHERE workspace_id=ANY($1::uuid[]))', [workspaces]);
    await pool.query('DELETE FROM projects WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM workspace_stones WHERE workspace_id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM workspaces WHERE id=ANY($1::uuid[])', [workspaces]);
    await pool.query('DELETE FROM phone_otp_challenges WHERE phone_number=ANY($1)', [phones]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=$1', [adminEmail]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
  } finally { await pool.end(); }
});

test('a customer submits the demo villa with stones and sees three published schemes and their images', async () => {
  const catalog = await call(catalogRoute.GET, { entry: slug });
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.catalog.stones.length, demoStones.length);
  const finishIds = catalog.body.catalog.demoVilla.finishes.map((finish: { id: string }) => finish.id);
  const cookie = await customer(), stones = ['demo-white-marble', 'demo-beige-marble', 'demo-grey-woodgrain'].map(stoneId => ({ stoneId, stoneVersion: 1 }));
  const payload = { source: 'demo-villa', operationId: randomUUID(), finishIds, stones, preferences: { tone: 'light', patterns: ['diagonal'], border: 'auto' } };
  const created = await call(requestsRoute.POST, { entry: slug }, { cookie, json: payload });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const request = created.body.request;
  assert.equal(request.status, 'published');
  assert.equal(request.schemes.length, 3);
  assert.deepEqual(request.preferences, { tone: 'light', patterns: ['diagonal'], border: 'auto' }, 'taste is kept for the enterprise');
  assert.equal(request.origin, 'customer'); assert.equal(request.finishes.length, finishIds.length);
  assert.ok(request.schemes.every((scheme: { adoptable: boolean; render: { status: string } }) => scheme.adoptable && scheme.render.status === 'queued'));
  assert.equal((await call(requestsRoute.POST, { entry: slug }, { cookie, json: payload })).body.request.id, request.id, 'retry returns the same request');
  // Closing the page does not matter: renders are durable jobs; reopening shows images once rendered.
  assert.equal(await renderAll(request.projectId), 3);
  const reopened = (await call(requestRoute.GET, { entry: slug, requestId: request.id }, { cookie })).body.request;
  const scheme = reopened.schemes[0];
  assert.equal(scheme.render.status, 'completed'); assert.match(scheme.render.imageHref, /\/image$/);
  const image = await call(imageRoute.GET, { entry: slug, requestId: request.id, schemeId: scheme.id }, { cookie });
  assert.equal(image.status, 200); assert.equal(image.response.headers.get('content-type'), 'image/png');
  // Another customer of the same enterprise sees neither the request nor its image.
  const other = await customer();
  assert.equal((await call(requestRoute.GET, { entry: slug, requestId: request.id }, { cookie: other })).status, 404);
  assert.equal((await call(imageRoute.GET, { entry: slug, requestId: request.id, schemeId: scheme.id }, { cookie: other })).status, 404);
  assert.deepEqual((await call(requestsRoute.GET, { entry: slug }, { cookie: other })).body.requests, []);
  // The submission is a lead for members, with the customer's phone.
  const leads = (await call(leadsRoute.GET, { workspaceId }, { cookie: adminCookie })).body.leads;
  const lead = leads.find((item: { id: string }) => item.id === request.id);
  assert.ok(lead?.customer.phone?.startsWith('+86199'));
  assert.equal((await call(leadsRoute.GET, { workspaceId }, { cookie })).status, 404, 'customers cannot list leads');
});

test('review-all workspaces hold schemes until a member publishes them', async () => {
  const cookie = await customer(reviewSlug);
  const created = await call(requestsRoute.POST, { entry: reviewSlug }, { cookie, json: { source: 'demo-villa', operationId: randomUUID(),
    finishIds: ['finish-f1-living-floor', 'finish-f1-stair'], stones: [{ stoneId: 'demo-limestone', stoneVersion: 1 }] } });
  const request = created.body.request;
  assert.equal(request.status, 'pending_review'); assert.match(request.statusLabel, /确认/); assert.deepEqual(request.schemes, []);
  const lead = (await call(leadsRoute.GET, { workspaceId: reviewWorkspaceId }, { cookie: adminCookie })).body.leads.find((item: { id: string }) => item.id === request.id);
  assert.ok(lead.schemes.length >= 2, 'members see schemes waiting for review'); assert.match(lead.reviewReason, /全部审核/);
  assert.equal((await call(publishRoute.POST, { workspaceId: reviewWorkspaceId, requestId: request.id }, { cookie, json: { operationId: randomUUID() } })).status, 404, 'customers cannot publish');
  const published = await call(publishRoute.POST, { workspaceId: reviewWorkspaceId, requestId: request.id }, { cookie: adminCookie, json: { operationId: randomUUID() } });
  assert.equal(published.status, 200, JSON.stringify(published.body)); assert.equal(published.body.lead.status, 'published');
  const seen = (await call(requestRoute.GET, { entry: reviewSlug, requestId: request.id }, { cookie })).body.request;
  assert.equal(seen.status, 'published'); assert.equal(seen.schemes.length, lead.schemes.length);
});

const fixture = (name: string) => readFile(new URL(`../../floorplan-import/fixtures/dxf/${name}`, import.meta.url));
async function drawingRequest(cookie: string) {
  const created = (await call(requestsRoute.POST, { entry: slug }, { cookie, json: { source: 'drawing', operationId: randomUUID(),
    stones: [{ stoneId: 'demo-white-marble', stoneVersion: 1 }, { stoneId: 'demo-beige-marble', stoneVersion: 1 }] } })).body.request;
  assert.equal(created.status, 'awaiting_drawing');
  return created;
}
const upload = (cookie: string, requestId: string, bytes: Uint8Array, name: string) => {
  const form = new FormData();
  form.set('file', new File([bytes as Uint8Array<ArrayBuffer>], name)); form.set('metadata', JSON.stringify({ operationId: randomUUID() }));
  return call(drawingRoute.POST, { entry: slug, requestId }, { cookie, form });
};
/** What the import Worker does per job: convert, then generate the request's schemes (ADR-0013). */
const convert = async (importId: string) => { await runImport(importId); await generateForImport(importId); await generateForImport(importId); };

test('a DXF drawing request converts and is published right away with derived floor finishes, no member review', async () => {
  const cookie = await customer(), created = await drawingRequest(cookie);
  const uploaded = await upload(cookie, created.id, await fixture('synthetic-flat.dxf'), 'synthetic-flat.dxf');
  assert.equal(uploaded.status, 202, JSON.stringify(uploaded.body)); assert.equal(uploaded.body.request.status, 'converting');
  await runImport(uploaded.body.request.floorplanImportId);
  assert.equal((await call(requestRoute.GET, { entry: slug, requestId: created.id }, { cookie })).body.request.status, 'converting', 'converted, schemes not yet generated');
  await generateForImport(uploaded.body.request.floorplanImportId); await generateForImport(uploaded.body.request.floorplanImportId);
  const seen = (await call(requestRoute.GET, { entry: slug, requestId: created.id }, { cookie })).body.request;
  assert.equal(seen.status, 'published'); assert.ok(seen.schemes.length >= 1 && seen.schemes.every((s: { adoptable: boolean }) => s.adoptable));
  assert.ok(seen.finishIds.length >= 3 && seen.finishIds.every((id: string) => id.startsWith('finish-floor-')), 'one floor finish per converted room');
  assert.equal(seen.conversionError, null);
  assert.equal(new Set(seen.schemes.map((s: { ordinal: number }) => s.ordinal)).size, seen.schemes.length, 'generating twice does not duplicate');
});

test('a drawing that cannot be converted is explained to the customer, can be uploaded again or handed to the enterprise', async () => {
  const cookie = await customer(), created = await drawingRequest(cookie);
  const bad = await upload(cookie, created.id, new TextEncoder().encode('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n'), 'empty.dxf');
  assert.equal(bad.status, 202, JSON.stringify(bad.body));
  await convert(bad.body.request.floorplanImportId);
  const failed = (await call(requestRoute.GET, { entry: slug, requestId: created.id }, { cookie })).body.request;
  assert.equal(failed.status, 'conversion_failed', JSON.stringify(failed)); assert.ok(failed.conversionError.length > 4, failed.conversionError);
  // Upload again: the new import replaces the failed one and converts.
  const again = await upload(cookie, created.id, await fixture('synthetic-flat.dxf'), 'synthetic-flat.dxf');
  assert.equal(again.status, 202, JSON.stringify(again.body)); assert.notEqual(again.body.request.floorplanImportId, bad.body.request.floorplanImportId);
  await convert(again.body.request.floorplanImportId);
  assert.equal((await call(requestRoute.GET, { entry: slug, requestId: created.id }, { cookie })).body.request.status, 'published');
  // Hand over instead: the request joins the enterprise's queue.
  const other = await drawingRequest(cookie), broken = await upload(cookie, other.id, new TextEncoder().encode('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n'), 'broken.dxf');
  assert.equal(broken.status, 202, JSON.stringify(broken.body));
  await convert(broken.body.request.floorplanImportId);
  assert.equal((await call(handOverRoute.POST, { entry: slug, requestId: created.id }, { cookie, json: {} })).body.error.code, 'DRAWING_NOT_FAILED');
  const handed = await call(handOverRoute.POST, { entry: slug, requestId: other.id }, { cookie, json: {} });
  assert.equal(handed.status, 200, JSON.stringify(handed.body)); assert.equal(handed.body.request.status, 'assisted_conversion');
  assert.match(handed.body.request.statusLabel, /排队/);
});

test('images and PDFs queue for the enterprise; uploads are limited to 3 per customer per day', async () => {
  const cookie = await customer(), created = await drawingRequest(cookie);
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
  const queued = await upload(cookie, created.id, png, '户型图.png');
  assert.equal(queued.status, 202, JSON.stringify(queued.body)); assert.equal(queued.body.request.status, 'assisted_conversion');
  assert.match(queued.body.request.statusLabel, /排队/);
  // Two more uploads today are allowed (failures count), the fourth is refused.
  for (let i = 0; i < 2; i++) { const r = await drawingRequest(cookie); assert.equal((await upload(cookie, r.id, png, `第${i}张.png`)).status, 202); }
  const fourth = await upload(cookie, (await drawingRequest(cookie)).id, png, '第四张.png');
  assert.equal(fourth.status, 429); assert.equal(fourth.body.error.code, 'DRAWING_DAILY_LIMIT');
  // Another customer has their own allowance.
  const neighbour = await customer();
  assert.equal((await upload(neighbour, (await drawingRequest(neighbour)).id, png, '邻居.png')).status, 202);
});

test('queued drawings: a member imports the floor plan, confirms, and the customer gets published schemes', async () => {
  const cookie = await customer(), created = await drawingRequest(cookie);
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
  const queued = (await upload(cookie, created.id, png, '户型照片.png')).body.request;
  const target = { id: queued.projectId, importId: queued.floorplanImportId }, lead = { workspaceId, requestId: created.id };
  // Nothing to confirm before a floor plan is imported; customers cannot confirm.
  assert.equal((await call(generateRoute.POST, lead, { cookie: adminCookie, json: { operationId: randomUUID() } })).body.error.code, 'DRAWING_NOT_READY');
  assert.equal((await call(generateRoute.POST, lead, { cookie, json: { operationId: randomUUID() } })).status, 404);
  const houseSpec = JSON.parse(await readFile(new URL('../../floorplan-import/fixtures/dxf/synthetic-flat.housespec.json', import.meta.url), 'utf8'));
  const revision = async () => (await call(importRoute.GET, target, { cookie: adminCookie })).body.import.revision;
  // A floor plan that fails validation is reported to the member; the customer stays in the queue.
  const broken = await call(houseSpecRoute.POST, target, { cookie: adminCookie, json: { operationId: randomUUID(), expectedRevision: await revision(), houseSpec: { walls: [] }, name: '缺墙' } });
  assert.equal(broken.status, 200, JSON.stringify(broken.body)); assert.equal(broken.body.import.candidate.valid, false);
  const refused = await call(generateRoute.POST, lead, { cookie: adminCookie, json: { operationId: randomUUID() } });
  assert.equal(refused.body.error.code, 'CANDIDATE_INVALID');
  assert.equal((await call(requestRoute.GET, { entry: slug, requestId: created.id }, { cookie })).body.request.status, 'assisted_conversion');
  const imported = await call(houseSpecRoute.POST, target, { cookie: adminCookie, json: { operationId: randomUUID(), expectedRevision: await revision(), houseSpec, name: '整理后的户型' } });
  assert.equal(imported.body.import.candidate.valid, true, JSON.stringify(imported.body.import.candidate.issues));
  assert.equal((await call(requestRoute.GET, { entry: slug, requestId: created.id }, { cookie })).body.request.status, 'assisted_conversion', 'still queued until confirmed');
  const operationId = randomUUID(), done = await call(generateRoute.POST, lead, { cookie: adminCookie, json: { operationId } });
  assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.lead.status, 'published');
  assert.equal((await call(generateRoute.POST, lead, { cookie: adminCookie, json: { operationId } })).status, 200, 'retry is harmless');
  const seen = (await call(requestRoute.GET, { entry: slug, requestId: created.id }, { cookie })).body.request;
  assert.equal(seen.status, 'published'); assert.ok(seen.schemes.length >= 1);
});

test('invalid submissions are rejected without leaving a lead', async () => {
  const cookie = await customer(), before = (await pool.query('SELECT count(*)::int AS n FROM finish_requests WHERE workspace_id=$1', [workspaceId])).rows[0].n;
  const reject = async (json: unknown) => (await call(requestsRoute.POST, { entry: slug }, { cookie, json })).body.error.code;
  assert.equal(await reject({ source: 'demo-villa', operationId: randomUUID(), finishIds: ['nope'], stones: [{ stoneId: 'demo-limestone', stoneVersion: 1 }] }), 'FINISH_NOT_FOUND');
  assert.equal(await reject({ source: 'demo-villa', operationId: randomUUID(), finishIds: ['finish-f1-stair'], stones: [{ stoneId: 'nope', stoneVersion: 1 }] }), 'STONE_NOT_FOUND');
  assert.equal((await call(requestsRoute.POST, { entry: 'no-such-entry' }, { cookie, json: { source: 'drawing', operationId: randomUUID(), stones: [{ stoneId: 'demo-limestone', stoneVersion: 1 }] } })).status, 404);
  assert.equal((await call(requestsRoute.POST, { entry: slug }, { json: { source: 'drawing', operationId: randomUUID(), stones: [] } })).status, 401);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM finish_requests WHERE workspace_id=$1', [workspaceId])).rows[0].n, before);
});
