// Node-only startup checks, imported from instrumentation.ts so the Edge build never compiles process.exit.
import { smsSenderFromEnv } from '../../packages/identity/src/sms';
import { otpConfig } from '../../packages/identity/src/phone-config';

try { smsSenderFromEnv(); otpConfig(); }
catch (error) {
  console.error('startup_configuration_rejected', { message: error instanceof Error ? error.message : 'unknown' });
  process.exit(1);
}
