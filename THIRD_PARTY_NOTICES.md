# 第三方声明

## Impeccable（项目级设计技能）

- 项目：https://github.com/pbakaus/impeccable
- 技能版本：4.6.0；来源提交：`2f46b7a8b059af00d20dd13b64dbe165e7c6a742`。
- 安装位置：`.agents/skills/impeccable/`，从官方仓库的同名 Codex 技能目录安装。
- 许可：Apache-2.0；完整条款和上游声明见该目录的 `LICENSE`、`NOTICE.md`。
- 用途：UI 设计规范和辅助命令；仅项目级安装，未安装或启用 hooks，未加入应用运行时依赖。

## Three.js

- 项目：https://github.com/mrdoob/three.js
- 许可：MIT，版权信息以安装包 `LICENSE` 为准。
- 用途：3D 渲染、相机控制、几何、材质与环境光。
- `scripts/build.mjs` 将安装包完整许可证嵌入 `dist/index.html`。

## esbuild

- 项目：https://github.com/evanw/esbuild
- 许可：MIT；Copyright (c) 2020 Evan Wallace。
- 用途：开发时将 JavaScript 打包，不作为在线服务使用。

## Noto Sans SC / Noto Serif SC

- 来源：Google Fonts 官方分发；字体与来源记录在 `src/fonts/`。
- 许可：SIL Open Font License 1.1，两份完整许可分别为 `gallery-OFL.txt`、`editorial-OFL.txt`。
- 用途：建筑展馆版无衬线标题、家居杂志版中文衬线标题。按当前原型文案请求官方字符子集；用户输入中不在子集内的字使用系统回退字体。
- `npm run fonts`（`scripts/source-fonts.mjs`）可主动更新字体子集；普通构建无需网络，字体与许可均内嵌原型 HTML。

模型和纹理由项目代码生成，当前没有外部商业家具资产库。工作台标题字体随仓库提供。
