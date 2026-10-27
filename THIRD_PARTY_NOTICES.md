# 第三方声明

## Impeccable（项目级设计技能）

- 项目：https://github.com/pbakaus/impeccable
- 技能版本：4.6.0；来源提交：`2f46b7a8b059af00d20dd13b64dbe165e7c6a742`。
- 安装位置：`.agents/skills/impeccable/`，从官方仓库的同名 Codex 技能目录安装。
- 许可：Apache-2.0；完整条款和上游声明见该目录的 `LICENSE`、`NOTICE.md`。
- 用途：UI 设计规范和辅助命令；仅项目级安装，未安装或启用 hooks，未加入应用运行时依赖。

## house-plan-designer（演示别墅数据）

- 项目：https://github.com/ZWD11/house-plan-designer ；来源提交：`3257e5a3c4acc54786666fd9647913cf084742c6`。
- 许可：MIT License，Copyright (c) 2026 ZWD11。
- 改编内容：`packages/floorplan-import/fixtures/demo-villa.housespec.json` 由上游 `reference/example-gen-villa.py` 生成的 HouseSpec 三层别墅示例改编：家具尺寸按上游 `reference/catalog-sizes.json` 默认值显式写入，挂机空调与吊灯离地高度显式写入，名称改为中性演示名称，并加入 `demo` 来源与演示标注。仅包含数据，未复制上游代码、HTML 模板或图片。
- 用途：多楼层空间、楼梯与楼板开洞的演示与测试数据；属于示意尺寸的演示数据，不是真实住宅或实测图纸。
- MIT 条款要求在副本中保留以下声明：

  > Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Three.js

- 项目：https://github.com/mrdoob/three.js
- 许可：MIT，版权信息以安装包 `LICENSE` 为准。
- 用途：3D 渲染、相机控制、几何、材质与环境光。
- `scripts/build.mjs` 将安装包完整许可证嵌入 `example/prototypes/index.html` 与 `dist/index.html`。

## esbuild

- 项目：https://github.com/evanw/esbuild
- 许可：MIT；Copyright (c) 2020 Evan Wallace。
- 用途：开发时将 JavaScript 打包，不作为在线服务使用。

## 仓耳渔阳体 / Tsanger YuYang

- 来源：用户指定的 `CONTEXTA/contexta-server/resources/fonts/tsanger-yuyang`，原始 TTF、WOFF2 和来源哈希记录在 `assets/fonts/tsanger-yuyang/`。
- 版权：北京仓耳文字技术有限公司（仓耳字库）。采用仓耳免费商用字体授权；条款摘要与官方授权链接见该目录 `NOTICE.txt`。允许嵌入、修改、子集化及按相同授权分发，不单独销售字体。此授权不等同于 SIL OFL。
- 用途：两套原型及后续产品界面的中文标题、正文、操作文字；W01–W05 对应 300–700 五档字重。压缩为 WOFF2 时保留原始字形覆盖，不按当前文案裁剪。
- `npm run fonts` 从本地原始 TTF 重新生成 WOFF2，需 Python fontTools 与 Brotli；正常构建无需网络或 Python。字体与声明内嵌两个原型 HTML 入口。

## Noto Sans SC / Noto Serif SC（历史原型资源）

- 来源：Google Fonts 官方分发；历史字体与来源记录随原型迁移保留在 `example/prototypes/src/fonts/`。
- 许可：SIL Open Font License 1.1，两份完整许可分别为 `gallery-OFL.txt`、`editorial-OFL.txt`。
- 曾用于建筑展馆版无衬线标题、家居杂志版中文衬线标题；2026-10-25 按用户指定替换为仓耳渔阳体，当前构建不再使用这些历史子集。

模型和纹理由项目代码生成，当前没有外部商业家具资产库。工作台标题字体随仓库提供。
