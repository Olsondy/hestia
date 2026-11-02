import { applyBinding } from '../../../../../../../../../packages/finish-requests/src/sharing';
import { body, endpoint, principal, sameOrigin } from '../../../../../../../../../apps/web/lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ entry: string; token: string }> }) {
  return endpoint(async () => {
    sameOrigin(request);
    const p = await context.params;
    return { application: await applyBinding(await principal(request), p.entry, p.token, await body(request)) };
  });
}
