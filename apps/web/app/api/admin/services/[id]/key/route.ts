import { replaceServiceKey } from '../../../../../../../../packages/model-registry/src/service';
import { endpoint } from '../../../../../../lib/server';
import { adminWrite } from '../../../../../../lib/admin';
type Context = { params: Promise<{ id: string }> };
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: Context) {
  return endpoint(async () => { const { admin, input } = await adminWrite(request); return { service: await replaceServiceKey(admin, (await context.params).id, input) }; });
}
