import { getWorkspace } from '../../../../../../packages/workspaces/src/service';
import { principal, endpoint } from '../../../../lib/server';
type Context = { params: Promise<{ workspaceId: string }> };
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: Context) {
  return endpoint(async () => ({ workspace: await getWorkspace(await principal(request), (await context.params).workspaceId) }));
}
