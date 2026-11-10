import { getFinishRequest } from '../../../../../../../../packages/finish-requests/src/service';
import { endpoint, principal } from '../../../../../../lib/server';
import { clientParams } from '../../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ entry: string; requestId: string }> }) {
  return endpoint(async () => {
    const { entry, requestId } = await clientParams(request, context.params);
    return { request: await getFinishRequest(await principal(request), entry, requestId) };
  });
}
