# 模型管理：平台管理员登记模型，按企业分配额度并计量

依据 [ADR-0018](../../decisions/0018-admin-managed-models-per-enterprise-quota.md)：模型不写死在代码或部署配置里；平台管理员登记模型与密钥并分配给企业，企业按月度额度使用，成员在 Agent 交互处选择模型，用量按调用计量并折算金额。

| 规格/能力 | 本地规格 | 阻塞 | GitHub |
| --- | --- | --- | --- |
| 总规格 | [spec.md](spec.md) | — | [#65](https://github.com/Olsondy/hestia/issues/65) |
| AM-P：模型管理界面交互原型（已审阅通过） | [AM-P.md](AM-P.md) | 无 | [#66](https://github.com/Olsondy/hestia/issues/66) |
| AM01：平台管理员角色与管理后台入口 | [AM01.md](AM01.md) | 无（界面部分：AM-P） | [#67](https://github.com/Olsondy/hestia/issues/67) |
| AM02：模型登记、加密密钥与接入检查 | [AM02.md](AM02.md) | AM01（界面部分：AM-P） | [#68](https://github.com/Olsondy/hestia/issues/68) |
| AM03：企业模型分配、月度额度与并发上限 | [AM03.md](AM03.md) | AM02（界面部分：AM-P） | [#69](https://github.com/Olsondy/hestia/issues/69) |
| AM04：调用级用量记录与统计页面 | [AM04.md](AM04.md) | AM02（界面部分：AM-P） | [#70](https://github.com/Olsondy/hestia/issues/70) |
| AM06：超级管理员只读进入企业工作台 | [AM06.md](AM06.md) | AM01（界面部分：AM-P） | [#72](https://github.com/Olsondy/hestia/issues/72) |
| AM05：Agent 交互处选择模型，运行时改读模型登记 | [AM05.md](AM05.md) | AM03（界面部分：AM-P） | [#71](https://github.com/Olsondy/hestia/issues/71) |

## 顺序

- AM-P 原型先行，用户审阅定稿后各工单的界面部分才开始；数据表、接口、权限、加密、协议适配、额度与计量不等原型，用接口测试验收。
- AM01 → AM02 → AM03 / AM04（可并行）→ AM05；AM06（2026-11-14 从 AM01 拆出，#72）只等 AM01。
- 企业 Agent（K03 #54、W07 #56）在 AM05 之后接入：任务绑定所选模型，调用经额度预占与用量记录。
- 接入检查与 AM05 的真实调用需要管理员录入一个真实模型；未录入前这些用例记为未验证，不用模拟结果代替。

2026-11-14 发布 #65–#71：子工单、阻塞关系与 `ready-for-agent` 标签已读回核验，见 [发布清单](published-issues.json)。AM-P/#66 经用户审阅通过后关闭。发布工单不表示功能已实现。
