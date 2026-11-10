import { PgBoss, getConstructionPlans } from 'pg-boss';
import type { PoolClient } from 'pg';
import { pool } from '../../persistence/src/client';
import { createProducer, producerSchema, queueInstalled, validatedQueueSchema } from '../../tasks/src/queue';
import { fairJobOptions, projectWorkspace } from '../../tasks/src/fairness';
export const RENDER_QUEUE = 'hestia-static-render';
export const RENDER_SCHEMA = 'hestia_renders';
/**
 * An ultra eye-level still takes about 100 s on software rendering (no GPU), aerials about 50 s. The render lease and the
 * queue expiry leave headroom for a busy host; a lapsed lease would otherwise retry a render that is still working.
 */
export const RENDER_LEASE_SECONDS = 360, RENDER_EXPIRE_SECONDS = 420;
export const createRenderQueue = (schema = RENDER_SCHEMA) => createProducer(schema);
export const renderQueue = createRenderQueue();
export async function initializeRenderQueue(schema = RENDER_SCHEMA) {
  validatedQueueSchema(schema);
  if (!(await queueInstalled(schema))) await pool.query(getConstructionPlans(schema));
  const queue = createRenderQueue(schema);
  await queue.createQueue(RENDER_QUEUE, { policy: 'standard', retryLimit: 10, retryDelay: 2, retryBackoff: true,
    retryDelayMax: 30, expireInSeconds: RENDER_EXPIRE_SECONDS, retentionSeconds: 86400, deleteAfterSeconds: 604800 });
  // Existing queues keep their creation options; carry the expiry forward on re-initialisation.
  await queue.updateQueue(RENDER_QUEUE, { expireInSeconds: RENDER_EXPIRE_SECONDS });
  return queue;
}
export async function enqueueRender(client: PoolClient, id: string, queue = renderQueue) {
  const { rows: [render] } = await client.query<{ project_id: string }>('SELECT project_id FROM project_renders WHERE id = $1', [id]);
  if (!render) throw new Error('Render job has no render');
  const fair = await fairJobOptions(client, producerSchema(queue, RENDER_SCHEMA), RENDER_QUEUE, await projectWorkspace(client, render.project_id));
  if (!await queue.send(RENDER_QUEUE, { renderId: id }, { id, ...fair, db: { executeSql: (sql, values) => client.query(sql, values) } }))
    throw new Error('Render was not enqueued');
}
