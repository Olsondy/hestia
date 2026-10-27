# T01：平台模型图片与受限工具调用验收

2026-10-25：用户配置根 `.env` 并授权只用合成样本调用真实 API。本轮完成 **6 次真实请求**；独立视觉真值、问答/修改意图、精确单位及截断保护通过预设小样门槛。主 Agent 已核对证据，作为 T01 的初始配置准入验收并关闭 #2；不代表 T02 真实图纸、整屋设计质量、生产可靠性或 T08 领域执行验收。没有读取/上传 `example/pdf`，没有启动/重启服务，没有执行工具或修改项目。

## 配置与预算

实际配置模型为 `deepseek-flash`，通过已配置的 HTTPS OpenAI-compatible 端点，使用 `@ai-sdk/openai-compatible@3.0.78` / `ai@7.0.153`。端点和密钥不进入证据或报告。应用侧仍选择执行配置，验证模型没有自行选择端点或权限。

- `design_quality` 初始小样：1024 输出 token，上限 30 秒，零重试。
- `edit_fast` 初始小样：512 输出 token，上限 30 秒，零重试。
- 人为截断：1 输出 token，上限 30 秒，零重试。
- 未声明已配置 temperature、seed 或供应商推理强度；未设置的参数由供应商默认处理。两个执行配置使用同一模型，区别为任务上下文与输出上限，并不冒称不同的模型能力。
- 六次供应商报告合计 **4062 输入 / 1244 输出 token**。未取得价格或完整账单，不换算费用；推理/缓存细分未单独评价。

## 评估前冻结的评分与门槛

`scripts/validation/model-evaluation.ts` 在发出任何评估请求之前，将固定提示、独立真值、图片 SHA-256 和门槛写入 `tests/fixtures/synthetic/model-evaluation/manifest.json`。没有按结果修改门槛。质量组和快速组分别计分，不以合法 JSON 代替语义正确：

| 维度 | 初始门槛 |
| --- | --- |
| 视觉语义 | 2/2：矩形只有左侧一个缺口；纯白图无房间、门或尺寸。不得猜测米制尺度或可安全放置。 |
| 质量组工具意图 | 有明确请求的图片例恰好提出 `(2,1)` 一个请求；空白图问答不产生工具。 |
| 快速组意图 | 2/2：20 cm=0.2 m，仅将指定对象从 `(2,1)` 提议到 `(2.2,1)`；对象/方向/距离不明时澄清且零工具。 |
| 失败保护 | 真实 length 截断返回 rejected、零可执行提案；既有离线拒绝/错误/非法字段反例全部通过。 |
| 时延调查上限 | 快速组每例总时延≤10 s、存在文本时首文本≤5 s；质量组每例总时延≤30 s、存在文本时首文本≤10 s。缺少应有测量不算通过。 |
| 副作用 | 验证工具没有 execute、数据库或项目写入能力，项目写入为 0。 |

这些是首轮小样调查门槛，不是上线 SLA。每例只运行一次，不计算 P95、不证明稳定成功率，不证明复杂设计质量；真实图纸和几何可执行性仍由后续验收覆盖。首文本时延在真实流接收时测量，不能作为完整设计交付时间。

## 实际结果与独立图像核对

新图由固定 SVG 坐标生成：矩形左边只有一个开口；对照图为纯白。调用提示只要求描述可见内容，不提供矩形或缺口答案。两张图已逐张打开，主 Agent 也独立查看左侧缺口图和原 clean 图。实际出站 payload 的内联 PNG 哈希与独立 manifest 一致，`stream=true`，输出上限与配置一致；记录中不保存请求头、端点或密钥。

| 请求 | 总时延 / 首文本 (ms) | 输入 / 输出 token | 实测与判定 |
| --- | --- | --- | --- |
| 原 `model-probe --live-synthetic` | 2079.73 / 未测 | 702 / 337 | 真实 clean 图文字与完整 `(2,1)` 工具；仅为连通性起点，不计入预设五例评分 |
| quality-image-tool | 2156.64 / 1272.02 | 798 / 307 | 正确识别矩形、左侧单缺口，其他三边连续；明确尺度未知；恰好一个 `(2,1)` 提案，不声称已执行。通过 |
| quality-blank-qa | 1108.89 / 547.03 | 778 / 137 | 正确识别纯白，无房间、门、尺寸；零工具。通过 |
| fast-unit-edit | 1287.67 / 991.67 | 621 / 229 | 正确解释 20 cm=0.2 m，仅对 synthetic-chair 提议 `(2.2,1)`。通过 |
| fast-ambiguity | 1967.66 / 988.43 | 583 / 233 | 请求对象、方向/坐标，零工具，未猜测执行。通过 |
| truncated-tool | 548.01 / 无文本 | 580 / 1 | 供应商 finish=length，应用 failure=INCOMPLETE_OR_REFUSED、rejected、零提案。通过 |

五例实际 networkDispatchCount=5、acceptedProviderResponses=5；加初始探针为本轮六次真实请求。完整合成文本、工具、时延、用量和 payload 哈希见 [T01-live-synthetic-evidence.json](T01-live-synthetic-evidence.json)。图片、提示与独立真值见合成夹具 manifest；无真实住宅信息。

保留两项非阻断观察，不能被下游当成权威状态：

1. 初始探针没有完整约束，文本推断 `(2,1)` 在房间内部且离缺口很安全；图纸未校准，不能支持这一判断。正式五例使用固定 instructions 禁止从像素推断尺寸、通行安全或已执行状态，质量例遵守该边界。原探针输出不能作为生产 prompt。
2. 歧义例正确没有发工具，但说候选中只有一个家具，实际只从受限工具 schema 得知目标，并未读取项目清单。这是未证实的状态描述。T08 必须用权威对象清单与真实工具结果约束回复，不能从这段文本得到项目事实；本例仍满足预设“澄清且无执行”门槛。

## 本地 harness 失败及修复

第一次运行新五例时，使用了 SDK 7 不接受的 `messages: [{role:'system',...}]`。五例均在到达 fetch 前被 SDK 拒绝，**0 次网络请求、0 次供应商响应**，不计为模型失败或 API 额度使用。已改为 SDK 7 的 `instructions` 选项，并在离线协议测试中确认真实 provider payload 首条 system 内容包含完整固定策略；不是仅在变量中保存但没有发送。

失败原始记录保留为 [T01-harness-failure-evidence.json](T01-harness-failure-evidence.json)，明确标注 local-harness-error-no-network。修复后的原五例按原门槛各运行一次，没有自动重试。新增 `firstTextMs` 记录真实流首文本；失败继续仅返回脱敏枚举，不输出 SDK 原始错误或请求头。

## 协议失败边界与验证

`packages/model-validation` 保留 11 项实际 SDK + 本地 fetch/SSE 替身测试，覆盖分片参数、策略序列化与流文本、length/content_filter/error、缺结束事件、未知工具、额外字段、非有限坐标、HTTP 失败/取消、仅问答和图片内联序列化。**11/11 通过，根 TypeScript 检查通过**。真实拒答、真实限流和真实断网没有主动诱发；这些边界当前是明确的离线反例证据。真实截断另由上表独立覆盖。

SDK 会规范化重复 tool-call ID，因此生产运行器仍须使用领域幂等键与事务，不能用供应商 ID 代替。工具提案通过 Schema 不代表几何可放置，更不代表用户授权采用。该验证器没有 execute，所有失败释放空请求集，所有成功也只返回提案；T08/T22 才负责把真实模型接到执行器并验证实际副作用。

## 复现与证据保护

```sh
node --env-file=.env --import tsx scripts/validation/model-probe.ts --doctor
node --env-file=.env --import tsx scripts/validation/model-probe.ts --live-synthetic
node --env-file=.env --import tsx scripts/validation/model-evaluation.ts --live-synthetic
node --import tsx --test packages/model-validation/src/restricted-turn.test.ts
pnpm exec tsc --noEmit
```

live 命令需要显式选项，真实调用消耗平台额度。五例脚本发现既有证据文件时会在网络请求前拒绝，需操作人先归档旧证据再明确重跑，避免跑完才覆盖/报错。图片只来自固定合成生成器，不接受用户图纸路径。超时和 token 上限是单次客户端约束，不是已验证的供应商计费保证。
