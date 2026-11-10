import { listMembers, setMember } from '../../../../../../../packages/workspaces/src/service';
import { principal, endpoint, body, sameOrigin } from '../../../../../lib/server';
type Context = { params: Promise<{ workspaceId: string }> };
import { workspaceParams } from '../../../../../lib/host';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: Context) {
  return endpoint(async () => ({ members: await listMembers(await principal(request), (await workspaceParams(request, context.params)).workspaceId) }));
}
/** Admin adds an existing account by email or changes its role; repeating the request is a no-op. */
export async function POST(request: Request, context: Context) {
  return endpoint(async () => { await sameOrigin(request);
    return { members: await setMember(await principal(request), (await workspaceParams(request, context.params)).workspaceId, await body(request)) }; });
}
