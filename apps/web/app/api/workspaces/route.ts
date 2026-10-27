import { listWorkspaces } from '../../../../../packages/workspaces/src/service';
import { principal, endpoint } from '../../../lib/server';
export const dynamic = 'force-dynamic';
// Workspaces are created by trusted scripts only (pnpm workspace:create); there is intentionally no POST.
export async function GET(request: Request) {
  return endpoint(async () => ({ workspaces: await listWorkspaces(await principal(request)) }));
}
