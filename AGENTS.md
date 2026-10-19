# My IdealHome 项目约定

此文件只规定本仓库的事实、入口与维护方式；沟通和通用执行规则遵循当前有效的用户指令。

## 当前范围

- 当前有两份交付物：原固定户型展示，以及双视觉方向的垂直 Agent 工作台交互原型。两者都不是通用自动识图平台。
- 原展示源码入口为 `src/app.js` / `src/index.html`；新工作台为 `src/workbench/app.js` / `src/workbench/index.html`。不要直接修改生成的 HTML。
- `docs/product-workflow.md` 是讨论稿，不是已经批准的开发计划。不能把设想写成已有功能。
- 新一版规划见 `docs/v1-scope.md`、`docs/web-stack.md`、`docs/v1-development-plan.md`。用户已确认自接模型的垂直 Agent 方向；多用户 + 密钥不经过平台为待最终选择的建议基线，不得写成已确认或已实现。
- 用户于 2026-10-19 明确授权实施双方向前端原型，使用可操作的演示助手；原先“仅规划不改代码”的阶段约束已结束。真实模型、账号、云存储和密钥接入仍未实施。
- 产品预算功能已被用户取消，不重新加入报价或预算模块。
- 三套方案必须改变家具摆放或组合，不能把仅换色称为布局方案。

## 事实与数据来源

- 示例说明：`examples/sample-home-2f/README.md`。
- 示例假设快照：`examples/sample-home-2f/assumptions.json`；它尚未驱动渲染。
- 历史纠正与约束：`docs/decisions.md`。
- 实际几何与位置：`src/model.js`、`src/layouts.js`。
- 用户新确认的事实优先；发生冲突时同时更新几何、说明与假设记录。
- 原房屋有四层，仅建一个代表层及连接梯段，不擅自扩展成整栋楼。
- 固定柜、空调、电视墙、门窗、柱位和楼梯关系不能因家具风格切换而移动。
- 床头保持朝北侧内墙。朝向、尺寸和楼梯压缩示意的说明必须与事实一致。

## 代码结构

- 项目级 UI 设计技能：`.agents/skills/impeccable/SKILL.md`。工作台依据 `PRODUCT.md` 与 `docs/prototype-brief.md` 实施；最终视觉规范见 `DESIGN.md` 与 `.impeccable/design.json`。
- Impeccable 不安装或启用 hooks；更新技能时继续保留此约定。

- `src/model.js`：房间、建筑、家具、楼梯、灯光和可选家具几何。
- `src/layouts.js`：三套摆放、方案可见性、占地与漫游位置。
- `src/soft-styles.js` / `src/textures.js`：配色、材质与程序纹理。
- `src/app.js`：交互、显示模式、镜头、漫游与选择。
- 切换布局后同步碰撞范围、可见物品列表、详情描述和选择状态。
- 避免直接修改共享材质而导致固定物品跟着变色。
- 当前双方向原型内嵌 Three.js，项目存入 localStorage；图片不上传。未来生产工作台网络、模型及导出方案以规划文档为准，不能把本地原型视作云服务。
- `src/workbench/store.js` 管理项目、固定物品、演示指令和撤销；`scene.js` 复用原示例并渲染用户手绘墙体；`app.js` 管理页面和编辑行为；`style.css` 包含两套视觉与响应式规则。
- `src/workbench/editorial.js` 管理家居杂志方向的实时空间首页、作品切换与项目索引；`motion.js` 管理页面过渡及相机承接。示例方案之间比较需保留用户观察角度，进入工作台时按画布比例适配视野。
- 新建项目从空白空间开始。不可把预置户型冒充用户图片的识别结果；演示助手始终明确标注。

## 常用命令

```sh
npm ci
npm run build
npm test
npm run check
npm run check:prototype
npm run preview:prototype
```

运行根目录脚本，不运行 `output/3d` 中遗留的一次性修订脚本。输出分别为 `output/3d/ideal-home-3d.html`、`output/prototype/index.html`。本地原型服务默认仅监听 `127.0.0.1:4173`。

几何或交互逻辑改变时运行 `npm run check`。视觉改变还需浏览器检查；自动测试的 Canvas 替身不能替代视觉验收。工具无法完成浏览器检查时明确记录限制，不把旧截图称为当前截图，也不绕过工具的访问限制。

不为简单文案修改增加实现镜像测试。检查通过后，仅在新改动、失败或具体疑点出现时追加验证。

## 提交内容

- 文档、示例目录和展示文案使用中性名称，不包含真实住宅名称、地名或住户身份。

- 提交源码、根目录锁文件、文档、当前离线 HTML 和当前布局比较图。
- 不提交上传图纸、私密原始资料、密钥、依赖目录、旧版导出和调试截图。
- 新产生且不再使用的临时文件在收尾清理；不要删除用户的历史成果。
- 不替用户决定项目开源许可证；保留第三方许可证声明。
