import { readSchemeImage } from '../../../../../../../../../../../packages/finish-requests/src/service';
import { endpoint, principal } from '../../../../../../../../../lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ entry: string; requestId: string; schemeId: string }> }) {
  try {
    const { entry, requestId, schemeId } = await context.params, bytes = await readSchemeImage(await principal(request), entry, requestId, schemeId);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return endpoint(async () => { throw error; }); }
}
