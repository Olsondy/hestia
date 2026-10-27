# Hestia

2026-10-25 最新确认：用户亲自将原型移入 `example/prototypes/projects`，保留该目录；生产 UI 只采用家居杂志（editorial），建筑展馆仅保留为原型历史。后文两方向的历史描述不构成生产双主题要求。

Hestia 取名自古希腊神话中的炉火女神赫斯提亚，造屋之始祖：家从炉火开始，产品帮用户把自己的家一步步造出来。

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

有平面图或手绘图、希望逐步校正住宅并比较装修摆法的人。主要在桌面浏览器操作，先看可交互原型再决定平台实现。

## Product Purpose

将图纸、可校正的空间数据、家具布局与自然语言修改串成一个过程。让用户理解、编辑和展示自己的空间。

## Operating Context

项目管理 → 导入图纸 → 二维校准与编辑 → 三维检查 → AI 对话调整 → 独立三维展示。工作台与展示页是两个不同界面。

## Capabilities and Constraints

首期注册与免费体验范围已确认：游客只浏览和操作公开示例；用户注册并登录后，一次性领取免费积分，用自己的户型创建个人项目和进行 AI 设计。不建立匿名账号、不发匿名积分，也不做账号合并或游客项目转移。积分规则见 `docs/decisions/0006-open-registration-free-credits.md`；当前 1／5／20 分及赠送 40 分为试用占位配置，后续按供应商真实消耗调整。首期不提供付费功能；上述新范围仍待实现与验收。

2026-10-19 用户授权重新实现可操作的多页面前端原型，并明确选择演示助手，不接真实模型。原型数据保存在本机浏览器。后续 T04 已完成邀请身份、隔离项目与 3D 重开的本地验收；自动识图、真实模型及首版完整流程仍未完成，不声称可用。

保留既有示例模型与已确认固定对象。新建项目可以使用明确标注的演示户型或上传底图，不把演示模型称为上传文件的识别结果。家具方案必须有摆放差异，不能只换颜色。无预算模块。技能不启用 hooks。

## Stack

当前原型使用 Three.js 与 esbuild；正式平台采用 Next.js / React / TypeScript，见 docs/web-stack.md。T04 的身份与 PostgreSQL 项目持久化已通过本地验收；生产部署和完整 Agent 流程尚未验收，不把原型或本地环境冒充已上线服务。

原型保留在 `example/prototypes/projects/`，源码位于其 `src/`，可直接打开生成的 `index.html`。新功能 UI 仅继承家居杂志（editorial）原型的间距、字号、布局与动效；建筑展馆保留为历史原型；中文统一使用用户指定的仓耳渔阳体，资源见 `assets/fonts/tsanger-yuyang/`。

## Brand Commitments

使用中性项目名称和简体中文。用户要求参考 Awwwards、Webby Awards、FWA 的完成度，检查排版、留白、层级、色彩、动效、微交互和原创性；不宣称获奖。

## Evidence on Hand

example/prototypes/projects/src/sample/model.js 为程序生成的示例模型，example/prototypes/projects/src/sample/layouts.js 含三种不同家具布局。V1 规划描述未来能力，不作为已发布特性。

## Product Principles

- 未确定尺寸与演示数据明确标注。
- 用户能理解变化、确认或撤销变化。
- 固定设施与可变家具分离。
- 展示页面以空间为主，编辑页面以任务为主。
