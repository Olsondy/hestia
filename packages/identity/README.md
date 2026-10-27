# 邮箱密码身份与注册

Better Auth 1.7.12 + Drizzle 0.45.4 + PostgreSQL。开放注册使用 `POST /api/register` 的受控事务入口，原生 `/api/auth/sign-up/email` 保持禁用，避免绕过赠送事务。管理员仍可通过本地 CLI 创建邮箱绑定、限时、一次性邀请；既有账号与项目不变。注册或接受邀请后均使用 Better Auth `/api/auth/sign-in/email` 登录；项目 API 必须在服务端校验 `auth.api.getSession` 返回的身份，不能只判断 cookie 存在。

C01 注册输入严格为 `{email,name,password}`；用户、credential account、账户余额和一次性赠送流水在同一事务提交。公开路由由 Better Auth 插件管线执行并使用注册路径限流、同源及请求体限制。重复已存在邮箱均返回相同中性结果，登录时验证凭据；掉线后可重试或登录。历史账号不自动补发。积分配置维护见 [credits README](../../packages/credits/README.md)。游客示例与页面验收仍以 C01 工单状态为准。

```sh
node --env-file=.env --import tsx scripts/migrate.ts
node --env-file=.env --import tsx scripts/invite.ts person@example.com
node --env-file=.env --import tsx --test packages/identity/src/identity.integration.test.ts
```

CLI 的第二个参数是有效小时数，默认 24，最大 720。它显示邀请链接，**没有发送邮件**；链接应由管理员发给邀请对象。数据库只存 token SHA-256，原始 32 字节随机 token 只返回给 CLI。接口 `POST /api/invitations/accept` 接收 `{token,name,password}`，不接受 email 覆盖，成功返回 `{ok:true,email}`；不自动登录。

邀请消费、用户与 credential account 创建在一个 PostgreSQL 事务中，锁定邀请并在密码哈希后复核到期时间；邮箱唯一约束应对不同邀请竞争。使用官方 `better-auth/crypto` 的 `hashPassword`，对应供应商源码中的 credential / accountId=userId 结构。邀请不是邮箱验证，因此 `emailVerified=false`；当前邀请试用允许未验证邮箱登录。SMTP、密码重置邮件尚未配置，不提供伪成功界面。

会话存 PostgreSQL，7 天有效期，默认 HttpOnly cookie，关闭 cookie 缓存，退出及到期后的数据库状态立即参与校验。认证与邀请 POST 共用实际流计数的 64 KiB JSON 上限和同源检查；转发到官方认证 handler 后仍保留 cookie 响应。当前仅支持邮箱密码 JSON，不隐含 OAuth form 接入。Better Auth 自带限流开启；当前没有部署层可信代理 IP 配置，无可识别 IP 时使用共享路径桶，不能宣称已有多实例全局限流。不要为消除告警盲目信任客户端传入的转发头。

2026-10-25 在本地 PostgreSQL 实测 7 个子场景通过：禁止注册、哈希保存与重复消费、过期、同邀请并发、不同邀请同邮箱竞争与回滚、两身份登录/错误密码/退出/会话到期、accept 接口来源与邮箱覆盖拒绝。测试用随机 example.test 身份，结束仅删除本次创建的身份和邀请；没有清空共享库。

依据：[Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)、[Email/password](https://better-auth.com/docs/authentication/email-password)、[Next.js 路由集成](https://better-auth.com/docs/integrations/next)，同时核对实际安装的 `api/routes/sign-up.mjs` 与加密导出。版本升级需重跑真实数据库集成测试。
