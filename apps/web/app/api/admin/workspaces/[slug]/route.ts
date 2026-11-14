import { getEnterprise, updateEnterprise } from '../../../../../../../packages/model-registry/src/grants';
import { endpoint } from '../../../../../lib/server';
import { adminRead, adminWrite } from '../../../../../lib/admin';
type Context = { params: Promise<{ slug: string }> };
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: Context) {
  return endpoint(async () => { await adminRead(request); return { enterprise: await getEnterprise((await context.params).slug) }; });
}
export async function PATCH(request: Request, context: Context) {
  return endpoint(async () => { const { admin, input } = await adminWrite(request); return { enterprise: await updateEnterprise(admin, (await context.params).slug, input) }; });
}
