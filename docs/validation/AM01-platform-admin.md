# AM01 平台管理员、超级管理员与管理后台入口验证

日期：2026-11-14。范围：工单 #67，依据 ADR-0018 及其 2026-11-12 补充。PostgreSQL 17.7（局域网主机上的本地 Compose 容器，经 SSH 隧道映射到 127.0.0.1:54329），HTTP 路由处理函数与 `proxy` 函数直接调用。

## 实现要点

- **数据**：迁移 `0008_platform_admins`：`platform_admins(user_id 主键 → hestia_auth_user, level platform|super, granted_at, granted_via)`、`platform_audit(at, actor_user_id, actor, action, target, detail)`，审计只追加。
- **命令**：`pnpm platform:admin grant [--super] <email> | revoke <email> | list`。只按邮箱授予已有账号；重复授予不变，换级别会更新；授予与撤销都写审计（操作者“server command”）。
- **后台域名**：`HESTIA_ADMIN_HOST` 是唯一响应 `/admin` 与 `/api/admin/*` 的域名；未设置时这套部署没有后台。它的上一级视为我方主域名：后台域名、主域名本身，以及主域名下的 `admin`、`www`、`api`、`static`、`mail` 不能登记给企业（`RESERVED_HOST`）；企业自有域名下的 `www` 不受影响。
- **三层把关**：`apps/web/proxy.ts` 在后台域名以外把 `/admin`、`/api/admin` 改写到不存在的路径（标准 404，与任何不存在的地址相同），在后台域名上只放行后台、登录接口与静态资源，其余重定向到 `/admin`；页面再用 `notFound()` 检查；每个接口经 `requirePlatformAdmin` 在服务端查角色（每次请求读库，撤销即刻生效）。
- **来源校验**：写操作的来源校验接受后台域名，但只在请求本身发到后台域名时。
- **后台外壳**：`/admin/…`，沿用工作台视觉；邮箱登录、非平台管理员提示、页头四项导航（模型服务 / 企业 / 用量 / 审计记录）与只读审计列表；前三项为占位，由 AM02–AM04 接入。
- 超级管理员只读进入企业工作台拆为 AM06（#72）。

## 执行结果

| 检查 | 结果 |
| --- | --- |
| `packages/platform-admin/src/admin.integration.test.ts` | 6/6 通过 |
| `pnpm check` | 通过，核心测试 103 项 |
| `pnpm test:db` | 188/189；唯一失败为 `conversation/budget.test.ts` 的生产准入测试，改动前的基线同样失败（S02 起已记录，按 ADR-0018 在 AM05 改写） |

断言：后台域名大小写与端口规范化；企业域名、主域名、`www.` 与 `localhost` 都不是后台请求。保留域名登记被拒，企业自有 `www.` 域名与 `admin-…` 前缀可登记。授予幂等、可升为超级管理员、未知邮箱 404，审计按时间倒序记录级别变化。会话接口：平台管理员在后台域名 200，企业域名、主域名与其他域名 404，未登录 401，企业管理员 403（审计接口同样 403）；撤销后同一会话立即 403，审计记下撤销。来源：后台域名来源只在请求发到后台域名时被接受。代理：三条后台路径在企业域名上改写为 404、在后台域名放行；后台域名上的 `/`、`/w`、`/c/…`、`/api/workspaces` 重定向到 `/admin`，登录接口与字体放行；企业域名的 `/w` 不受影响。

## 未验证

- 后台外壳的浏览器检查（登录、无权限提示、导航与审计列表，1440）未做：浏览器自动化需用户同意。
- 正式后台域名、证书与代理转发头的实际配置随部署另行验证。
