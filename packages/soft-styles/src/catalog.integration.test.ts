import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from '../../persistence/src/client';
import { acceptInvitation, createInvitation } from '../../identity/src/service';
import { createWorkspace } from '../../workspaces/src/service';
import * as catalogRoute from '../../../apps/web/app/api/client/[entry]/catalog/route';
import { addSoftStyles, retireSoftStyle, softStyleCatalog, softStyleVersion, workspaceSoftStyles } from './catalog';
import { demoSoftStyles } from './demo-styles';

// K01 soft style catalogue on real PostgreSQL: immutable versions, retiring, workspace isolation, customer view.
const run = randomUUID().slice(0, 8), slugs = [`k01-a-${run}`, `k01-b-${run}`], email = `k01-${run}@example.test`;
after(async () => {
  try {
    await pool.query('DELETE FROM workspaces WHERE slug=ANY($1)', [slugs]);
    const users = (await pool.query('SELECT id FROM hestia_auth_user WHERE email=$1', [email])).rows.map(r => r.id);
    await pool.query('DELETE FROM workspaces WHERE personal_user_id=ANY($1)', [users]);
    await pool.query('DELETE FROM hestia_invitation WHERE email=$1', [email]);
    await pool.query('DELETE FROM hestia_auth_user WHERE id=ANY($1)', [users]);
  } finally { await pool.end(); }
});

test('soft styles: versions are immutable, retired versions leave the choices but stay readable, workspaces are isolated', async () => {
  await acceptInvitation((await createInvitation(email)).token, '合成管理员', 'synthetic-k01-password-1');
  const [a, b] = await Promise.all(slugs.map(async (slug, i) => (await createWorkspace({ kind: 'enterprise', slug, name: `软装验证${i}`, adminEmail: email })).workspace.id));
  const [modern, luxury] = demoSoftStyles;
  await transaction(async client => {
    await addSoftStyles(client, a, demoSoftStyles);
    // Re-adding a version with different content keeps the original (immutable); a new version is a new row.
    await addSoftStyles(client, a, [{ ...modern, name: '改名' }, { ...modern, version: 2, name: '现代简约 二版' }]);
  });
  const active = await workspaceSoftStyles(pool, a);
  assert.deepEqual(active.map(s => `${s.id}@${s.version}:${s.name}`), ['demo-modern@1:现代简约', 'demo-luxury@1:轻奢', 'demo-chinese@1:新中式', 'demo-modern@2:现代简约 二版']);
  await transaction(client => retireSoftStyle(client, a, { styleId: luxury.id, styleVersion: 1 }));
  assert.ok(!(await workspaceSoftStyles(pool, a)).some(s => s.id === luxury.id), 'retired style is no longer offered');
  assert.equal((await softStyleVersion(pool, a, { styleId: luxury.id, styleVersion: 1 })).status, 'retired', 'but still readable for existing schemes');
  assert.deepEqual((await softStyleCatalog(pool, a)).filter(e => e.status === 'retired').map(e => e.style.id), [luxury.id]);
  // Another workspace sees nothing of it.
  assert.deepEqual(await workspaceSoftStyles(pool, b), []);
  await assert.rejects(softStyleVersion(pool, b, { styleId: modern.id, styleVersion: 1 }), { code: 'SOFT_STYLE_NOT_FOUND' });
  // The customer catalogue lists active styles for display only (no furnishing rules).
  const response = await catalogRoute.GET(new Request('http://test/api/client/x/catalog'), { params: Promise.resolve({ entry: slugs[0] }) } as never);
  const catalog = (await response.json()).catalog;
  assert.deepEqual(catalog.softStyles.map((s: { id: string; version: number }) => `${s.id}@${s.version}`), ['demo-modern@1', 'demo-chinese@1', 'demo-modern@2']);
  assert.equal(JSON.stringify(catalog.softStyles).includes('extras'), false);
  // The demo villa offered to customers is furnished by a style.
  assert.ok(catalog.demoVilla.finishes.length > 0);
});
