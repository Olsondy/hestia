import { auth } from '../../../../../packages/identity/src/auth';
import { endpoint } from '../../../lib/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return endpoint(async () => {
    const session = await auth.api.getSession({ headers: request.headers });
    return { user: session ? { id: session.user.id, name: session.user.name, email: session.user.email } : null };
  });
}
