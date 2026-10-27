# T05：单件家具精确修改与撤销

2026-10-25：领域执行器、PostgreSQL 事务与 HTTP 路径已实现并实测；本记录先覆盖后端，UI/3D 由主 Agent 补充验收。未关闭工单。所有测试使用合成空间和随机测试身份，没有调用模型或读取私密图纸。

## 已实现的公开契约

`POST /api/projects/:id/commands`：

```json
{
  "operationId": "UUID",
  "expectedRevision": 1,
  "command": { "type": "move-furniture", "objectId": "sofa-a", "x": 4, "z": 1.2, "yaw": 0.1 }
}
```

另支持 `set-lock {objectId,locked}` 与 `undo {targetOperationId}`。返回 `{project,operation}`，其中 project 是当前持久化修订，operation 含 `id,type,objectId,revision,undoable,createdAt`，撤销还含 targetOperationId。`GET` 同路径返回最近 20 条安全摘要 `{operations}`，不暴露原始数据库 before/after 值或 owner_id。幂等重试若发生在后续提交之后，返回**当前** project 及原操作 revision，不重新执行旧命令；两部分在一致数据库快照内读取。

x/z 使用米，yaw 使用绕 +y 的右手弧度；坐标范围 ±1000m，新移动命令朝向 ±2π。已有场景与撤销的 pose 允许任意有限 yaw，与 scene 契约一致；撤销恢复原始值，不因多圈等价朝向而拒绝合法旧状态。命令不能修改 y、尺寸、资产、固定事实、尺度、门型或 owner。服务对固定设施的移动及解锁均拒绝。`currentLayout.lockedObjectIds` 默认 [] 并必须引用当前家具；ProjectView 返回同名数组。

`fixedFacts.openingClearances` 默认 []，只能随固定事实建立。`kind:none` 是明确无需门扇区的事实，不能从模型默认推断；`kind:swing` 必须完整提供 hinge=start/end、side=±1、angle∈(0,π]，并引用存在且 sill≤1mm 的唯一落地开口。side 以墙 a→b 的 x/z 平面左侧为 +1，铰链在 end 时自动反向计算扫角。新建合成样本含明确合成门扇信息；旧数据缺省保持未知，不擅自补成真实确认。

## 几何与误差边界

`packages/geometry` 为纯函数，无渲染器、网络或数据库依赖；只使用共享数据契约和 polygon-clipping 0.15.7。家具是按资产尺寸形成的旋转长方体；墙体按中线厚度形成实体，按洞口水平位置与 [sill,head] 高程分段。检测使用实际 y 区间，不能将窗台、过梁当作空洞，也不将高窗误当门。

- 所有房间做多边形 union，再计算家具占地的 difference；包含凹口及 union 内孔，不能只检查中心或四角。退化、自相交和缺边界输入直接拒绝。
- 家具局部矩形每条边向内缩 **1mm** 后参与边界/碰撞检查；面积差≤**1e-8 m²** 视为数值噪声。宽/深≤2mm 不适用，明确拒绝，避免缩成空轮廓。此容差不是图纸测量或施工精度承诺。
- 固定物体及其他家具按旋转占地和高程相交检测；竖向重叠≤1mm 视为接触，不算相撞。
- 已知门扇区使用外包圆弧多边形，外包误差≤**0.5mm**，不会因内接弦漏掉圆弧区域。门扇高度来自实际落地开口 head。
- 未知落地开口仅在附近限制：使用两端潜在铰点、开口宽度半径的双圆保守包络，报告 `DOOR_CLEARANCE_UNKNOWN`，不冒充实测门扇冲突。远离未知开口时可继续编辑，同时检查结果保留 not-checked。已知无需门扇区可明确设 none。
- 精确摆放仅接受 calibrated / synthetic 尺度；synthetic 必须同时保留 synthetic=true。missing/estimated 返回 `SCALE_UNCONFIRMED`，不输出可放置结论；后续概念草稿流程不能绕过此限制冒充精确校验。

错误 `details.issues` 含 code、目标 objectId、相关墙/家具/开口 relatedObjectId 和说明；另有 passed/failed/not-applicable/not-checked 的检查项。几何库异常也拒绝采用，不静默通过。

当前只校验最终摆放，不模拟搬运路径；没有实现人体使用净空、施工结构安全、真实资产网格碰撞、跨层空间、物体俯仰/翻滚或房间高度推断。固定物体/家具以当前契约的长方体包围尺寸为准。

## 原子性与撤销语义

手动 UI 与未来 Worker 共用 `packages/commands/src/service.ts`。每次新操作先绑定服务端身份，按项目 owner 查询，再通过 operation advisory lock + 项目行锁串行检查版本。项目 snapshot、项目修订、操作幂等记录及命令 before/after 在同一 PostgreSQL 事务提交；失败不增加修订或半条操作。固定事实不因家具命令变化。

撤销产生新修订，恢复目标变化，不覆盖整个旧快照。目标必须属于当前用户/项目、未撤销，且引用当前布局与固定事实版本；同物体仍有效的后续操作会阻止撤销。先撤后续操作后，可继续撤前一项。不同物体的后续修改保留，反向摆放仍重新执行几何校验；新家具占住原位时拒绝反向覆盖。重复撤销 operationId 幂等，新 operationId 再撤同一目标拒绝。锁定也进入操作历史，不能通过普通移动绕过。

操作摘要 undoable 基于当前快照、依赖及反向几何检查计算；最终提交仍以 expectedRevision 为准，按钮状态不构成跨请求的提交保证。

## 实测证据

```sh
node --import tsx --test packages/geometry/src/placement.test.ts
node --env-file=.env --import tsx --test packages/commands/src/service.test.ts
node --env-file=.env --import tsx scripts/validation/editing-api.ts
```

| 层次 | 结果 | 关键反例 |
| --- | --- | --- |
| 纯几何 | 10 组通过 | L 形房间中中心/四角都在内但边穿凹口；union 内孔；旋转家具；斜墙；窗台/过梁高程；门扇铰点/开向；未知落地开口；非法数值 |
| 真实 PostgreSQL | 10 组通过 | 相同请求并发只一次；同基础修订不同请求仅一成功；失败无部分写；锁定/固定事实；正反向依赖；不同家具占据原位；UPDATE 后强制历史 INSERT 冲突验证完整回滚；尺度与固定事实版本；最近20条上限；已有多圈 yaw 精确撤销 |
| 真实本地 HTTP | 7 组通过 | 未登录/跨账号拒绝；伪 owner/尺寸字段；定位碰撞；移动+旋转后GET重开；幂等/409竞争；新修订撤销及重复撤销；锁定/解锁 |

根 TypeScript 检查通过。测试仅清理本次随机身份创建的数据；数据库回滚故障通过本测试项目的冲突修订行注入，未修改共享表结构或其他用户项目。

独立后端复核发现并修复一项契约缺陷：场景允许 yaw=2π+0.15，但移动后原状态被公开输入的 ±2π 限制挡住，导致不可撤销。新增真实 PostgreSQL 回归先复现失败，再验证修复后移动可撤销、恢复原始 yaw，同时超范围新命令仍拒绝且无部分写。复核后的纯几何 10/10、数据库命令 10/10 及 `pnpm exec tsc --noEmit` 通过；身份隔离、项目行锁、并发幂等、事务回滚与反向依赖检查未发现其他阻断。此次使用已有数据库服务，没有启动或重启服务。

## UI / 3D 验收

主 Agent 执行 `node --env-file=.env --import tsx scripts/validation/editing-ui.ts`，真实 Next.js / PostgreSQL 路径通过：

- 从列表点选沙发，3D 显示酒红轮廓；X 从 3m 改为 3.3m 后服务端 revision=2，画布像素随持久化结果更新。
- 越界与固定柜碰撞均拒绝，服务端修订保持不变；错误指出原因，定位按钮切换到相关固定物体或墙/开口，显示选中轮廓。拒绝不把未保存坐标画进当前方案。
- 锁定后数值字段禁用；解锁后依次撤销解锁、锁定及移动，恢复原坐标。撤销按钮根据服务端当前可撤销摘要启用；没有改变坐标时保存按钮禁用。
- 故意让服务端提交移动后丢弃 HTTP 响应；再次点击使用原 operationId 返回同一操作，修订仅增加一次。刷新后从服务器恢复 X=3.2m，重新点选可继续修改。
- 1440×1000、1100×900、390×844 下无横向溢出、无页面脚本错误。桌面属性面板独立滚动，错误出现不改变画布高度；手机保留画布在前、空间列表与属性在后的布局。米制数字使用表格数字，移动输入支持 1mm 步进。

当前截图在忽略目录 `.impeccable/review/t05/`，主 Agent 已打开检查。单次 Impeccable detector 为 6 项字号 advisory、无 primary，继续继承已选原型的密集控件层级。独立 finish reviewer 已给出五段 `ship`，结论限于本票家具编辑扩展，不涵盖 T09、最终家具资产或常规动效。验证脚本只清理本次随机身份、项目和操作记录。

## 本轮收尾验收（2026-10-25）

仅复用用户已启动的 Next.js 3000 与 PostgreSQL 54329，没有启动或重启服务。主 Agent 新跑 `pnpm validate:editing`，7 组 HTTP 与完整浏览器流程通过；独立后端复核定位并修复多圈 yaw 与撤销契约不一致：持久化 pose 接受任意有限角度，新增移动请求仍限 ±2π。界面显示等价范围内角度，位置编辑可提交，撤销恢复原始保存角度。新增真实浏览器反例（2π+0.15）通过，真实数据库命令测试现为 10 组。

Documenter 已对照 PRODUCT.md、DESIGN.md、侧车、属性面板 CSS 和截图：保留暖纸/褐墨/酒红、仓耳渔阳体、表格数字、Shared Action Rule、Canvas Layer Rule 与 Editorial Production Rule。局部错误色、标题字号及历史断点差异不提升为全局规范，不重写既有设计系统。独立 reviewer 和 documenter 均通过通用子 Agent 承载对应角色，未声称工具具有专用 agent_type。

四项工单验收均有对应证据；代码仍为本地未提交状态，未宣称远端 CI 或真实模型验收完成。
