import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from '../../persistence/src/client';
import * as schema from './schema';
import { createAuthEndpoint } from 'better-auth/api';
import { register, registrationSchema } from './registration';

if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
if (!process.env.BETTER_AUTH_URL) throw new Error('BETTER_AUTH_URL is required.');
export const authOrigin = new URL(process.env.BETTER_AUTH_URL).origin;

export const auth = betterAuth({
  appName: 'Hestia', baseURL: process.env.BETTER_AUTH_URL, secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [authOrigin],
  database: drizzleAdapter(drizzle(pool, { schema }), { provider: 'pg', schema, transaction: true }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8, maxPasswordLength: 128,
    requireEmailVerification: false },
  // The framework owns the HTTP pipeline and rate limiting. This endpoint retains the
  // application's atomic identity/credits transaction instead of framework sign-up.
  plugins: [{ id: 'hestia-registration', endpoints: { hestiaRegistration: createAuthEndpoint('/register',
    { method: 'POST', body: registrationSchema }, async context => context.json(await register(context.body), { status: 201 })) } }],
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
  rateLimit: { enabled: true, window: 60, max: 100, customRules: { '/sign-in/email': { window: 60, max: 10 }, '/register': { window: 60, max: 20 } } },
});
