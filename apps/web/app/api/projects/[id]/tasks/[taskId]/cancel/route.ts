import { cancelTask } from '../../../../../../../../../packages/tasks/src/service';
import { principal, sameOrigin, endpoint } from '../../../../../../../lib/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string; taskId: string }> }) {
  return endpoint(async () => { sameOrigin(request); const { id, taskId } = await context.params;
    return { task: await cancelTask(await principal(request), id, taskId) }; });
}
