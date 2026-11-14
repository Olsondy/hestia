import { getModel, updateModel } from '../../../../../../../packages/model-registry/src/service';
import { endpoint } from '../../../../../lib/server';
import { adminRead, adminWrite } from '../../../../../lib/admin';
type Context = { params: Promise<{ id: string }> };
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: Context) {
  return endpoint(async () => { await adminRead(request); return getModel((await context.params).id); });
}
export async function PATCH(request: Request, context: Context) {
  return endpoint(async () => { const { admin, input } = await adminWrite(request); return { model: await updateModel(admin, (await context.params).id, input) }; });
}
