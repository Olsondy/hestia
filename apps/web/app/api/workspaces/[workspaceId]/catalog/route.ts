import { memberCatalog } from '../../../../../../../packages/finish-requests/src/member-catalog';
import { endpoint, principal } from '../../../../../lib/server';
import { workspaceParams } from '../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Members: the workspace's stones and soft styles, every version, retired ones marked (read-only). */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  return endpoint(async () => ({ catalog: await memberCatalog(await principal(request), (await workspaceParams(request, context.params)).workspaceId) }));
}
