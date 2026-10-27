# D01：工作空间与项目归属

2026-10-28，分支 `feat/d01-workspaces`。服务端与迁移已在本地独立数据库 `hestia_d01`（PostgreSQL 14.23）验证；未启动 Next、Worker 或 Render Worker，未执行依赖运行中 Next 的 `scripts/validation/*` 脚本。

## 数据模型

按扩展–迁移–收缩三步推进，每步单独提交，`pnpm test:db` 均保持除既知模型配置项外全部通过。

- `0014-workspaces.sql`（扩展）：`workspace_types`（类型即数据：`max_members`、`usage_policy`、`provisioning`），种子为 `personal`（单成员、`member_credits`、按账号自动开通）与 `enterprise`（不限成员、`unmetered`、显式创建）；`workspaces`（`kind`、`name`、可选唯一 `slug`、唯一 `personal_user_id`、`settings jsonb`）；`workspace_members`（`admin` / `member`）。`projects` 增加 `workspace_id`、`created_by`。函数 `hestia_backfill_personal_workspaces()` 为每个账号及每个历史 `owner_id` 建个人工作空间并迁入项目，可重复调用。视图 `project_access(project_id, workspace_id, user_id, via, role)` 是项目授权的唯一来源，D01 只有 `via='member'`。
- 切换：所有按项目作用域的服务（项目、资源、底图、家具命令、候选、风格、出图、任务、布局规划、对话 Worker）改为经 `project_access` 授权；项目内记录对同一工作空间成员共享，成员可撤销他人命令或采用。展示/选择仍绑定操作者与会话，采用须由选择者本人完成。
- `0015-workspace-ownership.sql`（收缩）：再执行一次回填（覆盖部署间隙旧代码写入的项目），`projects.workspace_id`、`created_by` 设为非空，删除 `projects.owner_id`；其余表的 `owner_id` 改名 `actor_id`（含约束名），只表示操作者（幂等范围、审计、明确选择），不再授予访问。

授权按“能力 → 允许的关系”表达（`packages/workspaces/src/access.ts`）。D02/D08 增加客户关系时扩展视图的 `via` 并声明新能力，现有工作台能力仍只接受成员。积分保持 C01 行为：仍按账号记账，个人工作空间类型标注 `member_credits`，企业为 `unmetered`（企业额度不在本票）。

## 接口

- `GET /api/workspaces`：本人所属工作空间（自动确保个人空间存在）。
- `GET /api/workspaces/{id}`、`GET|POST /api/workspaces/{id}/projects`：仅成员；`/api/projects` 仍代表个人工作空间，行为不变。
- `GET|POST /api/workspaces/{id}/members`、`PATCH|DELETE /api/workspaces/{id}/members/{userId}`：成员可查看，仅管理员可增改删；按邮箱添加已有账号；超出类型成员上限 409 `WORKSPACE_MEMBER_LIMIT`；至少保留一名管理员 409 `LAST_ADMIN`。非成员一律 404。
- 企业工作空间无公开创建接口：`pnpm workspace:create <kind> <slug> <name> <admin-email>`，按 `slug` 幂等，拒绝 `per_user` 类型。

## 实际执行的验证

- 在 0013 结构上用当时的服务创建两名账号（注册、邀请各一）及项目、家具命令、已采用与未采用候选、改名、排队出图、资源；记录各服务读数后依次应用 0014、切换代码、0015，三次读数与迁移前逐字节一致（项目修订号 4、候选修订号、资源、出图、命令、风格、任务及跨账号 404）。脚本位于会话临时目录，未提交。
- `packages/persistence/src/migrations.integration.test.ts`：在隔离 schema 中执行真实 0001–0013，写入历史数据（含无账号的历史 owner），应用 0014 两次、模拟部署间隙写入、应用 0015，再重复应用 0014+0015 两轮；断言每个身份恰一个个人空间与唯一管理员、项目归属与访问集合不变、记录内容不变、不再有 `owner_id` 列。通过。
- `packages/workspaces/src/workspaces.integration.test.ts`：直接调用 Next 路由处理函数 + Better Auth 会话 + 真实 PG。企业成员可列出、读取、改动本空间项目，并按已知 ID 读取候选、资源、出图、任务；其他企业管理员与无关用户对项目、命令、候选、资源、出图、任务、成员列表、创建项目均得 404；成员不能管理成员；个人空间不能加人；最后管理员不能移除或降级；移除成员后其对已知 ID 的访问立即变为 404。通过。
- `pnpm workspace:create` 在 `hestia_d01` 上执行：首次 `created:true`，重复 `created:false` 同一 ID，`personal` 类型被拒；验证后已删除该工作空间。
- `pnpm check`：通过（原型构建、4 项数据测试、类型检查、68 项核心测试）。
- `pnpm test:db`：127 项中 126 通过；唯一失败为 `packages/conversation/src/budget.test.ts` 的 “production admission binds endpoint, model…”，原因是本机 `.env` 无真实 `HESTIA_MODEL_*` 配置，迁移前基线同样失败。

## 未验证与边界

- `scripts/validation/*` 中依赖运行中 Next/浏览器的脚本只随列名变更做了 SQL 调整并通过类型检查，未运行。
- `workspace_members.user_id` 与 `projects.created_by` 沿用原 `owner_id` 的做法，不对 `hestia_auth_user` 建外键（既有测试使用无账号的合成身份）；删除账号不会自动清理成员关系。
- 既有集成测试使用合成身份时会惰性创建个人工作空间，清理代码未删除这些空的工作空间行。
- 无成员管理界面、无客户关系、无企业额度；工作台界面仍只使用个人工作空间。
