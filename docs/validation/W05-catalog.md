# W05 企业石材库与软装风格目录（只读）验证

日期：2026-11-26。范围：工单 #50。状态：已实现，数据库与浏览器检查通过，待用户确认后关闭工单。

## 实现要点

- **接口** `GET /api/workspaces/{workspaceId}/catalog`（`packages/finish-requests/src/member-catalog.ts`）：只读，仅本企业成员；返回全部石材版本与软装风格版本，下架版本带 `status: 'retired'`。客户与其他企业成员一律 404（与不存在的数据同一回答），未登录 401。
- **软装风格描述**：按房间类型把换款与补充陈设写成一句话（如「L 型沙发、沙发换弧形沙发；添落地灯 ×2、挂画 ×2、绿植」），家具键名的中文名只在 `packages/soft-styles/src/describe.ts` 维护，未登记的键按原样显示；接口不返回布置规则（`swap`、`extras`）。
- **页面** `/w/{企业}/stones`（`apps/web/components/enterprise/workbench-catalog.tsx`）按 P02 原型「石材与软装」：石材卡片含程序生成的示意贴图、名称、表面、可选规格、厚度、版本与在售 / 已下架；软装风格卡片含色块、描述、各房间搭配与版本。目录为空时说明由平台录入。

## 执行结果

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | 通过 |
| `member-catalog.integration.test.ts`（成员可读含下架版本；同企业客户 404；未登录 401） | 通过 |
| M06 隔离矩阵（新路由自动纳入：其他企业成员、客户、匿名均不可读） | 通过 |
| `pnpm test:db` 全量 | 215 / 217；失败的 2 项为已知的数据库主机时钟偏差（`identity.integration.test.ts` 登出与过期会话） |
| 真实浏览器（Windows 主机 ego lite，2026-11-26） | 1440：石材三列、软装三列；1100：两列；均无横向溢出，下架标记、规格、软装各房间描述显示完整。390 不适用：工作台为电脑端（`min-width:1024px`） |
