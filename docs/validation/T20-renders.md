# T20：后台生成与领取静态成果

2026-10-25：后端、独立渲染队列、显式 Worker 入口、版本冻结与私有下载已实现。领域/文件反例测试 8/8 通过；首次人工发现的空白图已定位并修复，重新生成的两套图与交互 3D 已人工核对。用户另行明确授权本次隔离 Render Worker 验收，真实进程 exit 0，通过关页执行、版本冻结、候选不采用与私有下载。UI 最终独立 fresh review 为 ship，Documenter 无全局规则变更，主 Agent 汇总后已关闭 T20/#21。

## 接口与来源

`POST /api/projects/:id/renders` 返回 202 `{render}`，输入为：

```json
{ "operationId": "UUID", "source": { "kind": "current", "revision": 1 } }
```

候选使用 `source:{kind:"candidate",candidateId:"UUID",revision:1}`。current 必须匹配当前项目版本；candidate 必须匹配该候选版本，冻结候选自身 base_state 与 objects，不改当前方案或产生采用记录。已过期候选仍可作为明确的历史候选输出，`stale` 如实显示。

`GET /api/projects/:id/renders` 返回最近 20 项 `{renders}`；`GET /:renderId` 返回 `{render}`；`GET /:renderId/content` 内联 PNG，`?download=1` 提供下载。所有接口校验服务端身份与项目归属，变更要求同源；图片响应 `private, no-store`、nosniff，不暴露对象存储 key。未完成时无法下载；读取时核对已保存的图片 SHA-256。

RenderView 精确类型见 `packages/contracts/src/renders.ts`：queued/running/retry_wait/completed/failed、冻结 source、snapshotHash、assetVersion、rendererVersion、尺度/合成/concept/label、当前项目/候选版本及 stale、完成后的文件链接/尺寸/摘要、可查询错误。冻结 source 包括项目基础修订与固定事实版本。后续编辑只改变当前版本对照，不把旧图换成新图或更改原来源。

## 持久化、队列与文件

`0007-renders.sql` 建立 project_renders 和 render_attempts。任务接受、请求幂等结果与官方 pg-boss `send()` 同事务提交；生产独立 schema 为 `hestia_renders`，队列 `hestia-static-render`。API producer 不调用 start/work，不在浏览器连接上执行渲染。

渲染器读取接受时已冻结的完整 SceneSnapshot；来源摘要使用键排序后的规范 JSON，避免 PostgreSQL JSONB 属性排序破坏校验。资产指纹覆盖 catalog/src 的全部非测试 TypeScript（包括真实原型家具生成器）及原型样本/材质/纹理；渲染指纹覆盖 scene-runtime/src、场景/目录契约、独立图片标签包装、实际 Three.js 版本、Sharp/Playwright 版本与 Tsanger TTF 内容。执行前后均核对版本；规则变化明确失败，不冒充使用旧规则生成。Worker 模块加载时另保存指纹，防止长活进程使用旧内存模块却读取新磁盘指纹而错误标注。此加载期保护是在真实进程验收后补充，有限数据库 8/8 和 TypeScript 再次通过，未再次启动 Worker。当前本地运行从仓库根目录读取这些源，部署打包须保留相同版本清单，不能直接丢失来源文件。

Worker 每次领取在行锁内递增代次，租约 120 秒、最多 3 个执行代次；pg-boss job 超时 180 秒，独立重试调度。所有发布在事务里重新校验当前代次和租约。每代生成独立 resourceId / `projects/{uuid}/resources/{uuid}.png`，复用 T09 的 LocalPrivateFileStore，禁止任意输入路径。

文件写入和读回摘要核对完成后，资源 ready 与渲染 completed 在同一事务发布。迟到的旧代次至多写自己的未发布文件，无法覆盖新代已发布 key。上传响应或发布 COMMIT 结果未知时不删除文件；重试仍用新代 key，completed 后重投不重新生成或覆盖。未发布尝试的文件/资源会保留，单任务最多三代，后续存储清理必须识别发布状态，不能无条件删除。此行为优先避免错误删掉已发布成果。

`apps/worker/render.ts` 是显式服务入口，`scripts/render-worker.ts --setup` 只有限初始化队列，默认无参数才启动 Worker。`HESTIA_RENDER_QUEUE_SCHEMA` 经过严格名称校验，默认 hestia_renders；它只供独立测试配置，不更改 Web API 进程环境。

## 图像与标签

复用共享 `renderSnapshotToPng` 与 Three.js SceneSnapshot，不维护第二套几何/家具/材质实现。因为共享函数只截图 canvas，`packages/renders/src/image.ts` 在最终 PNG 上方追加 112px 的真实像素标签，使用用户提供的 **TsangerYuYangT W02** TTF 和 Sharp/Pango。

标签包含当前快照/候选未采用、来源版本、合成示例或概念草稿；missing/estimated/conflicted 均明确写入“概念草稿 · 尺寸未校准”。第二行保存项目基础修订及快照、资产、渲染摘要。用户下载或脱离工作台查看时仍能看到这些信息。纯标签格式在 label.ts，API 不加载 Playwright/esbuild；首次将标签放入 image.ts 引发 Next 构建依赖污染，已拆分修复。

## 已通过的有限数据库验证

```sh
node --env-file=.env --import tsx --test packages/renders/src/service.test.ts
pnpm exec tsc --noEmit
```

8 个独立测试通过，无嵌套计数：

- 同请求并发只一项成果/真实 pg-boss job；不同输入重用与旧版本拒绝；队列失败整体回滚。
- 创建、列表、详情、文件的跨账号/跨项目访问拒绝；伪路径字段拒绝。
- 生成中项目改变仍消费冻结快照；完成结果标旧版，重投不重渲染。
- 候选版本冻结且不采用；概念标签实际光栅化，PNG 高度包含标签区。
- 文件已写但响应丢失时保留文件，新尝试使用不同 key。
- 租约过期代次不能发布或覆盖新代 ready 资源。
- 快照/渲染版本不符、连续失败均可查询且不发布内容。
- 下载摘要不符拒绝；所有未校准尺度均带概念标识。

上述测试用可控 PNG 替身检验持久化与文件行为，不证明真实 3D 图像正确。测试只操作自己的随机项目、身份标识、临时文件根和隔离 pg-boss schema，收尾精确清理。

## 视觉与真实 Worker 证据

首次 `render-ui.ts` 的 HTTP/交互检查通过，但人工核对两张实际 PNG 发现 header 下空白画布，已否决该轮图像结论。独立 raw/wrapped 对照确认空白来自共享渲染输出，而非 Sharp 标签合成；主 Agent 的进一步探针发现 WebGL context lost。共享渲染器随后采用明确的 `--use-angle=swiftshader` 软件 ANGLE，并检测上下文丢失及实际像素差异，在发布前后检查异常；未禁用 sandbox 或启用 unsafe 标志。

修复后主 Agent 重新执行 `render-ui.ts` 并逐图检查；本后端 Agent 也独立打开两个 static、两个 interactive 及两个 worker PNG：方形空间的门窗、固定高柜、绿沙发、木色桌，凹形空间的凹口、斜墙、窗洞、床块、木色家具和绿色固定设施，数量、位置、朝向、轮廓和配色对应。不同画幅导致视野比例变化，未发现对象缺失或布局替换。合成示例与概念未校准文字已经写入图像，最新 Worker 概念图同时保留合成标识。此对比使用既有合成体块资产，不将它冒充精细商品资产或真实住宅校验。

有限 UI / HTTP 结果位于 `.impeccable/review/t20/browser-result.json`：1440/1100/390 宽度、接受响应丢失后同操作重试、关页后有界调用、旧版来源标识、候选不采用、真实 PNG 下载和无页面错误通过；UI 截图与有限调用不能单独替代下述进程证据。主 Agent 正补最终失败状态截图及 fresh UI review，最终结论应读取其最新记录。

用户明确批准本票的隔离 Render Worker 后，主 Agent 运行：

```sh
node --env-file=.env --import tsx scripts/validation/render-process.ts --allow-render-worker-process
```

实际进程 **exit 0**，`.impeccable/review/t20/render-process-result.json` 记录通过：只创建 1 个自己的 Render Worker 进程，用户页面关闭后由真实 pg-boss 独立队列消费并生成 2 张 PNG；来源版本冻结且旧版标识正确，候选未采用，概念标识光栅化，登录用户可通过私有 HTTP 路径下载。脚本使用独立 render_process schema 和随机账号/合成项目，不启动 Next.js、PostgreSQL 或测试 HTTP 服务，不消费生产渲染队列。finally 只终止自身 PID/ChildProcess，并精确清理自己的项目/文件/schema。

独立只读数据库复核：render_process schema **0**、本次前缀测试账号 **0**、测试邀请 **0**、无所属项目资源 **0**；脚本成功退出也经过自身文件清理。当前有效图像是 worker-courtyard.png、worker-angled-concept.png 及重跑后的两组 static/interactive，先前白图不作为成功证据。本次许可仅覆盖这次隔离验收，后续服务启动仍遵循用户许可规则。

## 最终 UI 与工单验收

主Agent最终有界浏览器脚本再次exit0：增加自己测试快照摘要损坏的失败路径，失败状态没有下载，手机错误明确；重拍1440/1100/390、概念/失败状态并检查真实图片内容。新鲜独立通用子Agent先查看七张当前UI图与一张Worker图，再阅读packet源码，Impeccable Finish Reviewer disposition: ship，无material fixes；Documenter对照既有editorial/Tsanger体系，无需全局样式重写。单次detector仅手机16px原生输入字号advisory。结合真实进程、领域与图像核对，T20四项标准验收通过；生产部署和真实模型不在此结论内。
