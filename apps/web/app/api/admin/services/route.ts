import { createService, listServices } from '../../../../../../packages/model-registry/src/service';
import { endpoint } from '../../../../lib/server';
import { adminRead, adminWrite } from '../../../../lib/admin';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return endpoint(async () => { await adminRead(request); return listServices(); });
}
export async function POST(request: Request) {
  return endpoint(async () => { const { admin, input } = await adminWrite(request); return { service: await createService(admin, input) }; }, 201);
}
