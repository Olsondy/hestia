import { undoSchemeAdjustment } from '../../../../../../../../../../../packages/finish-requests/src/adjust';
import { body, endpoint, principal, sameOrigin } from '../../../../../../../../../../../apps/web/lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Params = { entry: string; requestId: string; schemeId: string };
export async function POST(request: Request, context: { params: Promise<Params> }) {
  return endpoint(async () => {
    sameOrigin(request);
    const p = await context.params;
    return { request: await undoSchemeAdjustment(await principal(request), p.entry, p.requestId, p.schemeId, await body(request)) };
  });
}
