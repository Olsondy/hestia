// --setup is a finite SQL setup command; the default explicitly starts the import Worker service.
if (process.argv.includes('--setup')) {
  const { initializeImportQueue } = await import('../packages/drawing-imports/src/queue');
  const { pool } = await import('../packages/persistence/src/client');
  try { await initializeImportQueue(); console.log('Floorplan import queue initialized; no Worker started.'); }
  finally { await pool.end(); }
} else await import('../apps/worker/import');
export {};
