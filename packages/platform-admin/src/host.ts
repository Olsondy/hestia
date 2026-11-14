import { adminHost, requestHost } from '../../workspaces/src/domains';

// The platform console answers only on HESTIA_ADMIN_HOST (ADR-0018 supplement): admin.<main domain> on the shared
// deployment, a host the enterprise picks on a dedicated one. Unset means there is no console on this deployment.
export { adminHost };

export function isAdminRequest(headers: Headers): boolean {
  const host = adminHost();
  return !!host && requestHost(headers) === host;
}
