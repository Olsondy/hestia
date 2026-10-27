# 参与开发

2026-10-25 最新确认：用户亲自将原型移入 `example/prototypes/projects`，保留该目录；生产 UI 只采用家居杂志（editorial），建筑展馆仅保留为原型历史。后文两方向的历史描述不构成生产双主题要求。

先阅读 [AGENTS.md](AGENTS.md)、[已确认技术栈](docs/web-stack.md)、[工单与依赖](docs/planning/v1-issue-drafts/README.md) 和 [设计系统](DESIGN.md)。按真实依赖推进，验收通过后再关闭工单，不把合成验证视为真实模型或图纸验收。

1. 使用 Node.js 22+ 与 `package.json` 指定的 pnpm，执行 `pnpm install --frozen-lockfile`；维护根目录 `pnpm-lock.yaml`。
2. 原型修改 `example/prototypes/projects/src/`，生产应用修改 `apps/web` 及对应共享包；不要手改 `example/prototypes/projects/index.html` 或 `dist/index.html`。
3. 按改动运行 `pnpm check`、`pnpm typecheck`、`pnpm test:core` 或真实数据库验证，以及必要浏览器复核，见 [开发与验证](docs/development.md)。
4. 提交相关源码、锁文件、迁移与验证记录。原型改动同步提交两个构建产物；不要提交私密样本、环境文件、依赖或调试截图。

所有 UI 参照可访问原型的间距、字体层级、布局和动效，使用 Impeccable，不启用 hooks。中文使用仓耳渔阳体，保留字体来源和授权声明。

变更说明交代用户可见行为、固定设施影响、已执行验证和未完成项。新增家具或数据来源时记录许可；示例尺寸始终是示意。T03 已验收，T01/T02 真实验证仍待开展，T04 已通过本地验收；首版完整流程尚未完成。本地 PostgreSQL Compose 不代表已确定或完成生产部署。
