import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { transaction } from '../../persistence/src/client';
import { DomainError } from '../../contracts/src/project';
import { customerEntry, ensureCustomer } from '../../workspaces/src/customers';
import { smsSender } from './sms';
import { otpConfig, type OtpConfig } from './phone-config';

const phoneSchema = z.string().max(32).transform((value, context) => {
  const digits = value.replace(/[\s-]/g, '').replace(/^(\+86|0086|86)(?=1\d{10}$)/, '');
  if (!/^1[3-9]\d{9}$/.test(digits)) { context.addIssue({ code: 'custom', message: 'INVALID_PHONE' }); return z.NEVER; }
  return `+86${digits}`;
});
const sendSchema = z.object({ phoneNumber: z.string(), entry: z.string().max(64) }).strict();
const signInSchema = z.object({ phoneNumber: z.string(), entry: z.string().max(64), code: z.string().regex(/^\d{6}$/) }).strict();

export function normalizePhone(value: string) {
  const parsed = phoneSchema.safeParse(value);
  if (!parsed.success) throw new DomainError('INVALID_PHONE', '请输入 11 位中国大陆手机号。', 400);
  return parsed.data;
}
const secret = () => process.env.BETTER_AUTH_SECRET!;
const hmac = (value: string) => createHmac('sha256', secret()).update(value).digest('hex');
const codeHash = (challengeId: string, code: string) => hmac(`hestia:otp:${challengeId}:${code}`);
function sourceHash(headers: Headers, config: OtpConfig) {
  const raw = config.sourceHeader ? headers.get(config.sourceHeader)?.split(',')[0]?.trim() : undefined;
  return hmac(`hestia:otp-source:${raw || 'shared'}`);
}
const seconds = (value: number | string | null) => Math.max(1, Math.ceil(Number(value ?? 0)));

export type SendCodeResult = { sent: true; expiresInSeconds: number; resendAfterSeconds: number; maxAttempts: number; demoCode?: string };

/** Sends a new code to the phone number for the given customer entry, subject to cooldown and rate limits. */
export async function sendPhoneCode(input: unknown, headers: Headers): Promise<SendCodeResult> {
  const request = sendSchema.parse(input), phoneNumber = normalizePhone(request.phoneNumber);
  const sender = smsSender();
  if (!sender) throw new DomainError('SMS_UNAVAILABLE', '短信服务暂未开通，请稍后再试。', 503);
  const config = otpConfig(), source = sourceHash(headers, config);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0'), id = randomUUID();
  await transaction(async client => {
    await customerEntry(client, request.entry);
    // Phone before source in every request, so concurrent sends never wait on each other in a cycle.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hestia:otp:phone:${phoneNumber}`]);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hestia:otp:source:${source}`]);
    const recent = async (column: 'phone_number' | 'source_hash', value: string) => (await client.query<{ n: number; cooldown: string | null; reset: string | null }>(
      `SELECT count(*)::int AS n,
        extract(epoch FROM max(created_at) + make_interval(secs => $3) - clock_timestamp()) AS cooldown,
        extract(epoch FROM min(created_at) + make_interval(secs => $2) - clock_timestamp()) AS reset
      FROM phone_otp_challenges WHERE ${column}=$1 AND created_at > clock_timestamp() - make_interval(secs => $2)`,
      [value, config.windowSeconds, config.resendSeconds])).rows[0];
    const byPhone = await recent('phone_number', phoneNumber);
    if (byPhone.n > 0 && Number(byPhone.cooldown) > 0)
      throw new DomainError('OTP_COOLDOWN', '验证码已发送，请稍后再重新获取。', 429, { retryAfterSeconds: seconds(byPhone.cooldown) });
    if (byPhone.n >= config.perPhone)
      throw new DomainError('OTP_RATE_LIMITED', '获取验证码过于频繁，请稍后再试。', 429, { scope: 'phone', retryAfterSeconds: seconds(byPhone.reset) });
    const bySource = await recent('source_hash', source);
    if (bySource.n >= config.perSource)
      throw new DomainError('OTP_RATE_LIMITED', '获取验证码过于频繁，请稍后再试。', 429, { scope: 'source', retryAfterSeconds: seconds(bySource.reset) });
    await client.query('UPDATE phone_otp_challenges SET superseded_at=clock_timestamp() WHERE phone_number=$1 AND consumed_at IS NULL AND superseded_at IS NULL', [phoneNumber]);
    await client.query(`INSERT INTO phone_otp_challenges(id,phone_number,source_hash,code_hash,max_attempts,expires_at)
      VALUES($1,$2,$3,$4,$5,clock_timestamp() + make_interval(secs => $6))`, [id, phoneNumber, source, codeHash(id, code), config.maxAttempts, config.ttlSeconds]);
  });
  // The send is recorded (and counts toward limits) even if delivery then fails.
  try { await sender.send({ phoneNumber, code, ttlSeconds: config.ttlSeconds }); }
  catch (error) {
    console.error('sms_send_failed', { provider: sender.provider, type: error instanceof Error ? error.name : 'unknown' });
    throw new DomainError('SMS_SEND_FAILED', '短信发送失败，请稍后重试。', 502);
  }
  return { sent: true, expiresInSeconds: config.ttlSeconds, resendAfterSeconds: config.resendSeconds, maxAttempts: config.maxAttempts,
    ...(sender.revealsCode ? { demoCode: code } : {}) };
}

export type PhoneSignIn = { userId: string; phoneNumber: string; entry: { slug: string; name: string }; customer: { created: boolean } };

/**
 * Verifies the newest code for the number. A wrong code spends one attempt (committed even though the
 * request fails); success consumes the code, finds or creates the single account for the number, and
 * records the customer relation for the entry. Session creation is left to the caller (Better Auth).
 */
export async function verifyPhoneCode(input: unknown): Promise<PhoneSignIn> {
  const request = signInSchema.parse(input), phoneNumber = normalizePhone(request.phoneNumber);
  const outcome = await transaction(async client => {
    const entry = await customerEntry(client, request.entry);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hestia:otp:phone:${phoneNumber}`]);
    const challenge = (await client.query<{ id: string; code_hash: string; attempts: number; max_attempts: number; expired: boolean }>(
      `SELECT id,code_hash,attempts,max_attempts,expires_at<=clock_timestamp() AS expired FROM phone_otp_challenges
       WHERE phone_number=$1 AND consumed_at IS NULL AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [phoneNumber])).rows[0];
    if (!challenge) return new DomainError('OTP_NOT_REQUESTED', '请先获取验证码。', 400);
    if (challenge.expired) return new DomainError('OTP_EXPIRED', '验证码已过期，请重新获取。', 400);
    if (challenge.attempts >= challenge.max_attempts) return new DomainError('OTP_LOCKED', '错误次数过多，此验证码已失效，请重新获取。', 429);
    const expected = Buffer.from(challenge.code_hash, 'hex'), actual = Buffer.from(codeHash(challenge.id, request.code), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      const attempts = (await client.query<{ attempts: number }>('UPDATE phone_otp_challenges SET attempts=attempts+1 WHERE id=$1 RETURNING attempts', [challenge.id])).rows[0].attempts;
      const attemptsRemaining = challenge.max_attempts - attempts;
      return attemptsRemaining > 0
        ? new DomainError('OTP_INVALID', '验证码不正确。', 400, { attemptsRemaining })
        : new DomainError('OTP_LOCKED', '错误次数过多，此验证码已失效，请重新获取。', 429);
    }
    await client.query('UPDATE phone_otp_challenges SET consumed_at=clock_timestamp() WHERE id=$1', [challenge.id]);
    await client.query(`INSERT INTO hestia_auth_user(id,name,phone_number) VALUES($1,$2,$3)
      ON CONFLICT (phone_number) WHERE phone_number IS NOT NULL DO NOTHING`, [randomUUID(), `手机用户 ${phoneNumber.slice(-4)}`, phoneNumber]);
    const userId = (await client.query<{ id: string }>('SELECT id FROM hestia_auth_user WHERE phone_number=$1', [phoneNumber])).rows[0].id;
    const customer = await ensureCustomer(client, entry.id, userId);
    return { userId, phoneNumber, entry: { slug: entry.slug, name: entry.name }, customer };
  });
  if (outcome instanceof DomainError) throw outcome;
  return outcome;
}
