# T03 通用户型与后台渲染验证

日期：2026-10-25（Asia/Singapore）。范围：合成输入与渲染适配，不含真实识图、工程校验或最终家具视觉品质。

## 结论

选择可独立导入的 Three.js 场景适配器：`packages/scene-runtime/src/scene.ts`，输入契约见 `snapshot.ts`。浏览器与后台 `renderSnapshotToPng` 共用场景模块，调用方只传经过校验的数据。未把旧原型的固定坐标偏移或外部 HTML 调试全局接口带入正式契约。

复用了现有原型的 Three.js、OrbitControls、墙体按洞口分段的生成方式；旧原型本身仍作为视觉参考保留在 `example/prototypes`。外部 house-plan-designer 的 `assets/template.html` 为大体积内嵌构建，暴露 `window.__designer`、`window.__smart`、`window.__THREE__` 等调试入口；源码检查未找到适合直接作为本项目长期加载/选择/增量更新契约的独立模块。故本轮选择自有场景适配器，不宣称外部模板运行失败，也不将其作为后续前置依赖。此选择符合已确认 ADR-0003 的优先复用 Three.js 路径。

## 合成样本与结果

| 样本 | 覆盖 | 结果 |
| --- | --- | --- |
| A：6m × 5m 方形空间 | 窗洞、落地门洞、固定柜、沙发和茶几体积 | 点选回传 `sofa-a`；向右更新 0.2m；节点原位更新；相机保持；独立出图成功 |
| B：负坐标凹形空间 | L 形凹口、斜墙、沿墙偏移的门洞、旋转物体 | 点选回传 `desk-b`；向右更新 0.2m；比较加载保留相机；独立出图成功 |

坐标为米、领域平面 x/z、高程 y，原点不隐含平移，yaw 为 Three.js 右手弧度。家具位置定义为占地中心、y 为基底高程；墙的 a/b 为墙中线端点，洞口 offset 从 a 沿墙朝 b 方向计算。房间轮廓、墙和家具按输入生成。所有 ID 在同一快照中唯一。`synthetic` 必须随输入明确提供；此契约不是固定事实或尺度确认的业务授权。

## 已执行检查

- `pnpm exec tsx --test packages/scene-runtime/src/scene.test.ts`：4 项通过，包括负坐标/斜墙端点、实体洞口射线检查、凹形地板不填平、重复 ID/重叠洞口/非法数值拒绝。
- `pnpm exec tsx scripts/validation/scene.ts`：Chromium 145.0.7632.6 下两套空间均通过真实画布点击、增量修改、对象 ID 往返、比较镜头保持和浏览器错误检查。
- 测试先关闭交互页面，再由独立渲染函数创建新 headless 页面并输出 PNG；无用户浏览器或原页面状态依赖。
- 人工查看两套当前 PNG：窗/门洞可见，凹形缺口与斜墙一致，家具体积完整，无黑屏或裁切。验证产物由脚本写入被忽略的 `.tmp/validation/t03`，不提交调试截图。
- `pnpm exec tsc --noEmit` 通过。

运行依赖：Node 22.20.0、Three.js 0.186.x、esbuild、Playwright 1.58.2 及其 Chromium。未添加关闭 sandbox 的启动参数；其他目标运行环境仍需复验 WebGL。

## 后续边界

当前家具使用明确的尺寸体积表达，目的为验证输入到场景的可靠映射，不作为最终家具资产品质验收。后续 UI 必须继承原型的布局、间距、仓耳渔阳字体与动画；生产资产生成器可替换体积表达而不改变输入坐标和 ID 契约。渲染器不承担修改授权、固定事实保护、空间尺度确认及几何可行性判断，这些由领域执行器落实。

`sceneInspection` 只在 `sceneDocument(snapshot, true)` 的本地验证产物中注入；正常后台输出不包含该入口。正式模块通过类方法和选择回调访问，不依赖调试全局变量。
