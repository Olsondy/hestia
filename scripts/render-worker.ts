if (process.argv.includes('--setup')) {
  const { initializeRenderQueue } = await import('../packages/renders/src/queue');
  const { pool } = await import('../packages/persistence/src/client');
  try { await initializeRenderQueue(); console.log('Render queue initialized; no Worker started.'); }
  finally { await pool.end(); }
} else await import('../apps/worker/render');
export {};
