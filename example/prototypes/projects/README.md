# Hestia 交互原型

`src/` 保存原型源码；`index.html` 是构建后的离线入口，内嵌 Three.js、样式和仓耳渔阳体。不要直接修改生成 HTML。

从仓库根运行 `pnpm check` 构建并验证，生成此目录的 `index.html` 与兼容入口 `dist/index.html`。双击 `index.html` 即可打开；也可运行 `pnpm preview`，访问 `http://127.0.0.1:4173/example/prototypes/projects/`。

- 建筑展馆：`index.html?theme=gallery#projects`
- 家居杂志：`index.html?theme=editorial#projects`
- 对比入口：`index.html`

家居杂志（editorial）是唯一产品 UI 基线；建筑展馆仅保留为历史原型，保持既有间距、字号、布局与动效，标题和操作文字统一使用仓耳渔阳体。共享字体及许可证在 `assets/fonts/tsanger-yuyang/`。

原型仍使用本地演示助手，项目存于浏览器 localStorage；图片不会上传。它与后续 `apps/` 平台实现独立，不能将示例户型、演示对话视为真实识图或模型服务。
