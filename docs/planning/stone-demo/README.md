# 石材硬装 H5 可行性演示

依据 [ADR-0007](../../decisions/0007-shared-core-personal-and-enterprise-workspaces.md)，为石材硬装企业准备一次可离线的 H5 客户端演示：客户自助提交需求得到铺贴方案，以及打开企业成员预置的分享链接完成预览、绑定与确认。企业成员工作台本次不实现、不演示。

| 规格/能力 | 本地规格 | 阻塞 | GitHub |
| --- | --- | --- | --- |
| 总规格 | [spec.md](spec.md) | — | [#29](https://github.com/Olsondy/hestia/issues/29) |
| D01：工作空间与项目归属 | [D01.md](D01.md) | 无 | [#30](https://github.com/Olsondy/hestia/issues/30) |
| D02：客户手机号登录与模拟短信 | [D02.md](D02.md) | D01 | [#32](https://github.com/Olsondy/hestia/issues/32) |
| D03：多楼层空间与示例别墅 | [D03.md](D03.md) | 无 | [#31](https://github.com/Olsondy/hestia/issues/31) |
| D04：饰面与石材铺贴方案 | [D04.md](D04.md) | D03 | [#33](https://github.com/Olsondy/hestia/issues/33) |
| D05：DXF 图纸导入与辅助转换 | [D05.md](D05.md) | D03, D01 | [#34](https://github.com/Olsondy/hestia/issues/34) |
| D06：客户提交方案需求并获得方案 | [D06.md](D06.md) | D02, D04, D05 | [#35](https://github.com/Olsondy/hestia/issues/35) |
| D07：客户选项式调整与确认 | [D07.md](D07.md) | D06 | [#36](https://github.com/Olsondy/hestia/issues/36) |
| D08：分享链接预览与绑定 | [D08.md](D08.md) | D02, D07 | [#37](https://github.com/Olsondy/hestia/issues/37) |
| P01：H5 客户端交互原型（需用户审阅） | [P01.md](P01.md) | 无 | [#38](https://github.com/Olsondy/hestia/issues/38) |
| H01：H5 客户端实现 | [H01.md](H01.md) | P01 获批, D02, D05, D06, D07, D08 | [#39](https://github.com/Olsondy/hestia/issues/39) |
| D09：离线演示数据与验收 | [D09.md](D09.md) | H01 | [#40](https://github.com/Olsondy/hestia/issues/40) |

## 并行顺序

- 初始前沿：D01（工作空间）与 D03（多楼层）互不依赖，可以并行。
- D01 之后 D02（手机号登录）；D03 之后 D04（饰面铺贴）与 D05（DXF 导入，另需 D01）。
- D02、D04、D05 汇合到 D06（提交与出方案）→ D07（调整与确认）→ D08（分享与绑定）。D01–D08 只交付服务端，以接口和后台任务验收。
- P01（H5 原型）与服务端并行，用户审阅通过后才可开始 H01；开始 H01 时通知用户。
- H01 汇合原型与服务端后实现 H5，最后 D09 完成离线演示验收。

2026-10-28 已发布：#29 为总规格，#30–#40 为其原生子工单，阻塞关系与 `ready-for-agent` 标签已读回核验，见 [发布清单](published-issues.json)。本规格不挂在 V1 总规格 #1 下。发布工单不表示功能已实现，也没有启动服务或变更数据库。
