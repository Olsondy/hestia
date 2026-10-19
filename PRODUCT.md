# My IdealHome

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

2026-10-19 用户授权重新实现可操作的多页面前端原型，并明确选择演示助手，不接真实模型。原型数据保存在本机浏览器；多用户服务、自动识图、真实模型调用尚未实现，不声称可用。

保留既有示例模型与已确认固定对象。新建项目可以使用明确标注的演示户型或上传底图，不把演示模型称为上传文件的识别结果。家具方案必须有摆放差异，不能只换颜色。无预算模块。技能不启用 hooks。

## Stack

当前原型已有 Three.js 与 esbuild，可在独立 prototype 入口复用；正式平台规划为 Next.js / React / TypeScript，见 docs/web-stack.md。本轮先交付可本地打开的交互原型，不把账号与云端数据功能伪装成已实现。

## Brand Commitments

使用中性项目名称和简体中文。用户要求参考 Awwwards、Webby Awards、FWA 的完成度，检查排版、留白、层级、色彩、动效、微交互和原创性；不宣称获奖。

## Evidence on Hand

src/model.js 为现有程序生成的示例模型，src/layouts.js 含三种不同家具布局；现有截图为旧展示页证据。此前的 V1 规划描述未来能力，不作为已发布特性。

## Product Principles

- 未确定尺寸与演示数据明确标注。
- 用户能理解变化、确认或撤销变化。
- 固定设施与可变家具分离。
- 展示页面以空间为主，编辑页面以任务为主。
