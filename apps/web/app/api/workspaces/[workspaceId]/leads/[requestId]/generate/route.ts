import { generateLeadSchemes } from '../../../../../../../../../packages/finish-requests/src/service';
import { body, endpoint, principal, sameOrigin } from '../../../../../../../lib/server';
import { workspaceParams } from '../../../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Members (W03): confirm a queued drawing's imported floor plan; schemes are generated and published. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; requestId: string }> }) {
  return endpoint(async () => {
    await sameOrigin(request);
    const p = await workspaceParams(request, context.params);
    return { lead: await generateLeadSchemes(await principal(request), p.workspaceId, p.requestId, await body(request)) };
  });
}
