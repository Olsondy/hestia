import { sharePreview } from '../../../../../../packages/finish-requests/src/sharing';
import { endpoint } from '../../../../../../apps/web/lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  return endpoint(async () => {
    const p = await context.params;
    return { preview: await sharePreview(p.token) };
  });
}
