import { refreshCatalog } from '../../../../../../../../packages/model-registry/src/service';
import { endpoint } from '../../../../../../lib/server';
import { adminWrite } from '../../../../../../lib/admin';
type Context = { params: Promise<{ id: string }> };
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: Context) {
  return endpoint(async () => { const { admin } = await adminWrite(request); return { service: await refreshCatalog(admin, (await context.params).id) }; });
}
