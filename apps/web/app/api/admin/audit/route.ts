import { requirePlatformAdmin } from '../../../../../../packages/platform-admin/src/guard';
import { listAudit } from '../../../../../../packages/platform-admin/src/service';
import { endpoint } from '../../../../lib/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return endpoint(async () => {
    await requirePlatformAdmin(request.headers);
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 100);
    return { entries: (await listAudit({ limit: Number.isFinite(limit) ? limit : 100 })).map(row => ({ ...row, at: row.at.toISOString() })) };
  });
}
