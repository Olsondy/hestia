# C01：开放注册与首次积分赠送

2026-10-28。开放注册、一次赠送、游客示例、浏览器与独立复核均通过，主 Agent 已完成本地验收。

## 注册与积分

`POST /api/register` 接受严格的邮箱、名称和密码，经过同源与请求体上限，再进入 Better Auth 插件的 HTTP 路径和 `/register` 限流。Better Auth 的原生 sign-up 保持关闭，避免绕开应用的发放事务；原有 sign-in、会话、邀请与项目保留。接口对新旧邮箱均返回中性 `{registered:true}`，不揭示邮箱是否已存在；前端随后使用 `/api/auth/sign-in/email` 进行真实登录。注册响应丢失可同邮箱重试或直接登录，不改变已有账号密码。

新用户、官方 `better-auth/crypto` 密码哈希、credential account、credit_accounts 余额与 registration_grant 流水在同一 PostgreSQL 事务提交；同邮箱并发请求通过事务锁串行，数据库唯一约束防止重复身份或重复赠送。C01 后通过有效邀请创建的新账号也在邀请事务内获得一次赠送。与邀请消费发生竞争时若邀请先建立身份，注册事务整体回滚并返回同样中性响应，不重复赠送；已经存在的历史身份不补发。配置无效或不存在时事务回滚，不留下只创建账号而无赠送的中间状态。

`0013-registration-credits.sql` 初始化单行 `credit_rules`：新用户赠送40，问答1、小改5、整套设计20，均为试用占位。发放值与流水在当次事务固定，后续配置修改不追溯余额。注册服务二次核对赠送配置；数据库限制赠送为0–1000000整数、价格为1–1000000整数。维护SQL和说明见 `packages/credits/README.md`，没有公开配置写入口或管理后台。

`GET /api/credits` 根据 session 的实际 userId 返回 `{balance:{available,reserved},entries:[{id,kind,amount,createdAt}]}`，不以请求中的 userId 指定账户；未登录401，其他账号不能读取他人的余额与流水。历史邀请账号没有账户时只读展示0和空流水，不创建记录、不发奖励。C01 不实现 AI 任务积分预留、扣除或退款，交 C02 处理。

## 验证进度与边界

- 现有 PostgreSQL 已应用0013，未启动或重启服务；`pnpm exec tsc --noEmit` 通过。
- 原邀请与 Better Auth 身份数据库集成测试 8/8 通过；历史原生 sign-up 禁用断言保留是防绕过，不表示 `/api/register` 不开放。
- `node --env-file=.env --import tsx --test packages/credits/src/registration.integration.test.ts`：最终 **5/5** 通过。现有 Next HTTP/真实 PG 验证三次并发注册同一邮箱只创建一身份/一条40分流水、响应重试不重复、登录、余额与项目账号隔离；旧身份不补赠、新邀请身份获赠；配置修改事务不追溯已有余额，非法配置和不存在配置回滚；公开注册和邀请接受同邮箱竞争仍只产生一个身份和一次赠送。该测试要求已有 Next 与 PostgreSQL，列为独立 `pnpm validate:credits-api`，不加入只要求数据库的 `pnpm test:db`。
- 验收早期两项修复：Better Auth 插件内部返回200，包装路由统一公开201；测试误选 `credit_accounts.id` 已改为 `user_id`。后续重复登录遇到既有限流共享路径桶429，未更改或绕过限流，等待窗口恢复后最终整轮通过。由于本地没有可信代理 IP，Better Auth 使用共享路径桶；生产可信代理配置需在部署设计中处理，不信任客户端伪造 IP。
- 所有身份使用随机 example.test 地址，清理仅限本次测试用户及项目；不读取住宅资料、不调用模型。完整游客无匿名记录和页面表现由浏览器验收核对。

## 最终验收（2026-10-28）

`pnpm check`通过：4项原型、68项核心、根/Web/Worker类型；`pnpm test:db`125/125通过。`pnpm validate:credits-api` 在既有Next/PostgreSQL复验5/5，覆盖并发、账户隔离、邀请竞争、配置与回滚。独立后端源码审查未发现具体阻断。

真实浏览器有限脚本已验证游客合成示例、注册响应丢失重试且只赠一次、登录/刷新、项目创建重开与跨标签账号切换隔离；8张桌面和移动截图均已独立复核，Impeccable Finish Reviewer结论ship，Documenter No changes。页面证据位于`.impeccable/review/c01/`。

C01仅建立注册赠送、余额与记录基础；AI任务积分扣除、取消与退款属于尚未完成的C02。试用积分数字不是实际成本定价。未启动或重启服务、未读取真实住宅数据；代码尚未提交或推送。
