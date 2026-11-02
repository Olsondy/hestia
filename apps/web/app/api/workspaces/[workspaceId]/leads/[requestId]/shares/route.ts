import { createShare } from '../../../../../../../../../packages/finish-requests/src/sharing';
import { body, endpoint, principal, sameOrigin } from '../../../../../../../../../apps/web/lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; requestId: string }> }) {
  return endpoint(async () => {
    sameOrigin(request);
    const p = await context.params;
    return createShare(await principal(request), p.workspaceId, p.requestId, await body(request));
  }, 201);
}
