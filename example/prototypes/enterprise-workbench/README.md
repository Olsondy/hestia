# 企业工作台交互原型（P02）

供产品负责人审阅企业成员界面的电脑端可点击原型：纯前端、演示数据、不接服务端，只用于审阅。对应工单 #45（总规格 #42，ADR-0007、ADR-0008、ADR-0011）。视觉为柔和中性 **B 悬浮**，浅色与深色两套主题（默认跟随系统，页头可切换）。

## 打开

- 直接用浏览器打开 `index.html`（离线单文件，内嵌脚本、样式、Three.js 与仓耳渔阳体）。建议窗口宽度 1440，兼顾 1280 与 1024。
- 源码在 `src/`，不要直接改生成的 `index.html`；从仓库根运行 `node scripts/build-enterprise-workbench.mjs` 重新生成。
- 页头的虚线「审阅」可直接跳到任一页面和状态（跳转会重置演示数据），不属于产品界面。
- 演示登录：`consultant@demo-home.example` / `demo-password`。状态存于 localStorage（键 `hestia.enterprise-workbench.v2`）。

规则、token 与组件对照见 [docs/design/WEB_UI_DESIGN.md](../../../docs/design/WEB_UI_DESIGN.md)；通用准则见 [docs/design/ENGINEERING_RULES.md](../../../docs/design/ENGINEERING_RULES.md)。

2026-11-12 按 ADR-0018 补充（AM-P，待审阅）：页头齿轮进入「企业设置 · 模型 / 用量」（仅企业管理员）；Agent 助手输入框上方选择模型，含额度用完、所选模型被停用、企业未开通等状态。审阅导航的「选择模型」「企业设置」两组可直达。平台管理后台见 `../admin-console/`。

2026-11-13 补充：企业设置加「访问记录」和额度「不限」；我方超级管理员只读进入的「平台支持」模式（页头标“平台支持 · 只读”，写操作一律拦截），在审阅导航「平台支持」组，或从后台企业页「进入工作台（只读）」打开（带 `?as=support`）。
