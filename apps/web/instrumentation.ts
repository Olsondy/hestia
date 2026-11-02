/** Runs once when the server starts. A refused SMS configuration (mock in production) stops the server. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation-node');
}
