import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { pool, transaction } from '../../persistence/src/client';
import { auth, authOrigin } from '../../identity/src/auth';
import { acceptInvitation, createInvitation } from '../../identity/src/service';
import { mockSmsSender, setSmsSender } from '../../identity/src/sms';
import { createWorkspace } from '../../workspaces/src/service';
import { addStones, retireStone } from '../../finishes/src/catalog';
import { demoStones } from '../../finishes/src/demo-stones';
import { addSoftStyles, retireSoftStyle } from '../../soft-styles/src/catalog';
import { demoSoftStyles } from '../../soft-styles/src/demo-styles';
import * as authRoute from '../../../apps/web/app/api/auth/[...all]/route';
import * as catalogRoute from '../../../apps/web/app/api/workspaces/[workspaceId]/catalog/route';

// W05 石材与软装 over the HTTP route and real PostgreSQL. Other enterprises are covered by the M06 isolation matrix.
const run = randomUUID().slice(0, 8), slug = `w05-${run}`, email = `w05-${run}@example.test`, password = 'synthetic-w05-password-264!', phones: string[] = [];
let workspaceId = '', member = '', customer = '';
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const read = async (cookie: string) => {
  const response = await catalogRoute.GET(new Request(`${authOrigin}/api/test`, { headers: cookie ? { Cookie: cookie } : {} }), { params: Promise.resolve({ workspaceId }) } as never);
  return { status: response.status, body: await response.json() };
};

before(async () => {
  process.env.HESTIA_OTP_SOURCE_HEADER = 'x-real-ip';
  setSmsSender(mockSmsSender);
  await acceptInvitation((await createInvitation(email)).token, '合成成员', password);
  workspaceId = (await createWorkspace({ kind: 'enterprise', slug, name: '目录验证企业', adminEmail: email })).workspace.id;
  await transaction(async client => {
    await addStones(client, workspaceId, [...demoStones, { ...demoStones[0], version: 2 }]);
    await retireStone(client, workspaceId, { stoneId: demoStones[0].id, stoneVersion: 1 });
    await addSoftStyles(client, workspaceId, demoSoftStyles);
    await retireSoftStyle(client, workspaceId, { styleId: demoSoftStyles[1].id, styleVersion: 1 });
  });
  member = cookieOf(await auth.api.signInEmail({ body: { email, password }, asResponse: true }));
  const phoneNumber = `197${String(randomInt(0, 1e8)).padStart(8, '0')}`; phones.push(`+86${phoneNumber}`);
  const post = (path: string, payload: unknown) => authRoute.POST(new Request(`${authOrigin}/api/auth/${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: authOrigin, 'X-Real-IP': `10.8.${randomInt(0, 255)}.${randomInt(1, 255)}` }, body: JSON.stringify(payload) }));
  const code = (await (await post('phone/send-code', { phoneNumber, entry: slug })).json()).demoCode;
  customer = cookieOf(await post('phone/sign-in', { phoneNumber, entry: slug, code }));
});
after(async () => {
  try {
    await pool.query('DELETE FROM workspaces WHERE slug=$1', [slug]);
    const users = (await pool.query('SELECT id FROM hestia_auth_user WHERE email=$1 OR phone_number=ANY($2)', [email, phones])).rows.map(r => r.id);
    await pool.query('DELETE FROM workspaces WHERE personal_user_id=ANY($1)', [users]);
    await pool.query('DELETE FROM phone_otp_challenges WHERE phone_number=ANY($1)', [phones]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=$1', [email]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
  } finally { await pool.end(); }
});

test('members read every stone and soft style version, retired ones marked; customers and visitors cannot', async () => {
  const { status, body } = await read(member);
  assert.equal(status, 200, JSON.stringify(body));
  const stones = body.catalog.stones.map((s: { status: string; stone: { id: string; version: number } }) => `${s.stone.id}@${s.stone.version}:${s.status}`);
  assert.equal(stones.length, demoStones.length + 1);
  assert.ok(stones.includes(`${demoStones[0].id}@1:retired`) && stones.includes(`${demoStones[0].id}@2:active`));
  const styles = body.catalog.softStyles;
  assert.deepEqual(styles.map((s: { status: string; style: { id: string } }) => `${s.style.id}:${s.status}`), ['demo-modern:active', 'demo-luxury:retired', 'demo-chinese:active']);
  // Rooms are described for people, not as furnishing rules.
  const luxuryLiving = styles[1].rooms.find((r: { type: string }) => r.type === 'living');
  assert.match(luxuryLiving.summary, /(L 型沙发、沙发|沙发、L 型沙发)换弧形沙发/);
  assert.match(luxuryLiving.summary, /落地灯 ×2/);
  assert.equal(JSON.stringify(styles).includes('extras'), false);
  // A customer of the same enterprise and an anonymous visitor are refused.
  assert.equal((await read(customer)).status, 404);
  assert.equal((await read('')).status, 401);
});
