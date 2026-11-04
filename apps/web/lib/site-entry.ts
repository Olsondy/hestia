import { workspaceSlugSchema } from '../../../packages/contracts/src/workspaces';

/** Demo deployments (mock SMS) say so on the site entry, and fall back to the demo enterprise. */
export const isDemoDeployment = () => process.env.SMS_PROVIDER === 'mock';
const DEMO_ENTERPRISE = 'demo-home';

/**
 * Enterprise that the site entry (ADR-0015, ADR-0016) links its doors to: the customer H5 `/c/{slug}` and the
 * workbench `/w/{slug}`, from HESTIA_HOME_ENTRY. A path form is accepted too (`/c/demo-home`, `/w/demo-home/`).
 * Demo deployments without the setting use `demo-home`; production must set it. `invalid` carries a value that
 * could not be read, so the page can say so instead of silently disabling the doors.
 */
export function siteEntry(): { enterprise: string | null; invalid: string | null } {
  const raw = process.env.HESTIA_HOME_ENTRY?.trim() ?? '';
  if (!raw) return { enterprise: isDemoDeployment() ? DEMO_ENTERPRISE : null, invalid: null };
  const slug = raw.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+|\/+$/g, '').replace(/^(c|w)\//, '');
  const parsed = workspaceSlugSchema.safeParse(slug);
  return parsed.success ? { enterprise: parsed.data, invalid: null } : { enterprise: null, invalid: raw };
}
export const siteEnterprise = () => siteEntry().enterprise;
