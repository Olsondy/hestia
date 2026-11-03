import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { advisoryXactLock, transaction } from '../../persistence/src/client';
import { hestiaAuthUser, phoneOtpChallenges as otp } from '../../persistence/src/schema';
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
/** Keyed hash of a secret value (share codes); not reversible without the server secret. */
export const keyedHash = (purpose: string, value: string) => hmac(`hestia:${purpose}:${value}`);
/** Request source for rate limits, from the trusted proxy header shared with phone codes; one bucket without it. */
export function requestSource(headers: Headers | null | undefined, purpose: string) {
  const header = otpConfig().sourceHeader, raw = header && headers ? headers.get(header)?.split(',')[0]?.trim() : undefined;
  return hmac(`hestia:${purpose}-source:${raw || 'shared'}`);
}
const now = sql`clock_timestamp()`, interval = (secs: number) => sql`make_interval(secs => ${secs})`;
const seconds = (value: number | string | null) => Math.max(1, Math.ceil(Number(value ?? 0)));

export type SendCodeResult = { sent: true; expiresInSeconds: number; resendAfterSeconds: number; maxAttempts: number; demoCode?: string };

/** Sends a new code to the phone number for the given customer entry, subject to cooldown and rate limits. */
export async function sendPhoneCode(input: unknown, headers: Headers): Promise<SendCodeResult> {
  const request = sendSchema.parse(input), phoneNumber = normalizePhone(request.phoneNumber);
  const sender = smsSender();
  if (!sender) throw new DomainError('SMS_UNAVAILABLE', '短信服务暂未开通，请稍后再试。', 503);
  const config = otpConfig(), source = sourceHash(headers, config);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0'), id = randomUUID();
  await transaction(async (client, tx) => {
    await customerEntry(client, request.entry);
    // Phone before source in every request, so concurrent sends never wait on each other in a cycle.
    await advisoryXactLock(tx, `hestia:otp:phone:${phoneNumber}`);
    await advisoryXactLock(tx, `hestia:otp:source:${source}`);
    const recent = async (column: typeof otp.phoneNumber | typeof otp.sourceHash, value: string) => (await tx.select({
      n: sql<number>`count(*)::int`,
      cooldown: sql<string | null>`extract(epoch FROM max(${otp.createdAt}) + ${interval(config.resendSeconds)} - clock_timestamp())`,
      reset: sql<string | null>`extract(epoch FROM min(${otp.createdAt}) + ${interval(config.windowSeconds)} - clock_timestamp())`,
    }).from(otp).where(and(eq(column, value), gt(otp.createdAt, sql`clock_timestamp() - ${interval(config.windowSeconds)}`))))[0];
    const byPhone = await recent(otp.phoneNumber, phoneNumber);
    if (byPhone.n > 0 && Number(byPhone.cooldown) > 0)
      throw new DomainError('OTP_COOLDOWN', '验证码已发送，请稍后再重新获取。', 429, { retryAfterSeconds: seconds(byPhone.cooldown) });
    if (byPhone.n >= config.perPhone)
      throw new DomainError('OTP_RATE_LIMITED', '获取验证码过于频繁，请稍后再试。', 429, { scope: 'phone', retryAfterSeconds: seconds(byPhone.reset) });
    const bySource = await recent(otp.sourceHash, source);
    if (bySource.n >= config.perSource)
      throw new DomainError('OTP_RATE_LIMITED', '获取验证码过于频繁，请稍后再试。', 429, { scope: 'source', retryAfterSeconds: seconds(bySource.reset) });
    await tx.update(otp).set({ supersededAt: now }).where(and(eq(otp.phoneNumber, phoneNumber), isNull(otp.consumedAt), isNull(otp.supersededAt)));
    await tx.insert(otp).values({ id, phoneNumber, sourceHash: source, codeHash: codeHash(id, code), maxAttempts: config.maxAttempts,
      expiresAt: sql`clock_timestamp() + ${interval(config.ttlSeconds)}` });
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
  const outcome = await transaction(async (client, tx) => {
    const entry = await customerEntry(client, request.entry);
    await advisoryXactLock(tx, `hestia:otp:phone:${phoneNumber}`);
    const [challenge] = await tx.select({ id: otp.id, codeHash: otp.codeHash, attempts: otp.attempts, maxAttempts: otp.maxAttempts, expired: sql<boolean>`${otp.expiresAt} <= clock_timestamp()` })
      .from(otp).where(and(eq(otp.phoneNumber, phoneNumber), isNull(otp.consumedAt), isNull(otp.supersededAt))).orderBy(desc(otp.createdAt)).limit(1).for('update');
    if (!challenge) return new DomainError('OTP_NOT_REQUESTED', '请先获取验证码。', 400);
    if (challenge.expired) return new DomainError('OTP_EXPIRED', '验证码已过期，请重新获取。', 400);
    if (challenge.attempts >= challenge.maxAttempts) return new DomainError('OTP_LOCKED', '错误次数过多，此验证码已失效，请重新获取。', 429);
    const expected = Buffer.from(challenge.codeHash, 'hex'), actual = Buffer.from(codeHash(challenge.id, request.code), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      const [{ attempts }] = await tx.update(otp).set({ attempts: sql`${otp.attempts}+1` }).where(eq(otp.id, challenge.id)).returning({ attempts: otp.attempts });
      const attemptsRemaining = challenge.maxAttempts - attempts;
      return attemptsRemaining > 0
        ? new DomainError('OTP_INVALID', '验证码不正确。', 400, { attemptsRemaining })
        : new DomainError('OTP_LOCKED', '错误次数过多，此验证码已失效，请重新获取。', 429);
    }
    await tx.update(otp).set({ consumedAt: now }).where(eq(otp.id, challenge.id));
    await tx.insert(hestiaAuthUser).values({ id: randomUUID(), name: `手机用户 ${phoneNumber.slice(-4)}`, phoneNumber })
      .onConflictDoNothing({ target: hestiaAuthUser.phoneNumber, where: sql`${hestiaAuthUser.phoneNumber} IS NOT NULL` });
    const [{ id: userId }] = await tx.select({ id: hestiaAuthUser.id }).from(hestiaAuthUser).where(eq(hestiaAuthUser.phoneNumber, phoneNumber));
    const customer = await ensureCustomer(client, entry.id, userId);
    return { userId, phoneNumber, entry: { slug: entry.slug, name: entry.name }, customer };
  });
  if (outcome instanceof DomainError) throw outcome;
  return outcome;
}
