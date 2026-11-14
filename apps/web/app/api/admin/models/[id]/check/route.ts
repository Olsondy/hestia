import { startCheck } from '../../../../../../../../packages/model-registry/src/check';
import { queue } from '../../../../../../../../packages/tasks/src/queue';
import { endpoint } from '../../../../../../lib/server';
import { adminWrite } from '../../../../../../lib/admin';
type Context = { params: Promise<{ id: string }> };
export const dynamic = 'force-dynamic';
// Starts the access check; the Worker makes the real calls. The page polls the model for the result.
export async function POST(request: Request, context: Context) {
  return endpoint(async () => { const { admin } = await adminWrite(request); return startCheck(admin, (await context.params).id, queue); }, 202);
}
