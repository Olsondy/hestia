# V01 3D 画面质量提升验证记录

工单：#41（总规格 #29）。分支 `feat/v01-render-quality`，2026-11-02 本地执行；已合入含 D04 石材铺贴的 main（`59d0c96`），最终出图使用带示例铺贴设计的示例别墅（`packages/finishes/src/demo-villa-scene.ts`）。

## 改动

全部在 `packages/scene-runtime/src`，交互查看与后台出图共用 `SpatialScene` / `createSceneModel`，同一方案两者只差画质档。

| 模块 | 内容 |
| --- | --- |
| `stage.ts`（`RenderStage`） | 中性色调映射（Khronos PBR Neutral）与曝光；`RoomEnvironment` 程序生成的 PMREM 环境贴图挂在 `scene.environment`；室内视角自动换成在观察者位置捕获的真实场景反射探针（移动约 2.5 m 或场景、灯光变化后重拍）；有方向的日光（PCF 柔和阴影，阴影图仅在场景变化时重绘）、天空/反弹补光；阴影承接地面（不改页面底色）；夜景与室内灯（就近点亮固定数量点光源，灯具发光材质随开关）；按档位启用 GTAO 环境光遮蔽、夜景泛光。后处理下的背景色按色调映射反算，页面底色保持不变 |
| `quality.ts` | 画质分档 `low / medium / high / ultra`：像素比上限、阴影图尺寸与柔和半径、GTAO、多重采样、泛光、夜景实光数量。手机（粗指针或小屏）默认 `medium`，桌面 `high`，后台出图固定 `ultra`（2 倍超采样） |
| `props.ts` | 氛围道具参数化建模：沙发（含 L 形、影音沙发）、单椅、餐椅、办公椅、床、床头柜、床尾凳、餐桌/书桌/茶几/茶台、柜体（门板、抽屉、拉手、踢脚）与开放书架/展示柜/酒柜、厨房、冰箱、洗衣机、卫浴、绿植、树、吊灯、草坪灯、窗帘、钢琴、台球桌、幕布音箱、车辆、凉亭车棚、泳池、遮阳伞等。尺寸严格落在对象的目录尺寸包络内；同材质合并以降低绘制调用。未命名对象仍为原体块 |
| `architecture.ts` | 踢脚线；门洞套与门头线；窗与宽幅落地洞口的金属窗框、分格、玻璃、窗台板；按房间生成顶棚（扣除上层楼板开洞，只从下方可见，室外/挑空不生成）和筒灯；楼梯玻璃栏板、端柱与木扶手。均标记 `userData.detail`，不参与点选，不改变结构几何 |
| `cameras.ts` | 预设镜头：整栋鸟瞰、各楼层剖切鸟瞰；每层主要房间与楼梯的人视角（站在凸角、对准家具/楼梯，按水平视场适配手机竖屏与横版出图） |
| `scene.ts` / `render.ts` | `SpatialScene` 新增 `setLighting`、`getLighting`、`setQuality`、`getQuality`、`cameraPresets`、`applyCameraPreset`、`setBackdrop`、`render`；`renderSnapshotToPng(..., view?, { quality, lighting, preset })`，默认 `ultra`、白天 |

`apps/web/components/scene-viewport.tsx` 改用 `setBackdrop`（原先直接改 `scene.background`，在后处理下会被色调映射改色）。

## 与 D04 的集成约定

- 环境与光照：材质不要自己设 `envMap`，留空即自动使用 `scene.environment`（鸟瞰为工作室环境，室内为反射探针）；强弱用 `envMapIntensity` 微调。用 `roughness`/`clearcoat` 区分抛光与哑光。网格需 `receiveShadow`（地面饰面不必 `castShadow`）。
- 入口：`createFinishMeshes(snapshot, levelIds)` 仍在 `createSceneModel` 中、`addArchitecturalDetail` 之前调用，二者互不依赖；踢脚线在墙面外 12 mm，墙面饰面若加厚超过 12 mm 需告知以外移踢脚线。
- 几何或材质在加载后变化时调用 `SpatialScene.render()`；移动物品走 `updateObject`（会刷新阴影与探针）。

## 执行的命令与结果

| 命令 | 结果 |
| --- | --- |
| `node --import tsx scripts/validation/render-quality.ts before`（改动前代码） | 8 张对比基准图，`.impeccable/review/v01/before/` |
| `node --import tsx scripts/validation/render-quality.ts after --background` | 11 个固定镜头 + 9 个生成的预设镜头；后台出图路径（SwiftShader、ultra）单张约 50 秒 |
| `... after --only=stone-living-floor,stone-tv-wall --gpu` | 两张石材近景重拍（原镜头位置落在物体内部、画面全黑，改到客厅内重拍），各约 9.5 秒 |
| `... fps --only=none --fps --chrome` | 手机视口 390×844、`medium` 档、本机 GPU Chrome（AMD Radeon Pro 455）：鸟瞰 39.7 fps（最差帧 43 ms），室内 56.5 fps（最差帧 68 ms），1383 次绘制调用 |
| `pnpm check`、`pnpm test:db` | 合并 main 后执行，结果见下 |

图片均在 `.impeccable/review/v01/after/`（不提交），已逐张查看：

- 鸟瞰：中性色调映射后不再过曝，墙体、窗框、庭院道具与泳池层次清楚；夜景整栋灯光与室内暖光可用。
- 室内人视角（客厅、楼梯、二层卧室、餐厅、过厅）：顶棚、筒灯、踢脚线、门套、窗框与玻璃、楼梯玻璃栏板与扶手齐全；家具从方块变为有造型的沙发、餐桌椅、床、柜体、绿植。
- 石材：抛光白色大理石地面有纹路与环境反射，深色波打线可辨；电视背景墙灰色木纹石工字铺缝线清楚；餐厅人字铺、过厅斜铺方向正确；楼梯踏面为白色大理石。

## 限制

- 帧率在笔记本 GPU 的手机视口上测得，未在真实手机上测量；中端手机可能低于该值，`medium` 档之外还可降为 `low`。
- 后台出图单张约 50 秒（软件渲染），批量出图需要排队；有 GPU 的部署环境会更快。
- 道具为参数化低模，不是商品模型；未命名对象仍为体块。
- 后台出图默认视角仍为整栋鸟瞰；客户方案效果图使用哪个预设镜头在 H5 接入时决定。
