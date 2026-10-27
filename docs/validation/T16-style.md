# T16：独立视觉风格、局部应用与候选采用验证

2026-10-25。本票后端、契约、迁移、共享渲染与生产 UI 浏览器验收通过；独立 Finish Review 为 ship，Documenter 为 No changes。主 Agent 已汇总四项验收标准，有限 WebGL 与真实浏览器证据分别记录如下。

## 数据与操作边界

- `VisualStyle` 独立于 `currentLayout` 和 `fixedFacts`：`{version:1,materials:[{objectId,materialId,materialVersion}],lighting:{presetId,presetVersion}}`。它保存于项目快照、候选当前/历史修订，并投影到 `SceneSnapshot.visualStyle`。
- 旧快照没有 `visualStyle` 时仍使用原对象材质与原默认光照；不重写历史快照或迁移原家具记录。新材质变化使用覆盖，不修改 `object.catalog`、尺寸、测量来源、摆放、固定事实或锁。
- 材质沿用 T15 三套有原型来源的受控 palette 与版本。目录几何使用 palette 的各部件颜色与纹理；旧合成 box 只使用 palette swatch 作代理色，不冒充真实家具贴图。
- 展示灯光是应用内版本化预设 `display-warm`、`display-neutral`、`display-soft`，版本均为 1。warm 与 T16 前默认照明完全同参。预设控制环境光、主光颜色/强度/位置与曝光，不接收任意颜色、脚本或日照参数；不是电气改造、照度达标或真实日照性能结论。
- 材质目标必须为明确的单件家具。固定设施、范围外/不存在对象、锁定家具、未知目录或版本拒绝。实测家具可改变独立展示材质，实物尺寸与测量记录保持不变。整体展示光照可以改变整个画面观感，但不改写任何对象的材质值。
- 删除或换件清除旧实例的材质覆盖，并列入风格差异，防止旧覆盖悄悄套在新实物上。同资产/版本/尺寸的纯材质 `replace-furniture` 返回 `STYLE_REQUIRES_OVERRIDE`，须走独立风格命令。

## API 与授权

所有路径要求真实登录；写入要求同源，跨账户资源返回 404，严格拒绝未知字段。

| 路径 | 输入或返回 |
| --- | --- |
| `GET /api/styles/catalog` | `StyleCatalog {version,materials,lighting}` |
| `GET /api/projects/:id/styles` | `StyleState {projectRevision,visualStyle,undoableCommand}` |
| `POST /api/projects/:id/styles/commands` | `{operationId,expectedRevision,command}`；返回 `StyleResult {project,operationId,...StyleState}` |
| `POST /api/projects/:id/styles/commands/:operationId/undo` | `{operationId,expectedRevision}`；同上 |
| 既有候选 `POST .../candidates/:candidateId/commands` | 原候选信封中新增三个风格命令 |

`StyleCommand` 为 `set-material {objectId,materialId,materialVersion}`、`reset-material {objectId}` 或 `set-display-lighting {presetId,presetVersion}`。reset 恢复对象自身原材质；选择目录对象自身基础 palette 归一为无覆盖，视觉无变化请求拒绝。

明确当前材质修改直接保存，显示可撤销操作，无须创建候选。专用 `project_style_commands` 记录前后风格，复用项目行锁和全局 operations 幂等账本，与 T05 操作历史分开。修改和撤销均递增项目修订，不改布局身份或布局修订。局部风格撤销仅允许该命令之后没有其他项目修订，避免覆盖后续工作；重试同 operationId 不重复应用，返回最新权威状态。

候选 `changeKind` 由服务器计算为 `none | layout | style | mixed`；`styleChanges` 与已有完整 `objectChanges` 分开。纯风格候选称视觉风格，不称新家具布局。保存/预览不采用，仍由 T06 真实同源用户 presentation→selection→adopt 授权链提交；检查、内容 hash、展示与选择绑定独立风格。风格变更使旧授权失效。仍保留必要尺度未确认不能采用的既有边界。

纯风格采用及整体撤销保留布局 ID/修订。布局或混合采用及撤销继续使用 T06 新布局 ID 规则，布局和风格同事务更新。采用后的整体撤销仍严格禁止覆盖后续项目修订。历史/异常候选若在家具记录内携带纯材质变化，即使叠加灯光或移动，也在检查层拒绝；纯风格候选还要求没有对象记录差异，防止采用时丢弃预览内容。

## 迁移与渲染

`0008-styles.sql` 已对现有本地 PostgreSQL 应用并由迁移账本记录：候选与候选修订新增 `visual_style`；采用记录新增 `before_style`、`after_style`、`change_kind`；新增 `project_style_commands`。旧数据空字段按原默认状态处理，旧检查因 checker version 更新须重新检查。

`projects.toScene` 与静态成果候选投影均携带独立风格；交互与静态图复用同一个 `SpatialScene`。材质在每个实例新建/隔离，固定物品不接受风格覆盖；展示灯光只改 scene 的专用灯光。`renderVersions` 纳入风格契约和预设注册源，旧渲染任务不会静默使用新规则完成。

## 自动与真实图像验证

本轮只复用现有 Next.js 3000、PostgreSQL 54329。未启动/重启服务，未启动 Worker 或消费队列。

| 命令 | 结果与证据 |
| --- | --- |
| `node --env-file=.env --import tsx scripts/migrate.ts` | 仅应用新增 0008；既有迁移 hash 校验通过 |
| `node --env-file=.env --import tsx --test packages/styles/src/service.test.ts` | 9/9；局部幂等/撤销/原子回滚，固定/锁/测量保护，纯风格与 mixed 采用，过期选择、旧材质草稿拒绝，静态成果冻结快照投影 |
| `node --env-file=.env --import tsx --test packages/candidates/src/service.test.ts` | 19/19；T06/T15 回归，原纯材质换件测试明确升级为 T16 独立风格入口要求 |
| `node --env-file=.env --import tsx --test packages/commands/src/service.test.ts` | 10/10；T05 行为回归 |
| `node --import tsx --test packages/catalog/src/catalog.test.ts packages/scene-runtime/src/scene.test.ts` | 8/8；实际目录几何、尺寸包络、材质隔离与建筑几何回归 |
| `node --env-file=.env --import tsx scripts/validation/styles-api.ts` | 8/8；真实 HTTP+PG 登录/鉴权/同源、局部保存/重开/撤销、候选风格保存/真实用户授权采用/整体撤销与锁定拒绝 |
| `node --import tsx scripts/validation/styles-render.ts` | 真实软件 WebGL 6 项核对通过，见下文 |
| `pnpm exec tsc --noEmit` 与 `pnpm exec tsc --noEmit -p apps/web/tsconfig.json` | 均通过 |

风格 PG 测试中的静态成果冻结快照使用真实 `createRender`/PG 事务，但 queue dispatch 是明确的测试替身，不是 Worker 或真实队列验收；它证明当前/候选快照包含正确风格，后续候选修改不改写已冻结快照。真实渲染另通过有限 `renderSnapshotToPng` 函数完成，未运行后台 Worker。

`styles-render.ts` 使用两个同目录沙发与一个固定物品的合成空间：只改变一件沙发材质，再改变全场展示灯光。逐项核对材质确实改变像素、灯光确实改变像素、范围外家具与固定物品材质值不变、灯光不改写材质值、渲染后的快照保留独立风格；在相同尺寸与观察角度下，交互保留相机的画布与静态成果 PNG 的原始 RGBA **完全一致**。

以下本地证据均由生成者逐张打开确认画面有效，不提交调试截图：

- `.impeccable/review/t16/render-base.png`
- `.impeccable/review/t16/render-material.png`
- `.impeccable/review/t16/render-styled.png`
- `.impeccable/review/t16/render-interactive.png`

HTTP 与 PG 脚本仅创建随机 `@example.test` 合成账户和项目，在 finally 中按确切账户/项目范围清理操作、资源、修订、项目与身份。图像验证不创建账户，不调用模型，不使用真实住宅资料。工作台 UI 的三宽布局、Tsanger 字体和实际用户交互截图由本票 UI 验收补充。

## 工作台浏览器与整体验证

最终 style-ui.ts 真实浏览器/API/PG 验证退出 0：材质预览尚未保存时不改变服务器场景；提交成功但响应丢失后，同 operationId 重试只增加一个项目修订；刷新、局部撤销和灯光重开通过。实测家具可改变风格，固定/锁定家具不能作为材质目标。纯风格候选同时含材质和灯光两条差异、零对象差异；未保存编辑阻止检查/采用；明确采用和整体撤销均保留 currentLayout ID 与修订。

1440/1100/390 三宽无页面横向溢出，Tsanger 字体实际加载，reduced-motion 停稳，无 page error。UI Agent 逐张打开九张最终截图；主 Agent 另查看 material-desktop、candidate-style-mobile 与 render-base/render-styled 核对。证据在忽略目录 .impeccable/review/t16，详见 review-packet.md 与 browser-result.json。单次 Impeccable detect 仅继承的字号 advisory，无 critical；未启用 hooks。

集成后的 pnpm check 退出 0：原型构建、4 项原型行为、根/Web/Worker 类型检查与 44 项核心测试通过。pnpm test:db 退出 0：74 项真实 PostgreSQL 测试通过（含文件嵌套用例），已将风格服务测试纳入统一入口。pnpm validate:styles 指向可重复的有界浏览器验证脚本。没有新增服务启动。

## 最终视觉审查

新的独立通用子 Agent 承载 Impeccable Finish Reviewer，先逐张查看九张指定截图再读 builder packet，disposition: ship，material_fixes 为空。方法为通用子 Agent 使用角色契约，不冒称专用角色或 inline。Documenter 判定 No changes，未改全局 DESIGN 与 sidecar。主 Agent 汇总后通过 T16 四项验收；代码仍为本地未提交/未推送状态。
