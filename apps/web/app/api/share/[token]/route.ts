import { sharePreview } from '../../../../../../packages/finish-requests/src/sharing';
import { auth } from '../../../../../../packages/identity/src/auth';
import { endpoint } from '../../../../lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Public preview; a signed-in visitor also learns whether the request is bound to them or they applied. */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  return endpoint(async () => {
    const p = await context.params, session = await auth.api.getSession({ headers: request.headers });
    return { preview: await sharePreview(p.token, session?.user.id ?? null) };
  });
}
