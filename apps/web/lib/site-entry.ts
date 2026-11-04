import { workspaceSlugSchema } from '../../../packages/contracts/src/workspaces';

/**
 * Enterprise that the site entry (ADR-0015) links its two doors to: the customer H5 `/c/{slug}` and the workbench
 * `/w/{slug}`. Set per deployment with HESTIA_HOME_ENTRY (the demo uses `demo-home`). Unset: the doors explain that
 * customers and members arrive through the links their enterprise gives them.
 */
export function siteEnterprise() {
  const entry = workspaceSlugSchema.safeParse(process.env.HESTIA_HOME_ENTRY?.trim() || undefined);
  return entry.success ? entry.data : null;
}
/** Demo deployments (mock SMS) say so on the site entry. */
export const isDemoDeployment = () => process.env.SMS_PROVIDER === 'mock';
