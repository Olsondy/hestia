import { clientCatalog } from '../../../../../../../packages/finish-requests/src/service';
import { endpoint } from '../../../../../lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Public entry catalog: workspace name, active stones and the demo villa's finishes. */
export async function GET(_request: Request, context: { params: Promise<{ entry: string }> }) {
  return endpoint(async () => ({ catalog: await clientCatalog((await context.params).entry) }));
}
