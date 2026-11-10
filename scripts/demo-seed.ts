// D09 offline demo data for the stone H5 client. Trusted local command, never run against production.
//
//   pnpm demo:seed              prepare or re-confirm the demo (idempotent; reuses still-usable share links)
//   pnpm demo:seed --reset      wipe customer-side demo state (requests, bindings, sign-ins) and prepare again
//   pnpm demo:seed --no-render  skip pre-rendering scheme images (a running render Worker picks them up)
//   pnpm demo:seed --two-enterprises
//                               also a second demo enterprise, with entry domains a.localhost / b.localhost for the
//                               shared deployment (ADR-0017); the same demo number signs in to each as its own account
//
// Data goes through the service layer (accounts, workspace, stone catalog, member requests, shares) with the same
// validation, idempotency and records as the HTTP API. Only --reset deletes rows directly, scoped to the demo
// workspace and the demo phone numbers. All names are neutral and marked 演示; stones are procedural illustrations.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { db, pool, transaction } from '../packages/persistence/src/client';
import { hashPassword } from 'better-auth/crypto';
import { finishRequests, floorplanImports, hestiaAuthAccount, hestiaAuthSession, hestiaAuthUser, operations, phoneOtpChallenges, projectRenders, projectRevisions,
  projects, requestShares, resources, workspaceCustomers, workspaces } from '../packages/persistence/src/schema';
import { acceptInvitation, createInvitation } from '../packages/identity/src/service';
import { createWorkspace } from '../packages/workspaces/src/service';
import { addWorkspaceDomain } from '../packages/workspaces/src/domains';
import { addStones } from '../packages/finishes/src/catalog';
import { demoStones } from '../packages/finishes/src/demo-stones';
import { addSoftStyles } from '../packages/soft-styles/src/catalog';
import { demoSoftStyles } from '../packages/soft-styles/src/demo-styles';
import { initializeRenderQueue, renderQueue } from '../packages/renders/src/queue';
import { runRender } from '../packages/renders/src/runner';
import { createMemberRequest, listLeads } from '../packages/finish-requests/src/service';
import { createShare, revokeShare, sharePreview } from '../packages/finish-requests/src/sharing';

// Customers sign in with these numbers during the demo (mock SMS shows the code on the page).
const PHONES = { targeted: '13800138000', selfService: '13900139000', open: '13700137000' };
type Prepared = { key: 'targeted' | 'open'; name: string; stones: string[]; phone: string | null };
type Enterprise = { slug: string; name: string; member: { email: string; name: string }; host: string; files: string; prepared: Prepared[] };
const FIRST: Enterprise = { slug: 'demo-home', name: '演示家装企业', member: { email: 'consultant@demo-home.example', name: '演示方案顾问' }, host: 'a.localhost', files: '', prepared: [
  { key: 'targeted', name: '临水别墅 · 企业预置方案（演示）', stones: ['demo-white-marble', 'demo-beige-marble', 'demo-grey-woodgrain'], phone: PHONES.targeted },
  { key: 'open', name: '山景别墅 · 企业预置方案（演示）', stones: ['demo-beige-marble', 'demo-limestone', 'demo-dark-gold'], phone: null },
] };
const SECOND: Enterprise = { slug: 'demo-home-b', name: '演示家装企业乙', member: { email: 'consultant@demo-home-b.example', name: '演示方案顾问乙' }, host: 'b.localhost', files: '-b', prepared: [
  { key: 'open', name: '湖畔别墅 · 企业预置方案（演示）', stones: ['demo-grey-woodgrain', 'demo-white-marble', 'demo-limestone'], phone: null },
] };
const finishIds = ['finish-f1-living-floor', 'finish-f1-dining-floor', 'finish-f1-hall-floor', 'finish-f1-tv-wall', 'finish-f1-stair'];

const args = new Set(process.argv.slice(2));
// Demo data belongs to demo and development environments only: refuse production settings outright.
if (process.env.NODE_ENV === 'production' || process.env.SMS_PROVIDER !== 'mock') {
  console.error('demo:seed 只能在演示或开发环境运行（要求 SMS_PROVIDER=mock，且不是 NODE_ENV=production）。已停止，未改动任何数据。');
  process.exit(1);
}
const storage = path.resolve(process.env.PRIVATE_STORAGE_PATH ?? './private-data');
const stateFile = (e: Enterprise) => path.join(storage, 'demo', `seed${e.files}.json`);
/** Demo member's workbench password; kept across --reset, so a browser that saved it keeps working. */
const memberFile = (e: Enterprise) => path.join(storage, 'demo', `member${e.files}.json`);
/** `code` is the share code (XXXX-XXXX); it is returned only when shared, so the seed keeps it locally. */
type SavedShare = { requestId: string; shareId: string; code: string };
type Saved = Partial<Record<Prepared['key'], SavedShare>>;
/** Stable operation IDs so re-running the seed returns the same requests instead of creating new ones. */
const stableId = (label: string) => {
  const h = createHash('sha256').update(`hestia-demo-seed:${label}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const e164 = (phone: string) => `+86${phone}`;
const log = (line: string) => process.stdout.write(`${line}\n`);

async function reset(e: Enterprise) {
  const workspace = (await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, e.slug)))[0]?.id;
  const phones = Object.values(PHONES).map(e164);
  if (workspace) {
    const ids = (await db.select({ id: projects.id }).from(projects).where(eq(projects.workspaceId, workspace))).map(row => row.id);
    await transaction(async (_client, tx) => {
      await tx.delete(finishRequests).where(eq(finishRequests.workspaceId, workspace));
      for (const table of [operations, floorplanImports, projectRenders, resources, projectRevisions])
        await tx.delete(table).where(inArray(table.projectId, ids));
      await tx.delete(projects).where(inArray(projects.id, ids));
      await tx.delete(workspaceCustomers).where(eq(workspaceCustomers.workspaceId, workspace));
    });
    // Files from before M04 sit under projects/, newer ones under workspaces/{id}/projects/.
    for (const id of ids) for (const dir of [path.join(storage, 'projects', id), path.join(storage, 'workspaces', workspace, 'projects', id)])
      await rm(dir, { recursive: true, force: true });
  }
  // Demo customers start signed out with fresh verification-code limits.
  await db.delete(hestiaAuthSession).where(inArray(hestiaAuthSession.userId,
    db.select({ id: hestiaAuthUser.id }).from(hestiaAuthUser).where(inArray(hestiaAuthUser.phoneNumber, phones))));
  await db.delete(phoneOtpChallenges).where(inArray(phoneOtpChallenges.phoneNumber, phones));
  await rm(stateFile(e), { force: true });
  log(`已重置：${e.name}下的方案需求、绑定、客户关系与演示手机号的登录状态。`);
}

async function member(e: Enterprise) {
  const userId = async () => (await db.select({ id: hestiaAuthUser.id }).from(hestiaAuthUser).where(eq(hestiaAuthUser.email, e.member.email)))[0]?.id;
  const saved: { password?: string } = JSON.parse(await readFile(memberFile(e), 'utf8').catch(() => '{}'));
  const password = saved.password ?? randomBytes(9).toString('base64url');
  let id = await userId();
  if (!id) {
    const invitation = await createInvitation(e.member.email);
    await acceptInvitation(invitation.token, e.member.name, password);
    id = (await userId())!;
  } else if (!saved.password) {
    // Accounts from earlier seeds had a random, unshown password: set the one printed below.
    await db.update(hestiaAuthAccount).set({ password: await hashPassword(password), updatedAt: new Date() })
      .where(and(eq(hestiaAuthAccount.userId, id), eq(hestiaAuthAccount.providerId, 'credential')));
  }
  await mkdir(path.dirname(memberFile(e)), { recursive: true });
  await writeFile(memberFile(e), JSON.stringify({ email: e.member.email, password }, null, 2), { mode: 0o600 });
  return { id, password };
}

/** A saved share is reused while its code still previews and nobody is bound. */
async function usable(saved: SavedShare | undefined) {
  if (!saved?.code) return false;
  try {
    const preview = await sharePreview(saved.code);
    return !preview.bound && preview.request.id === saved.requestId;
  } catch { return false; }
}

async function prepare(e: Enterprise, withDomain: boolean) {
  if (args.has('--reset')) await reset(e);
  const { id: userId, password } = await member(e), principal = { userId };
  const workspace = (await createWorkspace({ kind: 'enterprise', slug: e.slug, name: e.name, adminEmail: e.member.email })).workspace;
  await transaction(async client => { await addStones(client, workspace.id, demoStones); await addSoftStyles(client, workspace.id, demoSoftStyles); });
  if (withDomain) await addWorkspaceDomain(e.slug, e.host);
  log(`企业入口：${e.name}（${e.slug}${withDomain ? `，域名 ${e.host}` : ''}），石材库 ${demoStones.length} 款、软装风格 ${demoSoftStyles.length} 套示意素材。`);

  const saved: Saved = JSON.parse(await readFile(stateFile(e), 'utf8').catch(() => '{}'));
  const leads = await listLeads(principal, workspace.id);
  for (const item of e.prepared) {
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
    saved[item.key] = { requestId: lead.id, shareId: created.share.id, code: created.code! };
  }
  await mkdir(path.dirname(stateFile(e)), { recursive: true });
  await writeFile(stateFile(e), JSON.stringify(saved, null, 2), { mode: 0o600 });

  if (!args.has('--no-render')) {
    const pending = (await db.select({ id: projectRenders.id }).from(projectRenders).innerJoin(projects, eq(projects.id, projectRenders.projectId))
      .where(and(eq(projects.workspaceId, workspace.id), inArray(projectRenders.status, ['queued', 'retry_wait']))).orderBy(asc(projectRenders.createdAt))).map(row => row.id);
    for (const [index, id] of pending.entries()) {
      const started = Date.now();
      await runRender(id);
      const status = (await db.select({ status: projectRenders.status }).from(projectRenders).where(eq(projectRenders.id, id)))[0]?.status;
      log(`预生成效果图 ${index + 1}/${pending.length}：${status === 'completed' ? '完成' : status}（${Math.round((Date.now() - started) / 1000)} 秒）`);
    }
  }
  const [{ failed }] = await db.select({ failed: count() }).from(projectRenders).innerJoin(projects, eq(projects.id, projectRenders.projectId))
    .where(and(eq(projects.workspaceId, workspace.id), eq(projectRenders.status, 'failed')));

  const configured = new URL(process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000');
  const base = withDomain ? `${configured.protocol}//${e.host}${configured.port ? `:${configured.port}` : ''}` : configured.origin;
  log('');
  log(`${e.name} 演示数据已就绪（短信为模拟发送，验证码显示在登录页）：`);
  log(`  客户自助入口      ${base}/c                  演示手机号 ${PHONES.selfService}`);
  if (saved.targeted) {
    log(`  定向分享码        ${saved.targeted.code}`);
    log(`                    指定手机号 ${PHONES.targeted}（用其他号码登录会提示不一致，可提交绑定申请）`);
  }
  log(`  分享码            ${saved.open!.code}`);
  log(`                    任一手机号登录即绑定，如 ${PHONES.open}`);
  log(`                    在 H5 首页「收到企业的分享码？」输入或粘贴；应用内部地址 ${base}/s/<分享码>`);
  log(`  企业工作台        ${base}/w                  成员 ${e.member.email} / ${password}`);
  if (failed) log(`注意：有 ${failed} 张效果图生成失败，可运行 pnpm demo:seed --reset 重新准备。`);
}

async function main() {
  await initializeRenderQueue();
  const two = args.has('--two-enterprises');
  await prepare(FIRST, two);
  if (two) {
    log('');
    await prepare(SECOND, true);
    log('');
    log(`两家企业：在 ${FIRST.host} 与 ${SECOND.host} 用同一个演示手机号各自登录，是两个互不相干的账号；在一家输入另一家的分享码会提示不存在。`);
  }
  log(`分享码与成员密码另存于 ${path.relative(process.cwd(), path.join(storage, 'demo'))}/（不提交仓库）。`);
}

try { await main(); }
catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
finally { await pool.end(); }
