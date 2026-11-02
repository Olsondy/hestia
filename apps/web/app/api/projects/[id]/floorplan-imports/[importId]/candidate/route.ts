import { getFloorplanCandidate } from '../../../../../../../../../packages/drawing-imports/src/service';
import { endpoint, principal } from '../../../../../../../lib/server';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string; importId: string }> }) {
  return endpoint(async () => {
    const { id, importId } = await context.params;
    return { candidate: await getFloorplanCandidate(await principal(request), id, importId) };
  });
}
