import { terminalTaskStatuses } from '../../contracts/src/tasks';
import type { Principal } from '../../projects/src/service';
import { readTaskEvents } from './service';

/** A read-only, bounded SSE subscription. Aborting it never touches a task or queue job. */
export async function taskEventStream(principal: Principal, projectId: string, taskId: string, after: number, signal: AbortSignal) {
  const initial = await readTaskEvents(principal, projectId, taskId, after);
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined, stopped = false, cursor = after;
  let removeAbort = () => {};
  const start = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const stop = () => {
        if (stopped) return;
        stopped = true; clearTimeout(timer); removeAbort();
        controller.close();
      };
      signal.addEventListener('abort', stop, { once: true });
      removeAbort = () => signal.removeEventListener('abort', stop);
      if (signal.aborted) { stop(); return; }
      const emit = (text: string) => { if (!stopped) controller.enqueue(encoder.encode(text)); };
      const poll = async (result?: Awaited<ReturnType<typeof readTaskEvents>>) => {
        try {
          const page = result ?? await readTaskEvents(principal, projectId, taskId, cursor);
          if (stopped) return;
          for (const event of page.events) {
            emit(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            cursor = event.seq;
          }
          if ((terminalTaskStatuses.has(page.task.status) || page.task.status === 'waiting_input' || page.task.status === 'waiting_selection') && cursor >= page.task.eventsCursor) { stop(); return; }
          if (Date.now() - start >= 25000) { stop(); return; }
          emit(': keepalive\n\n');
          timer = setTimeout(() => { void poll(); }, 500);
        } catch {
          emit('event: stream-error\ndata: {"message":"事件连接中断，请重新连接。"}\n\n'); stop();
        }
      };
      void poll(initial);
    },
    cancel() { stopped = true; clearTimeout(timer); removeAbort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no', Connection: 'keep-alive' } });
}
