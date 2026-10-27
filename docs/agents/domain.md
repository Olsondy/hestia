# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

> **This repo stores ADRs in `docs/decisions/`, not `docs/adr/`.** Wherever a skill (including `/domain-modeling`) says `docs/adr/`, read and write `docs/decisions/` instead, keeping the `NNNN-slug.md` numbering.

## 项目映射与阅读顺序

- 本项目使用 single-context。技能中的 `GLOSSARY.md` 对应根目录 [CONTEXT.md](../../CONTEXT.md)，`docs/adr/` 对应 [docs/decisions/](../decisions/)，不创建平行副本。
- 开始任务前读取领域语言、相关 ADR，以及 [实施计划](../v1-development-plan.md) 中对应的阶段。
- 涉及 Agent 时，按需读取 [工具契约](../agent/tool-contract.md)、[运行设计](../agent/runtime-design.md)、[模型策略](../agent/model-policy.md) 和 [System prompt](../agent/system-prompt.md)。
- 区分已确认产品决定、待验证技术草案和实际实现；[ADR-0002](../decisions/0002-agent-led-consumer-workflow.md) 的 `proposed` 状态不表示 Q1–Q8 尚未确认。
- [技术栈](../web-stack.md) 与 [ADR-0003](../decisions/0003-modular-monolith-with-durable-workers.md) 已确认为实现基线；[ADR-0004](../decisions/0004-mainland-invited-pilot-managed-services.md) 记录试用约束，[ADR-0005](../decisions/0005-unified-conversation-entry.md) 记录统一入口和 Worker 流式执行。部署及供应商候选仍另议；精确版本和能力待验证不等于需要重新询问已确认的架构选型。
- 新发现若与已有决定冲突，记录证据与影响，不静默改写。
- 领域术语进入 `CONTEXT.md`，架构取舍进入 ADR，任务进度与验收证据进入 Issue。

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists: it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/decisions/`**: read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/decisions/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (most repos):

```
/
├── CONTEXT.md
├── docs/decisions/
│   ├── 0001-fixed-facts-independent-of-layouts.md
│   └── 0002-agent-led-consumer-workflow.md
└── src/
```

Multi-context repo (presence of `CONTEXT-MAP.md` at the root):

```
/
├── CONTEXT-MAP.md
├── docs/decisions/                    ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/decisions/            ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/decisions/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
