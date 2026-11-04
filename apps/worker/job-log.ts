// One line per job on the Worker's stdout: start, then the stored outcome (status, error code) and duration.
// Runners record results only in the database, so without this a running Worker prints nothing after "ready".
// Only IDs, status and error codes/messages are printed; never file names or drawing contents.
export async function logged<T>(kind: string, id: string, work: () => Promise<T>, outcome: () => Promise<{ status: string; error?: unknown } | undefined>) {
  const started = Date.now(), short = id.slice(0, 8);
  const time = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const seconds = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
  process.stdout.write(`${time()} ${kind} ${short} 开始\n`);
  try {
    const result = await work();
    const row = await outcome().catch(() => undefined), error = row?.error as { code?: string; message?: string } | null | undefined;
    process.stdout.write(`${time()} ${kind} ${short} ${row?.status ?? '已跳过'}${error?.code ? ` ${error.code} ${error.message ?? ''}` : ''} · ${seconds()}\n`);
    return result;
  } catch (error) {
    process.stderr.write(`${time()} ${kind} ${short} 中断，等待重试 · ${seconds()} · ${error instanceof Error ? error.name : 'Error'}\n`);
    throw error;
  }
}
