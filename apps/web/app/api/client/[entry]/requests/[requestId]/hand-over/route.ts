import { handOverDrawing } from '../../../../../../../../../packages/finish-requests/src/service';
import { endpoint, principal, sameOrigin } from '../../../../../../../lib/server';
import { clientParams } from '../../../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Customer: a drawing that could not be converted automatically joins the enterprise's queue (ADR-0013). */
export async function POST(request: Request, context: { params: Promise<{ entry: string; requestId: string }> }) {
  return endpoint(async () => {
    await sameOrigin(request);
    const { entry, requestId } = await clientParams(request, context.params);
    return { request: await handOverDrawing(await principal(request), entry, requestId) };
  });
}
