import { createRender, listRenders } from '../../../../../../../packages/renders/src/service';
import { principal, body, sameOrigin, endpoint } from '../../../../../lib/server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => ({ renders: await listRenders(await principal(request), (await context.params).id) }));
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => { sameOrigin(request); return { render: await createRender(await principal(request), (await context.params).id, await body(request)) }; }, 202);
}
