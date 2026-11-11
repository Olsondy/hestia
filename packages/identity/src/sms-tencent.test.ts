import test from 'node:test';
import assert from 'node:assert/strict';
import { tc3Headers, tc3StringToSign, tencentSmsSender, type TencentSmsConfig } from './sms-tencent';
import { SmsConfigurationError, smsSenderFromEnv } from './sms';

// The worked example of Tencent Cloud's "签名方法 v3" page (cloud.tencent.com/document/api/382/52072). The page masks the
// example key, so the key-independent half is checked against it; the HMAC chain on top is the documented one.
test('builds the canonical request and string to sign exactly like the Tencent Cloud documentation example', () => {
  const { canonical, stringToSign } = tc3StringToSign({ service: 'cvm', host: 'cvm.tencentcloudapi.com', action: 'DescribeInstances', timestamp: 1551113065,
    payload: '{"Limit": 1, "Filters": [{"Values": ["\\u672a\\u547d\\u540d"], "Name": "instance-name"}]}' });
  assert.equal(canonical, 'POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:cvm.tencentcloudapi.com\nx-tc-action:describeinstances\n\n'
    + 'content-type;host;x-tc-action\n35e9c5b0e3ae67532d3c9f17ead6c90222632e5b1ff7f6e89887f1398934f064');
  assert.equal(stringToSign, 'TC3-HMAC-SHA256\n1551113065\n2019-02-25/cvm/tc3_request\n7019a55be8395899b900fb5564e4200d984910f34794a27cb3fb7d10ff6a1e84');
  const headers = tc3Headers({ secretId: 'AKIDsynthetic', secretKey: 'synthetic', service: 'sms', host: 'sms.tencentcloudapi.com', action: 'SendSms',
    version: '2021-01-11', payload: '{}', timestamp: 1551113065 });
  assert.match(headers.Authorization, /^TC3-HMAC-SHA256 Credential=AKIDsynthetic\/2019-02-25\/sms\/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=[0-9a-f]{64}$/);
});

const config: TencentSmsConfig = { secretId: 'id', secretKey: 'key', sdkAppId: '1400000000', signName: '合成签名', templateId: '100001',
  region: 'ap-guangzhou', endpoint: 'https://sms.tencentcloudapi.com', templateParams: ['code', 'minutes'], timeoutMs: 1000 };
const answering = (body: unknown, status = 200, seen: { init?: RequestInit } = {}) =>
  (async (_url: unknown, init?: RequestInit) => { seen.init = init; return new Response(JSON.stringify(body), { status }); }) as typeof fetch;

test('sends one SendSms with the code and lifetime as template parameters', async () => {
  const seen: { init?: RequestInit } = {};
  await tencentSmsSender(config, answering({ Response: { SendStatusSet: [{ Code: 'Ok', Message: 'send success', PhoneNumber: '+8613900139000' }] } }, 200, seen))
    .send({ phoneNumber: '+8613900139000', code: '042137', ttlSeconds: 300 });
  const headers = seen.init!.headers as Record<string, string>;
  assert.equal(headers['X-TC-Action'], 'SendSms'); assert.equal(headers['X-TC-Version'], '2021-01-11'); assert.equal(headers['X-TC-Region'], 'ap-guangzhou');
  assert.deepEqual(JSON.parse(seen.init!.body as string), { PhoneNumberSet: ['+8613900139000'], SmsSdkAppId: '1400000000', SignName: '合成签名',
    TemplateId: '100001', TemplateParamSet: ['042137', '5'] });
});

test('an API error or a refused number fails the send with Tencent\'s code', async () => {
  const sms = { phoneNumber: '+8613900139000', code: '042137', ttlSeconds: 300 };
  await assert.rejects(tencentSmsSender(config, answering({ Response: { Error: { Code: 'AuthFailure.SignatureFailure', Message: 'x' } } })).send(sms),
    { name: 'TencentSmsError', providerCode: 'AuthFailure.SignatureFailure' });
  await assert.rejects(tencentSmsSender(config, answering({ Response: { SendStatusSet: [{ Code: 'LimitExceeded.PhoneNumberDailyLimit', Message: 'x', PhoneNumber: '' }] } })).send(sms),
    { providerCode: 'LimitExceeded.PhoneNumberDailyLimit' });
  await assert.rejects(tencentSmsSender(config, answering('bad gateway', 502)).send(sms), { providerCode: 'HTTP502' });
  const offline = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
  await assert.rejects(tencentSmsSender(config, offline).send(sms), { providerCode: 'NetworkError' });
});

test('SMS_PROVIDER=tencent refuses to start without its settings and never reveals the code', () => {
  assert.throws(() => smsSenderFromEnv({ SMS_PROVIDER: 'tencent', TENCENT_SMS_SECRET_ID: 'id' } as NodeJS.ProcessEnv),
    (e: Error) => e instanceof SmsConfigurationError && e.message.includes('TENCENT_SMS_SECRET_KEY') && !e.message.includes('TENCENT_SMS_SECRET_ID,'));
  const env = { SMS_PROVIDER: 'tencent', NODE_ENV: 'production', TENCENT_SMS_SECRET_ID: 'id', TENCENT_SMS_SECRET_KEY: 'key',
    TENCENT_SMS_SDK_APP_ID: '1400000000', TENCENT_SMS_SIGN_NAME: '合成签名', TENCENT_SMS_TEMPLATE_ID: '100001' } as NodeJS.ProcessEnv;
  const sender = smsSenderFromEnv(env)!;
  assert.equal(sender.provider, 'tencent'); assert.equal(sender.revealsCode, false);
  assert.throws(() => smsSenderFromEnv({ ...env, TENCENT_SMS_TEMPLATE_PARAMS: 'minutes' }), SmsConfigurationError);
});
