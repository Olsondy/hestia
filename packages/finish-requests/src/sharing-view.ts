import type { PoolClient } from 'pg';
import { asc, eq, getTableColumns } from 'drizzle-orm';
import type { LeadView } from '../../contracts/src/finish-requests';
import { orm } from '../../persistence/src/client';
import { bindingApplications, bindingEvents, hestiaAuthUser, requestShares } from '../../persistence/src/schema';

const masked = (phone: string | null) => phone ? `${phone.slice(0, 6)}****${phone.slice(-4)}` : null;
/** Member view of a request's shares, binding applications and binding history. */
export async function sharingOf(client: Pick<PoolClient, 'query'>, requestId: string): Promise<LeadView['sharing']> {
  const tx = orm(client as PoolClient);
  const shares = await tx.select().from(requestShares).where(eq(requestShares.requestId, requestId)).orderBy(asc(requestShares.createdAt));
  const applications = await tx.select({ ...getTableColumns(bindingApplications), phoneNumber: hestiaAuthUser.phoneNumber }).from(bindingApplications)
    .leftJoin(hestiaAuthUser, eq(hestiaAuthUser.id, bindingApplications.applicantId)).where(eq(bindingApplications.requestId, requestId)).orderBy(asc(bindingApplications.createdAt));
  const history = await tx.select().from(bindingEvents).where(eq(bindingEvents.requestId, requestId)).orderBy(asc(bindingEvents.createdAt));
  return {
    shares: shares.map(s => ({ id: s.id, targetPhone: masked(s.targetPhone), bindingCode: !!s.codeHash, expiresAt: s.expiresAt?.toISOString() ?? null,
      revokedAt: s.revokedAt?.toISOString() ?? null, createdAt: s.createdAt.toISOString() })),
    applications: applications.map(a => ({ id: a.id, shareId: a.shareId, applicant: { userId: a.applicantId, phone: a.phoneNumber }, note: a.note, status: a.status as LeadView['sharing']['applications'][number]['status'],
      createdAt: a.createdAt.toISOString() })),
    history: history.map(e => ({ kind: e.kind, method: e.method, actorId: e.actorId, subjectId: e.subjectId, createdAt: e.createdAt.toISOString() })),
  };
}
