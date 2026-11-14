import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// API keys at rest (ADR-0018): AES-256-GCM under HESTIA_SECRET_KEY (32 bytes, base64 or 64 hex characters).
// Losing the master key means every stored key has to be entered again; there is no recovery path by design.
const version = 'v1';

function masterKey(): Buffer {
  const raw = process.env.HESTIA_SECRET_KEY?.trim();
  if (!raw) throw new Error('HESTIA_SECRET_KEY_MISSING');
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('HESTIA_SECRET_KEY_INVALID');
  return key;
}

/** Fails fast at startup when the master key is missing or malformed. */
export function assertSecretKey() { masterKey(); }

export function sealSecret(plain: string): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [version, iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

export function openSecret(sealed: string): string {
  const [tag, iv, auth, body] = sealed.split('.');
  if (tag !== version || !iv || !auth || !body) throw new Error('SECRET_FORMAT_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(auth, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
}

export const keyTail = (plain: string) => plain.slice(-4);
