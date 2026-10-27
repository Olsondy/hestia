# 注册积分基础

C01 初始化 `credit_rules` 单行配置为注册赠送 40、问答 1、小改 5、整套设计 20。数值为可调整试用基准；C01 只记录注册赠送，不实现 AI 工作扣分、预留或退款（C02）。服务端注册事务按当前配置发放，账本每账号的 `registration_grant` 唯一，账号余额与赠送流水和身份一起提交；新增邀请账号同样获赠，已经存在的历史账号不会自动补发。

维护者可在已授权的数据库连接中用事务调整规则，例如：

```sql
BEGIN;
UPDATE credit_rules
SET registration_grant = 40, qa_cost = 1, edit_cost = 5, design_cost = 20,
    updated_at = clock_timestamp()
WHERE singleton = true;
COMMIT;
```

数据库约束要求赠送为 0–1000000 的整数、三类工作价格为 1–1000000 的整数；服务端注册前也会验证赠送配置。变更只影响之后新注册的账号，不追溯修改已发余额或流水。用户没有配置或余额写入 API；`GET /api/credits` 只读当前登录用户的 `balance.available`、`balance.reserved` 和最近 100 条流水。

注册端点接收 `{email,name,password}`，返回中性 `{registered:true}`；调用现有登录接口后获得 session。真实身份和积分由数据库保管，浏览器不决定赠送量。所有验证使用合成账号并只清理本次创建的记录。
