import { createMemberRequest, listLeads } from '../../../../../../../packages/finish-requests/src/service';
import { body, endpoint, principal, sameOrigin } from '../../../../../lib/server';
import { workspaceParams } from '../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Members: customer finish requests (线索) with contact, status, follow-up and schemes. Filters: ?status=&follow=&contact=1 */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  return endpoint(async () => {
    const filters = Object.fromEntries(new URL(request.url).searchParams);
    return { leads: await listLeads(await principal(request), (await workspaceParams(request, context.params)).workspaceId, filters) };
  });
}
/** Members prepare a demo-villa request for a customer; it is published when its schemes pass checks. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  return endpoint(async () => {
    await sameOrigin(request);
    return { lead: await createMemberRequest(await principal(request), (await workspaceParams(request, context.params)).workspaceId, await body(request)) };
  }, 201);
}
