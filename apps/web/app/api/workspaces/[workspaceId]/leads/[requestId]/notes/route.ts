import { addLeadNote } from '../../../../../../../../../packages/finish-requests/src/follow-up';
import { body, endpoint, principal, sameOrigin } from '../../../../../../../lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Members only (S02 线索跟进). */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; requestId: string }> }) {
  return endpoint(async () => {
    sameOrigin(request);
    const p = await context.params;
    return { lead: await addLeadNote(await principal(request), p.workspaceId, p.requestId, await body(request)) };
  });
}
