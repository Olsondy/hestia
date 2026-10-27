import { PgBoss } from 'pg-boss';
import { pool } from '../../packages/persistence/src/client';
import { RENDER_QUEUE, RENDER_SCHEMA } from '../../packages/renders/src/queue';
import { validatedQueueSchema } from '../../packages/tasks/src/queue';
import { runRender } from '../../packages/renders/src/runner';
const schema = validatedQueueSchema(process.env.HESTIA_RENDER_QUEUE_SCHEMA ?? RENDER_SCHEMA);
const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema, migrate: false, schedule: false,
  superviseIntervalSeconds: 10, instanceName: 'hestia-render-worker' });
boss.on('error', error => console.error('render_queue_error', { type: error.name }));
await boss.start();
await boss.work<{ renderId: string }>(RENDER_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async jobs => {
  for (const job of jobs) await runRender(job.data.renderId);
});
console.log('Render Worker ready. No model calls.');
async function stop() { await boss.stop({ graceful: true, timeout: 120000 }); await pool.end(); }
process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
