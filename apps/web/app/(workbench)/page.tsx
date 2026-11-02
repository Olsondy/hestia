import { redirect } from 'next/navigation';
import { HestiaApp } from '../../components/hestia-app';
import { workspaceSlugSchema } from '../../../../packages/contracts/src/workspaces';

// Deployment switch (ADR-0007): HESTIA_HOME_ENTRY=<enterprise slug> sends the root to that enterprise's customer
// client, so an enterprise-facing deployment shows no workbench entry. Unset keeps the workbench at the root.
export const dynamic = 'force-dynamic';
export default function Page() {
  const entry = workspaceSlugSchema.safeParse(process.env.HESTIA_HOME_ENTRY?.trim() || undefined);
  if (entry.success) redirect(`/c/${entry.data}`);
  return <HestiaApp />;
}
