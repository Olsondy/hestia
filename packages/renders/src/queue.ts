import { PgBoss, getConstructionPlans } from 'pg-boss';
import type { PoolClient } from 'pg';
import { pool } from '../../persistence/src/client';
import { validatedQueueSchema } from '../../tasks/src/queue';
export const RENDER_QUEUE = 'hestia-static-render';
export const RENDER_SCHEMA = 'hestia_renders';
export function createRenderQueue(schema = RENDER_SCHEMA) {
  return new PgBoss({ schema: validatedQueueSchema(schema), db: { executeSql: (sql, values) => pool.query(sql, values) },
    supervise: false, schedule: false, registerInstance: false, migrate: false });
}
export const renderQueue = createRenderQueue();
export async function initializeRenderQueue(schema = RENDER_SCHEMA) {
  validatedQueueSchema(schema);
  if (!(await pool.query('SELECT to_regnamespace($1) AS schema', [schema])).rows[0].schema) await pool.query(getConstructionPlans(schema));
  const queue = createRenderQueue(schema);
  await queue.createQueue(RENDER_QUEUE, { policy: 'standard', retryLimit: 10, retryDelay: 2, retryBackoff: true,
    retryDelayMax: 30, expireInSeconds: 180, retentionSeconds: 86400, deleteAfterSeconds: 604800 });
  return queue;
}
export async function enqueueRender(client: PoolClient, id: string, queue = renderQueue) {
  if (!await queue.send(RENDER_QUEUE, { renderId: id }, { id, db: { executeSql: (sql, values) => client.query(sql, values) } }))
    throw new Error('Render was not enqueued');
}
