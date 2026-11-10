import { readSchemeScene } from '../../../../../../../../../../../packages/finish-requests/src/service';
import { endpoint, principal } from '../../../../../../../../../lib/server';
import { clientParams } from '../../../../../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Scene snapshot of the scheme's current render, for the customer's 3D viewer. */
export async function GET(request: Request, context: { params: Promise<{ entry: string; requestId: string; schemeId: string }> }) {
  return endpoint(async () => {
    const { entry, requestId, schemeId } = await clientParams(request, context.params);
    return { scene: await readSchemeScene(await principal(request), entry, requestId, schemeId) };
  });
}
