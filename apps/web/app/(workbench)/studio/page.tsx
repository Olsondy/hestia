import { HestiaApp } from '../../../components/hestia-app';

// Personal workbench (paused for the public, ADR-0006/status): kept at /studio; the root is the site entry (ADR-0015).
// Invitation links (`pnpm invite`) open here too.
export default function Page() {
  return <HestiaApp />;
}
