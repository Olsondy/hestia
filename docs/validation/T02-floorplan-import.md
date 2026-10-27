# T02：合成图识别与输入转换记录

2026-10-25：纯 TypeScript 转换及合成图脚本实测已完成。本次已调用真实配置 `deepseek-flash` 评估三类合成图：清晰图因输出截断没有完整结构；扫描、手绘效果图可转换但未通过事先固定的几何门槛。三类真实住宅样本/人工基准仍未验证，#3 保持开放，不据此解除真实识图相关下游。

## 可复用范围

`packages/floorplan-import` 将 HouseSpec 毫米/图纸 x-y 转换为米/领域 x-z 候选。它不依赖渲染器，不写项目，也不是 T04 的正式领域 Schema。15 项测试验证毫米往返误差小于 1e-9 mm（有限测试范围）、显式原点、方向/北向分离、倒向/斜墙门洞、窗型高度默认值、尺度证据、非法几何和重复 ID。有限输入产生溢出也拒绝。

水平开口 from/to 为绝对 x，竖直为绝对 y，斜墙为距 a 的距离；转换后 offset 始终沿 a→b。家具图纸顺时针角转为 Three 右手 yaw 的负弧度。墙按中线输入；非居中 flush 暂拒绝，避免静默移位。默认门窗高度会保留假设告警。

来源尺度只由调用方独立证据传入：missing/estimated/conflicted 都是 conceptOnly；calibrated 必须有 evidenceId 和人工/核对图纸来源。模型自己给的 confirmed、scale 等字段不具备提升权限。承重与固定设施始终是未确认假设。room 标签不虚构闭合房间；拓扑闭合、墙交点、面积、碰撞和可放置仍待领域校验。源家具/其他未映射字段明确警告，不静默宣称完整导入。按输入索引产生的 ID 只保证同一输入重复转换稳定，跨识别版本的对象身份匹配仍待实现。

## 实际算法实测

只调用本机 house-plan-designer 的 `scripts/analyze.py`，未复制或修改它；许可为 MIT（Copyright 2026 ZWD11）。脚本 SHA-256：`397bb87eb88d424863db0fec6a96c10fa7ca5e7c25751b9c5a48c9f4296c0aad`。环境与去除绝对路径后的逐例输出保留在 `synthetic-analyzer-evidence.json`。依赖为 Python 3.12、Pillow 12.3.0、NumPy 2.2.6、opencv-python-headless 4.12.0.88；隔离安装后实测，没有形成第二套业务服务。

| 合成输入 | 真值 | 实际输出 | 观察 |
| --- | --- | --- | --- |
| clean.png | 4 墙、1 开口 | 4 墙、1 开口 | 开口宽 900 mm；墙端点仍有延长，不能按计数宣称几何完全正确 |
| scan-like.png | 同上，旋转 0.7° + 噪声/模糊 | 4 墙、0 开口 | 漏开口，底墙只保留一侧，计数未暴露完整度问题 |
| handdrawn-like.png | 同上，扰动双线 | 退出 1，没有识别到墙体 | 即使 `--outlined` 也未识别 |

clean 的墙中线回到原始图像坐标后：顶墙 a=(1100,1220)、b=(7320,1220)，真值为 (1200,1200)→(7200,1200)；底墙 z=5200 与真值一致，右墙 x=7220 与真值相差 20 mm。由像素厚度和端点延长引出的误差必须人工核对，不能把算法输出的 bearing=true 或 scale=20 当作真实住宅确认。

结论：该脚本可作为灰黑、粗实线、近轴向图的候选提取辅助；旋转、断口、手绘双线有明确失败。PDF/DXF、OCR 标注、墙连接拓扑及真实图纸泛化未验证，不宣称支持。复用脚本之外仍需受控输入、尺寸证据、人工校核和失败恢复。

## 复现

```sh
python -m venv scripts/validation/.venv
# 使用该虚拟环境的 python / pip；Windows 路径为 .venv/Scripts/python.exe
python -m pip install Pillow==12.3.0 numpy==2.2.6 opencv-python-headless==4.12.0.88
python scripts/validation/generate-synthetic.py
python scripts/validation/evaluate-analyzer.py --analyzer /absolute/path/to/house-plan-designer/scripts/analyze.py --output scripts/validation/.tmp/new-evidence.json
node --import tsx --test packages/floorplan-import/src/house-spec.test.ts
node --import tsx scripts/validation/convert-floorplan.ts tests/fixtures/synthetic/ground-truth.housespec.json scripts/validation/.tmp/candidate.json
```

评估输出使用独占新建，避免覆盖旧证据。convert 命令默认 estimated、未确认；只做文件转换，不向模型发请求。外部脚本应核对哈希，更新版本后重新实测。合成图片生成基准不是人工核对过的三类真实样本，不能代替首项验收。

## 真实 API · 合成图评估（2026-10-25）

用户配置根目录 `.env` 后，明确授权先使用合成样本继续验收、不启动或重启服务。本轮仅发送仓库已有 `clean.png`、`scan-like.png`、`handdrawn-like.png`，共 **3 次实际请求、零重试**，没有读取或上传 `example/pdf`、住宅资料、项目记录。没有启动服务、Worker、队列消费者或数据库；工具无 execute 回调，实际项目写入为 0。

`scripts/validation/floorplan-model-eval.ts` 使用实际 AI SDK Core 7.0.153、OpenAI-compatible 3.0.78 与根 `.env` 的平台配置。严格工具 Schema 只接受候选观察，完整 `tool-calls` 结束且恰有一个合法请求才进入既有 `convertHouseSpec`。不把截断流或模型文本拼成结构，也不向模型发送基准答案。

### 输入、独立真值与预先门槛

三张输入已由执行者逐张打开查看：清晰与扫描效果图为粗线外框、底边单一缺口，手绘效果图为轻微扰动双线、同一缺口；没有房间文字、门扇/窗符号、家具或固定设施。基准来自 `generate-synthetic.py` 与 `ground-truth.housespec.json`，**未放进 prompt**。源文件哈希保存在各条 JSON 证据。扫描图经过 0.7° 旋转和噪声，手绘图经过双线扰动；本轮比较的是变形前的理想几何，不等同于真实扫描/手绘泛化。

Prompt 仅给出 420×320 画布、左上角原点、x 向右/y 向下，以及 **调用方给定的合成实验假设** `20 mm/px`、高度 `2800 mm`。没有给墙或开口数量、端点、宽深和开口位置。20 mm/px 不是模型从图中识别的尺度，不是用户确认的真实尺寸；传入转换器的可信尺度状态固定为 `estimated`，高度及开口默认高度也不构成实测。

第一次请求前冻结评分方式：墙中线做方向无关端点匹配，最大端点偏差 ≤100 mm（5 px），厚度误差 ≤40 mm，单一开口的端点/宽度误差各 ≤100 mm；另查无额外房间标签/固定物、毫米↔米往返误差 ≤1e-9 mm 和所有确认边界。计数正确不替代坐标核对。本轮门槛是这个低分辨率合成实验的初始验收值，不是住宅施工容差或上线 SLA。

### 实际结果

| 合成输入 | 请求上限 | 总时延 | 供应商用量（入/出 token） | 协议/转换 | 几何与语义结论 |
| --- | --- | --- | --- | --- | --- |
| clean | 2500 输出 token，60 s | 14.05 s | 1358 / 2500 | `finishReason=length`；无完整工具请求，无候选 | **截断失败**，没有几何输出可评分；不是几何识别错误，也不算通过 |
| scan-like | 6000 输出 token，60 s | 6.26 s | 1358 / 1230 | 完整工具请求，4 墙/1 开口，转换成功 | 最大墙端点误差 256.1 mm、开口端点误差 200 mm、开口宽误差 0；新增 1 条非源图描述性房间标签；**未通过** |
| handdrawn-like | 6000 输出 token，60 s | 11.70 s | 1358 / 2269 | 完整工具请求，4 墙/1 开口，转换成功 | 最大墙端点误差 215.4 mm、开口端点误差 128.1 mm、开口宽误差 100 mm；新增 1 条非源图描述性房间标签；**未通过** |

清晰图 2500 token 用尽后，主 Agent 明确允许仅剩余两张不同输入提高到 6000 token；未重试清晰图，未调整温度、推理参数或供应商配置，也没有挑选成功样本。因此这不是同配置下的三类成功率比较。清晰图没有保存推理流，不能确定其 token 是否全部用于推理；另外两次确有 `reasoning-delta`，只记录字符计数，不保存原始推理。真实费用未计算，不把 token 总量换算成未经核对的价格。

人工核对完整结果：扫描图估计外框为 x=1240..7040、y=1040..5400 mm，真值为 x=1200..7200、y=1200..5200 mm。手绘图顶部为 (1000,1280)→(7140,1280)，左右墙为 x=1080/7060、y=1200..5360，底墙 y=5280：端点未真正接合，模型文字却称矩形外框。转换器仍明确输出 `TOPOLOGY_NOT_CHECKED`，不能因模型描述把闭合拓扑视作已验收。

两次完整输出均识别 plain gap 为 `hole`，没有臆测门扇或窗 subtype，也没有固定设施输出。房间字符串分别为 “Unlabeled enclosed space (no legible label in drawing)” 与 “Unlabelled single space”：它们明确是模型附加的描述，**不是源图 OCR 标签**，仍违反本轮“没有可见标签则不新增 rooms”的要求。没有把这些描述称为真实房间用途。

两次转换的毫米/米往返误差为 0，`conceptOnly=true`、`scale.status=estimated`、整体/墙/开口/标签全部 `confirmed=false`，bearing hypothesis 为 null。手绘厚度误差的浮点值 `40.00000000000001` 按 1e-7 mm 数值 epsilon 视作在 40 mm 边界内，没有放宽业务门槛；经**离线重算**仍因端点/开口与额外标签失败。`scoringRevision.previousMetrics` 保留旧评分，模型响应没有改写，没有额外 API 请求。

### 证据与复现

- `T02-live-clean.json`：截断状态、真实用量、配置与源图哈希。
- `T02-live-scan-like.json`、`T02-live-handdrawn-like.json`：完整模型工具输入、未确认转换候选、逐墙与开口误差、原始评分和离线评分修订。
- 上述文件不含端点、密钥、请求头或原始 SDK 错误。生成的 JSON 是合成测试证据，可以复查，不能冒称真实住宅结果。

```sh
# 各命令仅一次真实请求；已有证据时在发请求前拒绝，需先有意归档才可开展新评估。
node --env-file=.env --import tsx scripts/validation/floorplan-model-eval.ts --live clean
node --env-file=.env --import tsx scripts/validation/floorplan-model-eval.ts --live scan-like
node --env-file=.env --import tsx scripts/validation/floorplan-model-eval.ts --live handdrawn-like
# 已存响应的离线重算，无模型连接，无项目修改。
node --import tsx scripts/validation/floorplan-model-eval.ts --rescore scan-like
node --import tsx scripts/validation/floorplan-model-eval.ts --rescore handdrawn-like
node --import tsx --test packages/floorplan-import/src/house-spec.test.ts
pnpm exec tsc --noEmit
```

本轮 3 个 live 命令均 exit 1，分别表示截断或质量门槛失败，不能写成测试全通过。离线重算、既有转换器 15/15 与根 TypeScript 检查通过。没有修改转换器以迁就模型输出，也没有修改已确认的几何约束。

复用结论：配置的真实模型能够对这两张合成图返回可转换的墙/开口候选，并比本地分析脚本找回了扫描/手绘图的开口；但 20 cm 级端点偏差、未接合墙体及附加标签说明，它目前只适合未经确认的初稿实验，不能直接进入“准确识别、自动确认尺度/拓扑”的生产链路。T02 保持开放；下一步应先改善输入/提取与独立核对，再用授权真实清晰图、扫描图、手绘图验证，不用本轮合成调用解除依赖。
