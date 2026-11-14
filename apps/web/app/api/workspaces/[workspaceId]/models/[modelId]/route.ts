import { setEnterpriseModel } from '../../../../../../../../packages/model-registry/src/grants';
import { principal, endpoint, body, sameOrigin } from '../../../../../../lib/server';
import { workspaceParams } from '../../../../../../lib/host';
type Context = { params: Promise<{ workspaceId: string; modelId: string }> };
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: Context) {
  return endpoint(async () => { await sameOrigin(request); const { workspaceId, modelId } = await workspaceParams(request, context.params);
    return setEnterpriseModel(await principal(request), workspaceId, modelId, await body(request)); });
}
