import { requirePlatformAdmin } from '../../../../../../packages/platform-admin/src/guard';
import { endpoint } from '../../../../lib/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return endpoint(async () => {
    const { name, email, level } = await requirePlatformAdmin(request.headers);
    return { admin: { name, email, level } };
  });
}
