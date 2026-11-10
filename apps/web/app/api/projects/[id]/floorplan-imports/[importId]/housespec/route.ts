import { importHouseSpec } from '../../../../../../../../../packages/drawing-imports/src/service';
import { readHouseSpecBody } from '../../../../../../../../../packages/drawing-imports/src/transport';
import { endpoint, principal, sameOrigin } from '../../../../../../../lib/server';

export const runtime = 'nodejs';
/** Member HouseSpec import for assisted, failed or pending-review drawings; the result waits for review. */
export async function POST(request: Request, context: { params: Promise<{ id: string; importId: string }> }) {
  return endpoint(async () => {
    await sameOrigin(request);
    const identity = await principal(request), { id, importId } = await context.params;
    return { import: await importHouseSpec(identity, id, importId, await readHouseSpecBody(request)) };
  });
}
