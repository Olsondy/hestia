import { readLeadScene } from '../../../../../../../../../../../packages/finish-requests/src/service';
import { endpoint, principal } from '../../../../../../../../../lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Members only: scene snapshot of a scheme's current still. */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; requestId: string; schemeId: string }> }) {
  return endpoint(async () => {
    const p = await context.params;
    return { scene: await readLeadScene(await principal(request), p.workspaceId, p.requestId, p.schemeId) };
  });
}
