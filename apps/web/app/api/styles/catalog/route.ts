import { getStyleCatalog } from '../../../../../../packages/styles/src/catalog';
import { principal, endpoint } from '../../../../lib/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return endpoint(async () => { await principal(request); return getStyleCatalog(); });
}
