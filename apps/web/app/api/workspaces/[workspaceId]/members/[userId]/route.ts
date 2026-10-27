import { removeMember, updateMember } from '../../../../../../../../packages/workspaces/src/service';
import { principal, endpoint, body, sameOrigin } from '../../../../../../lib/server';
type Context = { params: Promise<{ workspaceId: string; userId: string }> };
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: Context) {
  return endpoint(async () => { sameOrigin(request); const { workspaceId, userId } = await context.params;
    return { members: await updateMember(await principal(request), workspaceId, userId, await body(request)) }; });
}
export async function DELETE(request: Request, context: Context) {
  return endpoint(async () => { sameOrigin(request); const { workspaceId, userId } = await context.params;
    return { members: await removeMember(await principal(request), workspaceId, userId) }; });
}
