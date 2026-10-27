import { applyStyle } from '../../../../../../../../packages/styles/src/service';
import { principal, body, sameOrigin, endpoint } from '../../../../../../lib/server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    sameOrigin(request);
    return applyStyle(await principal(request), (await context.params).id, await body(request));
  });
}
