import { redirect } from 'next/navigation';
import { WorkbenchApp } from '../../../../components/enterprise/workbench-app';
import { siteEntry } from '../../../../lib/site-entry';

export const dynamic = 'force-dynamic';

// Enterprise workbench at /w/… for the deployment's one enterprise (ADR-0016). Old /w/demo-home/… links redirect.
export default async function WorkbenchPage({ params, searchParams }: { params: Promise<{ path?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ path = [] }, query] = await Promise.all([params, searchParams]);
  const { enterprise } = siteEntry();
  if (enterprise && decodeURIComponent(path[0] ?? '') === enterprise) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) for (const item of [value].flat()) if (item !== undefined) search.append(key, item);
    const rest = `/w${path.length > 1 ? `/${path.slice(1).join('/')}` : ''}`;
    redirect(search.size ? `${rest}?${search}` : rest);
  }
  return <WorkbenchApp slug={enterprise ?? ''} />;
}
