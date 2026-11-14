import { platformUsage, usageCsv } from '../../../../../../../packages/model-registry/src/usage';
import { endpoint } from '../../../../../lib/server';
import { adminRead } from '../../../../../lib/admin';
export const dynamic = 'force-dynamic';
// CSV for settling with enterprises: the same report as the usage page.
export async function GET(request: Request) {
  try {
    await adminRead(request);
    const q = new URL(request.url).searchParams, report = await platformUsage(q.get('month') ?? undefined, q.get('by'));
    return new Response(usageCsv(report), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="hestia-usage-${report.month}-${report.by}.csv"` } });
  } catch (error) { return endpoint(async () => { throw error; }); }
}
