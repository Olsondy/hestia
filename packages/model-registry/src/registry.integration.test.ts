import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { pool } from '../../persistence/src/client';
import { auth } from '../../identity/src/auth';
import { acceptInvitation, createInvitation } from '../../identity/src/service';
import { grantPlatformAdmin } from '../../platform-admin/src/service';
import { serviceCredentials } from './service';
import * as servicesRoute from '../../../apps/web/app/api/admin/services/route';
import * as serviceRoute from '../../../apps/web/app/api/admin/services/[id]/route';
import * as keyRoute from '../../../apps/web/app/api/admin/services/[id]/key/route';
import * as enableRoute from '../../../apps/web/app/api/admin/services/[id]/models/route';
import * as modelRoute from '../../../apps/web/app/api/admin/models/[id]/route';
import * as stateRoute from '../../../apps/web/app/api/admin/models/[id]/state/route';

// AM02 slice 1 (ADR-0018): register model services with sealed keys, enable model IDs, price versions, invalidation.
// HTTP route handlers + real PostgreSQL. No model is called here.
const run = randomUUID().slice(0, 8), admin = `admin.am02-${run}.example.test`, origin = `http://${admin}`;
const password = 'synthetic-am02-password-614!', emails = { ops: `am02-ops-${run}@example.test`, other: `am02-other-${run}@example.test` };
const cookies = { ops: '', other: '' }, plainKey = `sk-synthetic-${run}-${randomBytes(8).toString('hex')}`, nextKey = `sk-rotated-${run}-ZZ9q`;
const serviceName = `合成服务-${run}`;
const saved: Record<string, string | undefined> = {};
type Handler = (request: Request, context: never) => Promise<Response>;
async function call(handler: Handler, params: Record<string, string>, init: { cookie?: string; json?: unknown; method?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = { Host: admin };
  if (init.cookie ?? cookies.ops) headers.Cookie = init.cookie ?? cookies.ops;
  if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; if (init.origin !== null) headers.Origin = init.origin ?? origin; }
  const response = await handler(new Request(`http://${admin}/api/admin/x`, { method: init.method ?? (init.json === undefined ? 'GET' : 'POST'), headers,
    body: init.json === undefined ? undefined : JSON.stringify(init.json) }), { params: Promise.resolve(params) } as never);
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) : null };
}
const audit = async () => (await pool.query("SELECT action, target, detail FROM platform_audit WHERE actor=$1 ORDER BY at, id", [emails.ops])).rows;

before(async () => {
  for (const key of ['HESTIA_ADMIN_HOST', 'HESTIA_SECRET_KEY']) saved[key] = process.env[key];
  process.env.HESTIA_ADMIN_HOST = admin;
  process.env.HESTIA_SECRET_KEY ||= randomBytes(32).toString('base64');
  for (const key of Object.keys(emails) as (keyof typeof emails)[]) {
    const invitation = await createInvitation(emails[key]);
    await acceptInvitation(invitation.token, `合成${key}`, password);
    cookies[key] = (await auth.api.signInEmail({ body: { email: emails[key], password }, asResponse: true })).headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  }
  await grantPlatformAdmin(emails.ops, 'platform');
});
after(async () => {
  for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try {
    await pool.query('DELETE FROM models WHERE service_id IN (SELECT id FROM model_services WHERE name LIKE $1)', [`%${run}%`]);
    await pool.query('DELETE FROM model_services WHERE name LIKE $1', [`%${run}%`]);
    const users = (await pool.query('SELECT id FROM hestia_auth_user WHERE email=ANY($1)', [Object.values(emails)])).rows.map(row => row.id);
    await pool.query('DELETE FROM platform_audit WHERE actor=ANY($1) OR target=ANY($1)', [Object.values(emails)]);
    await pool.query('DELETE FROM workspaces WHERE personal_user_id=ANY($1)', [users]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=ANY($1)', [Object.values(emails)]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
  } finally { await pool.end(); }
});

let serviceId = '', listedId = '', manualId = '';

test('a service is registered with a sealed key that never comes back', async () => {
  const input = { name: serviceName, protocol: 'chat', baseUrl: 'https://api.vendor.example.test/v1/', apiKey: plainKey, timeoutSeconds: 60, concurrency: 8 };
  assert.equal((await call(servicesRoute.POST, {}, { json: input, cookie: cookies.other })).status, 403, 'not a platform admin');
  assert.equal((await call(servicesRoute.POST, {}, { json: input, origin: `http://elsewhere-${run}.example.test` })).status, 403, 'foreign origin');
  for (const bad of [{ baseUrl: 'https://user:pass@api.vendor.example.test/v1' }, { baseUrl: 'ftp://api.vendor.example.test' }, { compat: { store: true } }, { protocol: 'gemini' }])
    assert.equal((await call(servicesRoute.POST, {}, { json: { ...input, ...bad } })).status, 400, JSON.stringify(bad));

  const created = await call(servicesRoute.POST, {}, { json: input });
  assert.equal(created.status, 201);
  serviceId = created.body.service.id;
  assert.equal(created.body.service.keyTail, plainKey.slice(-4));
  assert.equal(created.body.service.baseUrl, 'https://api.vendor.example.test/v1');
  assert.deepEqual(created.body.service.compat, { usageInStream: true, maxTokensField: 'max_tokens', thinkingParam: 'enable_thinking' });
  const listed = await call(servicesRoute.GET, {});
  for (const response of [created, listed, await call(serviceRoute.GET, { id: serviceId })]) assert.ok(!response.text.includes(plainKey));
  const [row] = (await pool.query('SELECT key_ciphertext FROM model_services WHERE id=$1', [serviceId])).rows;
  assert.ok(row.key_ciphertext.startsWith('v1.') && !row.key_ciphertext.includes(plainKey));
  assert.equal((await serviceCredentials(serviceId)).apiKey, plainKey);
});

test('model IDs come from the fetched list or are added by hand; each is enabled once', async () => {
  await pool.query("UPDATE model_services SET catalog=$2 WHERE id=$1", [serviceId, { at: new Date().toISOString(), ids: ['design-large', 'edit-fast'], added: [] }]);
  const listed = await call(enableRoute.POST, { id: serviceId }, { json: { modelId: 'design-large' } });
  assert.equal(listed.status, 201); listedId = listed.body.model.id;
  assert.deepEqual([listed.body.model.manual, listed.body.model.state, listed.body.model.name, listed.body.model.params], [false, 'draft', 'design-large', { thinking: 'unset' }]);
  assert.equal((await call(enableRoute.POST, { id: serviceId }, { json: { modelId: 'design-large' } })).status, 409, 'enabled twice');
  assert.equal((await call(enableRoute.POST, { id: serviceId }, { json: { modelId: 'vision-plus' } })).body.error.code, 'NOT_IN_CATALOG');
  const manual = await call(enableRoute.POST, { id: serviceId }, { json: { modelId: 'vision-plus', manual: true } });
  assert.equal(manual.status, 201); manualId = manual.body.model.id; assert.equal(manual.body.model.manual, true);
  assert.equal((await call(enableRoute.POST, { id: serviceId }, { json: { modelId: 'bad id with spaces', manual: true } })).status, 400);
});

test('prices are versions; changing call parameters of an admitted model needs a new check', async () => {
  const first = await call(modelRoute.PATCH, { id: listedId }, { method: 'PATCH', json: { name: '深度设计', description: '整套方案', maxOutput: 8000, price: { input: 400, output: 1600 } } });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.model.prices.map((p: { input: number; output: number }) => [p.input, p.output]), [[400, 1600]]);
  const same = await call(modelRoute.PATCH, { id: listedId }, { method: 'PATCH', json: { price: { input: 400, output: 1600 } } });
  assert.equal(same.body.model.prices.length, 1, 'same price adds no version');
  const second = await call(modelRoute.PATCH, { id: listedId }, { method: 'PATCH', json: { price: { input: 320, output: 1280 } } });
  assert.deepEqual(second.body.model.prices.map((p: { input: number }) => p.input), [400, 320]);
  assert.equal((await call(modelRoute.PATCH, { id: listedId }, { method: 'PATCH', json: { params: { reasoning: 'high' } } })).body.error.code, 'INVALID_PARAMS');

  await pool.query("UPDATE models SET state='admitted' WHERE id=$1", [listedId]);
  const params = await call(modelRoute.PATCH, { id: listedId }, { method: 'PATCH', json: { params: { thinking: 'on' } } });
  assert.equal(params.body.model.state, 'stale');
  await pool.query("UPDATE models SET state='admitted' WHERE id=$1", [listedId]);
  assert.equal((await call(modelRoute.PATCH, { id: listedId }, { method: 'PATCH', json: { description: '只改说明' } })).body.model.state, 'admitted', 'a description change keeps admission');
});

test('changing address or compat sends admitted models back to check; replacing the key does not', async () => {
  const renamed = await call(serviceRoute.PATCH, { id: serviceId }, { method: 'PATCH', json: { name: `${serviceName}-改名`, concurrency: 12 } });
  assert.equal(renamed.status, 200);
  assert.equal((await call(modelRoute.GET, { id: listedId })).body.model.state, 'admitted');
  await call(serviceRoute.PATCH, { id: serviceId }, { method: 'PATCH', json: { baseUrl: 'https://api.vendor.example.test/v2' } });
  assert.equal((await call(modelRoute.GET, { id: listedId })).body.model.state, 'stale');
  assert.equal((await call(modelRoute.GET, { id: manualId })).body.model.state, 'draft', 'a draft stays a draft');

  await pool.query("UPDATE models SET state='admitted' WHERE id=$1", [listedId]);
  const rotated = await call(keyRoute.POST, { id: serviceId }, { json: { apiKey: nextKey } });
  assert.equal(rotated.status, 200); assert.equal(rotated.body.service.keyTail, 'ZZ9q');
  assert.ok(!rotated.text.includes(nextKey));
  assert.equal((await serviceCredentials(serviceId)).apiKey, nextKey);
  assert.equal((await call(modelRoute.GET, { id: listedId })).body.model.state, 'admitted');
});

test('disable and enable again; every change is audited and no key appears in the audit', async () => {
  const off = await call(stateRoute.POST, { id: listedId }, { json: { disabled: true } });
  assert.equal(off.body.model.state, 'disabled');
  const on = await call(stateRoute.POST, { id: listedId }, { json: { disabled: false } });
  assert.equal(on.body.model.state, 'stale', 'enabling again needs a fresh check');

  const rows = await audit();
  assert.deepEqual([...new Set(rows.map(row => row.action))], ['register_service', 'enable_model_id', 'update_model', 'change_price', 'update_service', 'replace_key', 'disable_model', 'reenable_model']);
  assert.deepEqual(rows.find(row => row.action === 'replace_key').detail, { key: 'replaced' });
  assert.deepEqual(rows.find(row => row.action === 'update_service' && row.detail.recheck)?.detail.recheck, ['design-large']);
  const all = JSON.stringify(rows);
  assert.ok(!all.includes(plainKey) && !all.includes(nextKey));
});
