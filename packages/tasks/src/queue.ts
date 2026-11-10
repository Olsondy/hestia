import { PgBoss, getConstructionPlans } from 'pg-boss';
import type { PoolClient } from 'pg';
import { pool } from '../../persistence/src/client';
import { fairJobOptions, projectWorkspace } from './fairness';

export const TASK_QUEUE = 'hestia-deterministic-task';
export const QUEUE_SCHEMA = 'hestia_jobs';
export function validatedQueueSchema(schema: string) {
  if (!/^[a-z][a-z0-9_]{0,49}$/.test(schema)) throw new Error('Invalid queue schema');
  return schema;
}
const producerSchemas = new WeakMap<PgBoss, string>();
/** Producer on the shared pool without start(), timers, LISTEN or worker polling; remembers its schema for fair sends. */
export function createProducer(schema: string) {
  const producer = new PgBoss({ schema: validatedQueueSchema(schema), db: { executeSql: (sql, values) => pool.query(sql, values) },
    supervise: false, schedule: false, registerInstance: false, migrate: false });
  producerSchemas.set(producer, schema);
  return producer;
}
export const producerSchema = (producer: PgBoss, fallback: string) => producerSchemas.get(producer) ?? fallback;
/** A producer uses the existing pool without start(), timers, LISTEN or worker polling. */
export const createQueueClient = (schema = QUEUE_SCHEMA) => createProducer(schema);
export const queue = createQueueClient();

/** Explicit finite setup, not a service. Never called by a request or module import. */
// Installed means pg-boss's own version table exists (the check its Workers run), not merely the schema: a schema left
// empty by an interrupted setup would otherwise be skipped for ever.
export async function queueInstalled(schema: string) {
  return !!(await pool.query('SELECT to_regclass($1) AS name', [`${validatedQueueSchema(schema)}.version`])).rows[0].name;
}
export async function initializeQueue(schema = QUEUE_SCHEMA) {
  validatedQueueSchema(schema);
  if (!(await queueInstalled(schema))) await pool.query(getConstructionPlans(schema));
  const producer = createQueueClient(schema);
  await producer.createQueue(TASK_QUEUE, { policy: 'standard', retryLimit: 10, retryDelay: 2, retryBackoff: true,
    retryDelayMax: 30, expireInSeconds: 30, retentionSeconds: 86400, deleteAfterSeconds: 604800 });
  return producer;
}
export async function enqueueTask(client: PoolClient, taskId: string, producer = queue, dispatchId = taskId, intentVersion = 1) {
  const { rows: [task] } = await client.query<{ project_id: string }>('SELECT project_id FROM design_tasks WHERE id = $1', [taskId]);
  if (!task) throw new Error('Task job has no task');
  const fair = await fairJobOptions(client, producerSchema(producer, QUEUE_SCHEMA), TASK_QUEUE, await projectWorkspace(client, task.project_id));
  const jobId = await producer.send(TASK_QUEUE, { taskId, intentVersion }, { id: dispatchId, ...fair, db: { executeSql: (sql, values) => client.query(sql, values) } });
  if (!jobId) throw new Error('Task job was not enqueued');
}
