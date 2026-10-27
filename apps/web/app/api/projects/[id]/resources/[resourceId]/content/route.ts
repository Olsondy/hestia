import { endpoint, principal } from '../../../../../../../lib/server';
import { readPrivateImage } from '../../../../../../../../../packages/files/src/service';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string; resourceId: string }> }) {
  try {
    const { id, resourceId } = await context.params;
    const bytes = await readPrivateImage(await principal(request),id,resourceId);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type':'image/png','Content-Length':String(bytes.length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="underlay.png"' } });
  } catch (error) { return endpoint(async () => { throw error; }); }
}
