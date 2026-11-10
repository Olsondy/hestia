import { removeMember, updateMember } from '../../../../../../../../packages/workspaces/src/service';
import { principal, endpoint, body, sameOrigin } from '../../../../../../lib/server';
type Context = { params: Promise<{ workspaceId: string; userId: string }> };
import { workspaceParams } from '../../../../../../lib/host';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: Context) {
  return endpoint(async () => { await sameOrigin(request); const { workspaceId, userId } = await workspaceParams(request, context.params);
    return { members: await updateMember(await principal(request), workspaceId, userId, await body(request)) }; });
}
export async function DELETE(request: Request, context: Context) {
  return endpoint(async () => { await sameOrigin(request); const { workspaceId, userId } = await workspaceParams(request, context.params);
    return { members: await removeMember(await principal(request), workspaceId, userId) }; });
}
