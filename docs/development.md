# 开发与验证

2026-10-25 最新确认：用户亲自将原型移入 `example/prototypes/projects`，保留该目录；生产 UI 只采用家居杂志（editorial），建筑展馆仅保留为原型历史。后文两方向的历史描述不构成生产双主题要求。

## 安装与入口

使用 Node.js 22+、`package.json` 指定的 pnpm 版本，根目录执行 `pnpm install --frozen-lockfile`。`pnpm-workspace.yaml` 组织应用与共享包，`pnpm-lock.yaml` 是依赖锁文件；不要用 npm 安装生成第二套锁文件。

| 命令 | 作用 |
| --- | --- |
| `pnpm build` | 从 `example/prototypes/projects/src/` 生成 `example/prototypes/projects/index.html` 和 `dist/index.html` |
| `pnpm test` | 原型数据行为测试 |
| `pnpm check` | 原型构建、数据测试、TypeScript 和核心行为检查 |
| `pnpm preview` | 在 `127.0.0.1:4173` 预览原型，入口 `/example/prototypes/projects/`；兼容 `/example/prototypes/`、`/example/prototypes/index.html` 与 `/dist/index.html` |
| `pnpm fonts` | 从仓库本地 TTF 重建完整 WOFF2；需要 Python fontTools/Brotli，普通构建不需要 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm test:core` | 共享模块与验证模块的行为检查 |
| `pnpm dev` | 启动 `apps/web` Next.js 开发入口，端口 3000 |
| `pnpm build:web` / `pnpm start:web` | 构建 / 启动 Web 应用 |
| `pnpm setup:local` | 创建本地 `.env`；已有配置保留，不配置模型密钥 |
| `pnpm db:up` | 启动本地 PostgreSQL 17.7 Compose 服务 |
| `pnpm db:migrate` | 对配置的本地数据库运行迁移 |
| `pnpm invite <email> [hours]` | 创建指定邮箱邀请，默认 24 小时、最长 720 小时；仅显示链接，不自动发邮件 |
| `pnpm test:db` | 使用真实本地数据库验证持久化与隔离 |

先安装依赖，再运行 `pnpm setup:local`、`pnpm db:up`、`pnpm db:migrate`，最后启动 Web。Docker 服务须可用；本地 Compose 只用于联调，不代表部署厂商或生产拓扑已确定。环境文件、数据库内容和私有文件不提交。数据库仅绑定 `127.0.0.1:54329`；邀请由管理员通过现有渠道交给指定收件人，不把生成链接视为邮件服务已接通。

## 当前完成度

- T03 已通过两套合成场景的交互、稳定 ID、增量更新、镜头保持及关闭页面后的独立出图；见 [报告](validation/T03-rendering.md)。
- T01 真实 API 合成小样准入通过：独立图像/空图、精确单位、歧义、截断和11项协议反例。T02 的15项转换测试通过，但三次真实 API 合成识图未通过几何门槛；真实住宅图纸未验证。见 [T01](validation/T01-model-protocol.md)、[T02](validation/T02-floorplan-import.md)。
- T04/T05/T06/T07/T09/T15/T16/T20 已通过本地验收，覆盖项目身份、单件编辑、候选采用、确定性后台任务、图纸底图、受控家具、独立风格与静态成果；T07 包含明确授权的隔离 Worker 关页执行与真实进程恢复。证据见 `validation/`；模型 API 已配置并经 T01 小样验证，首版尚未完成，代码尚未提交或推送。T20 包含授权的隔离 Render Worker 关页出图验收；T08 统一对话与真实局部修改已验收，T10 需求整理与回答恢复已验收，T17/T21 已验收，T19 已验收，其余未完成工单按用户要求暂停，T02 识图相关依赖仍保留，工单状态看 [工单映射](planning/v1-published-issues.json)。

## 检查边界

`scripts/check.mjs` 验证原型的编辑原子性、固定物品保护、存储恢复、撤销重做及演示指令，不运行 WebGL、不做工程碰撞或通行判断。共享模块测试与 `test:db` 分开；真实存储不能用替身结果代替。CI 是否通过以实际执行记录为准，测试通过不等于视觉验收通过。

视觉或交互改变时，检查桌面 1440、窄桌面 1100、小屏 390 下的相关流程。生产 UI 仅参照家居杂志（editorial）原型的间距、布局、字体和动画，使用用户指定 Impeccable，不启用 hooks。当前原型记录见 [迁移与字体验证](../example/prototypes/projects/verification.md)。

## 原型数据与字体

原型源代码位于 `example/prototypes/projects/src/`。构建内嵌 Three.js、CSS、仓耳渔阳体 W01–W05 完整字体与许可，运行时无需字体 CDN，也不请求模型。字体源与生成资源位于 `assets/fonts/tsanger-yuyang`，`pnpm fonts` 从本地源重建，不按当前文案裁剪字符覆盖。新 Web 页面使用同一字体资源。

原型使用 localStorage 键 `hestia.studio.v1`，不同浏览器和 origin 数据独立。图片限 8 MiB，最长边缩至 1600px 后存储；空间不足会提示保存失败。JSON 仅能导出。内置示例来自 `example/prototypes/projects/src/sample/`，不是用户图纸识别结果。原型数据不会自动上传为服务端项目；新流程需独立处理版本、归属与输入校验。

不要手改生成 HTML。原型改动提交源码及两个同步构建产物；生产改动提交相关源、迁移、锁文件与必要验证记录，不提交私密图纸、密钥、依赖目录和调试截图。
