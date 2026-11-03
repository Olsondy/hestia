import { shareScene, shareSource } from '../../../../../../../../../packages/finish-requests/src/sharing';
import { auth } from '../../../../../../../../../packages/identity/src/auth';
import { endpoint } from '../../../../../../../lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Public scene snapshot behind a live share code (preview only). */
export async function GET(request: Request, context: { params: Promise<{ code: string; schemeId: string }> }) {
  return endpoint(async () => {
    const { code, schemeId } = await context.params, session = await auth.api.getSession({ headers: request.headers });
    return { scene: await shareScene(code, schemeId, shareSource(request.headers), session?.user.id ?? null) };
  });
}
