import { createCandidate, listCandidates } from '../../../../../../../packages/candidates/src/service';
import { principal, body, sameOrigin, endpoint } from '../../../../../lib/server';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return endpoint(async () => listCandidates(await principal(request), (await context.params).id));
}
export async function POST(request: Request, context: Context) {
  return endpoint(async () => { sameOrigin(request); return { candidate: await createCandidate(await principal(request), (await context.params).id, await body(request)) }; }, 201);
}
