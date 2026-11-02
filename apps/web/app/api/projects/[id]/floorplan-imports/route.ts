import { createFloorplanImport, listFloorplanImports } from '../../../../../../../packages/drawing-imports/src/service';
import { readFloorplanUpload } from '../../../../../../../packages/drawing-imports/src/transport';
import { endpoint, principal, sameOrigin } from '../../../../../lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
/** Upload a drawing (multipart: file + metadata {operationId}). DXF is queued for background conversion. */
export async function POST(request: Request, context: Context) {
  return endpoint(async () => {
    sameOrigin(request);
    const identity = await principal(request), id = (await context.params).id, upload = await readFloorplanUpload(request);
    return { import: await createFloorplanImport(identity, id, upload.input, upload.bytes, upload.fileName) };
  }, 202);
}
export async function GET(request: Request, context: Context) {
  return endpoint(async () => ({ imports: await listFloorplanImports(await principal(request), (await context.params).id) }));
}
