# 企业工作台：线索、审核与分享管理

依据 [ADR-0007](../../decisions/0007-shared-core-personal-and-enterprise-workspaces.md)，在通用工作台中实现企业成员的电脑端界面：线索与跟进、审核发布、预置方案与分享、绑定审批、石材库。视觉依据 B 版（家居杂志，`example/prototypes/projects` 设计方向对比页右侧）。客户端 H5 见 [石材硬装 H5 演示](../stone-demo/README.md)。

| 规格/能力 | 本地规格 | 阻塞 | GitHub |
| --- | --- | --- | --- |
| 总规格 | [spec.md](spec.md) | — | [#42](https://github.com/Olsondy/hestia/issues/42) |
| S01：图纸需求先生成待审方案 | [S01.md](S01.md) | 无 | [#43](https://github.com/Olsondy/hestia/issues/43) |
| S02：线索跟进状态与内部备注 | [S02.md](S02.md) | 无 | [#44](https://github.com/Olsondy/hestia/issues/44) |
| P02：企业工作台交互原型（需用户审阅） | [P02.md](P02.md) | 无 | [#45](https://github.com/Olsondy/hestia/issues/45) |
| W01：工作台入口与成员登录 | [W01.md](W01.md) | P02 获批 | [#46](https://github.com/Olsondy/hestia/issues/46) |
| W02：线索列表与详情 | [W02.md](W02.md) | P02, W01, S02 | [#47](https://github.com/Olsondy/hestia/issues/47) |
| W03：审核发布与辅助转换 | [W03.md](W03.md) | W02, S01 | [#48](https://github.com/Olsondy/hestia/issues/48) |
| W04：预置方案、分享与绑定管理 | [W04.md](W04.md) | W02 | [#49](https://github.com/Olsondy/hestia/issues/49) |
| W05：企业石材库（只读） | [W05.md](W05.md) | W01 | [#50](https://github.com/Olsondy/hestia/issues/50) |
| W06：工作台演示数据与联合验收 | [W06.md](W06.md) | W03, W04, W05 | [#51](https://github.com/Olsondy/hestia/issues/51) |

## 顺序

- 初始前沿：S01、S02（服务端）与 P02（原型）互不依赖。
- P02 经用户审阅通过后开始 W01（开始实现时通知用户），随后 W02；W03 另需 S01，W02 另需 S02；W04、W05 在 W02 / W01 之后。
- 最后 W06 扩展演示数据并联合验收。

2026-11-03 已发布：#42 为总规格，#43–#51 为其原生子工单，阻塞关系与 `ready-for-agent` 标签已读回核验，见 [发布清单](published-issues.json)。发布工单不表示功能已实现。
