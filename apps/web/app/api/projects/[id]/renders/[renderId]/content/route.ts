import { readRender } from '../../../../../../../../../packages/renders/src/service';
import { principal, endpoint } from '../../../../../../../lib/server';
import { stillResponse } from '../../../../../../../lib/image-response';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string; renderId: string }> }) {
  try {
    const { id, renderId } = await context.params, bytes = await readRender(await principal(request), id, renderId);
    const disposition = new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline';
    return await stillResponse(request, bytes, { 'Content-Disposition': `${disposition}; filename="hestia-${renderId}.png"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }, { download: disposition === 'attachment' });
  } catch (error) { return endpoint(async () => { throw error; }); }
}
