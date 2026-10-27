import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '../../../../../../packages/identity/src/auth';
import { body, endpoint, sameOrigin } from '../../../../lib/server';
export const runtime = 'nodejs';
const handlers = toNextJsHandler(auth);
export const GET = handlers.GET;
/** The current email/password API accepts JSON only; bound bytes before framework parsing. */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = await body(request);
    const headers = new Headers(request.headers);
    headers.delete('content-length'); headers.delete('transfer-encoding');
    return handlers.POST(new Request(request, { headers, body: JSON.stringify(input) }));
  } catch (error) { return endpoint(async () => { throw error; }); }
}
