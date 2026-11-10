import { sharePreview, shareSource } from '../../../../../../packages/finish-requests/src/sharing';
import { sessionFor } from '../../../../../../packages/identity/src/session';
import { endpoint } from '../../../../lib/server';
import { shareScope } from '../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Public preview by share code (ADR-0012); a signed-in visitor also learns whether the request is bound to them or they applied. */
export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  return endpoint(async () => {
    const p = await context.params, session = await sessionFor(request.headers);
    return { preview: await sharePreview(p.code, session?.user.id ?? null, shareSource(request.headers), await shareScope(request)) };
  });
}
