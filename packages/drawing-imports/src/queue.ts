import { PgBoss, getConstructionPlans } from 'pg-boss';
import type { PoolClient } from 'pg';
import { pool } from '../../persistence/src/client';
import { queueInstalled, validatedQueueSchema } from '../../tasks/src/queue';

export const IMPORT_QUEUE = 'hestia-floorplan-import';
export const IMPORT_SCHEMA = 'hestia_imports';
/** Producer on the shared pool: no start(), polling or timers. */
export function createImportQueue(schema = IMPORT_SCHEMA) {
  return new PgBoss({ schema: validatedQueueSchema(schema), db: { executeSql: (sql, values) => pool.query(sql, values) },
    supervise: false, schedule: false, registerInstance: false, migrate: false });
}
export const importQueue = createImportQueue();
/** Explicit finite setup. `expireInSeconds` must exceed the converter timeout; tests shorten it to observe restarts. */
export async function initializeImportQueue(schema = IMPORT_SCHEMA, options: { expireInSeconds?: number } = {}) {
  validatedQueueSchema(schema);
  if (!(await queueInstalled(schema))) await pool.query(getConstructionPlans(schema));
  const queue = createImportQueue(schema);
  await queue.createQueue(IMPORT_QUEUE, { policy: 'standard', retryLimit: 10, retryDelay: 2, retryBackoff: true,
    retryDelayMax: 30, expireInSeconds: options.expireInSeconds ?? 180, retentionSeconds: 86400, deleteAfterSeconds: 604800 });
  return queue;
}
export async function enqueueImport(client: PoolClient, id: string, queue = importQueue) {
  if (!await queue.send(IMPORT_QUEUE, { importId: id }, { id, db: { executeSql: (sql, values) => client.query(sql, values) } }))
    throw new Error('Import was not enqueued');
}
