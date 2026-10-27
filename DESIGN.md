---
name: "Hestia"
description: "生产基线：家居杂志实时空间刊页；建筑展馆仅为原型历史"
colors:
  gallery-bg: "#f5f7f8"
  gallery-surface: "#fff"
  gallery-surface-alt: "#eef3f5"
  gallery-ink: "#1a3542"
  gallery-muted: "#64747c"
  gallery-line: "#dce3e7"
  gallery-accent: "#176c72"
  gallery-accent-soft: "#e2f0ee"
  gallery-nav: "#183642"
  gallery-nav-ink: "#edf4f5"
  gallery-canvas-bg: "#e9eef0"
  gallery-plan-grid: "#cbd7dc"
  gallery-plan-floor: "#fcfdfb"
  editorial-bg: "#f3ece2"
  editorial-surface: "#fcf7ef"
  editorial-surface-alt: "#e9ddd0"
  editorial-ink: "#382b29"
  editorial-muted: "#756057"
  editorial-line: "#d5c6b9"
  editorial-accent: "#743c49"
  editorial-accent-soft: "#ead9d8"
  editorial-nav: "#743c49"
  editorial-nav-ink: "#fcf7ef"
  editorial-canvas-bg: "#c9b8a7"
  editorial-plan-grid: "#d2bfb2"
  editorial-plan-floor: "#faf4e9"
  folio-paper: "#f6f1e8"
  folio-ink: "#352d29"
  folio-line: "#d7cec2"
  folio-selected: "#eadfd2"
  folio-hover: "#eee5da"
  folio-view-hover: "#e8dcd0"
  folio-view-text: "#fff8f1"
  focus: "#339fa1"
  danger: "#a33f2b"
  danger-soft: "#f8ece8"
  night: "#192b35"
typography:
  gallery-display:
    fontFamily: "Tsanger YuYang, Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "clamp(28px,2.6vw,39px)"
    fontWeight: 550
    lineHeight: 1.45
    letterSpacing: "-.035em"
  editorial-display:
    fontFamily: "Tsanger YuYang, Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "clamp(48px,5.1vw,78px)"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-.04em"
  gallery-showcase:
    fontFamily: "Tsanger YuYang, Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "clamp(26px,2.9vw,43px)"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-.035em"
  editorial-showcase:
    fontFamily: "Tsanger YuYang, Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "54px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-.025em"
  gallery-title:
    fontFamily: "Tsanger YuYang, Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
  editorial-title:
    fontFamily: "Tsanger YuYang, Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "23px"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "Tsanger YuYang, Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
  description:
    fontFamily: "Tsanger YuYang, Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "13px"
    lineHeight: 1.8
  button:
    fontFamily: "Tsanger YuYang, Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 550
    lineHeight: 1.4
  label:
    fontFamily: "Tsanger YuYang, Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "12px"
rounded:
  folio: "0px"
  gallery-control: "10px"
  editorial-control: "3px"
  gallery-cover: "12px"
  editorial-cover: "2px"
  field: "6px"
  search: "8px"
  icon: "7px"
  dialog: "14px"
spacing:
  compact: "7px"
  control-gap: "9px"
  small: "12px"
  medium: "20px"
  section: "24px"
  roomy: "28px"
  large: "40px"
components:
  button-primary:
    backgroundColor: "{colors.gallery-accent}"
    textColor: "{colors.gallery-surface}"
    typography: "{typography.button}"
    rounded: "{rounded.gallery-control}"
    padding: "12px 18px"
  button-primary-editorial:
    backgroundColor: "{colors.editorial-accent}"
    textColor: "{colors.gallery-surface}"
    typography: "{typography.button}"
    rounded: "{rounded.editorial-control}"
    padding: "12px 18px"
  button-secondary:
    backgroundColor: "{colors.gallery-surface}"
    textColor: "{colors.gallery-ink}"
    rounded: "{rounded.gallery-control}"
    padding: "12px 18px"
  button-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.gallery-control}"
    padding: "12px 18px"
  icon-button:
    rounded: "{rounded.icon}"
    height: "36px"
    width: "36px"
  field:
    backgroundColor: "{colors.gallery-bg}"
    textColor: "{colors.gallery-ink}"
    rounded: "{rounded.field}"
    padding: "11px"
  prototype-badge:
    textColor: "{colors.gallery-muted}"
    rounded: "5px"
    padding: "5px 9px"
  project-cover:
    backgroundColor: "{colors.gallery-canvas-bg}"
    rounded: "{rounded.gallery-cover}"
  room-entry:
    rounded: "{rounded.icon}"
    padding: "12px 10px"
  room-entry-active:
    backgroundColor: "{colors.gallery-accent-soft}"
    textColor: "{colors.gallery-accent}"
    rounded: "{rounded.icon}"
    padding: "12px 10px"
  folio-view:
    backgroundColor: "{colors.folio-paper}"
    textColor: "{colors.folio-ink}"
    rounded: "{rounded.folio}"
    padding: "11px 17px"
  folio-view-active:
    backgroundColor: "{colors.editorial-accent}"
    textColor: "{colors.folio-view-text}"
    rounded: "{rounded.folio}"
    padding: "11px 17px"
  folio-project-active:
    backgroundColor: "{colors.folio-selected}"
    textColor: "{colors.editorial-accent}"
    typography: "{typography.editorial-title}"
    rounded: "{rounded.folio}"
    padding: "22px 30px 18px"
---

# Design System: Hestia

## Overview

**Creative North Star: "家居杂志 · 空间作品刊页"**

2026-10-25 用户明确选择家居杂志（editorial）作为唯一生产视觉基线，并亲自将原型移至 `example/prototypes/projects`。暖纸导读、仓耳渔阳体项目名和实时三维空间组成作品刊页：先探索空间，再进入编辑，项目管理收进索引。生产不再要求建筑展馆主题或主题切换。

编辑工作台保留工具、房间、画布和演示助手的任务层级，独立展示页以空间浏览为主。模型、运行时过渡截图与图示来自项目自身的 Three.js 几何和 SVG；不使用商业室内摄影代替实际空间。保留原型仍为本地前端，带演示助手、本地保存和示例尺寸标注；生产 T04 另以真实邀请身份和服务端项目状态显示信息，不继承原型的演示身份。

**Key Characteristics:**

- 生产采用杂志导读、实时空间与方案轨道；原型历史仍保留展馆侧栏与模型封面目录。
- 纸色与墨色承载内容；酒红用于动作、选中与项目名字的强调。
- 示例方案共享观察方位，比较实际家具摆放与组合。
- 平面刊页、细分隔线和少量浮动控件形成层级。

本规范记录 2026-10-19 用户授权的结构重做，取代旧 editorial 精选卡片首页规范；gallery 继续保留。依据为 `example/prototypes/projects/src/style.css` 的最终覆盖层、`editorial.js`、`motion.js`、`scene.js` 与 `app.js`。这是 code-led 实现，没有 approved raster comp。具体表面契约见 `docs/prototype-brief.md` 顶部六块契约；验证事实与历史分界见 `docs/prototype-review.md`。

前置 token 按适用范围使用：生产选择 editorial / folio；gallery 及原先以 gallery 为默认的通用组件条目仅记录历史原型，不是生产默认值。gallery / editorial 前缀保留两套历史主题变量；folio 前缀记录刊页的局部颜色与形状，不能将其误写为整套 editorial 变量已经替换。旧卡片 CSS 仍在源码中，当前 editorial 项目路由进入实时刊页。

## Colors

### Primary

- **展馆湖蓝**：gallery-accent 用于主操作与选中，gallery-accent-soft 提供浅底。
- **杂志酒红**：editorial-accent 用于主操作、项目名强调、当前视角与方案轨道；editorial-accent-soft 继续服务编辑工具。

### Neutral

- **展馆冷白与深海蓝**：gallery-bg / surface / surface-alt 区分页面与工作面，ink / muted / line 区分文本与分隔，nav / nav-ink 管理侧栏。
- **刊页纸色与褐墨**：folio-paper / folio-ink 是实时刊页的局部底色和主文字；folio-line 连接导读、画面与轨道，folio-selected / folio-hover 区分轨道状态。项目索引也用刊页纸色。
- **工作台暖纸**：editorial-bg / surface / ink 等继续服务导入、编辑与展示控件，不将旧酒红导航样式套到刊页页头。
- **空间与反馈**：canvas-bg / plan-grid / plan-floor 服务三维与二维图。night 仅是三维夜景底；危险操作使用 danger。展馆焦点用 focus，杂志焦点用强调色。

**The Shared Action Rule.** 生产主操作、房间选中、输入焦点和材质选中沿用家居杂志的酒红强调色；历史原型的主题切换不改变操作含义。

侧车八阶 OKLCH 色条仅为色板预览，由实际色值派生，不是新增 UI token。

## Typography

用户于 2026-10-25 指定统一使用仓耳渔阳体（Tsanger YuYang），覆盖展馆、杂志的标题、正文与操作文字。共享资源为 `assets/fonts/tsanger-yuyang/`，W01–W05 分别对应 300、400、500、600、700，WOFF2 保留原始 TTF 的完整字形，支持新项目名；回退为 Segoe UI / Microsoft YaHei / system-ui。原型构建将字体内嵌，无运行时字体请求。保留 `font-synthesis:none`，550 等中间请求由浏览器匹配实际字重。

- 刊页项目名使用 editorial-display；常规桌面四字示例名分两行，后半段酒红。超过八字时使用 36px、1.4 行高、最多三行的长标题分支。
- 701–1100px 横向布局标题 59px；701px 以上且宽高比不超过 1 的竖向布局标题 43px、1.3 行高；700px 及以下为 35px、1.35 行高，并取消强制换行。
- 方案轨道名为 editorial-title，1600px 以上放大至 27px，手机为 22px；索引项目名为 26px。导读小标题 19px，说明文字 12–13px。
- 展馆目录标题沿用 gallery-display，展示页沿用 gallery-showcase / editorial-showcase。杂志展示标题桌面 54px、手机 32px，房间聚焦时隐藏大标题。
- 字段与工具通常为 11–14px，刊页事实与页脚为 10–11px；这些是组件实际值，不是强制等比字阶。

**The Editorial Production Rule.** 生产统一采用家居杂志布局、字号、留白与仓耳渔阳体；紧凑工具与数值编辑沿用操作字号。两套视觉的对比仅保留在历史原型。

## Layout

杂志刊页采用全宽实时模型和导读的组合；实时画面是主体，管理入口位于项目索引。常规横向桌面页头 78px，主体为 `minmax(270px,25%) minmax(0,1fr)`，约四分之一导读、四分之三画面。主体最小高 570px，高度按 `100dvh - 235px` 计算、最大 1050px；底部方案轨道最小高 113px，页脚 44px。导读主动作在底部，画布内有视角与昼夜控件。

- **701–1100px 横向视口**：导读为 240px，画面占余宽；页头与页脚内距缩至 25px。
- **701px 以上、宽高比不超过 1**：导读变为顶部 175px 横排（三列：项目名、介绍、动作），下面是全宽模型，最小高 450px。903×1244 是此布局的实际检查尺寸。
- **700px 及以下**：66px 页头；紧凑项目名与动作并排；隐藏长导读。画面高 `clamp(350px,52dvh,540px)`，下方方案轨道横向滚动、条目最小宽 172px。390px 使用此布局，不能继续压缩桌面侧栏。
- **1600px 及以上**：导读左内距 60px、右内距 40px，阅读列最大 270px。

gallery 保持固定左栏（214px）、最大 1800px 内容区与双列封面目录；宽屏变三列，窄屏依次缩为 185px、70px 侧栏，600px 及以下隐藏侧栏。编辑工作台桌面三栏：gallery 218px / 弹性画布 / 310px，editorial 230px / 弹性画布 / 326px；600px 及以下先画布、后面板。独立展示页仍为全画布。

三维视角根据可见边界与画布宽高比取景。刊页视角使用水平 / 垂直留量 .88 / .78；通用整层取景为 .84 / .78。从刊页进入更窄的编辑画布时，承接相机目标与方向并适配距离，不能机械复用距离造成裁切。

## Elevation & Depth

刊页与方案条目以纸色、细线和留白建立层级。浮动视角条、家具说明和索引抽屉才使用柔和阴影。gallery 继续采用轻阴影区分场景工具与对话框。

- 刊页视角条：0 6px 24px #3229210c。
- 家具说明：0 8px 24px #382b2920。
- 索引抽屉：-20px 0 65px #21170d24；遮罩 #29221b55。
- 共用对话框：0 25px 100px #102c3a33；场景工具：0 6px 25px #17344012。

**The Canvas Layer Rule.** 普通项目条目与工作面保持平面结构，浮动工具与模态对话框才使用明显的柔和阴影。

## Shapes

刊页、视角条、轨道与索引抽屉为直角，圆形用于继续设计箭头和添加入口。gallery 保留圆角封面与控件；editorial 共用主按钮保留小圆角。字段、图标按钮、共用对话框各有独立圆角，不统一覆盖。图标来自内联 SVG，常用 24×24 viewBox、1.6 描边。

## Components

### Buttons

共用主操作为主题强调色实底与白字，次操作用工作面底和细内描边，危险操作用独立危险色。常规内距见 token，禁用透明度 .42，键盘焦点为 3px 轮廓与 3px 外偏移。刊页的“继续设计”是双分隔线行与圆形箭头，悬停箭头右移 4px；“进入空间展示”为次级文字入口。

### Chips

原型、示例和本地保存标识是静态信息。刊页“可交互 3D”明确内容类型，不能伪装真实模型服务的连接状态。

### Cards / Containers

gallery 项目封面仍由 Three.js 生成，悬停放大并显示入口。editorial 当前首页不再渲染精选卡片组合；方案轨道是切换真实项目的按钮，用底色、酒红下划线与箭头标记当前项。手机轨道可横滑。侧车图示仅为自包含组件预览，不代表正式三维渲染。

### Inputs / Fields

工作台数值字段使用主题底色、细边框和 tabular-nums。项目索引搜索采用透明底与单条底线；搜索无结果有明确文案。固定物品的参数锁定继续由业务状态控制。

### Navigation

gallery 侧栏目录保留。editorial 刊页页头提供项目索引、导入图纸与连接设置；手机隐藏页头导入入口，仍可通过轨道加号与索引新建。索引使用原生 `dialog.showModal()`，从右侧出现，提供搜索、打开、重命名、复制、删除和新建；支持关闭按钮、遮罩点击与原生 Escape，显式关闭后将焦点还给触发入口。索引默认最多 500px 宽，手机占满可用宽度并内部滚动。

### Live spatial folio

示例默认客厅近景；整层、客厅、俯视三个按钮切换真实相机，按钮有 `aria-pressed`。自定义项目默认整层且隐藏客厅入口。用户可拖动旋转、滚轮缩放、点击家具说明、切换昼夜。切换示例方案先捕获当前相机，应用另一项目布局再恢复同一观察方位，用于比较摆放；自定义项目切换则重新取整层。此能力不是自动生成布局。

作品切换用当前模型截图执行 850ms 横向裁切揭示，标题 700ms 上移淡入、导读 900ms 淡入；首次进入刊页的标题、导读与轨道分别为 1000ms、1100ms、900ms。视角相机缓动为 700ms 四次 ease-out。索引进场为 550ms 横向移动。界面使用 cubic-bezier(.16,1,.3,1)。

刊页的继续设计 / 空间展示传递当前项目和相机；3D 编辑与展示往返也保留位置、目标、视野角、房间、材质、昼夜与家具显示状态。目标画布变窄时适配相机距离；恢复后的 1000ms 内防止普通 resize 全屋取景覆盖。过渡使用 850ms FLIP 图像层，前 75% 保持不透明；真实 Canvas 在 630ms 后用 220ms 淡入，面板以 600ms、260ms 起始延迟及 65ms 间隔进入。这些是临时导航状态，不是持久化相机书签；重新进入刊页仍初始化默认视角与白天。

`prefers-reduced-motion` 下跳过 WAAPI、FLIP 和相机缓动，取消刊页箭头移动与加号旋转，直接呈现最终内容。最终视觉验收状态由验证记录维护，不由本设计规范推断。

## Do's and Don'ts

### Do:

- **Do** 生产继承 editorial 实时空间刊页结构；gallery 目录仅在历史原型保留。
- **Do** 生产使用 editorial / folio 变量，并区分刊页局部纸色与工作台纸色。
- **Do** 保留真实模型、示例尺寸、手动描绘、演示助手和本地保存标识。
- **Do** 检查横屏、竖屏与手机构图，以及键盘焦点和 reduced-motion 分支。

### Don't:

- **Don't** 将旧的精选卡片首页继续当作当前杂志方向，或把换色称为结构重做。
- **Don't** 将固定设施随家具风格移动，或把仅换色称为布局方案。
- **Don't** 将尚未验收的真实模型、自动识图、云部署或预算模块写成现有能力；账号与项目保存仅按 T04 本地验收范围说明。
- **Don't** 将辅助小字推广为正文标准，或把测试通过、历史 ship 当作获奖品质证明。
