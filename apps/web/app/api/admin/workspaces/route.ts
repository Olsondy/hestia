import { listEnterprises } from '../../../../../../packages/model-registry/src/grants';
import { endpoint } from '../../../../lib/server';
import { adminRead } from '../../../../lib/admin';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return endpoint(async () => { await adminRead(request); return { enterprises: await listEnterprises() }; });
}
