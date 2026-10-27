import { createHash } from 'node:crypto';
import { auth, authOrigin } from '../../identity/src/auth';
import { DomainError } from '../../contracts/src/project';

// This capability is never constructed from model/tool parameters or serialized into a tool result.
// Only the browser's authenticated same-origin request can mint it; a structural lookalike is rejected.
export type BrowserUser = { readonly userId: string; readonly sessionHash: string };
const capabilities = new WeakSet<object>();
export async function browserUser(request: Request): Promise<BrowserUser> {
  if (request.headers.get('origin') !== authOrigin) throw new DomainError('ORIGIN_REJECTED', '请从应用页面选择方案。', 403);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  const user = Object.freeze({ userId: session.user.id, sessionHash: createHash('sha256').update(session.session.id).digest('hex') });
  capabilities.add(user);
  return user;
}
export function assertBrowserUser(user: BrowserUser) {
  if (!user || !capabilities.has(user)) throw new DomainError('USER_SELECTION_REQUIRED', '采用需要用户在已展示的方案上明确选择。', 403);
}
