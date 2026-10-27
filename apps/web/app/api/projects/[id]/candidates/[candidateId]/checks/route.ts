import { checkCandidate } from '../../../../../../../../../packages/candidates/src/service';
import { principal, body, sameOrigin, endpoint } from '../../../../../../../lib/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string; candidateId: string }> }) {
  return endpoint(async () => {
    sameOrigin(request);
    const { id, candidateId } = await context.params;
    const result = await checkCandidate(await principal(request), id, candidateId, await body(request));
    return { check: result };
  });
}
