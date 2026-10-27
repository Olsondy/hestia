# T04：项目持久化与身份隔离验证

2026-10-25，本地 Next.js 应用 `http://127.0.0.1:3000` 与真实 PostgreSQL 的 HTTP 验证通过。没有使用内存数据库或 API 替身；没有真实模型调用、私密图纸或旧原型 localStorage 上传。此记录的 API 部分不替代浏览器视觉与 3D 交互验收。

## HTTP 与数据库证据

执行：

```sh
node --env-file=.env --import tsx scripts/validation/project-api.ts
```

脚本只允许 localhost / 127.0.0.1，创建随机 `example.test` 身份 A/B，通过真实邀请接受、登录 HTTP 响应获取各自 cookie。输出只有场景名称和状态，不输出密码、邀请 token、cookie 或登录响应。完成/失败都按本次随机邮箱找到自己的项目，依次清理资源、修订、操作、项目、邀请及身份，不清空共享库。

12 组通过：

| 场景 | 实际结果 |
| --- | --- |
| 未登录项目 GET/POST | 401；session user=null |
| 普通公开注册 | 400，不创建用户 |
| 邀请 API 请求上限 | 没有 Content-Length 的 73,728 字节流返回 413 |
| 认证 API 请求上限 | 同样的超限流返回 413 |
| 两个邀请身份接受和登录 | 邮箱不可替换；重复接受 400；登录 cookie 为 HttpOnly；会话身份各自独立 |
| 同身份并发重复创建 | 两次 201 返回同一项目；数据库仅一行；重开 GET 与首次场景一致 |
| 操作 ID 隔离与冲突 | 同用户改参数重试 409；另一用户同操作 ID 可创建自己项目 |
| 输入与来源校验 | 伪 ownerId、非法 UUID 400；跨来源 POST 403；项目超限体 413 |
| 跨账号项目读取与修改 | GET/PATCH 均 404；另一身份列表中没有该项目 |
| 重命名与版本竞争 | 保存到 revision=2；同操作重试不加版本；旧版本的新操作 409；重开仍是新名称 |
| 资源预留/读取与隔离 | 仅 pending；同请求重试成功；变更文件类型 409；跨账号预留/读取 404；未登录 401；同账号错误项目 ID 读取/预留既有资源均 404；API 不暴露 object_key |
| 退出会话 | 原 cookie 再访问项目 401，session user=null；另一个身份仍可使用 |

合成 courtyard 明确返回 synthetic=true / scale=synthetic；空白项目返回 synthetic=false / scale=missing。资源测试只预留元数据，不声称已经上传文件或实现 T09 的真实图纸流程。

## 一致性检查与修复

项目与资源 SQL 使用参数绑定；身份只来自服务端 Better Auth session。项目查询绑定 owner_id；资源查询同时绑定 owner、project_id 和 resource_id。输入 Zod strict 拒绝调用者自带 ownerId；错误不包含数据库连接、堆栈或私有 object_key。

创建由事务中的 advisory lock + 操作记录实现幂等；重命名还有项目行锁和 expectedRevision，操作记录与修订一起提交。邀请消费锁、邮箱唯一约束及凭据创建均在事务内，过期和并发已由身份集成测试补充覆盖。

本轮修复了邀请接受直接 `request.json()` 没有字节上限的问题，复用 `apps/web/lib/server.ts` 的实际流计数 parser，64 KiB 后取消读取并返回 413；不依赖可伪造/缺失的 Content-Length。进一步核对 Better Auth Next 适配层只转发 Web Request，JSON 解析没有本路由的限额，因此认证 POST 也经过同样的 64 KiB JSON 边界再交给官方 handler。当前仅邮箱密码 JSON 流程；后续增加 OAuth 或其他内容类型时需重新设计对应输入边界，不能无条件放开。

相关 Next.js 本地指南已读取：`next/dist/docs/01-app/01-getting-started/15-route-handlers.md`、`03-api-reference/03-file-conventions/route.md`。动态 params 使用 Promise；会话/项目响应 no-store，API 不以页面重定向替代授权检查。

根 TypeScript 检查通过。身份集成测试 7 个子场景通过（TAP 含父测试共 8）；HTTP 12 组通过。未发现本次项目/资源路径中的阻断性隔离或事务问题。邀请邮件与密码找回尚未配置；当前限流为 Better Auth 进程内配置，没有可信代理 IP 时使用共享路径桶，不是已验证的跨实例限流。列表当前无分页，后续项目规模扩大需另行处理；这不影响本次邀请试用的隔离验收。

## 浏览器与 3D

最终生产 UI 只保留家居杂志（editorial）；原型中的建筑展馆是历史对比，不属于生产验收要求。UI Agent 在真实本地账号与数据库上验证邀请接受、登录、合成/空白项目创建、项目 URL 重开及 3D。故意丢弃创建成功后的 HTTP 响应，再从 UI 重试，返回同一项目 ID、数据库仅一条记录；旧原型 localStorage 不上传。手机长中文项目名、错误提示、创建对话框焦点/Escape、对象选择、相机保留及 reduced-motion 均有操作记录。

当前证据为 `.impeccable/review/t04/` 下 9 张 editorial 截图：登录、项目刊页、工作台，各包含 1440×1000、1100×900、390×844。截图从页顶、字体与 3D 就绪且动效稳定后采集；fresh reviewer 判定证据有效，主 Agent 另亲看最新桌面与手机。旧 gallery PNG 和旧双主题 packet 仅是历史，不充当本轮证据。

独立 finish reviewer 最终 disposition 为 **ship**，verdict pass 将首轮两项 finding 均评为 **resolved**：短标题桌面分行/后半酒红（手机同行双色）；真实 Canvas 的项目揭示及进入工作台承接转场。该 verdict 的范围是这两项修复的复核和用户最新单风格范围确认，不扩写为对全产品“没有任何问题”的重新认证。

转场复用 850ms 画面承接、700ms 标题与 900ms 导读节奏；镜头目标和观察方向保留，并按新画布比例适配距离。reduced-motion 操作中覆层数和活动动画数均为 0。详细当前 packet 为 `.impeccable/review/t04/fix-verdict-packet.md`；测试截图和账号不进入提交。

## 最小实现决策与进程恢复

- 应用入口为 `apps/web` 的 Next.js 页面与 Route Handlers。HTTP 仅处理可信会话、输入和应用服务；模型执行仍归后续 Worker 工单，本票没有建立请求内模型路径。
- Better Auth 邀请制邮箱密码身份来自服务端 session；项目服务只接受经该入口得到的 Principal，不接受请求中的 ownerId。邀请链接由管理员命令生成，邮件投递和密码找回尚未配置。
- PostgreSQL 保存项目、空间 JSON、修订、幂等操作与资源引用；Drizzle 读取与参数化 SQL 事务共用连接池。创建、修订和操作结果同事务提交，数据库成为事实来源。
- `packages/contracts` 统一米制、x/z 地面坐标与 y 高程、右手 yaw 弧度；固定事实与当前布局分离 ID 和修订，布局显式绑定固定事实版本。候选引用、资源引用及结构化错误已定义；这些 Schema 不等于 T06 候选预览/采用或 T09 上传能力已经完成。
- 项目集成测试加入独立 Node 子进程：新进程建立连接并读取同一完整 ProjectView，与父进程提交后结果相等。主 Agent 执行项目测试 3/3 通过；该证据验证跨进程重开，不冒充整套备份/灾难恢复验收。
- 迁移校验统一 LF，并兼容同内容的旧 CRLF 校验值；Git 固定 SQL 等文本行尾，避免跨平台将同一迁移误认作变更。修复后迁移验证已通过。

## 本地开发入口与当前 UI 边界

根目录使用 `package.json` 固定的 pnpm 与 `pnpm-lock.yaml`；`pnpm setup:local` 保留已有配置，`pnpm db:up` 使用 PostgreSQL 17.7 本地 Compose，随后 `pnpm db:migrate`、`pnpm dev` 启动 3000 端口应用。`scripts/web.mjs` 在父进程加载本地配置再启动 Next，避免将 `--env-file` 经 NODE_OPTIONS 带入 Next 的重新执行流程。`pnpm check`、`pnpm test:db` 与 `pnpm build:web` 分别覆盖核心检查、真实数据库和应用构建；CI 以实际运行结果为准，不因已配置就宣称远端通过。

GitHub 操作继续使用 gh CLI；本机可用安装路径记录在 `docs/agents/issue-tracker.md`。主 Agent 已确认 T04 四项验收全部通过；远端 [#5](https://github.com/Olsondy/hestia/issues/5) 已在全量正文同步完成后按此证据以 completed 关闭，见 [验收评论](https://github.com/Olsondy/hestia/issues/5#issuecomment-6389225582)。

用户最新确认生产仅采用家居杂志（editorial），视觉参考已由用户迁至 `example/prototypes/projects`。原型中的 gallery 保留为历史，不是生产双主题要求。原型真实文件入口为 `example/prototypes/projects/index.html`，旧 `/example/prototypes/` HTTP 路径仅作兼容；本轮最新 editorial UI 已完成上述独立 finish review；此前双主题截图不能替代这轮最终证据。

## Documenter 普通扩展对照

对照 `PRODUCT.md`、`DESIGN.md`、`.impeccable/design.json`、`docs/prototype-brief.md`、保留原型及当前 `apps/web/app/globals.css`、`hestia-app.tsx`、`scene-viewport.tsx`、`scene-transition.ts`。这是已选家居杂志世界的普通扩展：当前生产方向与原型路径已按用户明确决定更新，收尾不再重写 DESIGN token 或 sidecar。

- 色板：继承刊页暖纸 `#f6f1e8`、褐墨 `#352d29`、酒红 `#743c49` 与细分隔线；gallery token 只留作历史。
- 字体：标题、正文与操作采用完整 Tsanger YuYang W01–W05；正文 14px，紧凑标签按原型分层，标题在桌面与手机适配。
- 布局：桌面约四分之一导读与四分之三实时空间、底部横向项目轨道；手机导读/画布/面板纵向排列，侧向轨道可滚动。
- 组件：延续直角刊页、小圆角控件、酒红动作、可见焦点与原生 dialog；页面只呈现本票真实能力。
- 动效：保留真实场景揭示、镜头承接与 reduced-motion 分支，符合 Editorial Production Rule、Shared Action Rule 与 Canvas Layer Rule。

未规范化的漂移：首轮 detector 的 33 项 advisory（颜色、字号、圆角）属于当时构建与既有侧车的对照记录；最终修复后未重复运行 detector，不将旧计数当作当前完整扫描，也不为消除提示反向修改设计规范。旧原型记录的字号、布局和双主题条目仍按历史适用范围保留，不升格为生产双主题要求。

## 本地验收结论

主 Agent 最终运行 `pnpm check` 通过（4 项原型数据测试、30 项核心测试及类型检查），`pnpm build:web` 通过；真实数据库合计 11 项 TAP、HTTP 12 组通过，项目 3/3 测试包含跨 Node 进程重开。四项 T04 验收——共享契约及最小入口、UI→持久化→3D 重开、身份/资源直接越权拒绝、合成标注与创建重试幂等——均有对应证据。

以上为当前工作区的本地验收；代码尚未提交或推送，远端 CI 未据此宣称通过。此结论不包含真实模型/图纸评估、候选采用、家具修改、文件上传、邮件找回或生产部署，首版完整流程仍未完成。
