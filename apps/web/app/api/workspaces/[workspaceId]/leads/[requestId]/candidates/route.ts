import { listSchemeCandidates } from '../../../../../../../../../packages/finish-requests/src/agent';
import { endpoint, principal } from '../../../../../../../lib/server';
import { workspaceParams } from '../../../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Members only (K03): the enterprise Agent's whole-scheme candidates for this lead. */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; requestId: string }> }) {
  return endpoint(async () => {
    const { workspaceId, requestId } = await workspaceParams(request, context.params);
    return { candidates: await listSchemeCandidates(await principal(request), workspaceId, requestId) };
  });
}
