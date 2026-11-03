import { memberWorkspaceBySlug } from '../../../../../../../packages/workspaces/src/service';
import { endpoint, principal } from '../../../../../lib/server';
export const dynamic = 'force-dynamic';
/** Enterprise workbench entry: 401 when signed out, 403 for customers, other enterprises' members and unknown slugs alike. */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  return endpoint(async () => ({ workspace: await memberWorkspaceBySlug(await principal(request), (await context.params).slug) }));
}
