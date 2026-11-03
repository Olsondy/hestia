# 企业工作台：线索、Agent 出整体方案、审核与分享

依据 [ADR-0007](../../decisions/0007-shared-core-personal-and-enterprise-workspaces.md) 与 [ADR-0008](../../decisions/0008-one-stop-home-furnishing-hard-and-soft.md)，为一站式家装企业实现成员的电脑端工作台：线索与跟进、Agent 辅助出整体方案（硬装 + 软装）、审核发布、预置方案与分享、绑定审批、石材与软装风格目录；客户端补充软装风格切换。视觉依据 [Web 工作台 UI 设计规则](../../design/WEB_UI_DESIGN.md) 与 [H5 UI 设计规则](../../design/H5_UI_DESIGN.md)（柔和中性，ADR-0011；原定的家居杂志 B 版已被覆盖）。客户端 H5 见 [家装 H5 演示](../stone-demo/README.md)。

| 规格/能力 | 本地规格 | 阻塞 | GitHub |
| --- | --- | --- | --- |
| 总规格 | [spec.md](spec.md) | — | [#42](https://github.com/Olsondy/hestia/issues/42) |
| S01：图纸需求先生成待审方案 | [S01.md](S01.md) | 无 | [#43](https://github.com/Olsondy/hestia/issues/43) |
| S02：线索跟进状态与内部备注 | [S02.md](S02.md) | 无 | [#44](https://github.com/Olsondy/hestia/issues/44) |
| K01：软装风格目录、家具素材与多楼层布局 | [K01.md](K01.md) | 无 | [#52](https://github.com/Olsondy/hestia/issues/52) |
| K02：整体方案：硬装 + 软装，客户切换软装风格 | [K02.md](K02.md) | K01 | [#53](https://github.com/Olsondy/hestia/issues/53) |
| K03：Agent 接入企业工作空间 | [K03.md](K03.md) | K01 | [#54](https://github.com/Olsondy/hestia/issues/54) |
| P02：企业工作台交互原型（需用户审阅） | [P02.md](P02.md) | 无 | [#45](https://github.com/Olsondy/hestia/issues/45) |
| P03：H5 原型补充软装风格（需用户审阅） | [P03.md](P03.md) | 无 | [#55](https://github.com/Olsondy/hestia/issues/55) |
| W01：工作台入口与成员登录 | [W01.md](W01.md) | P02 | [#46](https://github.com/Olsondy/hestia/issues/46) |
| W02：线索列表与详情 | [W02.md](W02.md) | P02, W01, S02 | [#47](https://github.com/Olsondy/hestia/issues/47) |
| W03：审核发布与辅助转换 | [W03.md](W03.md) | W02, S01 | [#48](https://github.com/Olsondy/hestia/issues/48) |
| W04：预置方案、分享与绑定管理 | [W04.md](W04.md) | W02 | [#49](https://github.com/Olsondy/hestia/issues/49) |
| W05：石材库与软装风格目录（只读） | [W05.md](W05.md) | W01, K01 | [#50](https://github.com/Olsondy/hestia/issues/50) |
| W07：工作台 Agent 出方案界面 | [W07.md](W07.md) | P02, W02, K03 | [#56](https://github.com/Olsondy/hestia/issues/56) |
| H02：H5 客户端软装风格切换 | [H02.md](H02.md) | P03, K02 | [#57](https://github.com/Olsondy/hestia/issues/57) |
| W06：工作台演示数据与联合验收 | [W06.md](W06.md) | W03, W04, W05, W07, H02 | [#51](https://github.com/Olsondy/hestia/issues/51) |

## 顺序

- 初始前沿：服务端 S01、S02、K01 与原型 P02、P03 互不依赖。K01 之后 K02（整体方案与客户切换风格）、K03（Agent）。
- P02 经用户审阅通过后开始 W01（开始实现时通知用户）→ W02 → W03 / W04 / W07；W05 另需 K01。
- P03 经用户审阅通过且 K02 完成后开始 H02（开始实现时通知用户）。
- 最后 W06 扩展演示数据并联合验收（Agent 演示需联网，另备预先出好的方案）。

2026-11-03 发布 #42–#51，同日按 ADR-0008 扩展为整体方案与 Agent，新增 #52–#57；阻塞关系与 `ready-for-agent` 标签已读回核验，见 [发布清单](published-issues.json)。发布工单不表示功能已实现。
