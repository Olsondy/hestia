import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { DomainError, idSchema } from '../../contracts/src/project';
import { addLeadNoteSchema, setFollowStatusSchema, type LeadView } from '../../contracts/src/finish-requests';
import { advisoryXactLock, transaction, type Database } from '../../persistence/src/client';
import { finishRequestOperations, finishRequests, leadFollowEvents } from '../../persistence/src/schema';
import { actorOf, type Principal } from '../../workspaces/src/access';
import { listLeads, lockedRequest, memberOf } from './service';

// S02 线索跟进: members set the follow status and append internal notes. Customers, other enterprises' members and
// visitors get the same 404 as for any lead they cannot see. Every write carries an operation ID and is idempotent.

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function memberWrite(principal: Principal, workspaceId: string, requestId: string, operationId: string, hash: string,
  work: (tx: Database, row: { id: string; follow_status: string }, userId: string) => Promise<void>) {
  const userId = actorOf(principal);
  await transaction(async (client, tx) => {
    const row = await lockedRequest(client, requestId);
    if (row.workspace_id !== idSchema.parse(workspaceId)) throw new DomainError('NOT_FOUND', '方案需求不存在。', 404);
    await memberOf(client, userId, row.workspace_id);
    await advisoryXactLock(tx, `follow:${userId}:${operationId}`);
    const [previous] = await tx.select({ requestHash: finishRequestOperations.requestHash }).from(finishRequestOperations)
      .where(and(eq(finishRequestOperations.actorId, userId), eq(finishRequestOperations.id, operationId)));
    if (previous) { if (previous.requestHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', '此操作标识已用于不同请求。', 409); return; }
    const [{ follow_status }] = await tx.select({ follow_status: finishRequests.followStatus }).from(finishRequests).where(eq(finishRequests.id, row.id));
    await work(tx, { id: row.id, follow_status }, userId);
    await tx.insert(finishRequestOperations).values({ actorId: userId, id: operationId, requestId: row.id, requestHash: hash, result: {} });
  });
  return (await listLeads(principal, workspaceId)).find(lead => lead.id === requestId)!;
}

/** Set the follow status; setting the current status again records nothing. */
export async function setFollowStatus(principal: Principal, workspaceId: string, requestId: string, input: unknown): Promise<LeadView> {
  const value = setFollowStatusSchema.parse(input);
  return memberWrite(principal, workspaceId, requestId, value.operationId, sha({ kind: 'follow', requestId, status: value.status }), async (tx, row, userId) => {
    if (row.follow_status === value.status) return;
    await tx.update(finishRequests).set({ followStatus: value.status, updatedAt: sql`now()` }).where(eq(finishRequests.id, row.id));
    await tx.insert(leadFollowEvents).values({ id: randomUUID(), requestId: row.id, actorId: userId, kind: 'status', status: value.status });
  });
}
/** Append an internal note (500 characters at most). Notes are never edited or shown to customers. */
export async function addLeadNote(principal: Principal, workspaceId: string, requestId: string, input: unknown): Promise<LeadView> {
  const value = addLeadNoteSchema.parse(input);
  return memberWrite(principal, workspaceId, requestId, value.operationId, sha({ kind: 'note', requestId, note: value.note }), async (tx, row, userId) => {
    await tx.insert(leadFollowEvents).values({ id: randomUUID(), requestId: row.id, actorId: userId, kind: 'note', note: value.note });
  });
}
