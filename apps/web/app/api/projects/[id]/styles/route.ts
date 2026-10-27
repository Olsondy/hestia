import { getStyles } from '../../../../../../../packages/styles/src/service';
import { principal, endpoint } from '../../../../../lib/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => getStyles(await principal(request), (await context.params).id));
}
