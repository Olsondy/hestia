import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { pool } from '../../persistence/src/client';
import { createProject } from '../../projects/src/service';
import { createRender } from '../../renders/src/service';
import { initializeRenderQueue, RENDER_QUEUE } from '../../renders/src/queue';
import { usageReport } from '../../workspaces/src/usage';
import { fairWorkOptions } from './fairness';

// M03 (ADR-0017): queues are fair across workspaces; usage is reported per workspace and month. Real PostgreSQL and
// pg-boss in a throwaway schema; two users' personal workspaces stand in for two enterprises.
const a = { userId: `m03-a-${randomUUID()}` }, b = { userId: `m03-b-${randomUUID()}` };
const schema = `m03_test_${randomUUID().replaceAll('-', '')}`;
let boss: PgBoss;
const project = (owner: { userId: string }) => createProject(owner, { name: '合成队列验证', template: 'courtyard', operationId: randomUUID() });
const render = (owner: { userId: string }, projectId: string) => createRender(owner, projectId, { operationId: randomUUID(), source: { kind: 'current', revision: 1 } }, boss);
const workspaceOf = async (owner: { userId: string }) => (await pool.query('SELECT id FROM workspaces WHERE personal_user_id=$1', [owner.userId])).rows[0].id as string;

before(async () => { boss = await initializeRenderQueue(schema); });
after(async () => {
  const users = [a.userId, b.userId];
  try {
    await pool.query('DELETE FROM design_tasks WHERE actor_id=ANY($1)', [users]);
    await pool.query('DELETE FROM project_renders WHERE actor_id=ANY($1)', [users]);
    for (const table of ['resources', 'project_revisions']) await pool.query(`DELETE FROM ${table} WHERE project_id IN (SELECT id FROM projects WHERE created_by=ANY($1))`, [users]);
    await pool.query('DELETE FROM operations WHERE actor_id=ANY($1)', [users]);
    await pool.query('DELETE FROM projects WHERE created_by=ANY($1)', [users]);
    await pool.query('DELETE FROM workspaces WHERE personal_user_id=ANY($1)', [users]);
    assert.match(schema, /^m03_test_[a-f0-9]{32}$/); await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  } finally { await pool.end(); }
});

test('a busy workspace does not starve another: its later jobs wait behind the other workspace\'s first', async () => {
  const pa = await Promise.all([1, 2, 3, 4].map(() => project(a))), pb = await project(b);
  const fromA: string[] = [];
  for (const p of pa) fromA.push((await render(a, p.id)).id);
  const fromB = (await render(b, pb.id)).id;
  const [wa, wb] = [await workspaceOf(a), await workspaceOf(b)];
  const jobs = (await pool.query(`SELECT data->>'renderId' AS id, group_id, priority FROM ${schema}.job WHERE name=$1 ORDER BY created_on`, [RENDER_QUEUE])).rows;
  assert.deepEqual(jobs.map(j => j.group_id), [wa, wa, wa, wa, wb], 'jobs carry their workspace');
  assert.deepEqual(jobs.map(j => j.priority), [0, -1, -2, -3, 0]);
  // One Worker slot: the order it receives jobs in.
  const order: string[] = [];
  for (let i = 0; i < 5; i++) {
    const [job] = await boss.fetch<{ renderId: string }>(RENDER_QUEUE, { batchSize: 1 });
    order.push(job.data.renderId); await boss.complete(RENDER_QUEUE, job.id);
  }
  assert.deepEqual(order, [fromA[0], fromB, ...fromA.slice(1)]);
  // A job that finished no longer counts: a's next job starts at the front again.
  const again = await render(a, (await project(a)).id);
  const { rows: [row] } = await pool.query(`SELECT priority FROM ${schema}.job WHERE data->>'renderId'=$1`, [again.id]);
  assert.equal(row.priority, 0);
  const [job] = await boss.fetch<{ renderId: string }>(RENDER_QUEUE, { batchSize: 1 }); await boss.complete(RENDER_QUEUE, job.id);
});

test('with several slots one workspace holds at most its group limit', async () => {
  for (let i = 0; i < 3; i++) await render(a, (await project(a)).id);
  const fromB = (await render(b, (await project(b)).id)).id;
  const options = { batchSize: 1, groupConcurrency: { default: 1, tiers: {} } };
  const first = await boss.fetch<{ renderId: string }>(RENDER_QUEUE, options);
  const second = await boss.fetch<{ renderId: string }>(RENDER_QUEUE, options);
  const third = await boss.fetch<{ renderId: string }>(RENDER_QUEUE, options);
  assert.equal(second[0]?.data.renderId, fromB, 'the second slot goes to the other workspace');
  assert.equal(third.length, 0, 'both workspaces are at their limit while their jobs run');
  for (const job of [...first, ...second]) await boss.complete(RENDER_QUEUE, job.id);
  for (let n = 0; n < 2; n++) { const [job] = await boss.fetch(RENDER_QUEUE, options); await boss.complete(RENDER_QUEUE, job.id); }
});

test('Worker slots and limits come from the environment and refuse invalid values', () => {
  const keys = ['HESTIA_RENDER_WORKER_SLOTS', 'HESTIA_RENDER_GROUP_LIMIT', 'HESTIA_RENDER_GROUP_LIMITS'];
  const saved = keys.map(k => process.env[k]);
  try {
    for (const k of keys) delete process.env[k];
    assert.deepEqual(fairWorkOptions('RENDER'), { localConcurrency: 1, groupConcurrency: { default: 1, tiers: {} } });
    process.env.HESTIA_RENDER_WORKER_SLOTS = '3'; process.env.HESTIA_RENDER_GROUP_LIMITS = '{"enterprise-a":3}';
    assert.deepEqual(fairWorkOptions('RENDER'), { localConcurrency: 3, groupConcurrency: { default: 2, tiers: { 'enterprise-a': 3 } } });
    for (const [key, bad] of [['HESTIA_RENDER_WORKER_SLOTS', '0'], ['HESTIA_RENDER_GROUP_LIMIT', '1.5'], ['HESTIA_RENDER_GROUP_LIMITS', '{"x":0}'], ['HESTIA_RENDER_GROUP_LIMITS', 'nope']]) {
      const before = process.env[key]; process.env[key] = bad;
      assert.throws(() => fairWorkOptions('RENDER'), new RegExp(`${key} must`));
      if (before === undefined) delete process.env[key]; else process.env[key] = before;
    }
  } finally { keys.forEach((k, i) => saved[i] === undefined ? delete process.env[k] : process.env[k] = saved[i]); }
});

test('usage is reported per workspace and month; calls without token counts are listed, not counted as zero', async () => {
  const p = await project(b), wb = await workspaceOf(b);
  const done = await render(b, p.id), failed = await render(b, (await project(b)).id);
  await pool.query("UPDATE project_renders SET status='completed', attempts=2 WHERE id=$1", [done.id]);
  await pool.query("UPDATE project_renders SET status='failed', attempts=3 WHERE id=$1", [failed.id]);
  const task = randomUUID();
  await pool.query(`INSERT INTO design_tasks (id, actor_id, project_id, request_id, request_hash, protocol, status, steps, expected_revision)
    VALUES ($1, $2, $3, $4, 'synthetic', 'deterministic-v1', 'completed', '[]', 1)`, [task, b.userId, p.id, randomUUID()]);
  await pool.query(`INSERT INTO task_events (task_id, seq, type, data) VALUES ($1, 1, 'usage', $2), ($1, 2, 'usage', $3), ($1, 3, 'usage', $4)`, [task,
    { unit: 'token', inputTokens: 1200, outputTokens: 300, elapsedMs: 900 }, { unit: 'token', inputTokens: null, outputTokens: null, elapsedMs: 400 },
    { unit: 'protocol-step', used: 1 }]);
  const month = (await pool.query("SELECT to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') AS m")).rows[0].m as string;
  const mine = (await usageReport(month)).find(r => r.workspace.id === wb)!;
  assert.deepEqual(mine.tasks, { total: 1, byStatus: { completed: 1 } });
  assert.deepEqual(mine.model, { calls: 2, inputTokens: 1200, outputTokens: 300, unverifiedCalls: 1 });
  assert.equal(mine.renders.total, (await pool.query('SELECT count(*)::int AS n FROM project_renders r JOIN projects p ON p.id=r.project_id WHERE p.workspace_id=$1', [wb])).rows[0].n);
  assert.ok(mine.renders.completed >= 1 && mine.renders.failed >= 1);
  assert.deepEqual(mine.imports, { total: 0, byStatus: {} });
  // Another workspace's usage is not mixed in, and other months are empty.
  const wa = await workspaceOf(a), theirs = (await usageReport(month)).find(r => r.workspace.id === wa);
  assert.equal(theirs?.model.calls ?? 0, 0);
  assert.equal((await usageReport('2001-01')).find(r => r.workspace.id === wb), undefined);
  await assert.rejects(usageReport('2026-13'), { code: 'INVALID_MONTH' });
  await assert.rejects(usageReport(month, 'm03-missing'), { code: 'NOT_FOUND' });
});
