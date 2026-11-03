import type { PoolClient } from 'pg';
import { asc, eq } from 'drizzle-orm';
import type { CustomerActionView, FollowStatus, LeadFollowView, LeadView } from '../../contracts/src/finish-requests';
import { orm } from '../../persistence/src/client';
import { hestiaAuthUser, leadFollowEvents } from '../../persistence/src/schema';

/** Member view of a lead's follow-up: current status, status history and internal notes (S02). */
export async function followOf(client: Pick<PoolClient, 'query'>, requestId: string, status: string): Promise<LeadFollowView> {
  const rows = await orm(client as PoolClient).select({ id: leadFollowEvents.id, kind: leadFollowEvents.kind, status: leadFollowEvents.status, note: leadFollowEvents.note,
    actorId: leadFollowEvents.actorId, name: hestiaAuthUser.name, createdAt: leadFollowEvents.createdAt }).from(leadFollowEvents)
    .leftJoin(hestiaAuthUser, eq(hestiaAuthUser.id, leadFollowEvents.actorId)).where(eq(leadFollowEvents.requestId, requestId))
    .orderBy(asc(leadFollowEvents.createdAt), asc(leadFollowEvents.id));
  const by = (row: (typeof rows)[number]) => ({ userId: row.actorId, name: row.name });
  return {
    status: status as FollowStatus,
    history: rows.filter(row => row.kind === 'status').map(row => ({ status: row.status as FollowStatus, by: by(row), at: row.createdAt.toISOString() })),
    notes: rows.filter(row => row.kind === 'note').map(row => ({ id: row.id, by: by(row), text: row.note!, at: row.createdAt.toISOString() })),
  };
}

/** Latest customer action among submission, confirmations, messages, contact requests and binding applications. */
export function lastCustomerAction(lead: Pick<LeadView, 'origin' | 'createdAt' | 'events' | 'customer'> & { sharing: LeadView['sharing'] }): CustomerActionView | null {
  const actions: CustomerActionView[] = [
    ...(lead.origin === 'customer' ? [{ kind: 'submit' as const, at: lead.createdAt }] : []),
    ...lead.events.map(event => ({ kind: event.kind === 'confirmation' ? 'confirm' as const : event.contactRequested ? 'contact' as const : 'message' as const, at: event.createdAt })),
    ...lead.sharing.applications.map(application => ({ kind: 'apply' as const, at: application.createdAt })),
  ];
  return actions.reduce<CustomerActionView | null>((latest, action) => !latest || action.at > latest.at ? action : latest, null);
}
