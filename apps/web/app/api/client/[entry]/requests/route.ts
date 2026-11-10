import { createFinishRequest, listMyFinishRequests } from '../../../../../../../packages/finish-requests/src/service';
import { body, endpoint, principal, sameOrigin } from '../../../../../lib/server';
import { clientParams } from '../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ entry: string }> };
/** Customer submits a finish request (方案需求). Demo villa schemes are generated immediately; drawings upload next. */
export async function POST(request: Request, context: Context) {
  return endpoint(async () => {
    await sameOrigin(request);
    return { request: await createFinishRequest(await principal(request), (await clientParams(request, context.params)).entry, await body(request)) };
  }, 201);
}
export async function GET(request: Request, context: Context) {
  return endpoint(async () => ({ requests: await listMyFinishRequests(await principal(request), (await clientParams(request, context.params)).entry) }));
}
