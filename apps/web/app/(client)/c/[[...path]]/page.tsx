import { redirect } from 'next/navigation';
import { ClientApp } from '../../../../components/client/client-app';
import { headers } from 'next/headers';
import { pageEnterprise } from '../../../../lib/host';

export const dynamic = 'force-dynamic';

// Customer H5 at /c/… for the request's enterprise: its registered domain (ADR-0017), else HESTIA_HOME_ENTRY (ADR-0016). Earlier links carried the
// enterprise in the path (/c/demo-home/…); they redirect to the same page without it.
export default async function ClientPage({ params, searchParams }: { params: Promise<{ path?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ path = [] }, query] = await Promise.all([params, searchParams]);
  const { enterprise } = await pageEnterprise(await headers());
  if (enterprise && decodeURIComponent(path[0] ?? '') === enterprise) redirect(withQuery(`/c${path.length > 1 ? `/${path.slice(1).join('/')}` : ''}`, query));
  return <ClientApp entry={enterprise ?? ''} />;
}
function withQuery(path: string, query: Record<string, string | string[] | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) for (const item of [value].flat()) if (item !== undefined) search.append(key, item);
  return search.size ? `${path}?${search}` : path;
}
