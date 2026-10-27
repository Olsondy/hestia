# Hestia 项目约定

2026-10-25 最新确认：用户亲自将原型移入 `example/prototypes/projects`，保留该目录；生产 UI 只采用家居杂志（editorial），建筑展馆仅保留为原型历史。后文两方向的历史描述不构成生产双主题要求。

Hestia 取名自古希腊神话中的炉火女神赫斯提亚，造屋之始祖。此文件只规定本仓库的事实、入口与维护方式；沟通和通用执行规则遵循当前有效的用户指令。

## 当前范围

- 2026-10-28 定位调整：Hestia 改为共享内核，服务个人与企业两种工作空间；企业场景以石材硬装饰面铺贴为重心，先做 H5 可行性演示，小程序确认后以 web-view 内嵌，见 `docs/decisions/0007-shared-core-personal-and-enterprise-workspaces.md`。不得把“企业”或“个人”写死为唯一形态；企业品牌名称、石材素材和商业资料不提交到仓库。T02、T11–T14、T18、T22–T24 与 C02 按该决定暂停，未关闭。

- 2026-10-25 游客范围最终确认：首期不做匿名账号或匿名积分，游客只看公开示例；注册并登录后一次性领取积分，再用自己的户型创建项目和进行 AI 设计。不做匿名身份升级、游客项目转移、匿名/注册积分叠加或账号合并，见 `docs/decisions/0006-open-registration-free-credits.md`。C01 已完成游客公开示例、注册与一次性赠送本地验收；AI任务积分扣退 C02 尚未实施。

- 2026-10-25 免费体验讨论更新：用户确认取消首次上线必须受邀的产品限制，开放注册，以简单积分控制免费使用，首期不提供付费功能，保留未来订阅扩展能力，见 `docs/decisions/0006-open-registration-free-credits.md`。此决定覆盖下文邀请制上线范围的历史描述；首期发放、扣除、取消与退款原则已确认，用户要求不再逐场景细分，问答 1 分／小改 5 分／整套设计 20 分及赠送 40 分暂作试用占位，后续根据供应商真实用量和费用反推调整。开放注册与一次性赠送已通过 C01 本地验收；AI积分扣退尚未实施。

- 双视觉方向（建筑展馆 / 家居杂志）的工作台原型保持可用，首版已恢复开发但尚未完成；T03/T04/T05/T06/T07/T09/T15/T16/T20 已通过本地验收。T07 为确定性协议任务，包含用户授权的隔离 Worker 真实崩溃恢复；T20 包含授权的隔离 Render Worker 关页出图验收。T15 受控家具、T16 独立风格及 T20 静态成果均通过浏览器与独立视觉复核。T01 已通过真实 API + 独立合成图片的小样准入并关闭；T02 三类真实 API 合成评估暴露截断、几何误差和附加标签，仍未通过，真实住宅样本未验证。T08 已通过真实 API 合成混合问答/准确修改、93项数据库总检查与独立 UI 复核并关闭；T10 有来源需求、持久问题与同任务恢复已验收（真实两轮合成样本、104项数据库总检查、UI独立复核）；T17/T21 已通过真实合成链路、121项数据库测试及独立UI复核并关闭；T19 已完成合成模型、数据库及 UI 验收并关闭；其余未完成工单按用户要求暂停。具体证据见 `docs/validation/` 和工单映射，未验收票不得当作已完成。
- 源码入口为 `example/prototypes/projects/src/app.js` / `example/prototypes/projects/src/index.html`，构建产物为 `example/prototypes/projects/index.html`，`dist/index.html` 保留兼容副本。不要直接修改生成的 HTML。
- 规划见 `docs/v1-scope.md`、`docs/web-stack.md`、`docs/v1-development-plan.md`。用户于 2026-10-25 确认 C 端首版仅平台模型，不提供 BYOK/自定义端点，见 `docs/decisions/0002-agent-led-consumer-workflow.md`（产品 Q1–Q8 已确认，实现架构已定稿并进入实施）。旧规划中的浏览器自接模型是历史建议基线；具体供应商与部署技术仍未定，不得写成已确认或已实现。
- 同日技术栈讨论确认大陆用户优先、无需代理，首次上线为邀请制多账号独立项目试用，暂不开放公众注册或付费购买；主要由用户和 AI 维护，低成本、少运维、托管优先且保留迁移能力，预算暂不定。见 `docs/decisions/0004-mainland-invited-pilot-managed-services.md`；具体部署与供应商仍未定，不代表已部署或已授权购买资源。
- 后续技术讨论确认统一对话入口，同一轮允许问答与设计修改并存；模型调用统一在 Worker，回复流式返回，关页不取消已接受轮次，见 `docs/decisions/0005-unified-conversation-entry.md`。实现采用 AI SDK Core + pg-boss + Hestia 专用有限状态运行器、独立领域执行器及 SSE 持久化事件；部署方案留待后续讨论。
- 用户于 2026-10-25 确认 Agent 完成整套设计任务：候选阶段连续推进，不逐个工具确认；采用初始空间或整套方案时确认，明确局部修改可直接应用并撤销，固定事实变更单独处理。工具与 prompt 草案见 `docs/agent/tool-contract.md`、`docs/agent/system-prompt.md`。
- 同日确认首版为单层图纸到设计、迭代及 3D/静态图的完整流程，room tour 后续扩展；缺尺寸可继续概念设计，确认尺度或判断可放置前须补充可靠尺寸；关闭页面后任务在平台上限内继续并可恢复、取消。后台运行与验收草案见 `docs/agent/runtime-design.md`，完整后台运行链路尚未验收。
- 同日确认复杂设计优先质量、局部修改优先速度，两者共用执行约束。模型策略见 `docs/agent/model-policy.md`；具体模型与预算数值须业务样本验证，不要求用户凭型号选择，实施范围按后续明确授权与已发布工单推进。
- 用户随后明确批准 `docs/planning/v1-issue-drafts/` 的总规格、24 项子工单及测试边界，授权发布工单、建立父子与阻塞关系，并由子 Agent 并行推进无阻塞任务。开发按实际依赖调度，验收通过后才能解除下游阻塞；此前文档中的“仅设计、未授权实施”是当时的阶段记录，不覆盖本次明确授权。真实模型和样本验证不得用模拟结果冒充完成。
- 用户已审阅并确认 `docs/web-stack.md` 的实现架构与技术栈定稿，`docs/decisions/0003-modular-monolith-with-durable-workers.md` 已接受，作为首版实施基线，无需再次逐库确认。精确版本、模型能力、渲染及恢复仍需验证，部署方案不在本次定稿范围。随后用户明确要求同步现有工单并恢复开发，按实际依赖推进、使用子 Agent 并行处理独立无阻塞任务；此前暂停开发指示已解除。验收通过后才能关闭工单并解除下游阻塞。
- 本轮用户要求原型迁入 `example/prototypes/projects` 并保持可访问；生产 UI 仅参照该原型家居杂志（editorial）方向的间距、布局与动画，使用用户指定 `C:/Users/Olsond/.agents/skills/impeccable/SKILL.md` 实施，不启用 hooks。中文字体统一使用用户提供的 Tsanger YuYang 字体，保留随附授权声明；原型源码位于 `example/prototypes/projects/src`，可访问产物为 `example/prototypes/projects/index.html`；字体原始 TTF、完整 WOFF2 和授权声明位于 `assets/fonts/tsanger-yuyang`。
- 用户于 2026-10-19 明确授权实施双方向前端原型，使用可操作的演示助手。真实模型 API 按用户要求稍后配置；邀请身份与项目存储已通过 T04 本地验收，云存储及完整任务链路仍待对应工单验收。
- 产品不提供预算或报价模块，不重新加入。
- 布局方案必须改变家具摆放或组合，不能把仅换色称为布局方案。铺贴方案同理，必须改变石材、规格、铺法或排版。

## 内置示例项目

- 工作台自带一个示例户型（三个示例项目对应三套家具布局），几何与布局在 `example/prototypes/projects/src/sample/`。新建家具也以示例模型中的家具为模板。
- 固定设施（固定柜、空调、电视墙、门窗、柱位、楼梯等）独立于布局方案，见 `docs/decisions/0001-fixed-facts-independent-of-layouts.md`。新增固定设施时同步 `example/prototypes/projects/src/store.js` 的 `fixedIds`。
- 示例尺寸是示意，不是实测；界面中须明确标注示例与演示。

## 代码结构

- 项目级 UI 设计技能：`.agents/skills/impeccable/SKILL.md`。工作台依据 `PRODUCT.md` 与 `docs/prototype-brief.md` 实施；最终视觉规范见 `DESIGN.md` 与 `.impeccable/design.json`。
- Impeccable 不安装或启用 hooks；更新技能时继续保留此约定。

- `example/prototypes/projects/src/store.js`：项目、固定物品、演示指令和撤销。
- `example/prototypes/projects/src/scene.js`：Three.js 场景，渲染示例户型与用户手绘墙体。
- `example/prototypes/projects/src/app.js`：页面路由和编辑行为；`example/prototypes/projects/src/style.css` 包含两套视觉与响应式规则。
- `example/prototypes/projects/src/editorial.js`：家居杂志方向的实时空间首页、作品切换与项目索引；`example/prototypes/projects/src/motion.js`：页面过渡及相机承接。示例方案之间比较需保留用户观察角度，进入工作台时按画布比例适配视野。
- `example/prototypes/projects/src/sample/`：示例户型的房间、建筑、家具、灯光（`model.js`），三套摆放（`layouts.js`），配色材质（`soft-styles.js`、`textures.js`）。切换布局后同步碰撞范围、可见物品、详情描述和选择状态；避免直接修改共享材质导致固定物品跟着变色。
- 原型内嵌 Three.js，项目存入 localStorage（键 `hestia.studio.v1`）；图片不上传。未来生产工作台的网络、模型及导出方案以规划文档为准，不能把本地原型视作云服务。
- 新建项目从空白空间开始。不可把示例户型冒充用户图片的识别结果；演示助手始终明确标注。

- `apps/web`：已通过 T04 本地验收的 Next.js 页面和 API；`packages/contracts`、`projects`、`persistence`、`identity` 提供共享契约与服务，验收证据见 `docs/validation/T04-projects.md`，不代表后续工单完成。
- `packages/scene-runtime`：已通过 T03 的场景输入和 Three.js 适配；`packages/model-validation`、`floorplan-import` 仅记录合成/协议验证，不代替真实评估。
- 依赖通过 pnpm workspace 和根目录 `pnpm-lock.yaml` 维护。本地 PostgreSQL 17.7 Compose 用于联调，生产部署方案未确定。

## 常用命令

```sh
pnpm install --frozen-lockfile
pnpm check         # 原型构建、数据测试、类型与核心行为检查
pnpm preview       # 127.0.0.1:4173/example/prototypes/projects/
pnpm dev           # Next.js 开发入口，端口 3000
pnpm test:db       # 本地真实 PostgreSQL 验证
```

视觉改变还需浏览器检查；自动测试不能替代视觉验收。工具无法完成浏览器检查时明确记录限制，不把旧截图称为当前截图，也不绕过工具的访问限制。

不为简单文案修改增加实现镜像测试。检查通过后，仅在新改动、失败或具体疑点出现时追加验证。

## 提交内容

- 文档和展示文案使用中性名称，不包含真实住宅名称、地名或住户身份。
- 提交源码、根目录 `pnpm-lock.yaml`、迁移与文档；原型变更同步提交 `example/prototypes/projects/index.html` 和 `dist/index.html`。
- 不提交上传图纸、私密原始资料、密钥、依赖目录和调试截图。
- 新产生且不再使用的临时文件在收尾清理；不要删除用户的历史成果。
- 不替用户决定项目开源许可证；保留第三方许可证声明。

## Agent skills

### Issue tracker

任务与规格记录在本仓库 GitHub Issues，使用 `gh` CLI。操作及任务规范见 `docs/agents/issue-tracker.md`。

### Domain docs

Single-context：根目录 `CONTEXT.md` + `docs/decisions/`。读取与维护规则见 `docs/agents/domain.md`。
