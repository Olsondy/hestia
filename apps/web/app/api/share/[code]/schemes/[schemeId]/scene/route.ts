import { shareScene, shareSource } from '../../../../../../../../../packages/finish-requests/src/sharing';
import { sessionFor } from '../../../../../../../../../packages/identity/src/session';
import { endpoint } from '../../../../../../../lib/server';
import { shareScope } from '../../../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Public scene snapshot behind a live share code (preview only). */
export async function GET(request: Request, context: { params: Promise<{ code: string; schemeId: string }> }) {
  return endpoint(async () => {
    const { code, schemeId } = await context.params, session = await sessionFor(request.headers);
    return { scene: await shareScene(code, schemeId, shareSource(request.headers), session?.user.id ?? null, await shareScope(request)) };
  });
}
