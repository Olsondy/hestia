import { createTask, listTasks } from '../../../../../../../packages/tasks/src/service';
import { principal, body, sameOrigin, endpoint } from '../../../../../lib/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => ({ tasks: await listTasks(await principal(request), (await context.params).id) }));
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => { sameOrigin(request); return { task: await createTask(await principal(request), (await context.params).id, await body(request)) }; }, 202);
}
