import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { isAdminRequest } from '../../../../../../packages/platform-admin/src/host';
import { AdminApp } from '../../../../components/admin/admin-app';

export const dynamic = 'force-dynamic';

// /admin/… exists only on HESTIA_ADMIN_HOST (ADR-0018); proxy.ts already answers 404 elsewhere, this is the second check.
export default async function AdminPage({ params }: { params: Promise<{ path?: string[] }> }) {
  if (!isAdminRequest(await headers())) notFound();
  const { path = [] } = await params;
  return <AdminApp path={path.map(decodeURIComponent)}/>;
}
