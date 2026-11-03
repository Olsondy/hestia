// Share codes (ADR-0012): 8 characters from an alphabet without 0/O, 1/I/L, shown as XXXX-XXXX. Shared by server and H5.
export const SHARE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SHARE_CODE_LENGTH = 8;
const valid = new RegExp(`^[${SHARE_CODE_ALPHABET}]{${SHARE_CODE_LENGTH}}$`);

/** Canonical form (upper case, no separators) or null when the input is not a share code. */
export function normalizeShareCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 40) return null;
  const code = input.toUpperCase().replace(/[\s\-_·]/g, '');
  return valid.test(code) ? code : null;
}
export const formatShareCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/**
 * The share code inside pasted text: the code after「分享码」in a share message, or the whole text when it is only a code.
 * Anything else (links, other numbers) is ignored so a clipboard with unrelated text never prompts.
 */
export function findShareCode(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const tagged = /分享码[\s:：]*([A-Za-z0-9]{4}[\s-]?[A-Za-z0-9]{4})(?![A-Za-z0-9])/.exec(text);
  if (tagged) return normalizeShareCode(tagged[1]);
  return text.trim().length <= 12 ? normalizeShareCode(text.trim()) : null;
}

/** Message a member copies to the customer. Only the code matters; the words are for people. */
export const shareMessage = (workspaceName: string, code: string) =>
  `【${workspaceName}】方案分享码 ${formatShareCode(code)}，在企业的小程序或 H5 首页输入即可查看。`;
