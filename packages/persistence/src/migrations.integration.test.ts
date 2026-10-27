import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { pool } from './client';

// Applies the real migration files to an isolated schema holding pre-workspace data, so the
// D01 workspace migration is verified on existing records without touching the shared tables.
const schema = `migration_test_${randomUUID().replaceAll('-', '')}`;
const directory = new URL('../migrations/', import.meta.url);
const files = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
const legacy = files.filter(name => name < '0014-'), workspace = files.filter(name => name >= '0014-' && name < '0016-');
async function apply(client: PoolClient, names: string[]) {
  for (const name of names) await client.query(await readFile(new URL(name, directory), 'utf8'));
}
after(async () => {
  assert.match(schema, /^migration_test_[a-f0-9]{32}$/);
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end();
});

const users = ['mig-user-a', 'mig-user-b'], orphan = 'mig-legacy-identity-without-account';
const ids = { a1: randomUUID(), a2: randomUUID(), b1: randomUUID(), o1: randomUUID(), late: randomUUID(), candidate: randomUUID(), resource: randomUUID(), render: randomUUID(), task: randomUUID() };
const owners: Record<string, string> = { [ids.a1]: users[0], [ids.a2]: users[0], [ids.b1]: users[1], [ids.o1]: orphan, [ids.late]: users[1] };

async function seedLegacy(client: PoolClient) {
  for (const user of users) await client.query("INSERT INTO hestia_auth_user(id,name,email) VALUES($1,'合成迁移用户',$2)", [user, `${user}@example.test`]);
  for (const [id, revision] of [[ids.a1, 3], [ids.a2, 1], [ids.b1, 2], [ids.o1, 1]] as const) {
    await client.query("INSERT INTO projects(id,owner_id,name,revision,snapshot) VALUES($1,$2,$3,$4,$5)", [id, owners[id], `迁移前 ${id.slice(0, 4)}`, revision, { marker: id, revision }]);
    for (let r = 1; r <= revision; r++) {
      const operation = randomUUID();
      await client.query('INSERT INTO project_revisions(project_id,revision,snapshot,operation_id) VALUES($1,$2,$3,$4)', [id, r, { r }, operation]);
      await client.query('INSERT INTO operations(owner_id,id,project_id,request_hash,result) VALUES($1,$2,$3,$4,$5)', [owners[id], operation, id, `h${r}`, { r }]);
    }
  }
  await client.query("INSERT INTO resources(id,project_id,object_key,media_type,state) VALUES($1,$2,$3,'image/png','ready')", [ids.resource, ids.a1, `k-${ids.resource}`]);
  await client.query("INSERT INTO candidates(id,project_id,owner_id,name,revision,base_revision,base_state,objects,status) VALUES($1,$2,$3,'迁移前候选',2,3,'{}','[]','draft')", [ids.candidate, ids.a1, users[0]]);
  for (const r of [1, 2]) await client.query("INSERT INTO candidate_revisions(candidate_id,revision,objects) VALUES($1,$2,'[]')", [ids.candidate, r]);
  await client.query(`INSERT INTO project_renders(id,owner_id,project_id,request_id,request_hash,source,snapshot,snapshot_hash,asset_version,renderer_version,scale,synthetic,concept,label,status)
    VALUES($1,$2,$3,$4,'rh','{}','{}','sh','a1','r1','synthetic',true,false,'示例','completed')`, [ids.render, users[0], ids.a1, randomUUID()]);
  await client.query("INSERT INTO design_tasks(id,owner_id,project_id,request_id,request_hash,protocol,status,steps,expected_revision) VALUES($1,$2,$3,$4,'th','deterministic-v1','completed','[]',3)",
    [ids.task, users[0], ids.a1, randomUUID()]);
}
/** Everything a user could read before, minus the ownership columns that the migration replaces. */
async function content(client: PoolClient) {
  const strip = "- 'owner_id' - 'actor_id' - 'workspace_id' - 'created_by'";
  const read = async (table: string, key: string) => (await client.query(`SELECT to_jsonb(t) ${strip} AS v FROM ${table} t ORDER BY ${key}`)).rows.map(row => row.v);
  return { projects: await read('projects', 'id'), revisions: await read('project_revisions', 'project_id,revision'), operations: await read('operations', 'id'),
    resources: await read('resources', 'id'), candidates: await read('candidates', 'id'), candidateRevisions: await read('candidate_revisions', 'candidate_id,revision'),
    renders: await read('project_renders', 'id'), tasks: await read('design_tasks', 'id') };
}
async function ownership(client: PoolClient) {
  const workspaces = (await client.query(`SELECT w.personal_user_id AS user, w.kind, count(m.*)::int AS members, bool_and(m.user_id=w.personal_user_id AND m.role='admin') AS sole_admin
    FROM workspaces w LEFT JOIN workspace_members m ON m.workspace_id=w.id GROUP BY w.id ORDER BY 1`)).rows;
  const projects = (await client.query('SELECT p.id, w.personal_user_id AS owner, p.created_by FROM projects p JOIN workspaces w ON w.id=p.workspace_id ORDER BY p.id')).rows;
  const access = (await client.query("SELECT user_id, array_agg(project_id::text ORDER BY project_id) AS projects FROM project_access WHERE via='member' GROUP BY user_id ORDER BY user_id")).rows;
  return { workspaces, projects, access };
}

test('workspace migration keeps legacy access and data unchanged and is safe to re-apply', async () => {
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`); await client.query(`SET search_path TO ${schema}`);
    await apply(client, legacy); await seedLegacy(client);
    const before = await content(client);

    await apply(client, ['0014-workspaces.sql']);
    const expanded = await ownership(client);
    assert.deepEqual(expanded.workspaces, [...users, orphan].sort().map(user => ({ user, kind: 'personal', members: 1, sole_admin: true })));
    for (const row of expanded.projects) { assert.equal(row.owner, owners[row.id]); assert.equal(row.created_by, owners[row.id]); }
    await apply(client, ['0014-workspaces.sql']);
    assert.deepEqual(await ownership(client), expanded, 're-applying 0014 creates no second workspace or membership');

    // Pre-workspace code still running between deploys writes a project with only owner_id.
    await client.query("INSERT INTO projects(id,owner_id,name,revision,snapshot) VALUES($1,$2,'部署间隙项目',1,'{}')", [ids.late, users[1]]);
    await apply(client, ['0015-workspace-ownership.sql']);
    const contracted = await ownership(client);
    await apply(client, workspace); await apply(client, workspace);
    assert.deepEqual(await ownership(client), contracted, 're-applying 0014 and 0015 after the contract step is a no-op');

    assert.equal(contracted.workspaces.length, 3);
    assert.deepEqual(contracted.projects.map(row => [row.id, row.owner, row.created_by]),
      Object.keys(owners).sort().map(id => [id, owners[id], owners[id]]));
    const expected = [...users, orphan].sort().map(user => ({ user_id: user, projects: Object.keys(owners).filter(id => owners[id] === user).sort() }));
    assert.deepEqual(contracted.access, expected, 'each original owner reaches exactly the projects it owned');

    const after = await content(client);
    after.projects = after.projects.filter((row: { id: string }) => row.id !== ids.late);
    assert.deepEqual(after, before, 'names, revisions, snapshots, resources, candidates, renders and tasks are unchanged');
    const columns = (await client.query("SELECT table_name FROM information_schema.columns WHERE table_schema=$1 AND column_name='owner_id'", [schema])).rows;
    assert.deepEqual(columns, [], 'no table keeps a user-ownership column');
    assert.equal((await client.query('SELECT actor_id FROM design_tasks WHERE id=$1', [ids.task])).rows[0].actor_id, users[0]);
    assert.equal((await client.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='projects' AND column_name='workspace_id'", [schema])).rows[0].is_nullable, 'NO');
  } finally { await client.query('RESET search_path').catch(() => {}); client.release(); }
});
