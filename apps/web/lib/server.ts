import { ZodError } from 'zod';
import { DomainError } from '../../../packages/contracts/src/project';
import { auth } from '../../../packages/identity/src/auth';

export async function principal(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
  return { userId: session.user.id };
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const expected = new URL(process.env.BETTER_AUTH_URL!).origin;
  if (!origin || origin !== expected) throw new DomainError('ORIGIN_REJECTED', '请求来源不匹配，请从应用页面重新操作。', 403);
}
export async function body(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new DomainError('INVALID_CONTENT_TYPE', '请使用 JSON 请求。', 415);
  // Bound the actual stream; a missing or falsified Content-Length must not bypass the cap.
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError('INVALID_INPUT', '请求内容为空。');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 64 * 1024) { await reader.cancel(); throw new DomainError('INPUT_TOO_LARGE', '请求内容过大。', 413); }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('INVALID_INPUT', '请求内容无法解析。');
  } finally { reader.releaseLock(); }
}
export async function endpoint(work: () => Promise<unknown>, status = 200) {
  try { return Response.json(await work(), { status, headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) {
    if (error instanceof ZodError) return Response.json({ error: { code: 'INVALID_INPUT', message: '输入格式不正确。' } }, { status: 400 });
    if (error instanceof DomainError) return Response.json({ error: { code: error.code, message: error.message, details: error.details } }, { status: error.status });
    // Never include a database connection string or stack trace in a browser response.
    console.error('request_failed', { type: error instanceof Error ? error.name : 'unknown' });
    return Response.json({ error: { code: 'INTERNAL_ERROR', message: '暂时无法完成请求，请稍后重试。' } }, { status: 500 });
  }
}
