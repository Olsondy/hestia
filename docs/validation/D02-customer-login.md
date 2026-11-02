# D02：客户手机号登录与模拟短信

2026-11-02，分支 `feat/d02-customer-login`。只做服务端；在本地独立数据库 `hestia_d02`（PostgreSQL 14.23）验证，未启动 Next、Worker 或 Render Worker，没有页面。

## 取舍：不用 Better Auth 官方 phone-number 插件

已安装的 `better-auth@1.7.12` `plugins/phone-number` 把验证码明文写入 `verification` 表（`${code}:0`），只有框架级按路径限频，不能按手机号与来源限频，也不能在模拟模式把验证码返回给 H5，没有企业入口的概念。因此沿用 `/register` 的做法：在 Better Auth 插件里注册自定义端点，HTTP 管线、同源检查、请求体上限、框架限频和会话（`internalAdapter.createSession` + `setSessionCookie`，PostgreSQL 会话、HttpOnly cookie）都仍由 Better Auth 负责，验证码的存储与限额由应用事务实现。手机号登录后的会话与邮箱密码登录完全相同，`auth.api.getSession` 和所有现有接口无须改动。

## 数据模型（`0016-customer-login.sql`，可重复执行）

- `hestia_auth_user.phone_number`：`+86` + 11 位大陆手机号，部分唯一索引，全平台一个号码一个账号；`email` 改为可空，新增约束 `email` 与 `phone_number` 至少一个非空。手机号账号没有 credential account、不发注册积分、不预先开通个人工作空间。
- `workspace_types.customer_entry`：该类型的工作空间是否有客户入口（数据而非代码分支），`enterprise` 为 true。
- `phone_otp_challenges`：每次发送一行；只存 `code_hash = HMAC-SHA256(BETTER_AUTH_SECRET, challengeId:code)` 和来源的 HMAC，不存原始 IP；记录尝试次数、上限、到期、消费与被新码替代时间，同时作为限频的发送记录。
- `workspace_customers(workspace_id, user_id)`：客户关系，主键保证幂等。它不是成员关系，不进入 `project_access`，没有任何能力接受它；D06/D08 再为项目访问新增 `via`。

## 接口（经 `/api/auth/[...all]`，同源 JSON POST）

| 端点 | 输入 | 成功 |
| --- | --- | --- |
| `POST /api/auth/phone/send-code` | `{phoneNumber, entry}` | `{sent, expiresInSeconds, resendAfterSeconds, maxAttempts}`；仅 `SMS_PROVIDER=mock` 时另含 `demoCode` |
| `POST /api/auth/phone/sign-in` | `{phoneNumber, entry, code}` | 设置会话 cookie，返回 `{user:{id, phoneNumber}, entry:{slug, name}, customer:{created}}` |

`entry` 是 H5 路径里的工作空间 `slug`。手机号接受 `13800138000`、`+86 138 0013 8000` 等写法并统一规范化。错误统一为 `{error:{code, message, details?}}`：

| code | HTTP | 含义 |
| --- | --- | --- |
| `INVALID_INPUT` | 400 | 字段缺失、多余或验证码不是 6 位数字 |
| `INVALID_PHONE` | 400 | 不是大陆手机号 |
| `ENTRY_NOT_FOUND` | 404 | slug 不存在或该类型没有客户入口 |
| `OTP_COOLDOWN` | 429 | 重发冷却中，`details.retryAfterSeconds` |
| `OTP_RATE_LIMITED` | 429 | 窗口内发送次数超限，`details.scope` 为 `phone` 或 `source`，含 `retryAfterSeconds` |
| `OTP_NOT_REQUESTED` | 400 | 没有可用验证码（未获取或已使用） |
| `OTP_INVALID` | 400 | 验证码错误，`details.attemptsRemaining` |
| `OTP_LOCKED` | 429 | 错误次数用尽，此码失效，须重新获取 |
| `OTP_EXPIRED` | 400 | 验证码过期 |
| `SMS_UNAVAILABLE` | 503 | 未配置 `SMS_PROVIDER` |
| `SMS_SEND_FAILED` | 502 | 适配器发送失败（发送记录仍计入限额） |

只接受某号码最新的一条验证码；新发送会让旧码失效。错误尝试在失败响应前提交。同一号码与同一来源用事务级 advisory lock 串行。

## 环境变量（见 `.env.example`）

- `SMS_PROVIDER`：`mock` 不外发，验证码写服务端日志（`sms_mock_sent`）并在响应里返回；未设置时手机号登录不可用；其他值启动失败（尚无真实服务商适配器，接口为 `packages/identity/src/sms.ts` 的 `SmsSender` / `setSmsSender`）。`NODE_ENV=production` 且为 `mock` 时，`packages/identity/src/auth.ts` 模块初始化抛错，`apps/web/instrumentation.ts` 的 `register()` 记录 `startup_configuration_rejected` 后以退出码 1 结束。`pnpm setup:local` 新生成的 `.env` 默认写入 `SMS_PROVIDER=mock`。
- `HESTIA_OTP_TTL_SECONDS`=300、`HESTIA_OTP_MAX_ATTEMPTS`=5、`HESTIA_OTP_RESEND_SECONDS`=60、`HESTIA_OTP_RATE_WINDOW_SECONDS`=3600、`HESTIA_OTP_MAX_PER_PHONE`=5、`HESTIA_OTP_MAX_PER_SOURCE`=20（默认值与 H5 原型一致；非法值启动失败）。
- `HESTIA_OTP_SOURCE_HEADER`：可信代理写入的客户端 IP 头（如 `x-real-ip`）。未设置时所有请求共用一个来源桶，不信任客户端自带的转发头。

## 实际执行的验证

- `pnpm db:migrate`：在 `hestia_d02` 应用 `0016-customer-login.sql`；随后用 `psql -v ON_ERROR_STOP=1 -f` 再次执行同一文件，只有 “already exists, skipping” 提示，无错误。
- `node --env-file=.env --import tsx --test packages/identity/src/phone-login.integration.test.ts`（已加入 `pnpm test:db`）：调用 `/api/auth/[...all]` 与工作空间、项目的 Next 路由处理函数，使用真实 Better Auth 会话和 PostgreSQL，6 项全部通过：
  - mock 发送返回 6 位演示码且服务端日志含该码，数据库行不含明文；正确码登录得到有效会话，`customer.created=true`；已用的码再次提交得 `OTP_NOT_REQUESTED`；换一种写法的同一号码再次登录是同一账号、`created=false`，账号与客户关系各一行。
  - 错误码依次返回 `attemptsRemaining` 4/3/2/1，第 5 次 `OTP_LOCKED`，之后正确码也被拒；过期码 `OTP_EXPIRED`，不创建账号。
  - 立即重发 `OTP_COOLDOWN`；同号码窗口内第 6 次 `OTP_RATE_LIMITED`（`scope=phone`）；把来源上限设为 3 后同一来源第 4 个号码 `OTP_RATE_LIMITED`（`scope=source`），其他来源不受影响。
  - 非 mock 发送器（测试替身）收到验证码，响应不含 `demoCode`，响应正文不含该码，用其收到的码可以登录；未知入口 `ENTRY_NOT_FOUND`、非法号码 `INVALID_PHONE`、无发送器 `SMS_UNAVAILABLE`。
  - 子进程以 `NODE_ENV=production SMS_PROVIDER=mock` 导入身份模块失败并输出拒绝原因；执行 `instrumentation.register()` 退出码 1；开发环境 mock 与生产环境未配置短信均正常启动。
  - 客户访问该企业的工作空间、成员列表、项目列表与成员创建的项目均为 404；`GET /api/workspaces` 不含该企业；`project_access` 中没有该客户的行；成员列表只有管理员，管理员照常读取项目。
- `pnpm check`：通过（原型构建、4 项数据测试、类型检查、82 项核心测试）。
- `pnpm test:db`：133 项中 132 通过；唯一失败仍为 `packages/conversation/src/budget.test.ts` 的 “production admission binds endpoint, model…”（本机无真实 `HESTIA_MODEL_*` 配置），与基线相同。

## 未验证与边界

- 未启动 Next 服务器，`instrumentation.ts` 只在子进程中直接调用 `register()` 验证，未在真实 `next start` 中验证退出行为。
- H5 页面未接入这两个端点；真实短信服务商、微信手机号快速验证、小程序登录不在本票。
- 客户关系目前不授予任何项目访问；客户对项目的访问由 D06/D08 通过新的 `via` 实现。
- 客户调用 `GET /api/workspaces` 或个人 `/api/projects` 时，会像其他账号一样惰性开通个人工作空间（账号全平台唯一，ADR-0007 允许同一人既是客户又有个人工作空间）；手机号账号没有注册积分。
- 未设置 `HESTIA_OTP_SOURCE_HEADER` 时来源限频是全局共享桶，多人同时演示可能较早触发 `scope=source`；没有多实例全局限流以外的额外保证。过期发送记录暂不清理。
