# T07：确定性后台任务与持久化事件

2026-10-25 T08 更新：生产 view=tasks 已升级为统一空间对话，原 task-ui.ts 是旧协议表单的历史截图脚本，不再适用于当前页面；当前提交、关页恢复、取消与撤销的 UI 回归由 conversation-ui.ts 接管。T07 数据库及真实进程恢复证据保留，未因此重跑或启动 Worker。

2026-10-25：后端、Worker 入口、SSE、有限数据库与 UI 验证已完成；用户随后明确授权本次隔离 Worker 进程验收，主 Agent 实际运行成功，独立核对通过。T07 的确定性协议范围已具备四项验收证据，可由主 Agent 更新并关闭 #8。测试仅使用随机身份、合成项目和隔离的 pg-boss schema，不调用真实模型、不读取私密图纸；仅在本次授权范围内启动、终止及重启自己创建的测试 Worker，复用既有 Next.js/PostgreSQL。

## 实现与边界

- `packages/tasks` 保存任务状态、结构化步骤、检查点、执行代次、租约、预留与消耗、错误以及有序事件；`apps/worker/main.ts` 是显式服务入口，不由页面、模块导入或 SSE 自动启动。
- pg-boss 固定 **12.38.0**，要求 Node **≥22.12.0**。采用其官方 `Db.executeSql` 适配器，将 `send()` 与任务、首事件、请求幂等记录放在同一 PostgreSQL 事务。生产 schema 为 `hestia_jobs`，队列为 `hestia-deterministic-task`。不是自行实现或以内存替代 pg-boss。
- API producer 复用已有 `pg.Pool`，不调用 `boss.start()`，没有轮询、维护或实例心跳；有限初始化使用官方 `getConstructionPlans()` 和 `createQueue()`。后台服务才调用 `start()`、`work()`，启用 pg-boss 故障回收及重试。
- 每次任务接受固定 `deterministic-v1` 协议，包含最多 12 个文本/受限家具命令步骤；每个步骤都有应用生成的稳定 operationId。所有响应带“确定性协议测试 · 非真实模型设计”标签。文本是预定协议片段，不代表 AI 推理、模型回答或已完成业务结果。
- 本票未接入 AI SDK 或供应商；真实模型统一 Worker 的后续入口仍以 ADR-0005 为准。没有前置分类模型，也没有请求内模型调用。

官方依据：[事务适配器](https://pgboss.io/api/adapters)、[任务与重试选项](https://pgboss.io/api/jobs)、[Worker 生命周期](https://pgboss.io/api/workers)。版本及 Node 要求另用 npm registry `pnpm view pg-boss version engines --json` 核对。

## 公共接口

`POST /api/projects/:id/tasks` 接受 JSON，成功返回 202 `{task}`：

```json
{
  "operationId": "客户端生成的 UUID",
  "expectedRevision": 1,
  "protocol": "deterministic-v1",
  "steps": [
    { "type": "text", "text": "这是确定性协议测试，不是真实模型回答。" },
    { "type": "command", "command": { "type": "set-lock", "objectId": "sofa-a", "locked": true } }
  ]
}
```

文本字段最多 2000 字符，命令完整复用 T05 严格契约（move-furniture / set-lock / undo），不能携带 owner、固定事实或自定义执行代码。请求使用当前身份、项目归属及 expectedRevision；同一 operationId 内容相同返回同一任务，内容不同返回 409。同项目仅一个 queued/running/retry_wait 任务。项目行锁和唯一索引共同保护该约束。

| 接口 | 返回与行为 |
| --- | --- |
| `GET /api/projects/:id/tasks` | `{tasks}`，当前身份/项目最近 20 项 |
| `GET /api/projects/:id/tasks/:taskId` | `{task}`，最新检查点和消耗 |
| `POST /api/projects/:id/tasks/:taskId/cancel` | `{task}`，直接取消，不等待模型判断；重复取消无新事件 |
| `GET /api/projects/:id/tasks/:taskId/events?after=N` | SSE，优先使用 `Last-Event-ID`；只读、可续传 |

`TaskView` 的精确类型在 `packages/contracts/src/tasks.ts`：status、checkpoint(nextStep/totalSteps/expectedRevision)、generation、usage(limit/used/reserved/unit)、eventsCursor、error、timestamps。不会返回 owner、原始业务 before/after 或数据库错误详情。

SSE 的 `id` 是任务内单调序号，`event` 为 status/text/operation/usage，`data` 是完整 TaskEvent。每次补读最多 100 条；未来游标/非法游标拒绝。连接最长 25 秒，500ms 检查已保存事件；终态事件全部送出后关闭。浏览器断线/AbortSignal 只释放本订阅，绝不修改任务、取消队列或重新 POST。重开先 GET 原任务，再按游标补读。

## 执行、取消与恢复

状态限定为 queued、running、retry_wait、completed、partial、failed、cancelled。协议步骤全完成才 completed；预算耗尽或部分步骤完成后遇到业务失败为 partial，首步业务失败为 failed。设计候选的 waiting_input / waiting_selection 属于后续工单，本票不伪装完整设计生命周期。

领取在任务行锁内递增 generation，发放 15 秒租约；最多 3 个执行代次。重复且仍有效的领取拒绝，过期代次不能预留、写检查点或提交项目。每步先持久化 1 个协议单位预留，再执行并结算。默认上限 8 个单位，重试复用同一步预留且不重置已消费量；这只是协议运行上限，**不是产品积分、模型 token 或费用规则**。

主 Agent 协调批准对 T05 最小抽取 `executeCommandInTransaction(client,principal,projectId,input)`，原 `executeCommand` 的公开行为不变。Worker 在同一事务先锁任务并检查代次/租约，再调用领域执行器；项目修订、操作结果、任务检查点、消耗和结果事件共同提交。等待项目锁后再次检查租约，过期时整体回滚，不留下已改项目但未记检查点的状态。固定事实、几何、锁定、版本和权限检查仍由领域服务负责。

取消使用同一任务行锁：取消先赢则递增代次、释放预留、阻止旧执行者提交；业务提交先赢则保留真实修订与 checkpoint，并告知可以在操作历史撤销。本协议没有外部在途副作用，因此无需伪造 cancelling 阶段。以后真实模型/外部输出引入前须另处理未知请求结果及用量。

pg-boss 的 job 超时为 30 秒，10 次基础重试、2 秒指数退避、最长 30 秒间隔；Hestia 自身 3 个执行代次负责业务上限。恢复以已保存 nextStep、步骤 operationId 与项目版本为准；不是拼接旧文本流。瞬时错误保存 retry_wait 后交给 pg-boss 重试；任务已终止后的重复投递为空操作。

## 本地有限验证

```sh
node --env-file=.env --import tsx --test packages/tasks/src/runtime.test.ts packages/commands/src/service.test.ts
pnpm exec tsc --noEmit
pnpm exec tsc --noEmit --project apps/web/tsconfig.json
pnpm exec tsc --noEmit --project apps/worker/tsconfig.json
```

T07 真实 PostgreSQL **10/10**，T05 原命令回归 **10/10**。数据库测试只调用有界领域函数与 pg-boss 的有限 send/fetch，不调用 `boss.start()` 或 `work()`。

| 验证 | 结果 |
| --- | --- |
| 同请求并发、不同内容重用、同项目活动任务 | 只接受一个；其他按契约拒绝 |
| pg-boss 实际入队与故意不可用队列 | 有真实 job；入队失败时任务、事件、幂等结果整体回滚 |
| 跨账号、跨项目、伪 owner/协议、非法游标 | 全部拒绝，无状态污染 |
| 提交后丢弃回复、原检查点重放、租约过期后再领取 | 一次项目修改、一次操作事件；旧代次拒绝，新代次从下一步继续 |
| 取消前/后提交、并发取消与提交 | 按任务锁串行；无隐藏项目写入，已提交修订保留 |
| 预留后中断、超额 9 步、重复投递 | 不重复预留；执行 8 步后 partial；预算不重置 |
| 瞬时异常与持续异常 | 恢复原检查点；达到 3 次上限停止 |
| 任务接受后的手动修改 | 项目版本冲突拒绝任务旧修改 |
| 等待项目锁期间租约到期 | 项目、操作历史和检查点完整回滚 |
| SSE 断开、旧游标重连、终态游标 | 不取消/重建任务；只读遗漏事件；终态连接结束 |

上表“恢复”是有限函数级故障注入；实际 Worker 进程中断、pg-boss 重试和重启恢复由下文独立进程验收补充，两类证据分别记录。

## 有限 UI / HTTP 证据

UI 实施 Agent 在已有 Next.js / PostgreSQL 上执行 `scripts/validation/task-ui.ts`。实际接受请求后丢弃响应，再次提交保持同一 operationId / taskId；刷新和新页面恢复同一持久化任务，没有自动新建。SSE 读取真实已保存事件，queued 状态保持 0 步；取消通过真实 API 返回 cancelled。选定合成沙发可提交固定 +0.20m X 位移，但测试在 queued 时取消，项目 revision 保持不变；非合成项目禁用移动测试。共 2 个任务，实际执行步骤 **0**。

1440×1000、1100×900、390×844、reduced-motion、字体加载检查通过，无页面错误。当前六张截图及机器结果位于忽略目录 `.impeccable/review/t07/`，`browser-result.json` 明确记录 scope 为 accept/reopen/subscribe/cancel。此轮没有调用或启动 Worker，不能单独证明 running 文本流、真实后台移动或进程恢复。

独立 fresh finish reviewer 结论为 **ship**，记录在 `.impeccable/review/t07/finish-verdict.md`；逐一审阅六张当前截图与集成源码，material fixes 为无。字体、暖纸/褐墨/酒红、细分隔线与平面工作面符合既有 editorial；桌面左创建/右记录与手机已有任务时状态/取消优先是适用的响应式延展。真实 0 步、同任务重试及非真实 AI 标识保留，没有将展示页的大幅场景转场强套入任务面板。review 仅放行有限协议 UI，不把静态截图当作运行中文字流、键盘实操或完整模型链路的证据。

有限 SQL 初始化命令：`node --env-file=.env --import tsx scripts/worker.ts --setup`。实际服务入口为 `node --env-file=.env --import tsx scripts/worker.ts`；遵循项目规则，未经用户同意不得运行此服务命令。

## 已授权并通过的独立进程验收

用户明确批准本次隔离 Worker 验收后，主 Agent 执行以下命令，进程 **exit 0**；独立复核已核对脚本断言、成功结果和数据库清理。脚本仍要求显式 `--allow-worker-process` 才加载数据库/浏览器模块，默认拒绝启动；本次许可不构成以后任意服务启动的长期授权。

```sh
node --env-file=.env --import tsx scripts/validation/worker-process.ts --allow-worker-process
```

脚本使用随机邀请测试账号与合成项目、独立 `task_process_<随机ID>` pg-boss schema，通过领域入口入队，复用现有 Next.js/PostgreSQL。关闭真实浏览器页面及 SSE 后，启动自己的 Node Worker；发现已提交家具锁定命令后终止该确切 ChildProcess，再启动新 Worker，等待真实 pg-boss 超时重试。没有直接修改租约或在验收进程中调用领域 runner 来冒充重启恢复，也没有启动 Next.js、数据库或测试 HTTP 服务，不修改 API 进程的环境或消费 `hestia_jobs` 用户队列。Worker 支持经过严格名称校验的 `HESTIA_TASK_QUEUE_SCHEMA`，缺省仍为 `hestia_jobs`。

成功结果 `.impeccable/review/t07/worker-process-result.json` 记录：2 个自己创建的 Worker 进程，关闭页面后继续执行，同任务恢复，真实 pg-boss `retryCount=1`，家具命令只生效 **1 次**，事件游标 **28**，原任务使用量 **8**；运行中取消通过。脚本另断言项目 revision 只从 1 增加到 2、命令记录与 operation 事件各一条、重开 GET 返回原 taskId、`Last-Event-ID: 1` 只补读后续事件。

finally 已停止自己的 Worker 并精确清理；独立只读核对 `task_process_%` schema、`worker-process-%@example.test` 账号及邀请记录，三项残留均为 **0**。未对其他服务或用户数据执行操作。

## 工单验收对照

| #8 验收标准 | 对应证据与结论 |
| --- | --- |
| 协议替身驱动受限操作，UI 明示测试而非模型设计 | 确定性 Worker 实际提交一项家具锁定命令；UI 当前截图/标签及 fresh reviewer ship，通过 |
| 持久化任务、检查点、租约/代次、操作结果；关页不重建 | 数据库反例验证、真实关页后继续、重开同 taskId / 序号补读，通过 |
| 进程重启及提交后响应丢失可恢复，操作不重复生效 | 有限提交回复丢失重放；实际提交后进程终止、pg-boss 重试及新 Worker 恢复，唯一项目操作，通过 |
| 基本取消、单任务预留/上限、迟到执行者拒写 | 数据库取消竞争/预算/旧代次/超租约回滚；真实运行中取消及恢复不重置用量，通过 |

结论仅覆盖 T07 的确定性协议后台任务。真实模型、供应商用量与不明远端请求、完整设计状态机、真实模型文字流与后续候选采用流程仍须对应工单验证；没有将协议单位视作产品积分或模型费用，也没有宣称部署完成。
