import { taskEventStream } from '../../../../../../../../../packages/tasks/src/events';
import { DomainError } from '../../../../../../../../../packages/contracts/src/project';
import { principal, endpoint } from '../../../../../../../lib/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string; taskId: string }> }) {
  try {
    const { id, taskId } = await context.params;
    const raw = request.headers.get('last-event-id') ?? new URL(request.url).searchParams.get('after') ?? '0';
    if (!/^\d{1,10}$/.test(raw)) throw new DomainError('INVALID_CURSOR', '事件游标不正确。');
    return await taskEventStream(await principal(request), id, taskId, Number(raw), request.signal);
  } catch (error) { return endpoint(async () => { throw error; }); }
}
