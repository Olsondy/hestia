import { platformUsage } from '../../../../../../packages/model-registry/src/usage';
import { endpoint } from '../../../../lib/server';
import { adminRead } from '../../../../lib/admin';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return endpoint(async () => { await adminRead(request); const q = new URL(request.url).searchParams; return platformUsage(q.get('month') ?? undefined, q.get('by')); });
}
