import { createInvitation } from '../packages/identity/src/service';
import { pool } from '../packages/persistence/src/client';

try {
  const [email, hoursText = '24'] = process.argv.slice(2), hours = Number(hoursText);
  if (!email || !Number.isFinite(hours) || hours <= 0 || hours > 720)
    throw new Error('Usage: node --env-file=.env --import tsx scripts/invite.ts email [hours=24; maximum=720]');
  if (!process.env.BETTER_AUTH_URL) throw new Error('BETTER_AUTH_URL is required.');
  const invitation = await createInvitation(email, new Date(Date.now() + hours * 3600000));
  const url = new URL('/', process.env.BETTER_AUTH_URL); url.searchParams.set('invite', invitation.token);
  // This admin command intentionally displays the bearer invitation once; it is never stored in plaintext.
  console.log(JSON.stringify({ email: invitation.email, expiresAt: invitation.expiresAt, invitationUrl: url.href,
    delivery: 'not-sent: share this link with the intended invitee through your existing channel' }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to create invitation.'); process.exitCode = 1;
} finally { await pool.end(); }
