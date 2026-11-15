import { adoptSchemeCandidate } from '../../../../../../../../../../../packages/finish-requests/src/agent';
import { body, endpoint, principal, sameOrigin } from '../../../../../../../../../lib/server';
import { workspaceParams } from '../../../../../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Members only (K03): adopt a candidate as a scheme pending review; customers do not see it until it is published. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; requestId: string; candidateId: string }> }) {
  return endpoint(async () => {
    await sameOrigin(request);
    const p = await workspaceParams(request, context.params);
    return { lead: await adoptSchemeCandidate(await principal(request), p.workspaceId, p.requestId, p.candidateId, await body(request)) };
  });
}
