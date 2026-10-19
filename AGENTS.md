# Hestia 项目约定

Hestia 取名自古希腊神话中的炉火女神赫斯提亚，造屋之始祖。此文件只规定本仓库的事实、入口与维护方式；沟通和通用执行规则遵循当前有效的用户指令。

## 当前范围

- 当前交付物是双视觉方向（建筑展馆 / 家居杂志）的垂直 Agent 工作台交互原型，不是通用自动识图平台。
- 源码入口为 `src/app.js` / `src/index.html`，构建产物为 `dist/index.html`。不要直接修改生成的 HTML。
- 规划见 `docs/v1-scope.md`、`docs/web-stack.md`、`docs/v1-development-plan.md`。用户已确认自接模型的垂直 Agent 方向；多用户 + 密钥不经过平台为待最终选择的建议基线，不得写成已确认或已实现。
- 用户于 2026-10-19 明确授权实施双方向前端原型，使用可操作的演示助手。真实模型、账号、云存储和密钥接入仍未实施。
- 产品不提供预算或报价模块，不重新加入。
- 布局方案必须改变家具摆放或组合，不能把仅换色称为布局方案。

## 内置示例项目

- 工作台自带一个示例户型（三个示例项目对应三套家具布局），几何与布局在 `src/sample/`。新建家具也以示例模型中的家具为模板。
- 固定设施（固定柜、空调、电视墙、门窗、柱位、楼梯等）独立于布局方案，见 `docs/decisions/0001-fixed-facts-independent-of-layouts.md`。新增固定设施时同步 `src/store.js` 的 `fixedIds`。
- 示例尺寸是示意，不是实测；界面中须明确标注示例与演示。

## 代码结构

- 项目级 UI 设计技能：`.agents/skills/impeccable/SKILL.md`。工作台依据 `PRODUCT.md` 与 `docs/prototype-brief.md` 实施；最终视觉规范见 `DESIGN.md` 与 `.impeccable/design.json`。
- Impeccable 不安装或启用 hooks；更新技能时继续保留此约定。

- `src/store.js`：项目、固定物品、演示指令和撤销。
- `src/scene.js`：Three.js 场景，渲染示例户型与用户手绘墙体。
- `src/app.js`：页面路由和编辑行为；`src/style.css` 包含两套视觉与响应式规则。
- `src/editorial.js`：家居杂志方向的实时空间首页、作品切换与项目索引；`src/motion.js`：页面过渡及相机承接。示例方案之间比较需保留用户观察角度，进入工作台时按画布比例适配视野。
- `src/sample/`：示例户型的房间、建筑、家具、灯光（`model.js`），三套摆放（`layouts.js`），配色材质（`soft-styles.js`、`textures.js`）。切换布局后同步碰撞范围、可见物品、详情描述和选择状态；避免直接修改共享材质导致固定物品跟着变色。
- 原型内嵌 Three.js，项目存入 localStorage（键 `hestia.studio.v1`）；图片不上传。未来生产工作台的网络、模型及导出方案以规划文档为准，不能把本地原型视作云服务。
- 新建项目从空白空间开始。不可把示例户型冒充用户图片的识别结果；演示助手始终明确标注。

## 常用命令

```sh
npm ci
npm run check     # 构建 dist/index.html 并运行数据测试
npm run preview   # 仅在 127.0.0.1:4173 提供本地预览
```

视觉改变还需浏览器检查；自动测试不能替代视觉验收。工具无法完成浏览器检查时明确记录限制，不把旧截图称为当前截图，也不绕过工具的访问限制。

不为简单文案修改增加实现镜像测试。检查通过后，仅在新改动、失败或具体疑点出现时追加验证。

## 提交内容

- 文档和展示文案使用中性名称，不包含真实住宅名称、地名或住户身份。
- 提交源码、根目录锁文件、文档和当前 `dist/index.html`。
- 不提交上传图纸、私密原始资料、密钥、依赖目录和调试截图。
- 新产生且不再使用的临时文件在收尾清理；不要删除用户的历史成果。
- 不替用户决定项目开源许可证；保留第三方许可证声明。

## Agent skills

### Issue tracker

Issues 记录在本仓库的 GitHub Issues（使用 `gh` CLI，仓库由 `git remote` 推断）。See `docs/agents/issue-tracker.md`.

### Triage labels

使用默认五个标签：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。See `docs/agents/triage-labels.md`.

### Domain docs

Single-context：根目录 `CONTEXT.md` + `docs/decisions/`（ADR 目录，按需创建）。See `docs/agents/domain.md`.
