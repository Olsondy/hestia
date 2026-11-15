import { publishScheme } from '../../../../../../../../../../../packages/finish-requests/src/agent';
import { body, endpoint, principal, sameOrigin } from '../../../../../../../../../lib/server';
import { workspaceParams } from '../../../../../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Members only (K03): publish a scheme adopted from an Agent candidate. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; requestId: string; schemeId: string }> }) {
  return endpoint(async () => {
    await sameOrigin(request);
    const p = await workspaceParams(request, context.params);
    return { lead: await publishScheme(await principal(request), p.workspaceId, p.requestId, p.schemeId, await body(request)) };
  });
}
