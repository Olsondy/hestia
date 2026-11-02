import { shareScene } from '../../../../../../../../../packages/finish-requests/src/sharing';
import { endpoint } from '../../../../../../../lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Public scene snapshot behind a live share link (preview only). */
export async function GET(_request: Request, context: { params: Promise<{ token: string; schemeId: string }> }) {
  return endpoint(async () => {
    const { token, schemeId } = await context.params;
    return { scene: await shareScene(token, schemeId) };
  });
}
