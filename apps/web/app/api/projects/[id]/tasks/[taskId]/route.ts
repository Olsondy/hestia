import { getTask } from '../../../../../../../../packages/tasks/src/service';
import { principal, endpoint } from '../../../../../../lib/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string; taskId: string }> }) {
  return endpoint(async () => { const { id, taskId } = await context.params; return { task: await getTask(await principal(request), id, taskId) }; });
}
