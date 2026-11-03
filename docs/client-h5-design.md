# H5 客户端设计规范（P03 原型 v2）

本文是客户端 H5（小程序 web-view 内嵌）的视觉与组件规范，依据为 `example/prototypes/client-h5-v2/src/`。原型按代码级还原来组织：每个 CSS 类前缀对应一个将来的 React 组件，所有取值来自 token，实现 H02 时可以直接迁移到 `apps/web/app/(client)/client.css` 与 `apps/web/components/client/`。

方向：配色 A 柔和中性 + 布局 ① 沉浸全屏（用户在 `client-h5-styles`、`client-h5-layouts` 两轮探索后选定），浅色 / 深色共用一套配色，默认跟随系统。客户端与工作台的家居杂志方向（根目录 `DESIGN.md`）版式不同，只共用字体。

## Token

全部定义在 `style.css` 的 `:root`，深色值在 `prefers-color-scheme` 与 `[data-theme=dark]` 中覆盖同名变量。组件里不写字面色值，图片上的控件除外（固定白字 + 半透明深底）。

| 组别 | 变量 | 说明 |
| --- | --- | --- |
| 颜色 | `--c-bg` `--c-surface` `--c-surface-2` `--c-surface-3` | 页面底、卡片、浅填充（分段、输入按钮）、更深填充（开关轨道、进度底） |
| | `--c-ink` `--c-ink-2` | 主文字、次要文字（浅色模式下在 bg 上约 6:1，不再用更浅的灰） |
| | `--c-line` `--c-line-strong` | 分隔线、控件描边 |
| | `--c-primary` `--c-on-primary` | 主按钮与选中态（浅色近黑、深色近白） |
| | `--c-ok/-bg` `--c-warn/-bg` `--c-danger/-bg` | 已发布 / 已确认，需协助 / 提示，冲突 / 错误 |
| | `--c-media-ctl` `--c-on-media` | 效果图上的按钮、标签 |
| 字体 | `--font` | 仓耳渔阳体，只用 400 / 500（与生产 client.css 一致，原型内嵌约 1.6 MB） |
| | `--t-display` 30/1.3 · `--t-title` 22/1.35 · `--t-heading` 17/1.45 · `--t-body` 15/1.7 · `--t-label` 15/1.4·500 · `--t-meta` 13/1.6 · `--t-caption` 12/1.5 | 最小字号 12px；数字用 `.num`（tabular-nums） |
| 间距 | `--s-1…--s-10`（4 的倍数）· `--gutter` 20px | 区块间距 `--s-8`，标题与内容 `--s-3` |
| 圆角 | `--r-sm` 10 · `--r-md` 14 · `--r-lg` 20 · `--r-xl` 28 · `--r-pill` | 缩略图 md，卡片 / 分组 lg，弹层与面板 xl，按钮和选项 pill |
| 层级 | `--e-1` 卡片 · `--e-2` 浮层（菜单、提示）· `--e-3` 面板 | 卡片只用阴影、不加边框；深色模式卡片无阴影 |
| 尺寸 | `--h-control` 52 · `--h-control-sm` 40 · `--tap` 44 · `--h-appbar` 56 · `--h-tabbar` 64 · `--frame-max` 430 | 所有可点区域不小于 44px |
| 动效 | `--ease` cubic-bezier(.16,1,.3,1) · `--d-fast` 160 · `--d-base` 280 · `--d-slow` 450 ms | `prefers-reduced-motion` 下全部取消 |

## 组件对照

| 类名 | React 组件（建议） | 要点 |
| --- | --- | --- |
| `.screen` `--tabs` `--dock` | `Screen` | 一级页留出底部菜单空间，带底部操作的页留出 Dock 空间 |
| `.appbar` `--overlay` | `AppBar` | 三栏：返回 / 企业标志 · 标题 · 右侧；叠在图片上用 overlay |
| `.icon-btn` `--media` `--outline` | `IconButton` | 44px 触控区 |
| `.tabbar` `__item` `__action` | `TabBar` | 首页 / 项目 / 我的始终显示文字；「提交方案需求」为凸起的 + 圆形主操作，不加文字，读屏用 aria-label |
| `.btn` `--primary` `--secondary` `--block` `--grow` `--sm` | `Button` | 所有主操作同一样式：文字居中、不带箭头；每屏最多一个 primary |
| `.section` | `Section` | 标题 + 右侧说明（示意、计数、单位） |
| `.group` `.row` `--stack` | `Group` `Row` `LinkRow` | 长数值（饰面清单）用 stack，避免右对齐折行 |
| `.field` `--code` | `Field` | 放在 Group 内；验证码、绑定码的发送 / 填入按钮在同一行 |
| `.alert` `--hint` `--danger` `--info` | `Alert` | danger 带 `role="alert"` |
| `.badge` `--ok` `--warn` | `StatusBadge` | 项目状态 |
| `.chip` | `ChoiceChip` | `aria-pressed`；单选和多选共用 |
| `.segmented` `--media` | `Segmented` | 互斥切换：方案 A/B/C、软装 / 硬装、效果图 / 3D、主题 |
| `.switch` | `Switch` | `role="switch"` + `aria-checked` |
| `.stepper` | `Stepper` | 三段进度条 + 文字 |
| `.option` `.upload` | `OptionCard` `UploadCard` | 户型单选 |
| `.check` | `CheckRow` | 饰面多选 |
| `.swatches` `--rail` `.swatch` | `StonePicker` | 提交页为九宫格并显示选择顺序，调整页为横向滑动 |
| `.styles` `.style-opt` `.palette` | `SoftStylePicker` `Palette` | 三套风格三列并排，不需要横滑 |
| `.timeline` | `Timeline` | done / now / todo |
| `.stage` | `SchemeStage` | 效果图 / 3D、左右切换、出图中遮罩；可横滑 |
| `.panel` | `SchemePanel` | 沉浸页下方面板，与 Stage 上下相接，不遮挡地面；展开后 Stage 隐藏切换控件 |
| `.compare` | `SchemeCompare` | 真实 `<table>`，当前方案整列高亮 |
| `.renders` `.render-slot` `.bar` | `RenderProgress` | 三张效果图位逐张出现，替代进度环 |
| `.dock` | `Dock` | 底部固定操作 |
| `.sheet` | `Sheet` | 原生 `dialog.showModal()`，Esc 与点遮罩关闭，打开后焦点在弹层上 |
| `.toast` | `Toast` | `role="status"` |
| `.proto-btn` `.proto-ops` | 不实现 | 原型审阅入口与「模拟企业」操作，虚线样式，不属于产品 |

## 页面与状态

路由与 H01 一致（原型用 hash）：首页、登录、提交需求（三步）、项目状态（图纸转换中 / 出图中 / 待审核 / 需协助转换）、方案、调整、确认、已确认、分享预览、绑定（自动 / 不一致 / 绑定码 / 申请 / 待批准 / 已绑定）、链接失效（撤销 / 过期）、我的项目、我的。原型右上角「审阅」可直达 40 个状态。

## 与服务端（H01）的对齐

- **按服务端规则实现**：上传的图纸在提交后才转换，所以上传时第 2 步只选大致范围（各层地面 / 背景墙 / 楼梯踏面），DXF 提交后依次为图纸转换中 → 出图中 → 待审核；其他格式为需协助转换。3D 标注「实时 3D · 以效果图为准」。确认后又调整的，方案页和已确认页提示需重新确认。
- **与服务端不同，待 H02 实现**：调整页多处修改累积后统一出图（[ADR-0010](decisions/0010-client-adjust-batch-rerender.md)），需要新增批量提交修改的接口。
- 调整范围统一称「一层地面」：演示数据里一个地面规格作用于一层全部地面饰面。

## 验证

`node scripts/build-client-h5-v2.mjs` 生成离线单文件；390×844 浅色 40 个状态与深色 12 个关键状态逐页截图检查，1440 与 1100 桌面宽度下为居中的 430px 手机画幅；真实点击走通了提交 → 出图 → 切换方案 → 调整（冲突、撤回、统一出图）→ 确认 → 我的项目 → 分享预览登录弹层，页面无报错。
