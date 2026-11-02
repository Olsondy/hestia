# D05 DXF 图纸导入与辅助转换验证

日期：2026-11-02。范围：工单 #34。本机 PostgreSQL 14（独立库），pg-boss 使用测试专用 schema；转换在测试进程内调用真实 `python -I` 子进程，未启动常驻 Worker 或 Next.js。

## 实现要点

- **上传**：`POST /api/projects/{id}/floorplan-imports`（multipart：`file` + `metadata.operationId`），按实际读取字节限制 16 MB；扩展名决定格式，DXF 另检查文件头，改名的 DWG 被拒绝。字节先写入私有存储，再在一个事务里发布资源、导入记录和（DXF）转换任务；同一操作标识同一文件返回同一记录，换文件为幂等冲突。
- **状态**：`queued → converting → pending_review`，失败为 `failed`，中断可 `retry_wait`；非 DXF 直接为 `assisted_conversion`，界面文案注明“不会自动识别”。所有结果都停在待审核，发布在 D06。
- **转换**：`packages/floorplan-import/python/cadvec_dxf.py` 改编自 house-plan-designer `cadvec.py`（MIT，声明见 `THIRD_PARTY_NOTICES.md`），只保留 DXF 路线，numpy 代替 OpenCV。由导入 Worker 以独立 `python -I` 进程运行：临时私有目录、受限环境变量、超时与输出上限、图元数上限。尺度只取 `$INSUNITS`，未声明单位记为 `missing`，标注矛盾记为 `conflicted` 并逐条列出。
- **候选**：转换结果经 `floorplan-import` 与楼层契约校验，每个导入版本只有一个候选（唯一约束）；租约与代次保证重复投递和 Worker 重启不重复生成，过期执行者不能发布。
- **辅助转换**：`POST .../floorplan-imports/{importId}/housespec` 由成员导入单层或整栋 HouseSpec，校验后同样进入待审核；不合法的户型以阻塞问题记录。
- **授权**：所有读取与写入经工作空间 `projectAccess`；原始图纸只对项目成员可读，读取时校验摘要。
- **运行**：`pnpm setup:dxf` 创建 `.venv/dxf`（Python 3.10+，依赖固定在 `requirements-dxf.txt`）；`pnpm worker:import:setup` 初始化队列，`pnpm worker:import` 启动导入 Worker。

## 执行结果

| 命令 | 结果 |
| --- | --- |
| `pnpm check` | 通过，核心测试 92 项 |
| `pnpm test:db` | 142/143；唯一失败为本机未配置真实模型的准入测试，与本票无关 |
| 合成 DXF 直接运行转换器 | 约 0.6 秒，6 面墙、单位声明为毫米、无矛盾标注 |

数据库集成测试（6 项）覆盖：DXF 转换后墙体中线与厚度、洞口数、房间名与源户型一致（去除图纸原点平移后，误差 1 mm 内）；重复投递不新增候选；幂等上传、超限、错误格式、改名 DWG、越权上传；过期租约后接管且旧代次不能发布；超时与转换器缺失的失败状态；未声明单位与矛盾标注的报告；非 DXF 辅助转换、成员导入不合法与合法（演示别墅三层）户型、版本冲突、原始图纸私有读取与越权拒绝。

## 未验证与限制

- 合成 DXF 由改编的生成脚本产生，尚未用企业真实图纸验证识别质量。
- 常驻导入 Worker 未以服务方式启动验证，测试直接调用同一执行函数。
- 原点取图纸墙体外包，未与项目已有空间对齐；采用到项目在 D06 处理。
