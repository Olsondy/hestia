# Hestia

Hestia 取名自古希腊神话中的炉火女神赫斯提亚，造屋之始祖。它是一个空间设计工作台：导入户型图、校准描墙、编辑家具布局，并用独立的 3D 页面展示你的家。

**当前是双方向的 Agent 工作台前端原型。** 可操作项目管理、图片导入、手动校准描墙、家具编辑、演示对话和独立 3D 展示。尚未接入自动识图、真实大模型、账号或云端协作。

## 两种设计方向

建筑展馆采用深蓝侧栏、冷白编辑区和模型目录；家居杂志采用横向导航、暖纸背景与精选项目排版。两者共用同一套本地项目数据。

```sh
npm ci
npm run check
npm run preview
```

打开 [本地预览](http://127.0.0.1:4173/)，从任一方向进入项目，再点击「展示预览」进入独立浏览页。也可以直接打开 [构建产物](dist/index.html)。建议使用本地服务，以获得稳定的浏览器存储行为；`file:` 与 `http:` 的项目数据不互通。

- 可新建、搜索、重命名、复制项目，导入 PNG / JPG / WebP 图片并手动校准、描墙；PDF 请先转换为图片。
- 在平面图拖动家具，或通过属性修改位置与朝向；支持锁定、撤销重做、本地保存和 JSON 导出。JSON 重新导入尚未提供。
- 演示助手能执行“床向右移动 30 厘米”等有限指令；明确标注演示模式，不调用模型或收集密钥。
- 独立展示页支持材质 / 白模 / 线框、昼夜、隐藏家具和截图。内置示例户型还支持单独查看房间、房间漫游与室内灯光。

图纸导入不会自动生成墙体；新项目由用户手动绘制。家具移动没有工程级碰撞与通行校验。当前版本用于体验流程和比较视觉方向。

## 项目结构

```text
src/                 工作台页面、场景、存储、动效与字体
src/sample/          内置示例户型：几何、三套家具布局与材质
scripts/             构建、数据测试、本地预览、字体子集更新
dist/index.html      构建产物（单文件离线 HTML）
docs/                产品范围、技术栈、开发计划、原型契约与决策
.github/workflows/   Windows / Linux 构建与测试
AGENTS.md            本项目的 agent 工作约定
```

## 文档

- [产品上下文](PRODUCT.md) · [设计系统](DESIGN.md) · [原型范围与设计契约](docs/prototype-brief.md) · [原型验证记录](docs/prototype-review.md)
- [V1 功能范围](docs/v1-scope.md)（规划，未实施） · [Web 技术栈与密钥边界](docs/web-stack.md) · [开发阶段与验收](docs/v1-development-plan.md)
- [开发与验证](docs/development.md) · [决策记录](docs/decisions/) · [参与开发](CONTRIBUTING.md) · [版本记录](CHANGELOG.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

## 许可

本项目尚未选择开源许可证，`package.json` 暂标为 `UNLICENSED`，不因提交 GitHub 自动授予开源许可。Three.js、esbuild 与 Noto 字体依各自许可证使用；构建产物保留对应声明。
