import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '../../../../../../packages/identity/src/auth';
import { body, endpoint, sameOrigin } from '../../../../lib/server';
export const runtime = 'nodejs';
const handlers = toNextJsHandler(auth);
export const GET = handlers.GET;
/** The current email/password API accepts JSON only; bound bytes before framework parsing. */
export async function POST(request: Request) {
  try {
    await sameOrigin(request);
    const input = await body(request);
    const headers = new Headers(request.headers);
    headers.delete('content-length'); headers.delete('transfer-encoding');
    // Rebuild from the URL: under the Next server the incoming object is not an undici Request and cannot be cloned.
    return handlers.POST(new Request(request.url, { method: 'POST', headers, body: JSON.stringify(input) }));
  } catch (error) { return endpoint(async () => { throw error; }); }
}
