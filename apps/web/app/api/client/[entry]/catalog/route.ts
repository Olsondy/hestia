import { clientCatalog } from '../../../../../../../packages/finish-requests/src/service';
import { endpoint } from '../../../../../lib/server';
import { clientParams } from '../../../../../lib/host';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Public entry catalog: workspace name, active stones and the demo villa's finishes. */
export async function GET(request: Request, context: { params: Promise<{ entry: string }> }) {
  return endpoint(async () => ({ catalog: await clientCatalog((await clientParams(request, context.params)).entry) }));
}
