import { body, endpoint, principal, sameOrigin } from '../../../../../lib/server';
import { getUnderlay, saveUnderlay, updateUnderlay } from '../../../../../../../packages/files/src/service';
import { readUnderlayUpload } from '../../../../../../../packages/files/src/transport';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return endpoint(async () => ({ underlay: await getUnderlay(await principal(request), (await context.params).id), storage: 'local-private-development' }));
}
export async function POST(request: Request, context: Context) {
  return endpoint(async () => {
    sameOrigin(request); const identity = await principal(request), id = (await context.params).id;
    const upload = await readUnderlayUpload(request);
    return { underlay: await saveUnderlay(identity,id,upload.input,upload.bytes,upload.mediaType) };
  }, 201);
}
export async function PATCH(request: Request, context: Context) {
  return endpoint(async () => {
    sameOrigin(request);
    return { underlay: await updateUnderlay(await principal(request),(await context.params).id,await body(request)) };
  });
}
