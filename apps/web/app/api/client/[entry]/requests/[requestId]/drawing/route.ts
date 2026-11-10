import { uploadRequestDrawing } from '../../../../../../../../../packages/finish-requests/src/service';
import { readFloorplanUpload } from '../../../../../../../../../packages/drawing-imports/src/transport';
import { endpoint, principal, sameOrigin } from '../../../../../../../lib/server';
import { clientParams } from '../../../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** multipart: file + metadata {operationId}. DXF converts in the background; other formats wait for assisted conversion. */
export async function POST(request: Request, context: { params: Promise<{ entry: string; requestId: string }> }) {
  return endpoint(async () => {
    await sameOrigin(request);
    const { entry, requestId } = await clientParams(request, context.params), identity = await principal(request), upload = await readFloorplanUpload(request);
    return { request: await uploadRequestDrawing(identity, entry, requestId, upload) };
  }, 202);
}
