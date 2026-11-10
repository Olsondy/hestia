import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { z, ZodError } from 'zod';
import { pool } from '../../persistence/src/client';
import { DomainError } from '../../contracts/src/project';
import * as schema from './schema';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { register, registrationSchema } from './registration';
import { sendPhoneCode, verifyPhoneCode } from './phone';
import { otpConfig } from './phone-config';
import { smsSender } from './sms';
import { assertHostEntry, authOrigin, trustedOriginFor } from './origins';

if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
if (!process.env.BETTER_AUTH_URL) throw new Error('BETTER_AUTH_URL is required.');
export { authOrigin } from './origins';
// Fail at startup, not on the first request: refuses SMS_PROVIDER=mock in production and invalid OTP limits.
smsSender(); otpConfig();

/** Application errors keep the `{error:{code,message,details}}` shape used by every other Hestia API. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof ZodError) throw new APIError(400, { error: { code: 'INVALID_INPUT', message: '输入格式不正确。' } }, {}, 400);
    if (error instanceof DomainError) throw new APIError(error.status as ConstructorParameters<typeof APIError>[0], { error: { code: error.code, message: error.message, details: error.details } }, {}, error.status);
    throw error;
  }
}
const anyBody = z.record(z.string(), z.unknown());

export const auth = betterAuth({
  appName: 'Hestia', baseURL: process.env.BETTER_AUTH_URL, secret: process.env.BETTER_AUTH_SECRET,
  // Registered entry domains are trusted only for requests sent to that same host (ADR-0017).
  trustedOrigins: async request => [authOrigin, request ? await trustedOriginFor(request.headers) : null],
  database: drizzleAdapter(drizzle(pool, { schema }), { provider: 'pg', schema, transaction: true }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8, maxPasswordLength: 128,
    requireEmailVerification: false },
  // The framework owns the HTTP pipeline, rate limiting and sessions. These endpoints retain the application's
  // own transactions: atomic registration/credits, and phone codes stored as HMACs with per-phone/per-source limits
  // (the official phone-number plugin stores plaintext codes and cannot echo a mock code or bind an entry).
  plugins: [{ id: 'hestia-registration', endpoints: {
    hestiaRegistration: createAuthEndpoint('/register', { method: 'POST', body: registrationSchema },
      async context => context.json(await guarded(() => register(context.body)), { status: 201 })),
    hestiaPhoneSendCode: createAuthEndpoint('/phone/send-code', { method: 'POST', body: anyBody },
      async context => context.json(await guarded(async () => { await assertHostEntry(context.body, context.headers); return sendPhoneCode(context.body, context.headers ?? new Headers()); }))),
    hestiaPhoneSignIn: createAuthEndpoint('/phone/sign-in', { method: 'POST', body: anyBody }, async context => {
      const result = await guarded(async () => { await assertHostEntry(context.body, context.headers); return verifyPhoneCode(context.body); });
      const session = await context.context.internalAdapter.createSession(result.userId);
      const user = await context.context.internalAdapter.findUserById(result.userId);
      if (!session || !user) throw new APIError(500, { error: { code: 'INTERNAL_ERROR', message: '暂时无法完成请求，请稍后重试。' } }, {}, 500);
      await setSessionCookie(context, { session, user });
      return context.json({ user: { id: result.userId, phoneNumber: result.phoneNumber }, entry: result.entry, customer: result.customer });
    }),
  } }],
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
  // Coarse framework limits only; verification-code limits are enforced per phone number and source in phone.ts.
  rateLimit: { enabled: true, window: 60, max: 100, customRules: { '/sign-in/email': { window: 60, max: 10 }, '/register': { window: 60, max: 20 },
    '/phone/send-code': { window: 60, max: 30 }, '/phone/sign-in': { window: 60, max: 30 } } },
});
