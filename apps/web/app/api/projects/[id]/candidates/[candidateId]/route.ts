import { getCandidate } from '../../../../../../../../packages/candidates/src/service';
import { principal, endpoint } from '../../../../../../lib/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string; candidateId: string }> }) {
  return endpoint(async () => { const { id, candidateId } = await context.params; return { candidate: await getCandidate(await principal(request), id, candidateId) }; });
}
