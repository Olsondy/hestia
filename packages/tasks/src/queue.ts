import { PgBoss, getConstructionPlans } from 'pg-boss';
import type { PoolClient } from 'pg';
import { pool } from '../../persistence/src/client';

export const TASK_QUEUE = 'hestia-deterministic-task';
export const QUEUE_SCHEMA = 'hestia_jobs';
export function validatedQueueSchema(schema: string) {
  if (!/^[a-z][a-z0-9_]{0,49}$/.test(schema)) throw new Error('Invalid queue schema');
  return schema;
}
/** A producer uses the existing pool without start(), timers, LISTEN or worker polling. */
export function createQueueClient(schema = QUEUE_SCHEMA) {
  return new PgBoss({ schema: validatedQueueSchema(schema), db: { executeSql: (sql, values) => pool.query(sql, values) },
    supervise: false, schedule: false, registerInstance: false, migrate: false });
}
export const queue = createQueueClient();

/** Explicit finite setup, not a service. Never called by a request or module import. */
export async function initializeQueue(schema = QUEUE_SCHEMA) {
  validatedQueueSchema(schema);
  const existing = await pool.query('SELECT to_regnamespace($1) AS schema', [schema]);
  if (!existing.rows[0].schema) await pool.query(getConstructionPlans(schema));
  const producer = createQueueClient(schema);
  await producer.createQueue(TASK_QUEUE, { policy: 'standard', retryLimit: 10, retryDelay: 2, retryBackoff: true,
    retryDelayMax: 30, expireInSeconds: 30, retentionSeconds: 86400, deleteAfterSeconds: 604800 });
  return producer;
}
export async function enqueueTask(client: PoolClient, taskId: string, producer = queue, dispatchId = taskId, intentVersion = 1) {
  const jobId = await producer.send(TASK_QUEUE, { taskId, intentVersion }, { id: dispatchId, db: { executeSql: (sql, values) => client.query(sql, values) } });
  if (!jobId) throw new Error('Task job was not enqueued');
}
