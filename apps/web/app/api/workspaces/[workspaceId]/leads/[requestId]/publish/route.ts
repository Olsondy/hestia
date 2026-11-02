import { publishFinishRequest } from '../../../../../../../../../packages/finish-requests/src/service';
import { body, endpoint, principal, sameOrigin } from '../../../../../../../lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; requestId: string }> }) {
  return endpoint(async () => {
    sameOrigin(request);
    const { workspaceId, requestId } = await context.params;
    return { lead: await publishFinishRequest(await principal(request), workspaceId, requestId, await body(request)) };
  });
}
