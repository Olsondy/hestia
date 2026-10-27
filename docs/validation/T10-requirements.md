# T10：有来源的需求与可恢复问题

2026-10-25。后端、真实模型两轮合成小样、浏览器、整合测试与独立视觉复核均通过，主 Agent 已完成本地验收。

## 行为与持久化

复用 T08 `conversation-v1`、AI SDK 的规范 `reply + decision`、同一任务运行器、领域执行器和持久化 SSE。模型可附加 `brief` 整理摘要、需求与必要问题，不增加请求内模型调用或第二条意图路由。`0010-conversation-brief.sql` 将 `waiting_input` 加入非终态与每项目唯一活动任务约束，已在现有 PostgreSQL 应用；没有启动或重启服务。

任务 `conversation.brief` 保存 `intentVersion`、原始用户输入、带来源需求、问题与回答、过往轮次、摘要和本轮已完成工作。原始输入是用户说过什么的记录，不直接等同于硬约束或空间修改授权。需求来源：

- `user_explicit` 只接受一条完整用户消息原文，不允许摘出否定句中的肯定片段。引述、假设、问句不能以此类来源保存；这些提炼必须标为助手建议。此保守检查不是任意自然语言真实性证明。
- `assistant_suggestion` 是模型整理或提出的建议。可追溯输入引用必须真实存在；没有用户来源的建议允许空来源。后续用户完整明确表达同一内容时可升级为 `user_explicit`，推进 revision 并保留真实来源，不冒充按钮确认。
- `user_confirmed` 仅由真实用户 API 动作确认具体 `requirementId + requirementRevision` 产生。模型 Schema 没有此枚举；模型不能改写既有内容或降级确认。同内容再次建议不创建重复记录。确认需求不授权移动家具或更改固定事实。

`POST /api/projects/:id/tasks/:taskId/inputs` 接受严格 `message` 或 `confirm_requirement` 输入，验证身份、同源、项目归属、意图版本、项目修订及问题/需求归属；返回 202 `{task}`。输入、问题回答、意图版本、新 dispatch、幂等操作记录在同一事务写入。响应丢失后同 operationId 返回同一结果，不重复输入或入队；入队失败全部回滚。

每次输入立即推进 generation，清除旧租约，刷新权威项目上下文。已完成及等待中的任务可在同一 taskId 继续，保留用量及历史；其他任务已占用该项目时不能重新激活旧任务。已取消、失败或到限任务不能通过补充重置预算。每轮 dispatch 有独立 UUID，携带 intentVersion；旧 dispatch 只结束自身，不能领取后续意图。Worker 入口已同步传递版本，但本轮没有运行该服务。

## 问题与执行顺序

独立答复、已有需求整理以及仍获明确授权的局部修改先完成，再检查是否还有未答必要问题；存在问题不使这些工作跳过。当前有限阶段没有其他可执行工作时才进入 `waiting_input`，释放 lease 和运行中的 reservation。等待状态不由队列重新调用模型；SSE 可补读后结束，页面重开读取持久快照。

问题保存稳定 key、原文、创建意图版本与 answerInputId。程序按归一主题 key 或相同问句去重，已答问题不可重新打开或覆盖原回答；修正通过新输入保留来源。模型上下文包含所有问题、答案及稳定 key，并要求复用。任意换 key 且语义改写的问题无法仅靠此确定性规则证明同义，不能宣称完成任意语义去重。

scope 固定 `requirements_and_local_changes`，模型不能扩展。应用文案明确“本轮需求整理已保存，尚未生成或采用设计方案”；本票 `completed` 仅表示当前需求整理/答复阶段完成，不等同整套设计完成。T17 的布局生成及 T19 的长设计调整仍为后续工单。

## 恢复、用量与边界

每轮完整 response 与 `usage_used + 1` 在同一事务保存；随后才允许领域提交。响应保存后收到新输入时，旧结果进历史、旧提交失去执行权，已经结算的调用不重复扣除。调用已开始但结果未保存时，补充会归档 `unknownUsage: true` 且 token 为 null，并把该已发起调用计入累计技术上限；不会当零消耗后重调旧调用。取消、正常失败及领取恢复耗尽这几条终止路径也保留已发起调用的累计消费，未知 token 不记零。

当前任务上限为 8 次模型调用，仅为有限实现的技术测试上限，不是用户预算、积分档位或最终产品额度。正常新输入重置的是该 dispatch 的恢复重试计数，累计调用数不重置。完整 token 预算、未知供应商计费核对、回退及限额成果处理仍由 T21 完成。

## 后端验证

- `node --env-file=.env --import tsx --test packages/conversation/src/requirements.test.ts`：审查修复后 11/11。覆盖独立工作先完成与无租约等待、答案/来源持久化、重复输入与旧 dispatch、确认版本和再次建议、否定/引用/假设来源、保存响应后追加输入的旧提交栅栏与累计用量、未知调用、新入队失败回滚、取消、8 轮上限；新增同内容明确来源升级、确认不授权移动及领取恢复耗尽未知调用。
- T07/T08 回归：`node --env-file=.env --import tsx --test packages/conversation/src/runtime.test.ts packages/tasks/src/runtime.test.ts`，29/29。
- 最后合并 T07/T08/T10 回归 40/40，日志 `.impeccable/review/t10/backend-final-tests.log`；此后核心代码未改动。
- `pnpm exec tsc --noEmit` 通过。
- `scripts/validation/requirements-api.ts` 默认真实 HTTP/PostgreSQL + SDK 传输替身，两轮通过：关页断开订阅后执行、独立换算回答、等待问题、真实用户回答、来源/意图/历史恢复、认证/归属/同源/严格 Schema 与不改空间。真实模型调用 0、Worker 进程 0。证据 `.impeccable/review/t10/backend-fixture-initial.json`。

真实模型 opt-in 仅使用脚本内固定合成需求与合成项目，至多两轮，无自动重试，首轮缺必要提问或次轮重复提问会失败，不强造状态。证据文件先以 `wx` 创建，拒绝覆盖旧结果；可以明确使用 `--evidence-tag=...` 保存独立复验。脚本清理自己创建的身份、项目、任务及所有对应 dispatch，保留验收证据。

## 真实模型两轮小样

主 Agent 执行 `--live-synthetic --evidence-tag=initial`，两轮均通过，证据 `.impeccable/review/t10/backend-live-initial.json`。真实网络 dispatch 每轮 1 次，共 2 次，没有服务进程启动，也没有私有文件上传。

| 轮次 | 实际结果 | 总处理 / 首回复 | 输入 / 输出 token |
| --- | --- | --- | --- |
| 1 | 回答 20cm=0.2m，整理会客、办公和保留书桌的来源信息，再询问阅读时间，进入 waiting_input | 3994.91 / 2520.28ms | 2546 / 785 |
| 2 | 绑定用户“夜间阅读每晚1小时”的回答，保留来源、意图和历史，未重复问题；只完成需求整理，未改空间 | 4485.87 / 2298.08ms | 3160 / 826 |

这些数据仅代表固定合成小样，不是响应时间承诺或任意自然语言泛化结论。

## 独立后端审查修复

审查指出无问号疑问、举例和特殊引号可能被标成用户明确需求，已增加保守来源门禁及“保留书桌会影响通行吗”“举例：保留书桌”“「保留书桌」只是示例”等反例；原文日志仍保留，不能据此称任意语义已证明。审查还指出同内容明确来源升级会被去重忽略、领取重试耗尽会清掉未知调用 reservation；两处已修复并增加真实 PG 回归。模型 prompt 与工具 Schema 未因这些修复变化，真实两轮结果仍是原始保存证据。

## 最终整合与页面验证

`pnpm check` 通过：4 项原型、44 项核心及根/Web/Worker 类型检查；`pnpm test:db` 104/104 通过，其中 T10 11 项。独立后端审查已对三项修复复验，恢复耗尽路径使用现有 PostgreSQL 单项验证通过；未发现剩余具体阻断。

`scripts/validation/requirements-ui.ts` 使用真实现有 Next/API/PostgreSQL 与明确的 SDK 传输替身验证来源标签、展开原文、显式建议确认、问题绑定、丢失响应后的同标识重试、重开恢复、历史与当前轮次隔离、补充阻止旧修改，以及失败与取消。17 张三宽度/状态截图通过，页面错误为零；实际字体与 reduced-motion 已检查。浏览器用例没有调用真实模型。

页面验收修正了取消后旧 outcome 覆盖状态标题、等待订阅结束被误报断连及代次变更后回复恢复提示不消失的问题；移动端需求清单默认折叠，必要问题和输入框保持可达。最终截图、浏览器结果、复核包及检查日志位于 `.impeccable/review/t10/`，不把旧失败图当成当前证据。

本轮没有启动或重启任何服务，现有 Next.js/PostgreSQL 进程未替换；验收用有限 `runTask` 调用，不表示常驻 Worker 已运行。代码及报告仍在本地，未提交或推送。

独立 fresh generic sub-agent 承载 Impeccable Finish Reviewer 契约，先逐张查看全部 17 张截图再核对复核包和源码，结论 `ship`；Documenter 为 `No changes`，未修改全局设计或实现。主 Agent 已读回结论并查看等待/确认页面，UI 结论与上述真实模型、后端证据共同构成本票验收。
