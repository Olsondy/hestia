# D03 多楼层空间与示例别墅验证记录

工单：#31（总规格 #29）。分支 `feat/d03-multistorey`，2026-10-28 本地执行。

## 契约

- `packages/contracts/src/building.ts`：楼层 `levels`（`elevation` 完成面标高、`height` 层高、`slabThickness` 本层楼板厚），楼梯 `stairs`（`straight` 直跑 / `u` U 形，`rise`、`steps`、`fromLevelId`、`toLevelId`，U 形另有 `start`、`runWidth`、`landingDepth`），楼板开洞 `slabOpenings`（`stairwell` / `void` / `shaft`）。房间、墙、物品新增可选 `levelId`，房间新增可选 `name`。
- 所有楼层共用米制 x/z 平面坐标；墙、门窗与 `object.position.y` 按所属楼层完成面计高，世界 y = 楼层标高 + 本地 y。
- 单层兼容：不写 `levels` 即为一个位于标高 0 的隐含楼层，未写 `levelId` 的对象归最低楼层；`version` 仍为 1，已存数据不改写、不新增迁移。
- `checkBuilding()` 返回 `{ code, objectId, levelId?, message }`；`sceneSnapshotSchema` 与 `spatialStateSchema` 将其作为带 `params.code/objectId` 的自定义 Zod 问题拒收。错误码：`LEVEL_ORDER`、`LEVEL_STACK_MISMATCH`、`UNKNOWN_LEVEL`、`LEVELS_REQUIRED`、`SLAB_OPENING_ON_BASE_LEVEL`、`STAIR_DIRECTION`、`STAIR_RISE_MISMATCH`、`STAIR_RISER_RANGE`（0.10–0.21 m）、`STAIR_GEOMETRY`、`STAIR_START_OFF_FLOOR`、`STAIR_ARRIVAL_OFF_FLOOR`、`STAIR_HEADROOM_NOT_OPEN`（踏步上方 2.0 m 净空内的楼板必须被开洞覆盖）。

## 导入与示例别墅

- `packages/floorplan-import/src/building.ts`：`convertHouseSpecBuilding()` 支持 HouseSpec 整栋格式（`floors`、`slab`、`base`、`voids`、`stairU`/`stairRun`）。房间由墙中线围合的面识别（`rooms.ts`，40 mm 吸附、悬空墙段剪除），标签只命名，不生成几何；不闭合的标签报 `ROOM_NOT_CLOSED`。不支持的情形明确报错：起步高度非 0、转角踏步/平台拼接（`UNSUPPORTED_STAIR`）、下沉区（`UNSUPPORTED_SUNKEN_VOID`）、找不到到达楼层（`STAIR_ARRIVAL_LEVEL_MISSING`）。未给踏步数时按 170 mm 估算并警告 `ASSUMED_STAIR_STEPS`。
- `buildingCandidateToScene()` 生成只读预览场景；家具保留为预设氛围道具（电梯为固定物品），不参与布局。
- 示例：`packages/floorplan-import/fixtures/demo-villa.housespec.json`，改编自 house-plan-designer（MIT，提交 `3257e5a`）的 `reference/example-gen-villa.py`；顶层 `demo` 字段标注演示与来源，声明见 `THIRD_PARTY_NOTICES.md`。上游脚本经阅读确认只构造并写出 JSON，在临时目录以 `python3 -I` 运行生成，仓库未包含上游代码或模板。
- 导入结果：三层标高 0 / 3.45 / 6.60 m，房间标签 12 / 11 / 8 个全部落在闭合区域（面数 10 / 10 / 7，“餐厅+客厅”“楼梯+过厅”等同处一个开放空间），两部 U 形楼梯分别连接一→二层、二→三层，`checkBuilding` 无问题。

## 渲染

- `createSceneModel(snapshot, view)` 与 `SpatialScene.setView()` 支持 `building`、`level`（单层）、`section`（剖切：该层及以下）。上层楼板按房间轮廓减开洞挤出为实体，开洞是真实洞口；上层墙下补楼板边；楼梯按 `stairBlocks()` 生成踏步与平台（交互与后台共用）。
- `renderSnapshotToPng(snapshot, path, browser?, view?)`、`renderArtifact(..., view?)` 接收视图；默认整栋。

## 执行的命令与结果

| 命令 | 结果 |
| --- | --- |
| `pnpm db:migrate`（独立库 `hestia_d03`） | 通过，0001–0013 已应用 |
| `pnpm check` | 通过（exit 0）；`test:core` 82/82，含新增 `contracts/src/building.test.ts`、`floorplan-import/src/building.test.ts` 与 `scene-runtime` 新用例 |
| `pnpm test:db` | 124/125；唯一失败为 `budget.test.ts` “production admission binds endpoint, model…”，本机无真实模型配置，与基线相同 |
| `node --import tsx scripts/validation/multistorey.ts` | 通过；Playwright Chromium headless（SwiftShader）生成整栋、一/二/三层单层、二层剖切与单层旧样本图，交互适配器切换视图后网格数 410 → 167 → 410，无页面错误 |

- 单层不变：改动前记录 `courtyard`、`angled` 的网格包围盒+颜色摘要与后台出图 PNG；改动后摘要一致（已写入 `scene.test.ts`），两张 PNG 逐字节相同。
- 人工核对图片（不提交，位于 `.impeccable/review/d03/`）：整栋三层叠合对齐；一层可见 U 形楼梯；二层单层视图中客厅挑空与楼梯井为真实洞口；二层剖切可经楼梯井看到下层楼梯。

## 未验证与限制

- 交互查看组件随 H5 实现验收；本次未改 `apps/web`，未启动 Next.js。
- 氛围道具统一为方块，车棚、凉亭、树等体量偏重，仅作示意。
- 多楼层下的家具布局、碰撞（`geometry/placement`）与命令仍按单一平面处理，属规格外范围。
- 屋面、顶棚与楼梯扶手未建模；只支持完整开洞，不支持下沉区和转角踏步。
- 后台出图服务（`renders/service`）尚无按楼层出图的请求字段，目前只能整栋出图；单层/剖切图经渲染函数参数生成。
