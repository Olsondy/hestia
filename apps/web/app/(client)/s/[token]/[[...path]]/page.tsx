import type { Metadata } from 'next';
import { ClientApp } from '../../../../../components/client/client-app';

// Share links must not leak through the Referer header to anything the page loads.
export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } };
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ClientApp share={decodeURIComponent(token)} />;
}
