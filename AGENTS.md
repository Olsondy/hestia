# Hestia Agent Instructions

## Project Overview

Hestia（取名自古希腊炉火女神赫斯提亚，造屋之始祖）是空间设计工作台：导入户型图纸，由 Agent 完成布局、风格与铺贴设计，3D 呈现并出图。共享内核服务个人与企业两种工作空间，不得把任一形态写死为唯一形态。

当前范围、已确认决策和工单进度见 `docs/status.md`；本文件只规定仓库事实、入口与维护方式。

## Agent Workflow and Context

### Repository Baseline and Precedence

- 沟通和通用执行规则遵循当前有效的用户指令；本文件在本仓库范围内补充。
- 产品决定以 `docs/decisions/` 为准；同一事项有多条记录时以日期最新者为准，被覆盖的描述只作历史。
- 未验收的工单不得当作已完成；真实模型和样本验证不得用模拟结果冒充。
- 具体供应商、部署方案未定，不得写成已确认、已部署或已授权购买资源。

### Agent Interaction

- 开发按实际依赖调度，无阻塞的独立工单可由子 Agent 并行推进；验收通过后才能关闭工单并解除下游阻塞。
- 用户暂停的工单（见 `docs/status.md`）不主动恢复。

### Issue Tracking

任务与规格记录在本仓库 GitHub Issues，使用 `gh` CLI。操作规范见 `docs/agents/issue-tracker.md`，工单映射见 `docs/planning/v1-published-issues.json`。

### Triage Labels

标签映射见 `docs/agents/triage-labels.md`。

### Domain Model

Single-context：根目录 `CONTEXT.md` + `docs/decisions/`。读取与维护规则见 `docs/agents/domain.md`。

### Required Domain Documentation

#### Always Read Before Working

- `docs/status.md`：当前范围与进度
- `CONTEXT.md`：领域术语
- `docs/decisions/`：已接受的决定

#### Read When Relevant

- 产品与规划：`PRODUCT.md`、`docs/v1-scope.md`、`docs/v1-development-plan.md`
- 架构与技术栈：`docs/web-stack.md`
- Agent 运行时：`docs/agent/tool-contract.md`、`system-prompt.md`、`runtime-design.md`、`model-policy.md`
- UI：`DESIGN.md`、`.impeccable/design.json`、`docs/prototype-brief.md`
- 开发与验证细节：`docs/development.md`、`docs/validation/`

## Technology Baseline

- Node.js >= 22.12，pnpm workspace（版本见 `package.json` 的 `packageManager`），根目录 `pnpm-lock.yaml`；不用 npm 生成第二套锁文件。
- Web：Next.js 16 + React 19（`apps/web`）；Worker：`apps/worker`。
- 模型调用：AI SDK Core；后台任务：pg-boss + Hestia 有限状态运行器；流式事件：SSE 持久化。
- 数据库：PostgreSQL 17.7（本地 Compose 联调，生产未定）；Drizzle ORM（`pg` 驱动）+ drizzle-kit，规则见下文「Database Rules」与 `docs/decisions/0009-drizzle-schema-and-migrations.md`。
- 3D：Three.js（`packages/scene-runtime` 与原型内嵌）。
- 字体：仓耳渔阳体（Tsanger YuYang）W01–W05，资源与授权声明在 `assets/fonts/tsanger-yuyang`。

## Repository Map

- `apps/web`：Next.js 页面与 API。
- `apps/worker`：模型调用与后台任务 Worker。
- `packages/contracts`、`projects`、`persistence`、`identity`、`credits`：共享契约、项目、存储、身份、积分。`persistence/src/schema/` 是表结构来源，`persistence/drizzle/` 是生成的迁移，`persistence/migrations/` 是冻结的旧迁移链。
- `packages/conversation`、`tasks`、`commands`、`candidates`、`layout-planner`、`styles`、`catalog`、`renders`、`files`、`geometry`：领域服务。
- `packages/scene-runtime`：场景输入和 Three.js 适配。
- `packages/model-validation`、`floorplan-import`：仅记录合成/协议验证，不代替真实评估。
- `example/prototypes/projects/`：工作台原型。
  - `src/store.js`：项目、固定物品、演示指令和撤销。
  - `src/scene.js`：Three.js 场景，渲染示例户型与用户手绘墙体。
  - `src/app.js`：页面路由和编辑行为；`src/style.css`：视觉与响应式规则。
  - `src/editorial.js`：家居杂志方向首页、作品切换与项目索引；`src/motion.js`：页面过渡及相机承接。
  - `src/sample/`：示例户型（`model.js`）、三套摆放（`layouts.js`）、配色材质（`soft-styles.js`、`textures.js`）。
  - `index.html`：构建产物；`dist/index.html` 为兼容副本。
- `scripts/`：构建、检查、迁移、Worker 与 `validation/` 验收脚本。
- `docs/`：规划、决定、Agent 设计、验证记录。

## Development and Verification

### Commands

```sh
pnpm install --frozen-lockfile
pnpm check         # 原型构建、数据测试、类型与核心行为检查
pnpm preview       # 127.0.0.1:4173/example/prototypes/projects/
pnpm dev           # Next.js 开发入口，端口 3000
pnpm test:db       # 本地真实 PostgreSQL 验证
```

完整命令表见 `docs/development.md`。

### Local PostgreSQL

依次运行 `pnpm setup:local`、`pnpm db:up`、`pnpm db:migrate`。数据库仅绑定 `127.0.0.1:54329`；本地 Compose 只用于联调，不代表生产拓扑。

### Required Verification

- 代码改动跑 `pnpm check`；涉及持久化跑 `pnpm test:db`，真实存储不能用替身结果代替。
- 视觉或交互改变须浏览器检查桌面 1440、窄桌面 1100、小屏 390；自动测试不能替代视觉验收。工具无法完成浏览器检查时明确记录限制，不把旧截图称为当前截图，也不绕过工具的访问限制。
- 不为简单文案修改增加实现镜像测试。检查通过后，仅在新改动、失败或具体疑点出现时追加验证。

## Engineering Rules

### Documentation Ownership

- 新决定写入 `docs/decisions/`，进度与范围变化更新 `docs/status.md`，验收证据写入 `docs/validation/`；不在本文件追加带日期的进度日志。
- 文档和展示文案使用中性名称，不包含真实住宅名称、地名或住户身份；企业品牌名称、石材素材和商业资料不提交到仓库。

### Database Rules

- 表结构以 `packages/persistence/src/schema/` 为准：改 schema → `pnpm db:generate` → 提交生成的 SQL 和 `meta/`。不手写迁移，不手改 snapshot，不往 `packages/persistence/migrations/` 加文件（已冻结，`db:migrate` 会拒绝）。`pnpm check` 中的 `db:check` 会拦截有 schema 改动但没有生成迁移的情况。
- 新查询默认用 Drizzle（`db`、`orm(client)` 或 `transaction((client, tx) => …)` 的 `tx`），行类型从 schema 推导。行锁用 `.for('update')`；advisory 锁、`jsonb_set` 等可以用 `` sql`...` `` 或参数化 SQL。业务代码不再新增 `client.query`（例外：pg-boss 适配器、迁移执行器、事务控制语句，见 ADR-0009）。在事务回调内部按 Postgres 错误码判断时，先调用 `driverError(error)`。
- 触发器、函数、视图、数据回填用 `drizzle-kit generate --custom`；Drizzle 不支持 `DEFERRABLE` 外键，涉及时用自定义迁移。

### Next.js Guardrails

本项目使用 Next.js 16，API 和约定可能与训练数据不同。写 Next.js 代码前先查 `node_modules/next/dist/docs/` 中的对应指南，并留意弃用提示。

### Prototype Guardrails

- 源码在 `example/prototypes/projects/src/`；不要直接修改生成的 HTML，改后运行 `pnpm build` 并同步提交 `example/prototypes/projects/index.html` 和 `dist/index.html`。
- 原型内嵌 Three.js，项目存入 localStorage（键 `hestia.studio.v1`），图片不上传；不能把本地原型视作云服务。
- 示例户型与三套家具布局在 `src/sample/`，新建家具以示例家具为模板；示例尺寸是示意，界面须标注示例与演示。
- 新建项目从空白空间开始；不可把示例户型冒充用户图片的识别结果，演示助手始终明确标注。
- 固定设施（固定柜、空调、电视墙、门窗、柱位、楼梯等）独立于布局方案，见 `docs/decisions/0001-fixed-facts-independent-of-layouts.md`；新增固定设施时同步 `src/store.js` 的 `fixedIds`。
- 切换布局后同步碰撞范围、可见物品、详情描述和选择状态；不要直接修改共享材质导致固定物品跟着变色。
- 示例方案之间比较保留用户观察角度，进入工作台时按画布比例适配视野。

### UI and Design

- 生产 UI 只参照原型家居杂志（editorial）方向的间距、布局、字体与动画；建筑展馆方向仅为原型历史，不构成双主题要求。
- UI 设计技能使用 `.agents/skills/impeccable/SKILL.md`；不安装或启用 Impeccable hooks，更新技能时保留此约定。
- 中文字体统一使用仓耳渔阳体，保留随附授权声明；运行时不依赖字体 CDN。

### Product Guardrails

- 不提供预算或报价模块，不重新加入。
- 布局方案必须改变家具摆放或组合，仅换色不能称为布局方案；铺贴方案必须改变石材、规格、铺法或排版。
- C 端首版仅平台模型，不提供 BYOK/自定义端点。

### Commit Content

- 提交源码、根目录 `pnpm-lock.yaml`、迁移与文档。
- 不提交上传图纸、私密原始资料、密钥、`.env`、数据库内容、依赖目录和调试截图。
- 新产生且不再使用的临时文件在收尾清理；不要删除用户的历史成果。
- 不替用户决定项目开源许可证；保留第三方许可证声明。
