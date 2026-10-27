# T15：受控目录与候选家具组合

2026-10-25：后端、目录、渲染与真实浏览器验证已通过，独立 Finish Review 为 ship，T15/#16 已关闭。此结论不表示完整 Agent 家居设计能力已验收。没有模型调用、厂商接入或真实住宅样本。T16 随后收紧同资产同尺寸仅换材质的换件入口，改走独立风格命令，见 T16-style.md。

## 资产与材质来源

目录由 `packages/catalog/src/catalog.ts` 提供；登录后 `GET /api/catalog` 返回 `CatalogView`。不接受任意 URL、模型文件、SKU 或客户端自定义材质。

| 资产 ID（version=1） | 原型 itemId | 默认宽 × 深 × 高（m） | 允许宽 / 深范围（m） |
| --- | --- | --- | --- |
| prototype-sofa | sofa | 2.2 × 0.95 × 1.11 | 1.9–2.6（0.1步进）/ 0.85–1.10（0.05步进） |
| prototype-coffee-table | coffee-table | 0.9 × 0.55 × 0.55 | 0.7–1.2（0.1步进）/ 0.45–0.75（0.05步进） |
| prototype-reading-chair | reading-chair | 0.72 × 0.8 × 1.09 | 0.62–0.82（0.05步进）/ 0.7–0.9（0.05步进） |
| prototype-study-desk | study-desk | 1.4 × 0.6 × 1.26 | 1.2–1.8（0.1步进）/ 0.5–0.8（0.05步进） |

每件高度固定在该版本默认值。默认宽深依据 `example/prototypes/projects/src/sample/model.js` 的标称模板，沙发与茶几从原型朝向转为 x 宽/z 深；高度为含靠背、台面陈设、灯具等可见部件的模板包络。所有值为 **synthetic-template**，不是厂商规格、采购产品或用户实物测量。允许范围是应用选型规则，原型未声称这些范围对应在售产品。

三组材质 `prototype-wood`、`prototype-cream`、`prototype-chinese` 均为 version=1，颜色直接对应原型 `soft-styles.js` 的 wood/cream/chinese。每个条目保留来源路径和 styleId。木纹、胡桃木纹和织物纹理从原型 `textures.js` 移植，均由程序生成，没有外部媒体资源。

`prototype-visual.ts` 移植对应家具的圆角主体、坐垫、靠背、扶手、支腿及桌面陈设等实际生成逻辑；不把旧单色长方体称为目录视觉。每个实例的材质独立，改变候选材质不会修改固定设施或另一个实例的共享材质。实际模型按包络归一化后适配经过目录校验的尺寸，碰撞包络与可见几何在同一 x/z/y 坐标中一致。无目录元数据的已有对象继续使用原 T03 代理模型，不伪称已完成实物识别。

## 公开契约与差异

`packages/contracts/src/catalog.ts` 定义目录类型，`scene.ts` 为对象增加可选 `name`、`catalog {assetId,assetVersion,materialId,materialVersion}` 和 `dimensionSource`。`dimensionSource` 缺失按 unknown 理解，不能自动提升为 measured。无数据库迁移，既有 JSONB 项目与候选可继续读取。

现有 `POST /api/projects/:id/candidates/:cid/commands` 仍使用 `{operationId, expectedCandidateRevision, command}`，扩展：

- `add-furniture {assetId,assetVersion,materialId,materialVersion,size:{width,height,depth},x,z,yaw}`：实例 ID 由服务生成并由响应返回；幂等重试保留相同实例。
- `replace-furniture {objectId,assetId,assetVersion,materialId,materialVersion,size}`：保留实例 ID 与原位置/朝向/高程，明确表达将其换成目录新件；不能静默改变旧实物尺寸。
- `remove-furniture {objectId}`：删除可替换且未锁定的候选家具。
- `move-furniture`：保持原有有限字段和米制/角度范围，不接受 size、asset、dimensionSource 或任意 JSON。

`CandidateView.objectChanges` 包含 `kind:added/removed/replaced/moved` 与完整 before/after SceneObject（新增前、删除后为 null），可展示资产、材质、尺寸与来源差异。旧 `differences` 保留 pose-only 兼容字段；组合差异必须使用 objectChanges。`changedObjectIds` 现覆盖所有增删换件，不仅移动。

## 实测、固定事实与锁

- 固定设施始终独立于候选家具；删除、替换和移动均拒绝。新增 ID 不由调用者指定，不能通过删除固定柜再伪造同 ID 绕过。
- 锁定家具不能移动、删除或替换。候选不提供解锁命令。
- `measured` 实物可按原尺寸移动；本期普通候选删除/替换均返回 `MEASURED_FURNITURE_PROTECTED`。独立实物处置确认入口不在本票内。
- 最终检查对基础 measured 对象再次核对身份、来源及尺寸，阻止缩小、改成 unknown、删除后换 ID 重加等绕过，即便某个草稿数据被错误写入也不能采用。
- unknown 来源仍可显式替换为目录新件，差异保留原完整对象及新目录来源；这不是宣称测到了旧实物。
- 每次采用重新校验目录 ID、版本、材质和尺寸范围/步进，以及完整最终布局。新增/替换引起的碰撞允许保留在草稿中，但检查未通过不能展示为可采用版本。

## 采用、撤销与兼容

沿用 T06 的检查—展示—真实会话用户选择—采用事务。`checkerVersion=furniture-layout-2-catalog` 使旧检查自动失效；任何组合修改也会使旧展示和用户选择失效。固定事实和当前方案在候选阶段不变。整批采用及整体撤销继续使用新 layoutId、递增项目修订和独立 adoption 历史；T05 命令联合与历史表未改。

新增/删除、更换资产或尺寸、移动都构成布局变化。同一资产同一尺寸仅换材质虽会显示差异，但不能作为本票的“新布局”通过 change-set 检查；独立风格修改能力留给对应范围，不把仅换色称为布局方案。

采用后的 scene 保存目录引用及具体尺寸，刷新、再次查看历史候选和整体撤销均可追踪版本。整体撤销恢复原家具内容，也保留原候选作为只读历史。后续项目修订发生后继续拒绝整体覆盖。

## 验证证据

```sh
node --import tsx --test packages/catalog/src/catalog.test.ts packages/scene-runtime/src/scene.test.ts
node --env-file=.env --import tsx --test packages/candidates/src/service.test.ts
node --env-file=.env --import tsx scripts/validation/candidates-api.ts
node --env-file=.env --import tsx --test packages/commands/src/service.test.ts
pnpm exec tsc --noEmit
pnpm exec tsc --noEmit -p apps/web/tsconfig.json
```

| 验证 | 当前结果 | 证据范围 |
| --- | --- | --- |
| 目录与场景纯测试 | 8/8 | 目录来源/版本/规格范围、模型真实部件、每项最小/最大尺寸下可见包络、材质隔离、实测反例，以及原场景渲染几何回归 |
| 真实 PostgreSQL 候选服务 | 19/19 | T06 14项回归 + T15 增删换件、完整差异、目录幂等/非法参数、实测/固定/锁、陈旧选择和纯换色边界 |
| 真实本地 HTTP | 12/12 | T06 7项回归 + 目录身份/来源、非法参数、组合预览、采用重开与整体撤销、实测/锁/固定保护 |
| T05 命令回归 | 10/10 | 单件移动、锁、撤销、多圈 yaw、原子性及身份边界 |
| TypeScript | 通过 | 根及 Next 工程 |

验证仅使用随机 `@example.test` 身份与合成项目；测量保护测试只给本次随机项目注入合成 measured fixture，不代表生产已有测量确认入口。finally 清理本次身份及其项目、资源、候选、检查、展示、选择与操作历史。未启动或重启 Next、数据库或 Worker，未消费任务队列。

## UI / 3D 验证（UI Agent 提供的实际运行证据）

UI Agent 执行 `node --env-file=.env --import tsx scripts/validation/catalog-ui.ts`，复用当前 Next / PostgreSQL，完整脚本退出 0：

- 新候选添加原型休闲椅于 (-0.2,4)，当前方案不变；检查返回边界/开口相关冲突，采用禁用。将该实例移至 (5,4) 后继续组合。
- 替换原沙发为 prototype-sofa v1 / prototype-cream v1，删除原茶几。objectChanges 的 added/replaced/removed 与 UI 展示的前后尺寸、位姿、资产和材质版本一致。
- 必要检查通过；未保存的目录选择使采用禁用，放弃未保存编辑后恢复。当前与候选实际 canvas 字节不同，当前权威方案仍未变化。
- 用户明确采用产生项目 revision=2，持久化对象与候选完全一致；刷新后整体撤销产生 revision=3，恢复原始场景对象。
- 独立合成保护 fixture 中，measured 沙发、locked 茶几及 fixed 固定柜均不能被选为删除/替换对象。空白、尺度缺失项目禁用目录组合变更。
- 1440×1000、1100×900、390×844 下无横向溢出或页面异常；真实 Tsanger 字体加载，reduced-motion 停稳。未把静态截图当常规动效验收。

九张当前截图已由 UI Agent 逐一打开，位于忽略目录 `.impeccable/review/t15/`：combination 三宽、catalog-form 三宽，以及 invalid-desktop、protected-mobile、empty-mobile。catalog-form 为对应视口下的控件区域截图，其余为整页截图；不伪称区域图是整页。详情与有界结果见 `review-packet.md` 和 `browser-result.json`。

单次 Impeccable detector 无 critical/error，仅紧凑字号 advisory；没有启用 hooks 或重复跑 detector。UI 测试 finally 精确清理本次身份、项目和记录，已删除解决后的临时 failure 截图。新的独立 finish review 与既有设计体系对照仍由主 Agent 汇总；以上浏览器证据不代替该审查结论。

## 最终验收

主 Agent 汇总实际数据库、HTTP、UI与目录渲染证据，T15四项验收通过。新鲜独立通用子 Agent 承载 Impeccable Finish Reviewer，逐一查看九张当前截图，disposition: ship，无material fixes；Documenter完成既有体系对照，无需修改 DESIGN.md。审查方法限制：Reviewer先读packet定位截图时同时读到builder摘要，未完全满足截图先于摘要的顺序，已明确记录。主Agent另查看桌面组合和手机参数表单，未见裁切或虚构资产；此结论不扩展为模型设计验收。代码尚未提交或推送。
