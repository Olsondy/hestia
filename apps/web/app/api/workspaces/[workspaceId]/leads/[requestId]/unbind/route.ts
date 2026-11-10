import { unbindCustomer } from '../../../../../../../../../packages/finish-requests/src/sharing';
import { body, endpoint, principal, sameOrigin } from '../../../../../../../../../apps/web/lib/server';
import { workspaceParams } from '../../../../../../../../../apps/web/lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; requestId: string }> }) {
  return endpoint(async () => {
    await sameOrigin(request);
    const p = await workspaceParams(request, context.params);
    return { lead: await unbindCustomer(await principal(request), p.workspaceId, p.requestId, await body(request)) };
  });
}
