import { readRender } from '../../../../../../../../../packages/renders/src/service';
import { principal, endpoint } from '../../../../../../../lib/server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string; renderId: string }> }) {
  try {
    const { id, renderId } = await context.params, bytes = await readRender(await principal(request), id, renderId);
    const disposition = new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline';
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length),
      'Content-Disposition': `${disposition}; filename="hestia-${renderId}.png"`, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return endpoint(async () => { throw error; }); }
}
