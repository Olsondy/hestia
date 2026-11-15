import { readCandidateScene } from '../../../../../../../../../../../packages/finish-requests/src/agent';
import { endpoint, principal } from '../../../../../../../../../lib/server';
import { workspaceParams } from '../../../../../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Members only (W07): scene snapshot of an Agent candidate's still. */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; requestId: string; candidateId: string }> }) {
  return endpoint(async () => {
    const p = await workspaceParams(request, context.params);
    return { scene: await readCandidateScene(await principal(request), p.workspaceId, p.requestId, p.candidateId) };
  });
}
