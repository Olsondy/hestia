// Node-only startup checks, imported from instrumentation.ts so the Edge build never compiles process.exit.
import { smsSenderFromEnv } from '../../packages/identity/src/sms';
import { otpConfig } from '../../packages/identity/src/phone-config';
import { assertSecretKey } from '../../packages/model-registry/src/secret';

// The platform console stores model keys sealed under HESTIA_SECRET_KEY (ADR-0018): no console without a valid master key.
try { smsSenderFromEnv(); otpConfig(); if (process.env.HESTIA_ADMIN_HOST?.trim()) assertSecretKey(); }
catch (error) {
  console.error('startup_configuration_rejected', { message: error instanceof Error ? error.message : 'unknown' });
  process.exit(1);
}
