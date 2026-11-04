/** A verification-code text message. `code` must never be logged or returned except by the mock sender. */
export type VerificationSms = { phoneNumber: string; code: string; ttlSeconds: number };

/**
 * SMS delivery adapter. A real provider implements `send` and is installed with `setSmsSender`;
 * none is bundled yet. Only a sender with `revealsCode` (the mock) lets the API echo the code.
 */
export interface SmsSender {
  readonly provider: string;
  readonly revealsCode: boolean;
  send(message: VerificationSms): Promise<void>;
}

export class SmsConfigurationError extends Error {}

/** Mock delivery for demos and offline work: nothing leaves the server; the code goes to the server log. */
export const mockSmsSender: SmsSender = {
  provider: 'mock', revealsCode: true,
  async send({ phoneNumber, code, ttlSeconds }) {
    console.info('sms_mock_sent', { phoneNumber, code, ttlSeconds });
  },
};

/**
 * Validates SMS_PROVIDER at startup. `mock` is refused when NODE_ENV=production so the demo switch cannot ship by
 * accident; a demo deployment that runs a production build on purpose says so with HESTIA_DEMO=1 (`pnpm demo:start`).
 * Unset means phone sign-in is unavailable until a provider adapter is installed.
 */
export function smsSenderFromEnv(env: NodeJS.ProcessEnv = process.env): SmsSender | null {
  const provider = env.SMS_PROVIDER?.trim() ?? '';
  if (provider === '') return null;
  if (provider !== 'mock') throw new SmsConfigurationError(`SMS_PROVIDER=${provider} has no adapter; only "mock" is available.`);
  if (env.NODE_ENV === 'production' && env.HESTIA_DEMO !== '1') throw new SmsConfigurationError('SMS_PROVIDER=mock is not allowed when NODE_ENV=production (set HESTIA_DEMO=1 for a demo deployment).');
  return mockSmsSender;
}

let current: SmsSender | null | undefined;
export function smsSender(): SmsSender | null {
  if (current === undefined) current = smsSenderFromEnv();
  return current;
}
/** Installs a provider adapter (or a test double). Refuses the mock in production like the env path. */
export function setSmsSender(sender: SmsSender | null) {
  if (sender?.revealsCode && process.env.NODE_ENV === 'production' && process.env.HESTIA_DEMO !== '1') throw new SmsConfigurationError('A code-revealing SMS sender is not allowed in production.');
  current = sender;
}
