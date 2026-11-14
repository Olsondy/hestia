# AM02 模型服务、模型 ID、加密密钥与接入检查验证

日期：2026-11-14。范围：工单 #68，依据 ADR-0018。PostgreSQL 17.7（局域网主机上的本地 Compose 容器，经 SSH 隧道映射到 127.0.0.1:54329），HTTP 路由处理函数直接调用；模型一律为本机假服务。

## 实现要点

- **数据**：迁移 `0009_model_registry`：`model_services`（协议、地址、密文密钥与末四位、兼容设置、超时、总并发、最近连通与模型列表）、`models`（服务内唯一的模型 ID、显示名称、说明、最大输出、模型级参数、状态）、`model_prices`（单价版本，分 / 百万 token，只追加）、`model_checks`（每次接入检查的逐项结果、证据与失败原因）。`0010_audit_clock_timestamp`：审计时间改用 `clock_timestamp()`，同一事务里的多条记录保持先后顺序。
- **密钥**：AES-256-GCM，主密钥 `HESTIA_SECRET_KEY`（32 字节，base64 或 64 位十六进制）；设置了 `HESTIA_ADMIN_HOST` 而主密钥缺失或长度不对时 Web 启动失败。接口只回显末四位；更换密钥单独接口，审计只记“已更换”。
- **地址**：不能带账号、密码、查询参数或锚点；生产环境必须 HTTPS。Anthropic 登记到域名为止（带 `/v1` 也接受），其余协议登记到 `/v1`。
- **兼容设置与参数**：只接受协议给出的有限开关（Zod 严格校验），不接受任意请求体。改服务的协议、地址或兼容设置，这个服务下已准入或未通过的模型变为“需重新检查”；改模型的调用参数同理；只改名称、说明、单价或换密钥不影响准入。
- **适配器**（`packages/model-registry/src/adapters.ts`）：Chat Completions 用 `@ai-sdk/openai-compatible`（`transformRequestBody` 处理最大输出字段名与三种思考参数写法），Responses 用 `@ai-sdk/openai@4.0.102`（`store`、推理强度；登记的模型 ID 不在 SDK 自带清单里，要求推理时强制开启），Anthropic Messages 用 `@ai-sdk/anthropic@4.0.88`（`anthropic-version`、思考预算）。三者与 `ai@7.0.153` 共用 `@ai-sdk/provider@4.0.34`。
- **测试连通**：读模型列表（不消耗 token）；服务不提供列表且已启用模型 ID 时改发一次 1 token 请求。结果记在服务上，不计额度、不改准入、不写审计。
- **获取模型列表**：Chat Completions 与 Responses 读 `GET /models`，Anthropic 读 `GET /v1/models` 并翻页；新出现的 ID 标“新”，已启用但不再出现的 ID 在模型上标出，不自动停用；不提供列表时记为不支持并允许手动添加。
- **接入检查**：后台开始检查时在同一事务里把模型置为“检查中”、写检查记录并入队（`hestia-model-check`，由 `pnpm worker:setup` 建队列，任务 Worker 执行）。Worker 真实调用：连通、流式文本、工具调用（T01 单位换算样本，参数须为 x=2.2、z=1）、工具参数流式返回、Hestia 协议样本 3 条（含指令不明确先澄清、截断回复被拒绝）、返回用量。前四项必须通过；工具参数流式与用量可记为“不支持”。检查期间服务或模型设置被改，结果作废、模型回到“需重新检查”。
- **后台页面**：模型服务列表（每个服务测试连通、全部测试、连通失败醒目提示、已启用的模型 ID）、登记与管理服务（协议、兼容设置、密钥末四位与更换、获取列表、启用、手动添加）、模型设置（名称与说明、调用参数、单价与记录、接入检查逐项结果与轮询、停用与重新启用）。审计列表补充了这些动作的中文说明。

## 执行结果

| 检查 | 结果 |
| --- | --- |
| `packages/model-registry/src/registry.integration.test.ts` | 6/6 通过 |
| `packages/model-registry/src/check.integration.test.ts` | 2/2 通过 |
| `packages/model-registry/src/adapters.test.ts`（核心测试） | 5/5 通过 |
| `pnpm check` | 通过，核心测试 108 项 |
| `pnpm test:db` | 196/197；唯一失败为 `conversation/budget.test.ts` 的生产准入测试，改动前基线同样失败（按 ADR-0018 在 AM05 改写） |

断言摘要：非平台管理员与外来来源 403；带账号的地址、非 HTTP(S) 地址、与协议不符的兼容设置、未知协议 400。响应、列表、详情里都没有明文密钥；数据库为 `v1.` 开头的密文，服务端可解出原文。列表内的 ID 直接启用，不在列表里的须手动添加，重复启用 409，含空格的 ID 400。同价不新增版本，改价新增版本；已准入模型改参数变为“需重新检查”，只改说明不变。改名与并发不影响准入，改地址使已准入模型失效、草稿不变；换密钥后末四位更新、准入不变。停用后重新启用须再检查。审计依次记录登记、启用、修改、改价、修改服务（含需重新检查的 ID）、换密钥、停用、重新启用，全部审计中没有明文密钥。获取列表两次正确标出新增 ID，已启用 ID 消失时只标出不停用；测试连通成功后换错密钥变为 `HTTP 401`，获取列表报 `MODEL_LIST_FAILED`。

适配器（本机假服务，只验证适配层）：Chat Completions 的 `max_completion_tokens`、`thinking.type`、`stream_options.include_usage` 与关闭时的 `max_tokens`、`enable_thinking=false`；工具参数分两段流式到达并解析为完整调用，结束原因 `tool-calls`，用量 120/30。Responses 发送 `store=false` 与 `reasoning.effort=high`，读出工具调用与用量。Anthropic 发送 `x-api-key`、`anthropic-version` 与 `thinking.budget_tokens`，读出工具调用。模型列表去重排序、Anthropic 翻页、404 记为不支持、401 报错。测试连通：列表成功、错误密钥 401、无列表时 1 token 探测、超时。

接入检查（本机假服务）：表现正常的模型逐项通过、协议样本 3/3、状态“已准入”，任务与检查记录同事务入队，重复执行已结束的检查不改变结果；从不调用工具的模型在“工具调用”项未通过并给出原因；检查中修改服务地址，结果作废、模型回到“需重新检查”。

## 未验证

- **真实模型**：三种协议都还没有录入真实模型服务做接入检查。需要平台管理员在后台录入真实地址与密钥后运行；在那之前不能视为任何模型已准入。
- **浏览器**：模型服务列表、服务管理与模型设置 1440 的浏览器检查未做（浏览器自动化需用户同意）；本机 3000 端口已有开发服务器在运行，未另起服务做页面冒烟。
- 任务 Worker 进程内消费 `hestia-model-check` 队列未在常驻 Worker 中实测，检查逻辑由测试直接调用 `runCheck` 验证。
