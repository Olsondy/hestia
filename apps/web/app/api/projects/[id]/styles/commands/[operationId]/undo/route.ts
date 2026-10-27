import { undoStyle } from '../../../../../../../../../../packages/styles/src/service';
import { principal, body, sameOrigin, endpoint } from '../../../../../../../../lib/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string; operationId: string }> }) {
  return endpoint(async () => {
    sameOrigin(request); const { id, operationId } = await context.params;
    return undoStyle(await principal(request), id, operationId, await body(request));
  });
}
