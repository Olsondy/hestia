import { getService, updateService } from '../../../../../../../packages/model-registry/src/service';
import { endpoint } from '../../../../../lib/server';
import { adminRead, adminWrite } from '../../../../../lib/admin';
type Context = { params: Promise<{ id: string }> };
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: Context) {
  return endpoint(async () => { await adminRead(request); return getService((await context.params).id); });
}
export async function PATCH(request: Request, context: Context) {
  return endpoint(async () => { const { admin, input } = await adminWrite(request); return { service: await updateService(admin, (await context.params).id, input) }; });
}
