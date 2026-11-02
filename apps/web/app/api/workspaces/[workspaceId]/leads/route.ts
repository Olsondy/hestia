import { listLeads } from '../../../../../../../packages/finish-requests/src/service';
import { endpoint, principal } from '../../../../../lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Members: customer finish requests (线索) with contact, status and schemes. */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  return endpoint(async () => ({ leads: await listLeads(await principal(request), (await context.params).workspaceId) }));
}
