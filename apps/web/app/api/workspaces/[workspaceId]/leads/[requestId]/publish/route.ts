import { publishFinishRequest } from '../../../../../../../../../packages/finish-requests/src/service';
import { body, endpoint, principal, sameOrigin } from '../../../../../../../lib/server';
import { workspaceParams } from '../../../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; requestId: string }> }) {
  return endpoint(async () => {
    await sameOrigin(request);
    const { workspaceId, requestId } = await workspaceParams(request, context.params);
    return { lead: await publishFinishRequest(await principal(request), workspaceId, requestId, await body(request)) };
  });
}
