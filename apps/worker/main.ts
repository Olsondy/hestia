import { PgBoss } from 'pg-boss';
import { setTimeout as delay } from 'node:timers/promises';
import { pool } from '../../packages/persistence/src/client';
import { QUEUE_SCHEMA, TASK_QUEUE, validatedQueueSchema } from '../../packages/tasks/src/queue';
import { runTask } from '../../packages/tasks/src/runner';

// Explicit service entry. Importing domain/API modules never starts this process.
const schema = validatedQueueSchema(process.env.HESTIA_TASK_QUEUE_SCHEMA ?? QUEUE_SCHEMA);
const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema, migrate: false,
  schedule: false, superviseIntervalSeconds: 10, instanceName: 'hestia-task-worker' });
boss.on('error', error => console.error('worker_queue_error', { type: error.name }));
await boss.start();
await boss.work<{ taskId: string; intentVersion?: number }>(TASK_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async jobs => {
  // Legacy dispatches belong to the first input; a delayed job cannot claim a newer intent.
  for (const job of jobs) await runTask(job.data.taskId, { intentVersion: job.data.intentVersion ?? 1, betweenSteps: () => delay(750) });
});
console.log('Hestia task Worker ready. Conversation tasks use the configured platform model.');
async function shutdown() { await boss.stop({ graceful: true, timeout: 20000 }); await pool.end(); }
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
