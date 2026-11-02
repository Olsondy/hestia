// D09 offline demo data for the stone H5 client. Trusted local command, never run against production.
//
//   pnpm demo:seed              prepare or re-confirm the demo (idempotent; reuses still-usable share links)
//   pnpm demo:seed --reset      wipe customer-side demo state (requests, bindings, sign-ins) and prepare again
//   pnpm demo:seed --no-render  skip pre-rendering scheme images (a running render Worker picks them up)
//
// Data goes through the service layer (accounts, workspace, stone catalog, member requests, shares) with the same
// validation, idempotency and records as the HTTP API. Only --reset deletes rows directly, scoped to the demo
// workspace and the demo phone numbers. All names are neutral and marked 演示; stones are procedural illustrations.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pool, transaction } from '../packages/persistence/src/client';
import { acceptInvitation, createInvitation } from '../packages/identity/src/service';
import { createWorkspace } from '../packages/workspaces/src/service';
import { addStones } from '../packages/finishes/src/catalog';
import { demoStones } from '../packages/finishes/src/demo-homes';
import { initializeRenderQueue, renderQueue } from '../packages/renders/src/queue';
import { runRender } from '../packages/renders/src/runner';
import { createMemberRequest, listLeads } from '../packages/finish-requests/src/service';
import { createShare, revokeShare, sharePreview } from '../packages/finish-requests/src/sharing';

const DEMO = {
  slug: 'demo-home', name: '演示家装企业', member: { email: 'consultant@demo-home.example', name: '演示方案顾问' },
  // Customers sign in with these numbers during the demo (mock SMS shows the code on the page).
  phones: { targeted: '13800138000', selfService: '13900139000', withCode: '13700137000' },
};
const finishIds = ['finish-f1-living-floor', 'finish-f1-dining-floor', 'finish-f1-hall-floor', 'finish-f1-tv-wall', 'finish-f1-stair'];
const prepared = [
  { key: 'targeted', name: '临水别墅 · 企业预置方案（演示）', stones: ['demo-white-marble', 'demo-beige-marble', 'demo-grey-woodgrain'], phone: DEMO.phones.targeted },
  { key: 'code', name: '山景别墅 · 企业预置方案（演示）', stones: ['demo-beige-marble', 'demo-limestone', 'demo-dark-gold'], phone: null },
] as const;

const args = new Set(process.argv.slice(2));
const storage = path.resolve(process.env.PRIVATE_STORAGE_PATH ?? './private-data');
const stateFile = path.join(storage, 'demo', 'seed.json');
type SavedShare = { requestId: string; shareId: string; token: string; code: string | null };
type Saved = Partial<Record<(typeof prepared)[number]['key'], SavedShare>>;
/** Stable operation IDs so re-running the seed returns the same requests instead of creating new ones. */
const stableId = (label: string) => {
  const h = createHash('sha256').update(`hestia-demo-seed:${label}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const e164 = (phone: string) => `+86${phone}`;
const log = (line: string) => process.stdout.write(`${line}\n`);

async function reset() {
  const workspace = (await pool.query('SELECT id FROM workspaces WHERE slug=$1', [DEMO.slug])).rows[0]?.id as string | undefined;
  const phones = Object.values(DEMO.phones).map(e164);
  if (workspace) {
    const projects = (await pool.query('SELECT id FROM projects WHERE workspace_id=$1', [workspace])).rows.map(row => row.id as string);
    await transaction(async client => {
      await client.query('DELETE FROM finish_requests WHERE workspace_id=$1', [workspace]);
      for (const table of ['operations', 'floorplan_imports', 'project_renders', 'resources', 'project_revisions'])
        await client.query(`DELETE FROM ${table} WHERE project_id=ANY($1::uuid[])`, [projects]);
      await client.query('DELETE FROM projects WHERE id=ANY($1::uuid[])', [projects]);
      await client.query('DELETE FROM workspace_customers WHERE workspace_id=$1', [workspace]);
    });
    for (const id of projects) await rm(path.join(storage, 'projects', id), { recursive: true, force: true });
  }
  // Demo customers start signed out with fresh verification-code limits.
  await pool.query('DELETE FROM hestia_auth_session WHERE user_id IN (SELECT id FROM hestia_auth_user WHERE phone_number=ANY($1))', [phones]);
  await pool.query('DELETE FROM phone_otp_challenges WHERE phone_number=ANY($1)', [phones]);
  await rm(stateFile, { force: true });
  log('已重置：演示企业下的方案需求、绑定、客户关系与演示手机号的登录状态。');
}

async function member() {
  const existing = (await pool.query('SELECT id FROM hestia_auth_user WHERE email=$1', [DEMO.member.email])).rows[0]?.id as string | undefined;
  if (existing) return existing;
  // The member never signs in during the client demo; the password is random and not shown.
  const invitation = await createInvitation(DEMO.member.email);
  await acceptInvitation(invitation.token, DEMO.member.name, randomBytes(18).toString('base64url'));
  return (await pool.query('SELECT id FROM hestia_auth_user WHERE email=$1', [DEMO.member.email])).rows[0].id as string;
}

/** A saved share is reused while its link previews, nobody is bound and (for code shares) the code is unused and valid. */
async function usable(saved: SavedShare | undefined) {
  if (!saved) return false;
  try {
    const preview = await sharePreview(saved.token);
    if (preview.bound || preview.request.id !== saved.requestId) return false;
    if (!saved.code) return true;
    const row = (await pool.query('SELECT code_used_at IS NULL AND code_expires_at > now() + interval \'2 hours\' AND code_attempts < 3 AS ok FROM request_shares WHERE id=$1', [saved.shareId])).rows[0];
    return !!row?.ok;
  } catch { return false; }
}

async function main() {
  await initializeRenderQueue();
  if (args.has('--reset')) await reset();
  const userId = await member(), principal = { userId };
  const workspace = (await createWorkspace({ kind: 'enterprise', slug: DEMO.slug, name: DEMO.name, adminEmail: DEMO.member.email })).workspace;
  await transaction(client => addStones(client, workspace.id, demoStones));
  log(`企业入口：${DEMO.name}（${DEMO.slug}），石材库 ${demoStones.length} 款示意素材。`);

  const saved: Saved = JSON.parse(await readFile(stateFile, 'utf8').catch(() => '{}'));
  const leads = await listLeads(principal, workspace.id);
  for (const item of prepared) {
    // Same operation ID + same content returns the existing request (published once all schemes pass the layout checks).
    const lead = leads.find(l => l.origin === 'member' && l.title === item.name) ?? await createMemberRequest(principal, workspace.id, {
      operationId: stableId(`request:${item.key}`), name: item.name, finishIds, stones: item.stones.map(stoneId => ({ stoneId, stoneVersion: 1 })),
      note: '演示数据：企业成员为客户预先准备的方案。' }, { renderQueue });
    if (lead.status !== 'published') throw new Error(`预置方案未发布（${lead.status}），请检查石材目录与排版校验。`);
    if (await usable(saved[item.key])) continue;
    if (lead.customer) throw new Error(`「${item.name}」已绑定客户。运行 pnpm demo:seed --reset 恢复演示初始状态。`);
    // Replace a used or expired link: revoke the old one (recorded) and share again.
    for (const share of lead.sharing.shares.filter(s => !s.revokedAt))
      await revokeShare(principal, workspace.id, lead.id, share.id, { operationId: randomUUID() });
    const created = await createShare(principal, workspace.id, lead.id, { operationId: randomUUID(), ...(item.phone ? { phone: item.phone } : {}), expiresInDays: 90 });
    saved[item.key] = { requestId: lead.id, shareId: created.share.id, token: created.token!, code: created.bindingCode };
  }
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(saved, null, 2), { mode: 0o600 });

  if (!args.has('--no-render')) {
    const pending = (await pool.query(`SELECT r.id FROM project_renders r JOIN projects p ON p.id=r.project_id
      WHERE p.workspace_id=$1 AND r.status IN ('queued','retry_wait') ORDER BY r.created_at`, [workspace.id])).rows.map(row => row.id as string);
    for (const [index, id] of pending.entries()) {
      const started = Date.now();
      await runRender(id);
      const status = (await pool.query('SELECT status FROM project_renders WHERE id=$1', [id])).rows[0]?.status;
      log(`预生成效果图 ${index + 1}/${pending.length}：${status === 'completed' ? '完成' : status}（${Math.round((Date.now() - started) / 1000)} 秒）`);
    }
  }
  const failed = Number((await pool.query(`SELECT count(*) FROM project_renders r JOIN projects p ON p.id=r.project_id WHERE p.workspace_id=$1 AND r.status='failed'`, [workspace.id])).rows[0].count);

  const base = (process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
  log('');
  log('演示数据已就绪（短信为模拟发送，验证码显示在登录页）：');
  log(`  客户自助入口      ${base}/c/${DEMO.slug}        演示手机号 ${DEMO.phones.selfService}`);
  log(`  定向手机号分享    ${base}/s/${saved.targeted!.token}`);
  log(`                    指定手机号 ${DEMO.phones.targeted}（用其他号码登录会提示不一致，可提交绑定申请）`);
  log(`  绑定码分享        ${base}/s/${saved.code!.token}`);
  log(`                    绑定码 ${saved.code!.code}（任一手机号，如 ${DEMO.phones.withCode}；48 小时内有效）`);
  if (failed) log(`注意：有 ${failed} 张效果图生成失败，可运行 pnpm demo:seed --reset 重新准备。`);
  log(`链接与绑定码另存于 ${path.relative(process.cwd(), stateFile)}（不提交仓库）。`);
}

try { await main(); }
catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
finally { await pool.end(); }
