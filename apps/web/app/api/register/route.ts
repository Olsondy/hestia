import { auth } from '../../../../../packages/identity/src/auth';
import { registrationSchema } from '../../../../../packages/identity/src/registration';
import { body, endpoint, sameOrigin } from '../../../lib/server';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = registrationSchema.parse(await body(request));
    const headers = new Headers(request.headers); headers.delete('content-length'); headers.delete('transfer-encoding');
    const url = new URL('/api/auth/register', request.url);
    const response = await auth.handler(new Request(url, { method: 'POST', headers, body: JSON.stringify(input) }));
    // Better Auth's endpoint wrapper returns 200 for ctx.json; retain our public 201 contract.
    return response.status === 200 ? new Response(response.body, { status: 201, headers: response.headers }) : response;
  } catch (error) { return endpoint(async () => { throw error; }); }
}
