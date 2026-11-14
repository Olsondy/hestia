import { enterpriseUsage } from '../../../../../../../packages/model-registry/src/usage';
import { principal, endpoint } from '../../../../../lib/server';
import { workspaceParams } from '../../../../../lib/host';
type Context = { params: Promise<{ workspaceId: string }> };
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: Context) {
  return endpoint(async () => { const q = new URL(request.url).searchParams;
    return enterpriseUsage(await principal(request), (await workspaceParams(request, context.params)).workspaceId, q.get('month') ?? undefined, q.get('by')); });
}
