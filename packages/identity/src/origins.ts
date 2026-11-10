import { DomainError } from '../../contracts/src/project';
import { enterpriseForHost, normalizeHost, requestHost } from '../../workspaces/src/domains';

// Browser origins allowed to call state-changing APIs: the configured BETTER_AUTH_URL, and on the shared deployment
// (ADR-0017) a registered entry domain when it is also the host the request was sent to.
export const authOrigin = new URL(process.env.BETTER_AUTH_URL!).origin;
const authProtocol = new URL(authOrigin).protocol;

export async function trustedOriginFor(headers: Headers): Promise<string | null> {
  const origin = headers.get('origin');
  if (!origin) return null;
  if (origin === authOrigin) return origin;
  let url: URL;
  try { url = new URL(origin); } catch { return null; }
  const host = normalizeHost(url.host);
  if (url.protocol !== authProtocol || !host || host !== requestHost(headers)) return null;
  return (await enterpriseForHost(host)) ? url.origin : null;
}

/** Phone sign-in names its customer entry in the body; on a registered domain it must be the domain's enterprise. */
export async function assertHostEntry(input: unknown, headers: Headers | undefined) {
  const host = headers ? await enterpriseForHost(requestHost(headers)) : null;
  const entry = input && typeof input === 'object' ? (input as { entry?: unknown }).entry : undefined;
  if (host && entry !== host) throw new DomainError('ENTRY_NOT_FOUND', '没有找到这个企业入口，请确认链接。', 404);
}
