import { reserveResource } from '../../../../../../../packages/projects/src/service';
import { principal, endpoint, body, sameOrigin } from '../../../../../lib/server';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    sameOrigin(request);
    return { resource: await reserveResource(await principal(request), (await context.params).id, await body(request)) };
  }, 201);
}
