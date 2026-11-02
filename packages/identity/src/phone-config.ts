/** Limits for phone verification codes. Every value is configurable through the environment. */
export type OtpConfig = {
  ttlSeconds: number; maxAttempts: number; resendSeconds: number; windowSeconds: number;
  perPhone: number; perSource: number; sourceHeader: string | null;
};
const positive = (env: NodeJS.ProcessEnv, name: string, fallback: number) => {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 1_000_000) throw new Error(`${name} must be a positive integer.`);
  return value;
};
/** Read on every request so a deployment changes limits without code; validated once at startup too. */
export function otpConfig(env: NodeJS.ProcessEnv = process.env): OtpConfig {
  const header = env.HESTIA_OTP_SOURCE_HEADER?.trim().toLowerCase();
  return {
    ttlSeconds: positive(env, 'HESTIA_OTP_TTL_SECONDS', 300),
    maxAttempts: positive(env, 'HESTIA_OTP_MAX_ATTEMPTS', 5),
    resendSeconds: positive(env, 'HESTIA_OTP_RESEND_SECONDS', 60),
    windowSeconds: positive(env, 'HESTIA_OTP_RATE_WINDOW_SECONDS', 3600),
    perPhone: positive(env, 'HESTIA_OTP_MAX_PER_PHONE', 5),
    perSource: positive(env, 'HESTIA_OTP_MAX_PER_SOURCE', 20),
    // Only a header set by a trusted proxy identifies the source. Without one, all requests share one bucket.
    sourceHeader: header ? header : null,
  };
}
