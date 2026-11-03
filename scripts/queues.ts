// Creates or completes the three pg-boss queues (tasks, renders, floorplan imports). Finite and idempotent; used by
// `pnpm bootstrap` and before `pnpm dev:all` starts the Workers.
import { initializeQueue } from '../packages/tasks/src/queue';
import { initializeRenderQueue } from '../packages/renders/src/queue';
import { initializeImportQueue } from '../packages/drawing-imports/src/queue';
import { pool } from '../packages/persistence/src/client';
try {
  await initializeQueue(); await initializeRenderQueue(); await initializeImportQueue();
  console.log('Queues ready: tasks, renders, floorplan imports.');
} finally { await pool.end(); }
