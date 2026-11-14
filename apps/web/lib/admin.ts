import { requirePlatformAdmin } from '../../../packages/platform-admin/src/guard';
import { body, sameOrigin } from './server';

// Platform console handlers (ADR-0018): every request is checked on the server; writes also come from the console's own origin.
export const adminRead = (request: Request) => requirePlatformAdmin(request.headers);
export async function adminWrite(request: Request) {
  const admin = await requirePlatformAdmin(request.headers);
  await sameOrigin(request);
  return { admin, input: request.headers.get('content-type')?.startsWith('application/json') ? await body(request) : {} };
}
