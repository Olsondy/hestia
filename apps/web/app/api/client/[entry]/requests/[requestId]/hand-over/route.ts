import { handOverDrawing } from '../../../../../../../../../packages/finish-requests/src/service';
import { endpoint, principal, sameOrigin } from '../../../../../../../lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Customer: a drawing that could not be converted automatically joins the enterprise's queue (ADR-0013). */
export async function POST(request: Request, context: { params: Promise<{ entry: string; requestId: string }> }) {
  return endpoint(async () => {
    sameOrigin(request);
    const { entry, requestId } = await context.params;
    return { request: await handOverDrawing(await principal(request), entry, requestId) };
  });
}
