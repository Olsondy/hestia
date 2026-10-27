# T08：统一对话中的真实局部修改

2026-10-25。T01 通过后实施，现已通过本地验收：后端、迁移、有限运行器、真实 API 合成小样、工作台 UI 与独立视觉复核均完成。不表示完整设计 Agent 或常驻 Worker 已运行。

## 最终整合验收

最终 `pnpm check` 通过：4 项原型测试、44 项核心测试及根目录/Web/Worker 类型检查；`pnpm test:db` 93/93 通过（其中 T08 19 项）。`git diff --check` 无空白错误。验证使用已启动的 Next.js 与 PostgreSQL，本轮没有启动或重启任何服务。

工作台采用统一空间对话入口，保留家居杂志布局、Tsanger YuYang 与 reduced-motion。浏览器以工具仅返回 `{reply, decision}` 的 SDK 传输替身检查混合问答与准确修改、刷新后回复恢复、撤销、取消、失败、歧义、重试、空项目，以及模型虚构已修改时应用仍明确显示空间未修改。17 张桌面、1100px 和移动端截图已检查；没有横向溢出或页面错误。此浏览器用例不冒充真实模型。

独立 generic sub-agent 承载 Impeccable Finish Reviewer 契约，先看全部截图再读复核包，结论 `ship`；Documenter 为 `No changes`。复核包、截图、浏览器结果、最终检查日志位于本地 `.impeccable/review/t08/`。真实模型单次混合复验则回答单位换算、准确移动 20cm 并通过撤销；首回复约 784ms，总处理约 1417ms，仅为该合成小样观测值。

代码与验证报告尚未提交或推送。页面提交任务仍需要用户另行启动常驻 Worker 才会自动消费；本轮使用有限 `runTask` 调用验收，不自行启动 Worker。

## 实现与边界

复用 T07 的 `design_tasks`、pg-boss 队列、任务接受/查询/取消 API、事件序号与 SSE、claim/generation/lease；增加 `conversation-v1`，保留原 `deterministic-v1` 行为。`0009-conversation.sql` 已应用现有 PostgreSQL，增加版本化协议约束和 `conversation` JSON 状态；没有新服务或第二套自主运行框架。

`POST /api/projects/:id/tasks` 接受严格的 `{operationId,expectedRevision,protocol:'conversation-v1',message,selectedObjectId?,referenceFrame:'plan'}`，返回 202 `{task}`。接受请求只保存消息、项目快照、应用生成的领域 operationId 并入队，不调用模型。owner/project 从登录与路径绑定，模型不能提供身份、端点、预算或授权。选中对象必须属于项目；固定/锁定对象可用于问答上下文，但不能修改。

任务 view 保留原字段，新增 `conversation.input/phase/outcome/modelUsage`；不暴露内部空间快照、密钥或配置端点。现有查询、取消和 SSE 路径不变。模型由有限 `runTask` 的 conversation 分支调用，未来同一 Worker 入口也调用此函数。Worker 日志已如实更新；本轮没有启动该入口。

AI SDK 7 使用 `instructions`，`messages` 不放 system 角色。单轮至多一次模型调用，20 秒超时、1600 输出 token 上限、SDK 自动重试为 0；现有队列 30 秒过期，网络调用在数据库事务外，每 4 秒短事务续期原有 15 秒 lease。模型、prompt、工具、提交策略版本与参数持久化，密钥和完整 endpoint 不持久化。

模型只通过 `resolve_turn` 提出 answer/clarification/move/rotate，最终工具根为严格 object `{reply:非空字符串,decision:...}`；不提供 execute。reply 是规范完整答复，decision 只描述动作；保留 answer/clarification.message 作兼容，正式展示以 reply 为准。每轮只允许一个完整提案，重复完整工具请求、额外字段、未知工具、截断/拒绝/错误均不执行。只有自由文本而没有规范完整回复时不宣称本轮业务完成。

修改对象由接受时的 selectedObjectId 绑定，不接受模型切换目标。移动以原文方向、数字字符串及 m/cm/mm 单位为证据，由代码从原位姿计算准确增量；旋转以明确顺/逆时针及角度计算。模型不能输出任意目标位置来偷偷缩短距离。当前允许明确图纸方向、阿拉伯数字距离/角度；难以可靠提取的表达进入澄清，不把此有限语法覆盖宣称为任意自然语言能力。

模型负责本轮意图解析，不建立关键词问答路由或第二入口。写入边界另外做保守否决：evidenceQuote 必须覆盖用户原始完整语句，审查完整源消息中的假设、引用、禁止修改及未选中/其他对象指向。故意从“移动20厘米会撞墙吗？”截掉问句尾，或从“如果我说……”抽出命令，均不能获得写入权限。混合“这里是什么空间？把所选家具沿图纸向右移动20厘米”仍可按独立明确指令修改。此规则会保守澄清部分复杂句，不声称完全证明任意语言授权。

完整模型响应先持久化，再调用 T05 `executeCommandInTransaction`；领域操作、权威事件、检查点和终态在同一 fenced 事务中提交。继续复用锁定、固定事实、尺度、几何、项目修订与撤销检查。碰撞不缩短距离、不缩小家具、不移动范围外对象。

模型回复通过公开的 AI SDK `tool-input-delta` 与 `parsePartialJson` 提取 reply 的可显示前缀，事件明确 `source:model, provisional:true`，不作为执行凭证。部分修复 JSON 仅用于展示，绝不产生 decision；执行仍只接受 SDK 完整工具请求、严格 Schema 和完整 finish。重复 JSON 字段（含转义字段名）、前缀改写或不一致均失败关闭。只展示规范 reply，工具外自然文本仅记录诊断，避免两条输出路径重复。最终 reply 保留原始空白，仅拒绝全空白，不做 trim 转换。真正的操作事件由应用在提交事务内产生，含准确 before/after、操作 ID 和项目修订；权威 outcome 由应用生成。即使模型 answer 文本捏造“已移动”，任务仍明确“本轮已回复，空间未修改”，没有 operation 事件。

## 恢复与取消

- 完整响应已保存后中断：重投读取已保存响应，不再次调用模型，沿用原 operationId 提交一次。UI只显示当前generation文本，恢复时在本代次尚无模型文本的情况下重放已持久完整reply；同代次不重复，实际操作仍只有一次。
- 调用已开始但完整结果未保存：记录 `MODEL_OUTCOME_UNKNOWN`，token 用量保持 null，不隐式重调。此小步实现不尝试猜测供应商最终计费；更完整用量核对/任务预算由 T21 验收。
- 当前 generation lease 过期：抛出让队列重投，不能 ACK 后把任务留在 running；新 generation 或取消已接管时，旧尝试仅停止自身。
- 失败终态本身也要求有效 fence，过期执行者不能结束新执行者的任务。
- 取消在任务行锁上推进 generation；调用期间由心跳发现并 abort，迟到结果不能提交。取消后的供应商用量若没有返回仍为未知。
- 项目被手动改动后，旧轮次不能覆盖新版本。只读答案也标明绑定接受时版本，过期时要求重新发起。

## 自动与 HTTP 证据

| 验证 | 结果 |
| --- | --- |
| `node --env-file=.env --import tsx --test packages/conversation/src/runtime.test.ts packages/tasks/src/runtime.test.ts` | reply 修复后 28/28：T08 18 项、T07 10 项；随后新增尾随空格/换行专项 1/1 通过，当前 T08 共19项 |
| `node --env-file=.env --import tsx scripts/validation/conversation-api.ts` | 三个真实 HTTP/PG 流程通过，模型是明确的 SDK 传输替身，真实模型调用 0 |
| `pnpm exec tsc --noEmit` | 通过 |

T08 数据库用例覆盖身份/同源入口所需服务权限、幂等接受、精确位移和撤销、混合问答、伪造成功文本、假设/引用/问句截片、20cm 偷改10cm或单位、非选中对象转嫁、碰撞、固定/锁定、旋转、截断/额外字段/未知工具/重复提案、响应后恢复、未知调用停止、取消/过期代次/项目冲突。

两个延迟 SDK 替身用例分别等待 5 秒并核对 lease 在第4秒已续期，以及在调用期间取消、约第4秒发现取消并 abort；它们使用真实 SDK 流和真实 PostgreSQL，但不连接外部 API，也不启动服务。现有 T07 的真实 Worker 进程证据不被重新声称为本票真实模型 Worker 验收。

HTTP 脚本通过真实登录、项目 API 和任务 API 创建独立 `@example.test` 合成账户/项目，验证匿名、跨账户、跨源和额外授权字段被拒绝；重复提交只接受一次。先断开 SSE 读取，再由一次性 `runTask` 完成本轮，查询和事件重放读取真实状态，修改后通过真实 command API 撤销。

## 三次真实平台调用

命令：`node --env-file=.env --import tsx scripts/validation/conversation-api.ts --live-synthetic`。只发送应用内合成场景与测试文字，没有读取或上传私人图纸。配置模型为 `deepseek-flash`，采用上述固定运行参数，三个用例均达到预期：

| 用例 | 真实结果 | 模型耗时 | 输入/输出 token | 已知 network dispatch |
| --- | --- | ---: | ---: | ---: |
| 选中的 desk-b 沿图纸右移20cm | x 从 -2.1 到 -1.9；仅提交一次，项目到 revision2，可撤销回原状态 | 1475ms | 1702 / 150 | 1 |
| sofa-a 沿图纸下移180cm | 模型保持原距离；领域 `PLACEMENT_REJECTED`，原场景及 revision1 不变 | 1582ms | 1621 / 232 | 1 |
| “把它移动一点” | 请求明确方向和距离；clarification，空间未修改 | 1136ms | 1679 / 139 | 1 |

这些是三次单例模型处理耗时，不是端到端 SLA，也不表示复杂设计质量通过。用量来自供应商响应，未换算价格；费用由供应商实际计费核对。

此前第一次尝试在131ms内安全返回 `MODEL_STREAM_ERROR`，无文本、finish 或用量，项目未修改。当时工具根为 union，随后改为 object 包装，离线核对实际出站 Schema 后三例通过。根 Schema 兼容问题是前后对照支持的解释；首次没有记录 HTTP status 或 dispatch 数，不虚构400、不确定其是否实际发送或收费。保守按最多4次尝试记录，修正后三次确定各发送1次，无自动重试。

忽略目录中的证据分别为 `.impeccable/review/t08/backend-live-initial-failure.json`（保留首次失败）、`backend-live-result.json`（三例成功）、`backend-api-result.json`（离线协议/真实HTTP）。证据只含合成输入、脱敏参数和结果，无凭据或完整 endpoint。

## 清理与未覆盖范围

验证结束在 finally 中按随机合成账户/项目/任务 ID 清理身份、邀请、项目、修订、操作和所属队列 job；DB用例独立随机队列 schema 已清理。未启动/重启 Next.js、PostgreSQL、Worker 或其他服务；没有消费常驻队列。所有模型成功证据来自有限 runner 调用，不能称后台服务正在运行。

本票仍由主 Agent 汇总生产 UI、浏览器和独立视觉审查。长期需求来源/多轮问题续接属于 T10；真实图纸导入属于 T02/T11；整套设计、动态要求和任务预算分别按后续工单验收。代码与本报告尚未提交或推送。

## 补充：同轮问答加修改的真实反例

在前三例完成后，主 Agent 另行指定仅追加一次 `--live-mixed`，输入“20厘米等于多少米？把选中的书桌沿图纸向右移动20厘米”。未重跑原三例。

这次真实结果 **未通过**：`deepseek-flash` 在3287ms内产生完整移动提案、任务提交到 revision2，但 `response.text` 为空，没有回答单位换算问题。已知 network dispatch=1，供应商用量1703输入/462输出 token。问答断言失败后未继续本用例后面的位移/撤销断言，不能称本混合用例完整通过；合成账户、项目和任务在 finally 中按确切范围清理。失败独立归档为 `.impeccable/review/t08/backend-live-mixed-initial-failure.json`，不覆盖原三例或首次失败证据。

已确认的实现缺口：`resolve_turn` 当前互斥的 move/rotate 分支没有问答字段，只依赖模型额外产生流式文本；本次供应商只返回工具调用。因此原有混合意图替身测试只证明问答句不妨碍正确移动，不能证明真实同轮两部分都完成。本项反馈主 Agent 后暂停追加真实调用。建议将工具返回明确拆成 reply 与 decision，保留模型正文和权威执行结果的区别，再单独验证；此建议在本文记录时尚未实施。

## 混合请求修复后的最终复验

主 Agent 确认具体反例后，工具契约提升为 resolve-turn-2-reply，instructions 为 local-conversation-2，提交策略记录 exact-local-change-2-reply。规范 reply 必填非空，必须包含同轮问答；旧持久化完整响应若没有 reply，不会重调模型或提交为混合成功，而以 MODEL_REPLY_REQUIRED 停止、保留旧证据并要求重新发起。已经完成的历史任务不重写。

新增自动验证严格使用 tool-only 分片（没有预先的自由文本回答）：同一回复包含“20厘米等于0.2米”与准确移动，检查持久化文字和一次 operation；缺失/空 reply 不允许写入；旧无 reply 响应恢复不再次调用模型；重复 reply keys（含 Unicode 转义）拒绝；尾随空格和换行保持原样且不误报前缀冲突。另有受控暂停的真实 SDK 流：工具 JSON 未完整时已从数据库读到“20厘米等于”的回复事件，项目仍是 revision1；放行剩余片段后完整回复无重复，项目只提交一次到 revision2。

仅追加一次真实 --live-mixed 复验，未重跑旧三例。deepseek-flash 在同一回复中明确回答“20厘米等于0.2米”，并提出 desk-b 沿图纸右移20cm；真实领域提交 x=-2.1→-1.9、revision2，只发生一次，实际 command API 撤销恢复原场景。脚本全部断言通过。规范 reply 首片在784ms可用，总模型处理1417ms，供应商输入1804/output218 token，network dispatch=1。首片时间是运行器提取可显示回复的时刻，不是浏览器接收到首字的端到端 SLA。

成功证据在 .impeccable/review/t08/backend-live-mixed-result.json，失败归档独立保留。原三例为 resolve-turn-1 时的单意图证据；此新增用例是最终 resolve-turn-2-reply 的真实问答+修改证据。全过程已知真实 dispatch共5次（原三例、混合失败、混合成功），另首次Schema相关失败dispatch未知，因此保守最多6次尝试，不推算未知费用。未新增服务或 Worker 进程，合成数据均已清理。

最终增量复核：尾随空白专项与完整响应恢复专项 2/2 通过；恢复用例同时核对新 generation 可见原规范回复、模型调用仍只有一次、operation 仍只有一条。当前 T08 runtime.test.ts 共19项，整仓最终复跑由主 Agent 记录。
