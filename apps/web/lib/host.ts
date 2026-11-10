import { DomainError } from '../../../packages/contracts/src/project';
import { enterpriseForHost, requestHost, workspaceSlugOf } from '../../../packages/workspaces/src/domains';
import { siteEntry } from './site-entry';

// Which enterprise a request belongs to on the shared deployment (ADR-0017).

/** Enterprise of a registered entry domain; null for an unregistered host (the request is not scoped). */
export const hostEnterprise = (headers: Headers) => enterpriseForHost(requestHost(headers));

/** Enterprise the pages at /, /c and /w serve: the registered domain's, else HESTIA_HOME_ENTRY (ADR-0015/0016). */
export async function pageEnterprise(headers: Headers): Promise<{ enterprise: string | null; invalid: string | null; byDomain: boolean }> {
  const byHost = await hostEnterprise(headers);
  return byHost ? { enterprise: byHost, invalid: null, byDomain: true } : { ...siteEntry(), byDomain: false };
}

const entryNotFound = () => new DomainError('ENTRY_NOT_FOUND', '没有找到这个企业入口，请确认链接。', 404);

/** On a registered domain the path's enterprise must be the domain's; any other reads as not found. */
export async function scopedEntry(request: Request, entry: string): Promise<string> {
  const host = await hostEnterprise(request.headers);
  if (host && host !== entry) throw entryNotFound();
  return entry;
}
/** Enterprise a public share code must belong to on this host; null when the host is not scoped. */
export const shareScope = (request: Request) => hostEnterprise(request.headers);
/** Route params of a /api/client/{entry}/… handler, after checking the entry against the request's domain. */
export async function clientParams<T extends { entry: string }>(request: Request, params: Promise<T>): Promise<T> {
  const value = await params;
  await scopedEntry(request, value.entry);
  return value;
}
const workspaceNotFound = () => new DomainError('NOT_FOUND', '工作空间不存在。', 404);
/** Route params of a /api/workspaces/{workspaceId}/… handler: on a registered domain only that enterprise's workspace. */
export async function workspaceParams<T extends { workspaceId: string }>(request: Request, params: Promise<T>): Promise<T> {
  const value = await params, host = await hostEnterprise(request.headers);
  if (host && (await workspaceSlugOf(value.workspaceId)) !== host) throw workspaceNotFound();
  return value;
}
/** Workbench lookup by slug: on a registered domain only the domain's own enterprise. */
export async function scopedWorkspaceSlug(request: Request, slug: string): Promise<string> {
  const host = await hostEnterprise(request.headers);
  if (host && host !== slug) throw workspaceNotFound();
  return slug;
}
