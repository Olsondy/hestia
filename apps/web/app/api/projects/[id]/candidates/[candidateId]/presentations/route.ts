import { presentCandidate } from '../../../../../../../../../packages/candidates/src/service';
import { browserUser } from '../../../../../../../../../packages/candidates/src/browser-user';
import { body, sameOrigin, endpoint } from '../../../../../../../lib/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string; candidateId: string }> }) {
  return endpoint(async () => {
    sameOrigin(request);
    const { id, candidateId } = await context.params;
    const result = await presentCandidate(await browserUser(request), id, candidateId, await body(request));
    return { presentation: result };
  });
}
