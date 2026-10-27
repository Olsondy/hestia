// --setup is a finite SQL setup command; the default explicitly starts the Worker service.
if (process.argv.includes('--setup')) {
  const { initializeQueue } = await import('../packages/tasks/src/queue');
  const { pool } = await import('../packages/persistence/src/client');
  try { await initializeQueue(); console.log('pg-boss task queue ready; no Worker started.'); }
  finally { await pool.end(); }
} else await import('../apps/worker/main');
export {};
