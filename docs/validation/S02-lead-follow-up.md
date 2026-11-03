# S02 线索跟进状态与内部备注验证

日期：2026-11-03。范围：工单 #44。本机 PostgreSQL（127.0.0.1:54329），HTTP 路由处理函数直接调用。

## 实现要点

- **数据**：迁移 `0002_lead_follow_up`：`finish_requests.follow_status`（新线索 `new`、已联系 `contacted`、跟进中 `active`、已成交 `won`、已搁置 `parked`，默认 `new`）；`lead_follow_events` 只追加，记录状态变更（`kind = status`）与内部备注（`kind = note`，1–500 字），带操作成员与时间，约束在数据库里。
- **接口**（仅本企业成员）：`POST /api/workspaces/{id}/leads/{requestId}/follow` `{ operationId, status }`；`POST …/notes` `{ operationId, note }`；均返回该线索。同一 `operationId` 重试不重复，换内容复用则 409；设成当前状态不产生记录。客户、其他企业成员得到 404，未登录 401。
- **线索视图**：`LeadView` 增加 `follow`（当前状态、状态历史、备注，含成员名字）、`contactRequested` 与 `lastCustomerAction`（提交、确认、留言、请求联系、绑定申请中最近的一次及时间）。`GET …/leads` 支持 `?status=`、`?follow=`、`?contact=1`：跟进状态与联系请求在查询里过滤；需求状态（图纸需求取决于转换结果）在生成视图后过滤，列表仍是最新的 200 条。
- **不外泄**：客户端接口与分享预览使用客户视图，不含跟进字段；测试检查返回内容里没有备注原文和 `follow` 字段。
- **工作台「今日」**：请求联系一栏只列跟进状态仍为“新线索”的线索（与原型一致），成员把线索改为已联系等状态后即移出。
- `CONTEXT.md` 增加“线索跟进”。

## 执行结果

| 检查 | 结果 |
| --- | --- |
| `follow-up.integration.test.ts` | 3/3 通过 |
| `pnpm check` | 通过，核心测试 95 项 |
| `pnpm test:db` | 158/159；唯一失败为 `conversation/budget.test.ts` 的生产准入测试，未改动的 main 上同样失败 |

断言：设置状态与历史（谁、何时），同操作重试无重复、换内容 409、相同状态不记录、非法状态 400；备注去首尾空白、按时间追加，空白与超过 500 字 400，重试无重复；客户（已绑定该线索）、其他企业成员 404，未登录 401，三者都不能读线索列表；客户的需求详情、需求列表与分享预览都不含备注和跟进字段；按跟进状态、联系请求、需求状态及组合筛选正确，非法筛选值 400；`contactRequested` 与最近客户动作（请求联系）正确，成员预置且无客户动作的线索为空。
