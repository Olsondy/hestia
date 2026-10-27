# 迁移与字体复核 · 2026-10-25

当前维护说明：用户随后亲自将本原型移至 `example/prototypes/projects`，实际入口为该目录的 `index.html`，源码为 `src/`；当前命令为根目录 `pnpm check` / `pnpm preview`，HTTP 旧 `/example/prototypes/` 入口仍兼容。生产只采用家居杂志（editorial）。以下是迁移当时两套原型的实际检验记录，旧命令、旧路径和双主题证据保留，不改写为本次新 UI 验收。

本次结论：原型迁移与仓耳渔阳体替换通过；未扩大为平台功能验收。

- `npm run check`：两个离线入口构建成功，原有数据测试 4/4 通过。`example/prototypes/index.html` 与 `dist/index.html` 字节一致，分别约 6.00 MB。
- Chromium 1208 / Playwright 1.58.2：1440×1000 桌面与 390×844 手机，两套项目首页均无横向溢出；查看了桌面杂志工作台和手机展馆工作台，画布、导航及输入区保持现有排布。
- 杂志方案切换更新项目与标题；整层/客厅/俯视、昼夜切换、继续设计路由、手机项目索引搜索正常。浏览器未记录页面脚本错误。
- 直接以 `file://` 打开新入口可显示 Three.js 空间，没有 HTTP 资源请求。五档字体均加载成功，CDP `CSS.getPlatformFontsForNode` 确认标题实际使用自定义 `TsangerYuYangT-W03`。
- 五档 WOFF2 的 cmap 与对应原始 TTF 完全一致，每档保留 7049 个字符映射。完整字库避免仅按当前文案裁剪造成自定义名称字体混用；超出原字体字符覆盖时仍按 CSS 系统字体回退。
- `prefers-reduced-motion: reduce` 下切换方案后，无活动 Web Animation，方案按钮 transition 为 0s。
- Impeccable 4.7 context / typeset / craft-floor 指引已应用，最终机械检测有 105 项 advisory：20 个既有颜色、78 个既有字号、7 个既有圆角与侧车规范未完全对应。已比对原 CSS：本次仅更改三处字体声明，未新增这些差异，也未改动间距、布局或动效。

当前截图和机械检测 JSON 保留在忽略目录 `.impeccable/review/prototype-migration/` 供本次复核，不提交调试截图；历史原型验收记录仍在 `docs/prototype-review.md`。
