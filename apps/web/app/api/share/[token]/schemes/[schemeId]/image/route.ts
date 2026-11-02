import { shareImage } from '../../../../../../../../../packages/finish-requests/src/sharing';
import { endpoint } from '../../../../../../../lib/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Public scheme image behind a live share link (preview only). */
export async function GET(_request: Request, context: { params: Promise<{ token: string; schemeId: string }> }) {
  try {
    const { token, schemeId } = await context.params, bytes = await shareImage(token, schemeId);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) { return endpoint(async () => { throw error; }); }
}
