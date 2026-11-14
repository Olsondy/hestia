import { enterpriseModels } from '../../../../../../../packages/model-registry/src/grants';
import { principal, endpoint } from '../../../../../lib/server';
import { workspaceParams } from '../../../../../lib/host';
type Context = { params: Promise<{ workspaceId: string }> };
export const dynamic = 'force-dynamic';
// Models this enterprise can use (ADR-0018): members get the enabled ones for the Agent picker, the admin everything granted.
export async function GET(request: Request, context: Context) {
  return endpoint(async () => enterpriseModels(await principal(request), (await workspaceParams(request, context.params)).workspaceId));
}
