import { and, asc, eq } from 'drizzle-orm';
import { db, transaction } from '../../persistence/src/client';
import { workspaceDomains, workspaces } from '../../persistence/src/schema';
import { DomainError } from '../../contracts/src/project';
import { workspaceSlugSchema } from '../../contracts/src/workspaces';

// Entry domains on the shared deployment (ADR-0017). A registered host decides the request's enterprise; an
// unregistered host leaves the request unscoped, as on a single-enterprise deployment.

const hostPattern = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Lower-case hostname without port or trailing dot; null when it is not a domain name (IP literals included). */
export function normalizeHost(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase();
  if (!value || value.startsWith('[')) return null;
  const host = value.replace(/:\d+$/, '').replace(/\.$/, '');
  return hostPattern.test(host) && !/^[\d.]+$/.test(host) ? host : null;
}

/**
 * Host the visitor asked for. Behind a proxy that rewrites Host, HESTIA_HOST_HEADER names the header it forwards
 * (e.g. x-forwarded-host); for a list the last entry is the one our own proxy set, as for client addresses.
 */
export function requestHost(headers: Headers): string | null {
  const name = process.env.HESTIA_HOST_HEADER?.trim();
  const raw = name ? headers.get(name)?.split(',').at(-1) : headers.get('host');
  return normalizeHost(raw);
}

/** Slug of the enterprise that registered this host, or null. */
export async function enterpriseForHost(host: string | null): Promise<string | null> {
  if (!host) return null;
  const [row] = await db.select({ slug: workspaces.slug }).from(workspaceDomains)
    .innerJoin(workspaces, eq(workspaces.id, workspaceDomains.workspaceId)).where(eq(workspaceDomains.host, host));
  return row?.slug ?? null;
}

const parseHost = (raw: string) => {
  const host = normalizeHost(raw);
  if (!host || host !== raw.trim().toLowerCase().replace(/\.$/, '')) throw new DomainError('INVALID_HOST', `域名「${raw}」无效：只写主机名，不带协议、端口或路径。`, 400);
  return host;
};
async function workspaceIdOf(slug: string): Promise<string> {
  const parsed = workspaceSlugSchema.safeParse(slug);
  const [row] = parsed.success ? await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, parsed.data)) : [];
  if (!row) throw new DomainError('NOT_FOUND', `工作空间「${slug}」不存在。`, 404);
  return row.id;
}

/** Trusted admin command. Idempotent for the same workspace; a host already registered elsewhere is refused. */
export async function addWorkspaceDomain(slug: string, raw: string): Promise<{ host: string; added: boolean }> {
  const host = parseHost(raw), workspaceId = await workspaceIdOf(slug);
  return transaction(async (_client, tx) => {
    const inserted = await tx.insert(workspaceDomains).values({ host, workspaceId }).onConflictDoNothing().returning({ host: workspaceDomains.host });
    if (inserted.length) return { host, added: true };
    const [existing] = await tx.select({ workspaceId: workspaceDomains.workspaceId }).from(workspaceDomains).where(eq(workspaceDomains.host, host));
    if (existing?.workspaceId !== workspaceId) throw new DomainError('HOST_TAKEN', `域名「${host}」已登记给其他工作空间。`, 409);
    return { host, added: false };
  });
}
export async function removeWorkspaceDomain(slug: string, raw: string): Promise<{ host: string; removed: boolean }> {
  const host = parseHost(raw), workspaceId = await workspaceIdOf(slug);
  const removed = await db.delete(workspaceDomains).where(and(eq(workspaceDomains.host, host), eq(workspaceDomains.workspaceId, workspaceId)))
    .returning({ host: workspaceDomains.host });
  return { host, removed: removed.length > 0 };
}
export async function listWorkspaceDomains(slug: string): Promise<string[]> {
  const workspaceId = await workspaceIdOf(slug);
  return (await db.select({ host: workspaceDomains.host }).from(workspaceDomains).where(eq(workspaceDomains.workspaceId, workspaceId))
    .orderBy(asc(workspaceDomains.host))).map(row => row.host);
}

/** Slug of a workspace by id; null when the id is malformed or unknown. */
export async function workspaceSlugOf(workspaceId: string): Promise<string | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) return null;
  const [row] = await db.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return row?.slug ?? null;
}
