import { adjustScheme } from '../../../../../../../../../../../packages/finish-requests/src/adjust';
import { body, endpoint, principal, sameOrigin } from '../../../../../../../../../../../apps/web/lib/server';
import { clientParams } from '../../../../../../../../../../../apps/web/lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Params = { entry: string; requestId: string; schemeId: string };
export async function POST(request: Request, context: { params: Promise<Params> }) {
  return endpoint(async () => {
    await sameOrigin(request);
    const p = await clientParams(request, context.params);
    return { request: await adjustScheme(await principal(request), p.entry, p.requestId, p.schemeId, await body(request)) };
  });
}
