import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { pool, transaction } from '../../persistence/src/client';
import { acceptInvitation, createInvitation } from '../../identity/src/service';
import { createWorkspace } from '../../workspaces/src/service';
import { deleteWorkspace } from '../../workspaces/src/data';
import { addStones } from '../../finishes/src/catalog';
import { demoStones } from '../../finishes/src/demo-stones';
import { addSoftStyles } from '../../soft-styles/src/catalog';
import { demoSoftStyles } from '../../soft-styles/src/demo-styles';
import { initializeRenderQueue } from '../../renders/src/queue';
import { initializeQueue } from '../../tasks/src/queue';
import { createTask, getTask } from '../../tasks/src/service';
import { runTask } from '../../tasks/src/runner';
import { toolChunks } from '../../model-validation/src/protocol-fixture';
import { createService, enableModel, updateModel } from '../../model-registry/src/service';
import { updateEnterprise } from '../../model-registry/src/grants';
import { createMemberRequest, lockedRequest, view } from './service';
import { adoptSchemeCandidate, discardSchemeCandidate, listSchemeCandidates, proposeSchemeInTransaction, publishScheme, readCandidateScene } from './agent';
import type { SchemeDecision } from '../../contracts/src/agent-schemes';

// K03 (ADR-0019): the enterprise Agent on a lead's space. Real PostgreSQL, the real task runner and a local fake Chat
// Completions service (adapter-level only; no real model). Renders are queued, not executed.
const run = randomUUID().slice(0, 8), slug = `k03-${run}`, adminEmail = `k03-admin-${run}@example.test`, password = 'synthetic-k03-password-482!';
const schema = `k03_${randomUUID().replaceAll('-', '')}`, saved = process.env.HESTIA_SECRET_KEY;
const actor = { userId: null as unknown as string, email: `k03-actor-${run}@example.test` }, outsider = { userId: `k03-outsider-${randomUUID()}` };
const requested = ['finish-f1-living-floor', 'finish-f1-tv-wall', 'finish-f1-stair'];
let producer: PgBoss, server: Server, serviceId = '', workspaceId = '', member = { userId: '' }, lead = { id: '', projectId: '' };
let reply: { reply: string; decision: unknown } = { reply: '', decision: null };
const prompts: string[] = [];
const valid: SchemeDecision = { kind: 'propose_scheme', name: '暖白大气', summary: '白色大理石大板直铺、深色波打线，原木风软装',
  tilings: [
    { finishIds: ['finish-f1-living-floor'], stoneId: 'demo-white-marble', tile: { lengthMm: 1200, widthMm: 1200 }, pattern: 'straight', border: { stoneId: 'demo-dark-gold', widthMm: 180 } },
    { finishIds: ['finish-f1-tv-wall'], stoneId: 'demo-grey-woodgrain', tile: { lengthMm: 1200, widthMm: 600 }, pattern: 'running-bond' },
    { finishIds: ['finish-f1-stair'], stoneId: 'demo-white-marble', tile: { lengthMm: 1200, widthMm: 400 }, pattern: 'straight' },
  ], softStyleId: demoSoftStyles[0].id, softChoices: [demoSoftStyles[1].id] };
const revision = async () => (await pool.query('SELECT revision FROM projects WHERE id=$1', [lead.projectId])).rows[0].revision as number;
const input = async () => ({ protocol: 'conversation-v1', operationId: randomUUID(), expectedRevision: await revision(), message: '客厅大气一点，出一套整体方案', referenceFrame: 'plan' });
const candidates = async () => (await pool.query('SELECT id, task_id, status FROM scheme_candidates WHERE request_id=$1 ORDER BY created_at', [lead.id])).rows;
async function turn(decision: unknown) {
  reply = { reply: '按要求出了一套整体方案，等应用校验。', decision };
  const task = await createTask(member, lead.projectId, await input(), producer);
  await runTask(task.id);
  return getTask(member, lead.projectId, task.id);
}
const customerSchemes = () => transaction(async client => (await view(client, await lockedRequest(client, lead.id), 'customer')).schemes.map(s => s.id));

before(async () => {
  process.env.HESTIA_SECRET_KEY ||= randomBytes(32).toString('base64');
  producer = await initializeQueue(schema);
  await initializeRenderQueue();
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    prompts.push(body.messages?.find((m: { role: string }) => m.role === 'user')?.content ?? '');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(toolChunks(reply, 'resolve_turn').map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  const invitation = await createInvitation(adminEmail);
  await acceptInvitation(invitation.token, '合成企业成员', password);
  member = { userId: (await pool.query('SELECT id FROM hestia_auth_user WHERE email=$1', [adminEmail])).rows[0].id };
  workspaceId = (await createWorkspace({ kind: 'enterprise', slug, name: 'K03 合成企业', adminEmail })).workspace.id;
  await transaction(async client => { await addStones(client, workspaceId, demoStones); await addSoftStyles(client, workspaceId, demoSoftStyles); });
  serviceId = (await createService(actor, { name: `K03 服务-${run}`, protocol: 'chat', baseUrl: base, apiKey: 'sk-k03-synthetic', timeoutSeconds: 20, concurrency: 5 })).id;
  const model = await enableModel(actor, serviceId, { modelId: `k03-${run}`, manual: true });
  await updateModel(actor, model.id, { maxOutput: 2000, price: { input: 100, output: 200 } });
  await pool.query("UPDATE models SET state='admitted' WHERE id=$1", [model.id]);
  await updateEnterprise(actor, workspaceId, { grants: [model.id], quota: null, concurrency: 2 });
  await pool.query('UPDATE workspace_models SET enabled=true, is_default=true WHERE workspace_id=$1', [workspaceId]);
  const created = await createMemberRequest(member, workspaceId, { operationId: randomUUID(), name: 'K03 合成线索', finishIds: requested,
    stones: [{ stoneId: 'demo-white-marble', stoneVersion: 1 }, { stoneId: 'demo-beige-marble', stoneVersion: 1 }] });
  lead = { id: created.id, projectId: created.projectId };
});
after(async () => {
  if (saved === undefined) delete process.env.HESTIA_SECRET_KEY; else process.env.HESTIA_SECRET_KEY = saved;
  await new Promise<void>(resolve => server.close(() => resolve()));
  try {
    await deleteWorkspace(slug, slug);
    await pool.query('DELETE FROM models WHERE service_id=$1', [serviceId]); await pool.query('DELETE FROM model_services WHERE id=$1', [serviceId]);
    await pool.query('DELETE FROM platform_audit WHERE actor=$1', [actor.email]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=$1', [adminEmail]);
    await pool.query('DELETE FROM workspaces WHERE personal_user_id=$1', [member.userId]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=$1', [member.userId]);
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  } finally { await pool.end(); }
});

test('a valid proposal becomes a checked candidate with a queued render; the space and the lead schemes stay as they were', async () => {
  const [before, schemesBefore] = [await revision(), (await customerSchemes()).length];
  const task = await turn(valid);
  // The candidate lives on the lead, so the turn completes and does not block further Agent work on the lead.
  assert.equal(task.status, 'completed', JSON.stringify(task.error ?? task.conversation?.outcome));
  const outcome = task.conversation!.outcome!;
  assert.equal(outcome.kind, 'scheme_candidate');
  // The model saw the enterprise catalogs and the lead's finishes, never prices.
  const prompt = JSON.parse(prompts.at(-1)!);
  assert.deepEqual(prompt.enterprise.stones.map((s: { id: string }) => s.id).sort(), demoStones.map(s => s.id).sort());
  assert.ok(prompt.enterprise.finishes.some((f: { id: string; requested: boolean }) => f.id === 'finish-f1-living-floor' && f.requested));
  assert.ok(!/price|单价/.test(prompts.at(-1)!));
  const [listed] = await listSchemeCandidates(member, workspaceId, lead.id);
  assert.deepEqual([listed.id, listed.status, listed.stale, listed.softStyle?.id, listed.softChoices.map(c => c.id)],
    [outcome.schemeCandidateId, 'draft', false, demoSoftStyles[0].id, [demoSoftStyles[0].id, demoSoftStyles[1].id]]);
  assert.equal(listed.render?.status, 'queued');
  const { rows: [render] } = await pool.query("SELECT source->>'kind' AS kind FROM project_renders WHERE id=$1", [listed.render!.id]);
  assert.equal(render.kind, 'scheme-candidate');
  assert.deepEqual([await revision(), (await customerSchemes()).length], [before, schemesBefore]);
  // Replaying the same turn (recovery after the response was saved) returns the same candidate, never a second one.
  const { rows: [row] } = await pool.query('SELECT task_id, operation_id, base_revision FROM scheme_candidates WHERE id=$1', [listed.id]);
  const again = await transaction(client => proposeSchemeInTransaction(client, { projectId: lead.projectId, actorId: member.userId, taskId: row.task_id,
    operationId: row.operation_id, baseRevision: row.base_revision, decision: valid }));
  assert.deepEqual([again.status, again.status === 'candidate' && again.candidateId], ['candidate', listed.id]);
  assert.equal((await candidates()).filter(c => c.task_id === row.task_id).length, 1);
});

test('proposals outside the catalogs or the layout rules are refused with reasons and store nothing', async () => {
  const count = (await candidates()).length;
  const foreign = await turn({ ...valid, tilings: [{ ...valid.tilings[0], stoneId: 'another-enterprise-stone' }] });
  assert.equal(foreign.conversation!.outcome!.kind, 'no_change');
  assert.ok(foreign.conversation!.outcome!.schemeIssues!.some(i => i.code === 'STONE_NOT_IN_CATALOG'));
  assert.match(foreign.conversation!.outcome!.message, /没有通过校验/);
  const oversize = await turn({ ...valid, tilings: [{ ...valid.tilings[1], tile: { lengthMm: 4000, widthMm: 4000 } }] });
  assert.ok(oversize.conversation!.outcome!.schemeIssues!.some(i => i.code === 'TILE_SIZE_OUT_OF_RANGE'), JSON.stringify(oversize.conversation!.outcome));
  assert.equal((await candidates()).length, count);
});

test('adopting makes a scheme pending review that customers cannot see until a member publishes it', async () => {
  const [candidate] = await listSchemeCandidates(member, workspaceId, lead.id), operationId = randomUUID();
  const adopted = await adoptSchemeCandidate(member, workspaceId, lead.id, candidate.id, { operationId });
  const scheme = adopted.schemes.find(s => s.pendingReview)!;
  assert.ok(scheme, 'the lead has a pending scheme');
  assert.deepEqual([scheme.name, scheme.softStyle?.id, scheme.render?.status], [valid.name, demoSoftStyles[0].id, 'queued']);
  assert.ok(!(await customerSchemes()).includes(scheme.id), 'customers do not see a pending scheme');
  // The same operation is a no-op; another adoption of the same candidate is refused.
  assert.equal((await adoptSchemeCandidate(member, workspaceId, lead.id, candidate.id, { operationId })).schemes.length, adopted.schemes.length);
  await assert.rejects(adoptSchemeCandidate(member, workspaceId, lead.id, candidate.id, { operationId: randomUUID() }), { code: 'CANDIDATE_ADOPTED' });
  const published = await publishScheme(member, workspaceId, lead.id, scheme.id, { operationId: randomUUID() });
  assert.equal(published.schemes.find(s => s.id === scheme.id)?.pendingReview, false);
  assert.ok((await customerSchemes()).includes(scheme.id), 'published schemes reach the customer');
  await assert.rejects(publishScheme(member, workspaceId, lead.id, scheme.id, { operationId: randomUUID() }), { code: 'SCHEME_ALREADY_PUBLISHED' });
});

test('a candidate made before the space changed cannot be adopted', async () => {
  const task = await turn(valid), id = task.conversation!.outcome!.schemeCandidateId!;
  await pool.query('UPDATE projects SET revision=revision+1 WHERE id=$1', [lead.projectId]);
  try {
    assert.equal((await listSchemeCandidates(member, workspaceId, lead.id)).find(c => c.id === id)?.stale, true);
    await assert.rejects(adoptSchemeCandidate(member, workspaceId, lead.id, id, { operationId: randomUUID() }), { code: 'CANDIDATE_STALE' });
  } finally { await pool.query('UPDATE projects SET revision=revision-1 WHERE id=$1', [lead.projectId]); }
});

test('a member can view a draft candidate in 3D and discard it; a discarded candidate cannot be adopted', async () => {
  const task = await turn(valid), id = task.conversation!.outcome!.schemeCandidateId!;
  const scene = await readCandidateScene(member, workspaceId, lead.id, id);
  assert.ok(scene.rooms.length > 0 && scene.objects.length > 0, 'the frozen render scene of the candidate');
  const after = await discardSchemeCandidate(member, workspaceId, lead.id, id, { operationId: randomUUID() });
  assert.equal(after.find(c => c.id === id)?.status, 'discarded');
  await assert.rejects(discardSchemeCandidate(member, workspaceId, lead.id, id, { operationId: randomUUID() }), { code: 'CANDIDATE_NOT_DRAFT' });
  await assert.rejects(adoptSchemeCandidate(member, workspaceId, lead.id, id, { operationId: randomUUID() }), { code: 'CANDIDATE_NOT_DRAFT' });
  await assert.rejects(readCandidateScene(outsider, workspaceId, lead.id, id), { code: 'NOT_FOUND' });
});

test('only members of the enterprise can run the Agent on a lead or see and adopt its candidates', async () => {
  await assert.rejects(createTask(outsider, lead.projectId, await input(), producer), { code: 'NOT_FOUND' });
  await assert.rejects(listSchemeCandidates(outsider, workspaceId, lead.id), { code: 'NOT_FOUND' });
  const [candidate] = await listSchemeCandidates(member, workspaceId, lead.id);
  await assert.rejects(adoptSchemeCandidate(outsider, workspaceId, lead.id, candidate.id, { operationId: randomUUID() }), { code: 'NOT_FOUND' });
});
