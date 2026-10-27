import { getMyCredits } from '../../../../../packages/credits/src/service';
import { endpoint, principal } from '../../../lib/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return endpoint(async () => getMyCredits(await principal(request)));
}
