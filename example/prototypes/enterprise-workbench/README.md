# 企业工作台交互原型（P02）

供产品负责人审阅企业成员界面的电脑端可点击原型：纯前端、演示数据、不接服务端，只用于审阅。对应工单 #45（总规格 #42，ADR-0007、ADR-0008、ADR-0011）。视觉为柔和中性 **B 悬浮**，浅色与深色两套主题（默认跟随系统，页头可切换）。

## 打开

- 直接用浏览器打开 `index.html`（离线单文件，内嵌脚本、样式、Three.js 与仓耳渔阳体）。建议窗口宽度 1440，兼顾 1280 与 1024。
- 源码在 `src/`，不要直接改生成的 `index.html`；从仓库根运行 `node scripts/build-enterprise-workbench.mjs` 重新生成。
- 页头的虚线「审阅」可直接跳到任一页面和状态（跳转会重置演示数据），不属于产品界面。
- 演示登录：`consultant@demo-home.example` / `demo-password`。状态存于 localStorage（键 `hestia.enterprise-workbench.v2`）。

规则、token 与组件对照见 [docs/design/WEB_UI_DESIGN.md](../../../docs/design/WEB_UI_DESIGN.md)；通用准则见 [docs/design/ENGINEERING_RULES.md](../../../docs/design/ENGINEERING_RULES.md)。
