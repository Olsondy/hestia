import { PgBoss } from 'pg-boss';
import { pool } from '../../packages/persistence/src/client';
import { IMPORT_QUEUE, IMPORT_SCHEMA } from '../../packages/drawing-imports/src/queue';
import { validatedQueueSchema } from '../../packages/tasks/src/queue';
import { runImport } from '../../packages/drawing-imports/src/runner';
import { generateForImport } from '../../packages/finish-requests/src/service';
import { initializeRenderQueue } from '../../packages/renders/src/queue';

// Explicit service entry for DXF conversion. Each job spawns one bounded `python -I` converter process; a converted
// drawing request then gets its schemes generated and queued for rendering right away (ADR-0013).
const schema = validatedQueueSchema(process.env.HESTIA_IMPORT_QUEUE_SCHEMA ?? IMPORT_SCHEMA);
const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema, migrate: false, schedule: false,
  superviseIntervalSeconds: 10, instanceName: 'hestia-import-worker' });
boss.on('error', error => console.error('import_queue_error', { type: error.name }));
await boss.start();
const renderQueue = await initializeRenderQueue();
await boss.work<{ importId: string }>(IMPORT_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async jobs => {
  for (const job of jobs) { await runImport(job.data.importId); await generateForImport(job.data.importId, { renderQueue }); }
});
console.log('Floorplan import Worker ready. DXF only; no model calls.');
async function stop() { await boss.stop({ graceful: true, timeout: 90000 }); await pool.end(); }
process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
