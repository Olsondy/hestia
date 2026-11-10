import { schemeOptions } from '../../../../../../../../../../../packages/finish-requests/src/adjust';
import { endpoint, principal } from '../../../../../../../../../../../apps/web/lib/server';
import { clientParams } from '../../../../../../../../../../../apps/web/lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Params = { entry: string; requestId: string; schemeId: string };
export async function GET(request: Request, context: { params: Promise<Params> }) {
  return endpoint(async () => {
    
    const p = await clientParams(request, context.params);
    return { options: await schemeOptions(await principal(request), p.entry, p.requestId, p.schemeId) };
  });
}
