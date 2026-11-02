/** Runs once when the server starts. A refused SMS configuration (mock in production) stops the server. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { smsSenderFromEnv } = await import('../../packages/identity/src/sms');
  const { otpConfig } = await import('../../packages/identity/src/phone-config');
  try { smsSenderFromEnv(); otpConfig(); }
  catch (error) {
    console.error('startup_configuration_rejected', { message: error instanceof Error ? error.message : 'unknown' });
    process.exit(1);
  }
}
