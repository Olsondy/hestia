import { createMemberRequest, listLeads } from '../../../../../../../packages/finish-requests/src/service';
import { body, endpoint, principal, sameOrigin } from '../../../../../lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Members: customer finish requests (线索) with contact, status and schemes. */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  return endpoint(async () => ({ leads: await listLeads(await principal(request), (await context.params).workspaceId) }));
}
/** Members prepare a demo-villa request for a customer; it is published when its schemes pass checks. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  return endpoint(async () => {
    sameOrigin(request);
    return { lead: await createMemberRequest(await principal(request), (await context.params).workspaceId, await body(request)) };
  }, 201);
}
