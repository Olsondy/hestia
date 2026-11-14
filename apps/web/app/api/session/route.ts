import { sessionFor } from '../../../../../packages/identity/src/session';
import { pool } from '../../../../../packages/persistence/src/client';
import { endpoint } from '../../../lib/server';
import { platformAdminOf } from '../../../../../packages/platform-admin/src/service';
import { adminHost } from '../../../../../packages/workspaces/src/domains';
import { authOrigin } from '../../../../../packages/identity/src/origins';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return endpoint(async () => {
    const session = await sessionFor(request.headers);
    if (!session) return { user: null };
    // Phone-verified customers have no e-mail; the client shows the masked number they signed in with.
    const phone = (await pool.query<{ phone_number: string | null }>('SELECT phone_number FROM hestia_auth_user WHERE id=$1', [session.user.id])).rows[0]?.phone_number ?? null;
    // ADR-0018: accounts with console rights get its address, so the workbench can link to model settings there.
    const host = adminHost(), level = host ? await platformAdminOf(session.user.id) : null;
    return { user: { id: session.user.id, name: session.user.name, email: session.user.email, phoneNumber: phone },
      ...(level && host ? { console: { level, origin: `${new URL(authOrigin).protocol}//${host}` } } : {}) };
  });
}
