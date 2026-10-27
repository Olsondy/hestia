import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { pool, transaction } from '../../persistence/src/client';
import { createInvitation, acceptInvitation } from '../../identity/src/service';
import { auth, authOrigin } from '../../identity/src/auth';
import { createWorkspace } from './service';
import { createCandidate } from '../../candidates/src/service';
import { reserveResource } from '../../projects/src/service';
import { createRender } from '../../renders/src/service';
import { initializeRenderQueue } from '../../renders/src/queue';
import * as workspacesRoute from '../../../apps/web/app/api/workspaces/route';
import * as workspaceProjectsRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/projects/route';
import * as membersRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/members/route';
import * as memberRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/members/[userId]/route';
import * as projectsRoute from '../../../apps/web/app/api/projects/route';
import * as projectRoute from '../../../apps/web/app/api/projects/[id]/route';
import * as commandsRoute from '../../../apps/web/app/api/projects/[id]/commands/route';
import * as resourceRoute from '../../../apps/web/app/api/projects/[id]/resources/[resourceId]/route';
import * as candidateRoute from '../../../apps/web/app/api/projects/[id]/candidates/[candidateId]/route';
import * as candidatesRoute from '../../../apps/web/app/api/projects/[id]/candidates/route';
import * as renderRoute from '../../../apps/web/app/api/projects/[id]/renders/[renderId]/route';
import * as tasksRoute from '../../../apps/web/app/api/projects/[id]/tasks/route';

const run = randomUUID(), password = 'synthetic-workspace-password-913!';
const queueSchema = `ws_test_${run.replaceAll('-', '')}`;
type Actor = { email: string; userId: string; cookie: string };
const actors: Record<'admin' | 'member' | 'outsider' | 'solo', Actor> = {} as never;
const slugs = [`d01-a-${run.slice(0, 8)}`, `d01-b-${run.slice(0, 8)}`];
let boss: PgBoss;

// Route handlers declare their own params shape; the test supplies matching params per call.
type Handler = (request: Request, context: never) => Promise<Response>;
async function call(handler: Handler, actor: Actor | undefined, params: Record<string, string> = {}, method = 'GET', payload?: unknown) {
  const response = await handler(new Request(`${authOrigin}/api/test`, { method, headers: {
    ...(actor ? { Cookie: actor.cookie } : {}), Origin: authOrigin, ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
  }, body: payload === undefined ? undefined : JSON.stringify(payload) }), { params: Promise.resolve(params) } as never);
  return { status: response.status, body: await response.json() };
}

before(async () => {
  for (const name of ['admin', 'member', 'outsider', 'solo'] as const) {
    const email = `workspace-${name}-${run}@example.test`, invitation = await createInvitation(email);
    const { userId } = await acceptInvitation(invitation.token, `合成${name}`, password);
    const login = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    actors[name] = { email, userId, cookie: login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
  }
  boss = await initializeRenderQueue(queueSchema);
});
after(async () => {
  try {
    await transaction(async client => {
      const users = Object.values(actors).map(actor => actor.userId);
      const workspaces = (await client.query('SELECT id FROM workspaces WHERE slug=ANY($1) OR personal_user_id=ANY($2)', [slugs, users])).rows.map(row => row.id);
      const projects = (await client.query('SELECT id FROM projects WHERE workspace_id=ANY($1::uuid[])', [workspaces])).rows.map(row => row.id);
      await client.query('DELETE FROM project_renders WHERE project_id=ANY($1::uuid[])', [projects]);
      await client.query('DELETE FROM resources WHERE project_id=ANY($1::uuid[])', [projects]);
      await client.query('DELETE FROM operations WHERE project_id=ANY($1::uuid[])', [projects]);
      await client.query('DELETE FROM project_revisions WHERE project_id=ANY($1::uuid[])', [projects]);
      await client.query('DELETE FROM projects WHERE id=ANY($1::uuid[])', [projects]);
      await client.query('DELETE FROM workspaces WHERE id=ANY($1::uuid[])', [workspaces]);
      await client.query('DELETE FROM hestia_invitation WHERE email=ANY($1)', [Object.values(actors).map(actor => actor.email)]);
      await client.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
    });
    assert.match(queueSchema, /^ws_test_[a-f0-9]{32}$/); await pool.query(`DROP SCHEMA IF EXISTS ${queueSchema} CASCADE`);
  } finally { await pool.end(); }
});

test('workspace members share projects and their records; non-members and other workspaces are refused', async () => {
  const first = await createWorkspace({ kind: 'enterprise', slug: slugs[0], name: '合成企业甲', adminEmail: actors.admin.email });
  const again = await createWorkspace({ kind: 'enterprise', slug: slugs[0], name: '合成企业甲', adminEmail: actors.admin.email });
  assert.equal(first.created, true); assert.equal(again.created, false); assert.equal(again.workspace.id, first.workspace.id);
  await assert.rejects(createWorkspace({ kind: 'personal', slug: `p-${run.slice(0, 8)}`, name: '不允许', adminEmail: actors.admin.email }), { code: 'WORKSPACE_KIND_INVALID' });
  const other = await createWorkspace({ kind: 'enterprise', slug: slugs[1], name: '合成企业乙', adminEmail: actors.outsider.email });
  const ws = { workspaceId: first.workspace.id };

  // Only an admin manages members; an unknown account cannot be added.
  assert.equal((await call(membersRoute.POST, actors.member, ws, 'POST', { email: actors.member.email, role: 'member' })).status, 404);
  assert.equal((await call(membersRoute.POST, actors.admin, ws, 'POST', { email: `nobody-${run}@example.test`, role: 'member' })).body.error.code, 'ACCOUNT_NOT_FOUND');
  const added = await call(membersRoute.POST, actors.admin, ws, 'POST', { email: actors.member.email, role: 'member' });
  assert.equal(added.status, 200); assert.deepEqual(added.body.members.map((m: { email: string; role: string }) => [m.email, m.role]).sort(),
    [[actors.admin.email, 'admin'], [actors.member.email, 'member']].sort());
  assert.equal((await call(membersRoute.POST, actors.member, ws, 'POST', { email: actors.solo.email, role: 'member' })).body.error.code, 'FORBIDDEN');

  const listed = await call(workspacesRoute.GET, actors.member);
  assert.deepEqual(listed.body.workspaces.map((w: { kind: string; role: string; personal: boolean; usagePolicy: string }) => [w.kind, w.role, w.personal, w.usagePolicy]),
    [['personal', 'admin', true, 'member_credits'], ['enterprise', 'member', false, 'unmetered']]);

  // A project created by the admin in the enterprise workspace is fully usable by the member.
  const created = await call(workspaceProjectsRoute.POST, actors.admin, ws, 'POST', { name: '企业合成项目', template: 'courtyard', operationId: randomUUID() });
  assert.equal(created.status, 201); const project = created.body.project;
  const target = { id: project.id };
  assert.deepEqual((await call(workspaceProjectsRoute.GET, actors.member, ws)).body.projects.map((p: { id: string }) => p.id), [project.id]);
  assert.equal((await call(projectRoute.GET, actors.member, target)).body.project.revision, 1);
  const moved = await call(commandsRoute.POST, actors.member, target, 'POST', { operationId: randomUUID(), expectedRevision: 1, command: { type: 'move-furniture', objectId: 'sofa-a', x: 3.4, z: 1.2, yaw: 0 } });
  assert.equal(moved.status, 200); assert.equal(moved.body.project.revision, 2);
  const admin = { userId: actors.admin.userId };
  const candidate = await createCandidate(admin, project.id, { operationId: randomUUID(), expectedRevision: 2, name: '管理员的候选' });
  const resource = await reserveResource(admin, project.id, { id: randomUUID(), mediaType: 'image/png' });
  const render = await createRender(admin, project.id, { operationId: randomUUID(), source: { kind: 'current', revision: 2 } }, boss);
  const known = { candidate: { ...target, candidateId: candidate.id }, resource: { ...target, resourceId: resource.id }, render: { ...target, renderId: render.id } };
  assert.equal((await call(candidateRoute.GET, actors.member, known.candidate)).body.candidate.id, candidate.id);
  assert.equal((await call(candidatesRoute.GET, actors.member, target)).body.candidates.length, 1);
  assert.equal((await call(resourceRoute.GET, actors.member, known.resource)).body.resource.id, resource.id);
  assert.equal((await call(renderRoute.GET, actors.member, known.render)).body.render.id, render.id);
  assert.equal((await call(tasksRoute.GET, actors.member, target)).status, 200);

  // The enterprise project stays out of personal listings, including the creator's.
  assert.deepEqual((await call(projectsRoute.GET, actors.admin)).body.projects, []);
  assert.deepEqual((await call(projectsRoute.GET, actors.member)).body.projects, []);

  // Members of another workspace and unrelated users are refused, also for directly addressed known IDs.
  for (const stranger of [actors.outsider, actors.solo]) {
    assert.equal((await call(workspaceProjectsRoute.GET, stranger, ws)).status, 404);
    assert.equal((await call(workspaceProjectsRoute.POST, stranger, ws, 'POST', { name: '越权', template: 'empty', operationId: randomUUID() })).status, 404);
    assert.equal((await call(membersRoute.GET, stranger, ws)).status, 404);
    assert.equal((await call(projectRoute.GET, stranger, target)).status, 404);
    assert.equal((await call(projectRoute.PATCH, stranger, target, 'PATCH', { name: '越权改名', expectedRevision: 2, operationId: randomUUID() })).status, 404);
    assert.equal((await call(commandsRoute.POST, stranger, target, 'POST', { operationId: randomUUID(), expectedRevision: 2, command: { type: 'move-furniture', objectId: 'sofa-a', x: 3.6, z: 1.2, yaw: 0 } })).status, 404);
    assert.equal((await call(candidateRoute.GET, stranger, known.candidate)).status, 404);
    assert.equal((await call(candidatesRoute.GET, stranger, target)).status, 404);
    assert.equal((await call(resourceRoute.GET, stranger, known.resource)).status, 404);
    assert.equal((await call(renderRoute.GET, stranger, known.render)).status, 404);
    assert.equal((await call(tasksRoute.GET, stranger, target)).status, 404);
  }
  assert.equal((await call(projectRoute.GET, undefined, target)).status, 401);
  assert.equal((await call(workspaceProjectsRoute.GET, actors.admin, { workspaceId: other.workspace.id })).status, 404);
  assert.equal((await call(projectRoute.GET, actors.admin, target)).body.project.revision, 2);

  // Personal workspaces stay single-member, and a workspace always keeps an admin.
  const personal = listed.body.workspaces[0].id;
  assert.equal((await call(membersRoute.POST, actors.member, { workspaceId: personal }, 'POST', { email: actors.solo.email, role: 'member' })).body.error.code, 'WORKSPACE_MEMBER_LIMIT');
  assert.equal((await call(memberRoute.DELETE, actors.admin, { ...ws, userId: actors.admin.userId }, 'DELETE')).body.error.code, 'LAST_ADMIN');
  assert.equal((await call(memberRoute.PATCH, actors.admin, { ...ws, userId: actors.admin.userId }, 'PATCH', { role: 'member' })).body.error.code, 'LAST_ADMIN');

  // Removing a member revokes access immediately, including to records it could read before.
  assert.equal((await call(memberRoute.DELETE, actors.admin, { ...ws, userId: actors.member.userId }, 'DELETE')).status, 200);
  assert.equal((await call(projectRoute.GET, actors.member, target)).status, 404);
  assert.equal((await call(candidateRoute.GET, actors.member, known.candidate)).status, 404);
  assert.equal((await call(resourceRoute.GET, actors.member, known.resource)).status, 404);
  assert.equal((await call(renderRoute.GET, actors.member, known.render)).status, 404);
  assert.equal((await call(workspaceProjectsRoute.GET, actors.member, ws)).status, 404);
});
