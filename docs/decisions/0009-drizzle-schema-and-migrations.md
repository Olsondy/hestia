---
status: accepted
date: 2026-11-03
---

# 以 Drizzle TS schema 为数据库结构来源，drizzle-kit 生成新迁移

ADR-0003 选了「Drizzle 管理数据访问与迁移」，但实现时漂移成了手写 SQL 迁移和约 550 处 `client.query`，Drizzle 只用于 Better Auth adapter。用户于 2026-11-03 要求立即纠正，对齐 contexta-server 的用法，避免继续偏离。本决定细化 ADR-0003 的数据库部分。

## 已接受决策

- **结构来源**：`packages/persistence/src/schema/` 按领域拆分的 TS schema 是表结构的唯一来源，由 `index.ts` 汇总；首版由 `drizzle-kit pull` 从完整重放的旧迁移链反向生成，并与数据库逐项比对（列、约束、索引）一致。
- **新迁移**：改 schema 后运行 `pnpm db:generate`，提交 `packages/persistence/drizzle/` 下生成的 SQL 和 `meta/`；不手写迁移 SQL，不手改 snapshot。触发器、函数、视图、数据回填这类 drizzle-kit 不表达的内容，用 `drizzle-kit generate --custom` 生成空迁移后填写。
- **旧迁移链冻结**：`packages/persistence/migrations/0001–0029` 只读，`scripts/migrate.ts` 拒绝新增文件。迁移顺序固定：先在同一会话锁下执行旧链（记录在 `hestia_migrations`），再执行 Drizzle 迁移（记录在 `drizzle.__drizzle_migrations`）。Drizzle 的 `0000_baseline` 是空操作，它的 snapshot 描述旧链执行后的结构。
- **数据访问**：新代码默认用 Drizzle 查询构建器（`db`、`orm(client)`、`transaction()` 的第二个参数 `tx`），行类型由 schema 推导，不再手写行类型。行锁优先用 `.for('update')`；advisory 锁、`jsonb_set` 等复杂表达式可以用 `` sql`...` `` 或参数化 SQL，但表和列仍引用 schema。已有的手写 SQL 在顺手修改所在模块时逐步迁移，不做一次性重写。参考范例：`packages/finishes/src/catalog.ts`。
- **驱动**：继续用 `pg`（`drizzle-orm/node-postgres`），与 pg-boss 共用连接池，不换成 postgres.js。

## 已知限制

- Drizzle 无法表达 `DEFERRABLE INITIALLY DEFERRED` 外键。`candidate_adoptions` 与 `project_style_commands` 的操作外键在数据库中是可延迟的，schema 中已加注释；修改这两条约束时要用自定义迁移。
- `drizzle-kit pull` 生成的 schema 曾有三处错误，已人工修正：`CHECK (CHECK (...))` 嵌套、复合外键列顺序错乱、正则里的反斜杠被吞。以后需要重新 pull 对照时，要复核这几类问题。

## 考虑过的替代方案

- **维持手写 SQL，只补 schema 类型**：成本最低，但迁移和类型两套事实会继续分离，正是这次漂移的来源。
- **一次性把查询全部改写为 Drizzle**：约 2–3 周人力，而且要重新验收 T05/T07/T08/T17/T20 等依赖锁与幂等语义的路径；收益集中在类型安全，改为按模块渐进迁移。
- **把旧迁移链压缩成 Drizzle 基线**：可以删掉旧目录，但已有的库要人工改写迁移记录，迁移测试也依赖逐段重放；暂不做。
