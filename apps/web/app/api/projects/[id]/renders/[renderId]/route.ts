import { getRender } from '../../../../../../../../packages/renders/src/service';
import { principal, endpoint } from '../../../../../../lib/server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string; renderId: string }> }) {
  return endpoint(async () => { const { id, renderId } = await context.params; return { render: await getRender(await principal(request), id, renderId) }; });
}
