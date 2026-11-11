import { createHash, createHmac } from 'node:crypto';
import type { SmsSender, VerificationSms } from './sms';

// Tencent Cloud SMS (SendSms, API 2021-01-11) with TC3-HMAC-SHA256 request signing. No SDK: one signed POST.
// The template is the approved verification-code template; its parameters are filled from TENCENT_SMS_TEMPLATE_PARAMS.

export type TencentSmsConfig = {
  secretId: string; secretKey: string; sdkAppId: string; signName: string; templateId: string;
  region: string; endpoint: string; templateParams: ('code' | 'minutes')[]; timeoutMs: number;
};

/** A failed send. `providerCode` is Tencent's error or status code (never contains the verification code). */
export class TencentSmsError extends Error {
  override name = 'TencentSmsError';
  constructor(readonly providerCode: string, message: string) { super(message); }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest();

type Tc3Input = { secretId: string; secretKey: string; service: string; host: string; action: string; version: string;
  region?: string; payload: string; timestamp: number };
const CONTENT_TYPE = 'application/json; charset=utf-8', SIGNED_HEADERS = 'content-type;host;x-tc-action';

/** The key-independent half of TC3 signing; exported so the documentation's worked example can be checked. */
export function tc3StringToSign({ service, host, action, payload, timestamp }: Omit<Tc3Input, 'secretId' | 'secretKey' | 'version'>) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10), scope = `${date}/${service}/tc3_request`;
  const canonical = ['POST', '/', '', `content-type:${CONTENT_TYPE}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`, SIGNED_HEADERS, sha256(payload)].join('\n');
  return { date, scope, canonical, stringToSign: ['TC3-HMAC-SHA256', String(timestamp), scope, sha256(canonical)].join('\n') };
}

/** Signs one Tencent Cloud API v3 request; returns the headers to send. */
export function tc3Headers(input: Tc3Input): Record<string, string> {
  const { date, scope, stringToSign } = tc3StringToSign(input);
  const key = hmac(hmac(hmac(`TC3${input.secretKey}`, date), input.service), 'tc3_request');
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex');
  return {
    Authorization: `TC3-HMAC-SHA256 Credential=${input.secretId}/${scope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`,
    'Content-Type': CONTENT_TYPE, Host: input.host, 'X-TC-Action': input.action, 'X-TC-Version': input.version, 'X-TC-Timestamp': String(input.timestamp),
    ...(input.region ? { 'X-TC-Region': input.region } : {}),
  };
}

type SendSmsResponse = { Response: { Error?: { Code: string; Message: string }; RequestId?: string;
  SendStatusSet?: { Code: string; Message: string; PhoneNumber: string }[] } };

export function tencentSmsSender(config: TencentSmsConfig, fetchImpl: typeof fetch = fetch): SmsSender {
  const host = new URL(config.endpoint).host;
  return {
    provider: 'tencent', revealsCode: false,
    async send({ phoneNumber, code, ttlSeconds }: VerificationSms) {
      const minutes = String(Math.max(1, Math.round(ttlSeconds / 60)));
      const payload = JSON.stringify({ PhoneNumberSet: [phoneNumber], SmsSdkAppId: config.sdkAppId, SignName: config.signName,
        TemplateId: config.templateId, TemplateParamSet: config.templateParams.map(p => (p === 'code' ? code : minutes)) });
      const headers = tc3Headers({ secretId: config.secretId, secretKey: config.secretKey, service: 'sms', host, action: 'SendSms',
        version: '2021-01-11', region: config.region, payload, timestamp: Math.floor(Date.now() / 1000) });
      let response: Response;
      try { response = await fetchImpl(config.endpoint, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(config.timeoutMs) }); }
      catch (error) { throw new TencentSmsError(error instanceof Error && error.name === 'TimeoutError' ? 'Timeout' : 'NetworkError', 'Tencent SMS request failed.'); }
      const body = await response.json().catch(() => null) as SendSmsResponse | null;
      const result = body?.Response;
      if (!response.ok || !result) throw new TencentSmsError(`HTTP${response.status}`, 'Tencent SMS answered without a result.');
      if (result.Error) throw new TencentSmsError(result.Error.Code, result.Error.Message);
      const status = result.SendStatusSet?.[0];
      if (!status) throw new TencentSmsError('NoStatus', 'Tencent SMS returned no send status.');
      if (status.Code !== 'Ok') throw new TencentSmsError(status.Code, status.Message);
    },
  };
}
