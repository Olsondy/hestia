import { DomainError } from '../../contracts/src/project';
import { sessionFor } from '../../identity/src/session';
import { isAdminRequest } from './host';
import { platformAdminOf, type AdminLevel } from './service';

export type PlatformAdmin = { userId: string; name: string; email: string; level: AdminLevel };

/** Every /api/admin handler starts here. Off the admin host the console does not exist; the role is checked on the server. */
export async function requirePlatformAdmin(headers: Headers): Promise<PlatformAdmin> {
  if (!isAdminRequest(headers)) throw new DomainError('NOT_FOUND', '页面不存在。', 404);
  const session = await sessionFor(headers);
  if (!session) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  const level = await platformAdminOf(session.user.id);
  if (!level) throw new DomainError('FORBIDDEN', '这个账号不是平台管理员。', 403);
  return { userId: session.user.id, name: session.user.name, email: session.user.email ?? '', level };
}
