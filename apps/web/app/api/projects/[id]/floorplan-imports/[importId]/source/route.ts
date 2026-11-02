import { readFloorplanSource } from '../../../../../../../../../packages/drawing-imports/src/service';
import { endpoint, principal } from '../../../../../../../lib/server';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string; importId: string }> }) {
  try {
    const { id, importId } = await context.params;
    const file = await readFloorplanSource(await principal(request), id, importId);
    return new Response(new Uint8Array(file.bytes), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.bytes.length),
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="drawing"; filename*=UTF-8''${encodeURIComponent(file.fileName)}` } });
  } catch (error) { return endpoint(async () => { throw error; }); }
}
