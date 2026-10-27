# 候选布局与具体版本采用（T06 后端）

2026-10-25 T15 扩展：候选现支持受控目录新增、替换、删除，完整差异使用 `objectChanges`，检查器升级为 `furniture-layout-2-catalog`。原先仅移动的阶段说明保留为 T06 历史；最新目录范围、实测保护与验证见 `docs/validation/T15-catalog.md`。原子采用、真实用户选择、独立整体撤销及 T05 历史隔离不变。

2026-10-25：后端领域服务、真实 PostgreSQL 与 HTTP 验证已完成；UI 与完整工单验收由主 Agent 汇总。本包不调用模型，不生成家具资产，也不修改 T05 单件命令联合或历史。

## 权威状态和范围

候选从当前项目修订复制可移动家具，保存不可变的基础 `SpatialState` 与独立候选修订。`candidate_revisions` 保留各版家具状态，GET/预览不会采用。修改只接受 `move-furniture { objectId, x, z, yaw }`；米制 x/z 在 ±1000 内，新输入 yaw 在 ±2π 内。已有多圈 yaw 保留原值。禁止新增/删除家具、改 y/尺寸/资产/颜色、移动固定设施或改变锁；未知字段拒绝。

草稿中间摆放可以存在几何冲突，便于完成家具互换；它不会写当前方案。每次修改使先前检查、展示和选择因候选修订不匹配而失效。已采用候选永远保留为只读历史，包括整体撤销之后。当前项目修订、基础状态、固定事实或锁发生变化后，旧候选不能再修改、检查或采用，必须从当前项目新建。

## HTTP 契约

共享类型及严格 Schema：`packages/contracts/src/candidates.ts`。下表路径均在 `/api/projects/:id` 下，写入均要求应用同源与登录身份。

| 方法与路径 | 请求 | 返回 |
| --- | --- | --- |
| POST `/candidates` | operationId, expectedRevision, name | 201 `{candidate: CandidateView}` |
| GET `/candidates` | — | `CandidateList`：candidates, undoableAdoption |
| GET `/candidates/:cid` | — | `{candidate: CandidateView}` |
| POST `/candidates/:cid/commands` | operationId, expectedCandidateRevision, command | `{candidate}` |
| POST `/candidates/:cid/checks` | operationId, expectedCandidateRevision | `{check: CandidateCheck}` |
| POST `/candidates/:cid/presentations` | operationId, expectedCandidateRevision, expectedRevision, checkId | `{presentation: CandidatePresentation}` |
| POST `/candidates/:cid/selections` | operationId, presentationId | `{selection: CandidateSelection}` |
| POST `/candidates/:cid/adopt` | operationId, expectedRevision, selectionId | `AdoptionResult` |
| POST `/adoptions/:operationId/undo` | operationId, expectedRevision | `AdoptionResult` |

`CandidateView` 包含共享 `SceneSnapshot`、differences（每件家具 before/after pose）、lockedObjectIds、scale、synthetic、当前版本检查，以及独立候选/基础版本。`AdoptionResult` 包含当前权威 project、目标 adoption 摘要，以及当前 `undoableAdoption: {operationId, revision} | null`。重试旧采用/撤销返回当前项目，不退回旧快照。

## 展示、用户选择与执行边界

UI 先渲染已检查的候选和差异，再以具体 checkId/候选修订/基础修订记录 presentation。仅在用户点击采用该版本时请求 selection，随后提交 adopt。presentation 不是同意；GET、检查和展示均不创建采用事件。

`browserUser(Request)` 必须经过 Better Auth 的真实有效会话与 Origin 校验，返回进程内 WeakSet 登记的能力。`presentCandidate`、`selectCandidate` 接受此能力并再次检查；只有 `{userId, sessionHash}` 的结构仿造会被拒绝。展示与选择持久化绑定用户和会话，选择绑定具体展示/检查/候选/基础版本。客户端不能传 `approved:true`、actor 或检查结果。

**presentations、selections 和 browserUser 不属于 Worker/模型工具。** Worker 未来可以调用候选读写/检查或消耗应用已经记录的用户选择；不能从模型参数、对话声明或 worker principal 生成选择。不得将会话能力或用户选择创建接口放入模型工具注册表。HTTP 会话事件是应用接收用户操作的可信边界，不宣称服务器能够独立观测浏览器是否实际画出了像素；UI 验收须确认展示后才能点击采用。

## 检查覆盖与采用事务

服务端对完整最终布局中的每件家具调用 T05 `validatePlacement`，不会按旧位置逐条执行。`checkerVersion=furniture-layout-1`；检查持久化绑定候选修订、基础修订及规范化内容 SHA-256。

必要项：范围与锁、可靠尺度、非空变更集、家具边界/对象碰撞/墙实体/门扇区域。所有必要项必须 passed 或 not-applicable，任何 failed/not-checked 都阻止采用。missing/estimated 尺度可保留概念草稿，不能采用。对于门型信息不全但当前摆放远离开口的情况，T05 单件检查可能允许局部修改并保留 not-checked；T06 整套采用要求完整必要门扇覆盖，仍会阻止采用，不把未知变成通过。

人体使用净空、搬运路径与结构安全明确记录为非本票覆盖的 not-checked 提示项，未把几何通过描述为施工或工程安全保证。几何边界、容差和长方体代理限制沿用 T05。

采用在同一事务内复核 owner、项目基础状态、候选修订、当前固定事实及锁、检查覆盖、用户选择，并重新计算最终布局。通过后更新项目 snapshot、新项目修订、共享幂等 ledger、独立 adoption 记录、选择消费状态及候选只读状态。任一失败全部回滚。共享 advisory operation 锁与项目行锁与 T05 串行化，禁止半套布局或双重采用。

## 整体撤销

采用创建新 layoutId；旧 T05 单件历史不能跨布局继续撤销。独立 adoption 保存 before/after layout。整体撤销要求当前项目修订恰好等于采用产生的修订、布局/固定事实相符且尚未撤销；任何后续项目修订（包括重命名）均拒绝。逆向布局再次校验后整体恢复内容，并再生成新 layoutId、新项目修订；不回写旧 revision，也不恢复旧 layoutId。原候选保持 adopted。没有复用或混入 `project_commands`，UI 使用独立“撤销采用”入口。

## 当前验证

```sh
node --env-file=.env --import tsx --test packages/candidates/src/service.test.ts
node --env-file=.env --import tsx scripts/validation/candidates-api.ts
pnpm exec tsc --noEmit
pnpm exec tsc --noEmit -p apps/web/tsconfig.json
```

- 真实 PostgreSQL 14/14：隔离与修订、严格范围/固定事实/锁、全布局家具互换、必要检查缺失、旧检查/展示/选择失效、真实会话能力与仿造拒绝、并发采用与幂等、跨布局历史隔离、整体撤销、故障注入事务回滚。
- 真实本地 HTTP 7/7：匿名/跨账号、额外字段、硬冲突草稿、同源/用户选择边界、并发采用、整体撤销和后续修改冲突。
- 根及 Next TypeScript 检查通过。0005 已应用现有本地 PG；未启动/重启服务，也未顺带迁移 T07 的 0006。
- 两套验证只使用随机 `@example.test` 身份与合成空间，finally 精确清理本次身份、项目、候选、授权及历史；没有真实模型调用或真实住宅样本。UI/3D 验收尚不由本后端记录声明完成。
