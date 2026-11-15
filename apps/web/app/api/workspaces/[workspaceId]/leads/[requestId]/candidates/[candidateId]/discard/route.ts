import { discardSchemeCandidate } from '../../../../../../../../../../../packages/finish-requests/src/agent';
import { body, endpoint, principal, sameOrigin } from '../../../../../../../../../lib/server';
import { workspaceParams } from '../../../../../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Members only (K03/W07): discard a draft Agent candidate. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; requestId: string; candidateId: string }> }) {
  return endpoint(async () => {
    await sameOrigin(request);
    const p = await workspaceParams(request, context.params);
    return { candidates: await discardSchemeCandidate(await principal(request), p.workspaceId, p.requestId, p.candidateId, await body(request)) };
  });
}
