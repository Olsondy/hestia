import { uploadRequestDrawing } from '../../../../../../../../../packages/finish-requests/src/service';
import { readFloorplanUpload } from '../../../../../../../../../packages/drawing-imports/src/transport';
import { endpoint, principal, sameOrigin } from '../../../../../../../lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** multipart: file + metadata {operationId}. DXF converts in the background; other formats wait for assisted conversion. */
export async function POST(request: Request, context: { params: Promise<{ entry: string; requestId: string }> }) {
  return endpoint(async () => {
    sameOrigin(request);
    const { entry, requestId } = await context.params, identity = await principal(request), upload = await readFloorplanUpload(request);
    return { request: await uploadRequestDrawing(identity, entry, requestId, upload) };
  }, 202);
}
