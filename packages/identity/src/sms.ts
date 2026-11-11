import { tencentSmsSender, type TencentSmsConfig } from './sms-tencent';

/** A verification-code text message. `code` must never be logged or returned except by the mock sender. */
export type VerificationSms = { phoneNumber: string; code: string; ttlSeconds: number };

/**
 * SMS delivery adapter: `mock` or `tencent` (Tencent Cloud SMS, `sms-tencent.ts`), chosen by SMS_PROVIDER.
 * Only a sender with `revealsCode` (the mock) lets the API echo the code.
 */
export interface SmsSender {
  readonly provider: string;
  readonly revealsCode: boolean;
  send(message: VerificationSms): Promise<void>;
}

export class SmsConfigurationError extends Error {}

const TENCENT_REQUIRED = ['TENCENT_SMS_SECRET_ID', 'TENCENT_SMS_SECRET_KEY', 'TENCENT_SMS_SDK_APP_ID', 'TENCENT_SMS_SIGN_NAME', 'TENCENT_SMS_TEMPLATE_ID'] as const;

/** Reads and checks the Tencent Cloud SMS settings; every problem is reported at startup, not on the first send. */
export function tencentConfigFromEnv(env: NodeJS.ProcessEnv): TencentSmsConfig {
  const value = (name: string) => env[name]?.trim() ?? '';
  const missing = TENCENT_REQUIRED.filter(name => !value(name));
  if (missing.length) throw new SmsConfigurationError(`SMS_PROVIDER=tencent needs ${missing.join(', ')}.`);
  if (!/^\d+$/.test(value('TENCENT_SMS_SDK_APP_ID'))) throw new SmsConfigurationError('TENCENT_SMS_SDK_APP_ID must be the numeric SDK AppID.');
  if (!/^\d+$/.test(value('TENCENT_SMS_TEMPLATE_ID'))) throw new SmsConfigurationError('TENCENT_SMS_TEMPLATE_ID must be the numeric template ID.');
  const params = (value('TENCENT_SMS_TEMPLATE_PARAMS') || 'code').split(',').map(p => p.trim());
  if (!params.includes('code') || params.some(p => p !== 'code' && p !== 'minutes'))
    throw new SmsConfigurationError('TENCENT_SMS_TEMPLATE_PARAMS lists the template\'s {1},{2}… as "code" and "minutes", and must include code.');
  const timeoutMs = Number(value('TENCENT_SMS_TIMEOUT_MS') || 10_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) throw new SmsConfigurationError('TENCENT_SMS_TIMEOUT_MS must be 1000–60000.');
  const endpoint = value('TENCENT_SMS_ENDPOINT') || 'https://sms.tencentcloudapi.com';
  if (!endpoint.startsWith('https://')) throw new SmsConfigurationError('TENCENT_SMS_ENDPOINT must be https.');
  return { secretId: value('TENCENT_SMS_SECRET_ID'), secretKey: value('TENCENT_SMS_SECRET_KEY'), sdkAppId: value('TENCENT_SMS_SDK_APP_ID'),
    signName: value('TENCENT_SMS_SIGN_NAME'), templateId: value('TENCENT_SMS_TEMPLATE_ID'), region: value('TENCENT_SMS_REGION') || 'ap-guangzhou',
    endpoint, templateParams: params as TencentSmsConfig['templateParams'], timeoutMs };
}

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
 * Unset means phone sign-in is unavailable.
 */
export function smsSenderFromEnv(env: NodeJS.ProcessEnv = process.env): SmsSender | null {
  const provider = env.SMS_PROVIDER?.trim() ?? '';
  if (provider === '') return null;
  if (provider === 'tencent') return tencentSmsSender(tencentConfigFromEnv(env));
  if (provider !== 'mock') throw new SmsConfigurationError(`SMS_PROVIDER=${provider} has no adapter; use "tencent" or "mock".`);
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
