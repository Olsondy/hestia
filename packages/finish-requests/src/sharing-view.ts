import type { PoolClient } from 'pg';
import type { LeadView } from '../../contracts/src/finish-requests';

const masked = (phone: string | null) => phone ? `${phone.slice(0, 6)}****${phone.slice(-4)}` : null;
/** Member view of a request's shares, binding applications and binding history. */
export async function sharingOf(client: Pick<PoolClient, 'query'>, requestId: string): Promise<LeadView['sharing']> {
  const shares = (await client.query('SELECT * FROM request_shares WHERE request_id=$1 ORDER BY created_at', [requestId])).rows;
  const applications = (await client.query(`SELECT a.*,u.phone_number FROM binding_applications a LEFT JOIN hestia_auth_user u ON u.id=a.applicant_id
    WHERE a.request_id=$1 ORDER BY a.created_at`, [requestId])).rows;
  const history = (await client.query('SELECT * FROM binding_events WHERE request_id=$1 ORDER BY created_at', [requestId])).rows;
  return {
    shares: shares.map(s => ({ id: s.id, targetPhone: masked(s.target_phone), bindingCode: !!s.code_hash, expiresAt: s.expires_at?.toISOString() ?? null,
      revokedAt: s.revoked_at?.toISOString() ?? null, createdAt: s.created_at.toISOString() })),
    applications: applications.map(a => ({ id: a.id, shareId: a.share_id, applicant: { userId: a.applicant_id, phone: a.phone_number }, note: a.note, status: a.status,
      createdAt: a.created_at.toISOString() })),
    history: history.map(e => ({ kind: e.kind, method: e.method, actorId: e.actor_id, subjectId: e.subject_id, createdAt: e.created_at.toISOString() })),
  };
}
