# 共享托管：多家企业共用一套服务，账号按企业隔离

依据 [ADR-0017](../../decisions/0017-shared-hosting-tenant-isolated-accounts.md)：我方运营一套服务，甲方企业只负责小程序；企业按工作空间在数据层隔离，账号按企业隔离。

| 规格/能力 | 本地规格 | 阻塞 | GitHub |
| --- | --- | --- | --- |
| 总规格 | [spec.md](spec.md) | — | [#58](https://github.com/Olsondy/hestia/issues/58) |
| M01：按域名接入企业工作空间 | [M01.md](M01.md) | 无 | [#59](https://github.com/Olsondy/hestia/issues/59) |
| M02：账号按企业工作空间隔离 | [M02.md](M02.md) | M01 | [#60](https://github.com/Olsondy/hestia/issues/60) |
| M03：后台队列按企业限流与用量报告 | [M03.md](M03.md) | 无 | [#61](https://github.com/Olsondy/hestia/issues/61) |
| M04：私有文件按企业分目录，企业数据导出与删除 | [M04.md](M04.md) | M02 | [#62](https://github.com/Olsondy/hestia/issues/62) |
| M05：小程序登录：原生壳换票据进入 H5 | [M05.md](M05.md) | M01, M02 | [#63](https://github.com/Olsondy/hestia/issues/63) |
| M06：跨企业隔离测试矩阵与两企业联合验收 | [M06.md](M06.md) | M01–M05 | [#64](https://github.com/Olsondy/hestia/issues/64) |

## 顺序

- 初始前沿：M01 与 M03 互不依赖，可并行。
- M01 → M02 → M04；M05 需要 M01、M02；M06 最后联合验收。
- M05 的真实微信接口验证需要甲方提供 AppID 与测试环境，未提供前记为未验证。

2026-11-10 发布 #58–#64，子工单与阻塞关系、`ready-for-agent` 标签已读回核验，见 [发布清单](published-issues.json)。发布工单不表示功能已实现。
