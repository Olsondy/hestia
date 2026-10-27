# Hestia

2026-10-25 最新确认：用户亲自将原型移入 `example/prototypes/projects`，保留该目录；生产 UI 只采用家居杂志（editorial），建筑展馆仅保留为原型历史。后文两方向的历史描述不构成生产双主题要求。

Hestia 取名自古希腊神话中的炉火女神赫斯提亚，造屋之始祖。目标是让用户从单层图纸与居住需求出发，由 Agent 完成空间设计、迭代以及 3D 和静态图展示。

**当前已恢复开发，首版尚未完成。** 双视觉原型已迁入 `example/prototypes/projects` 并保持可访问；T03/T04/T05/T06/T07/T09/T15/T16/T20 已通过本地验收，涵盖场景、项目、单件编辑、候选采用、确定性后台任务、图纸底图、受控家具、独立视觉风格与静态成果。T07 的隔离 Worker 真实崩溃恢复已验证，不代表真实模型设计完成。T01 已通过真实 API 与独立合成图片的小样准入；T02 真实 API 合成识图评估未达到几何门槛，真实住宅样本仍未验证。T08 统一空间对话与准确局部修改已验收，T10 需求与问题持久化已验收，T17/T21 已验收，T19 已验收；其余未完成工单按用户要求暂停；T20 的隔离 Render Worker 关页出图已验证。代码尚未提交或推送，证据见 `docs/validation/`。

## 体验原型

建筑展馆采用深蓝侧栏、冷白编辑区和模型目录；家居杂志采用横向导航、暖纸背景与精选项目排版。两者共用本地项目数据，中文使用仓耳渔阳体（Tsanger YuYang）。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm preview
```

打开 [本地原型](http://127.0.0.1:4173/example/prototypes/projects/)，从任一方向进入项目，再点击「展示预览」进入独立浏览页。可直接打开 [原型构建产物](example/prototypes/projects/index.html)；[dist 兼容入口](dist/index.html) 保留相同产物。建议使用本地服务；`file:` 与 `http:` 的浏览器存储不互通。

- 可新建、搜索、重命名、复制项目，导入 PNG / JPG / WebP 图片并手动校准、描墙；原型的 PDF 输入须先转图片。
- 可拖动家具或修改位置和朝向，支持锁定、撤销重做、本地保存与 JSON 导出，尚无 JSON 导入入口。
- 演示助手执行有限指令，明确标注演示，不调用模型或收集密钥；图片不会自动识别为墙体。
- 独立展示支持材质 / 白模 / 线框、昼夜、隐藏家具与截图；示例还支持房间浏览和室内灯光。

原型用于体验流程与比较视觉，不提供工程级碰撞、通行或结构判断。新项目不会套用示例户型冒充识别结果。

## 开发入口

使用 Node.js 22+ 与 `package.json` 指定的 pnpm；依赖以 `pnpm-lock.yaml` 为准。`pnpm dev` 启动 `apps/web` 的 Next.js 开发入口（127.0.0.1:3000），与 4173 端口原型独立。本地数据库、邀请及验证命令见 [开发与验证](docs/development.md)。PostgreSQL 17.7 Compose 用于本地联调，不代表生产部署已确定。

```text
example/prototypes/projects/src/   原型页面、场景、存储、布局与动画
example/prototypes/projects/      原型构建产物及验证记录
apps/web/                正在实施的 Next.js 应用
packages/                场景、验证模块及项目/身份/持久化共享模块
assets/fonts/tsanger-yuyang/  原始字体、完整 WOFF2 与授权声明
scripts/                 构建、本地环境、迁移与验证入口
dist/index.html          原型兼容构建产物
docs/                    产品范围、架构、工单、验收与决策
```

所有新 UI 延续原型的间距、字体层级、布局和动效，使用 Impeccable，不启用 hooks。

## 文档

- [已确认技术栈](docs/web-stack.md) · [实施计划](docs/v1-development-plan.md) · [已发布工单与依赖](docs/planning/v1-issue-drafts/README.md) · [历史范围基线](docs/v1-scope.md)
- [T01 协议验证](docs/validation/T01-model-protocol.md) · [T02 合成图转换](docs/validation/T02-floorplan-import.md) · [T03 渲染验收](docs/validation/T03-rendering.md)
- [产品上下文](PRODUCT.md) · [设计系统](DESIGN.md) · [原型契约](docs/prototype-brief.md) · [原型验证](example/prototypes/projects/verification.md)
- [领域语言](CONTEXT.md) · [决策记录](docs/decisions/) · [工具边界](docs/agent/tool-contract.md) · [后台运行设计](docs/agent/runtime-design.md)
- [开发与验证](docs/development.md) · [参与开发](CONTRIBUTING.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

## 许可

项目尚未选择开源许可证，`package.json` 标为 `UNLICENSED`。第三方代码和仓耳渔阳字体依各自声明使用，保留 [字体授权与来源](assets/fonts/tsanger-yuyang/NOTICE.txt)，不因提交 GitHub 自动授予项目开源许可。
