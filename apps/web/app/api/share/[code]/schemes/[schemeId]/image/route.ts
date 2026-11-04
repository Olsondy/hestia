import { shareImage, shareSource } from '../../../../../../../../../packages/finish-requests/src/sharing';
import { auth } from '../../../../../../../../../packages/identity/src/auth';
import { endpoint } from '../../../../../../../lib/server';
import { stillResponse } from '../../../../../../../lib/image-response';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Public scheme image behind a live share code (preview only). */
export async function GET(request: Request, context: { params: Promise<{ code: string; schemeId: string }> }) {
  try {
    const { code, schemeId } = await context.params, session = await auth.api.getSession({ headers: request.headers });
    const bytes = await shareImage(code, schemeId, shareSource(request.headers), session?.user.id ?? null);
    return await stillResponse(request, bytes, { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  } catch (error) { return endpoint(async () => { throw error; }); }
}
