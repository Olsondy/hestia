import { ClientApp } from '../../../../../components/client/client-app';

export default async function EntryPage({ params }: { params: Promise<{ entry: string }> }) {
  const { entry } = await params;
  return <ClientApp entry={decodeURIComponent(entry)} />;
}
