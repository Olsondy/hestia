import { readSchemeImage } from '../../../../../../../../../../../packages/finish-requests/src/service';
import { endpoint, principal } from '../../../../../../../../../lib/server';
import { clientParams } from '../../../../../../../../../lib/host';
import { stillResponse } from '../../../../../../../../../lib/image-response';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ entry: string; requestId: string; schemeId: string }> }) {
  try {
    const { entry, requestId, schemeId } = await clientParams(request, context.params), bytes = await readSchemeImage(await principal(request), entry, requestId, schemeId);
    return await stillResponse(request, bytes, { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  } catch (error) { return endpoint(async () => { throw error; }); }
}
