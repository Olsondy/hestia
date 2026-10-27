# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <utf8-file>`.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body-file <utf8-file>`.
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## 开发任务约定

- 开发顺序与阶段验收依据 [V1 实施计划](../v1-development-plan.md)。
- 每个任务包含：所属阶段、目标、范围、不包含项、前置依赖、相关 ADR/工具契约、验收标准与验证方式。
- 按可独立验证的用户能力拆分任务，避免仅按前后端目录拆分。
- 验证任务记录问题、实验方法、证据和结论；实现任务记录行为变化、验收结果和未完成项。
- 标签表示任务分类或准备程度，不覆盖用户的实施范围与授权。已有标签映射见 [triage-labels.md](triage-labels.md)；本轮未安装或启用 `triage`，不据此创建或调整远程标签。
- 完成任务前核对验收标准，记录实际证据；未执行项标为未验证。
- 多行 Issue、评论与 PR 正文写入 UTF-8 临时文件，通过 `--body-file` 提交，完成后清理临时文件。下文短文本命令示例不替代此规则。
- GitHub 操作前确认 `gh` 可用、登录有效且目标仓库正确；不可用时明确报告，不把本地草稿称为已发布。

2026-10-25 环境更新：远程仓库为 `Olsondy/hestia`；官方 GitHub CLI 2.103.2 已安装、校验并登录为 Olsondy。当前 PowerShell PATH 不含该 CLI，可使用 `C:\Users\Olsond\AppData\Local\Programs\GitHub CLI\2.103.2\bin\gh.exe`。已通过 CLI 发布总工单 #1、子工单 #2–#25，读回核验 24 个原生父子关系、39 条原生阻塞关系及 ready-for-agent 标签，映射见 [发布清单](../planning/v1-published-issues.json)。已连接的 GitHub 工具能读取，但创建 Issue 曾返回 403，本次写入使用 CLI。用户已确认实现架构并明确恢复开发，按依赖推进，独立工单可由子 Agent 并行；旧暂停说明不再适用。本轮按定稿架构更新 #1–#25；T03/#4 在主 Agent 验收后关闭，证据见 [T03 验证报告](../validation/T03-rendering.md)，T04/#5 随后也已通过本地验收并关闭，T05/#6 与 T09/#10 的开放阻塞已读回为 0；代码尚未提交/推送，见 [T04 报告](../validation/T04-projects.md)。T01/#2、T02/#3 仍开放，当前仅合成样本与协议验证，真实模型 API 稍后配置。此记录是当次环境检查结果，实际操作前应重新检查。

2026-10-25 本轮续做验收：T05/#6、T09/#10 收尾后，按依赖完成并关闭 T06/#7、T07/#8、T15/#16、T16/#17、T20/#21；连同既有 T03/#4、T04/#5，共 9/24 项子工单通过本地验收。当前剩余无开放依赖的入口为 T01/#2、T02/#3，真实模型配置和真实样本验收尚缺；其余依赖边保留。最终 pnpm check（4 项原型、44 项核心、根/Web/Worker 类型）与 pnpm test:db（74 项）通过。T07/T20 获准的两次隔离进程验收已结束并清理，现有 Next/PostgreSQL 未重启；不授权常驻 Worker。实现、验证报告与映射均在本地工作区，未提交或推送。最新远程状态读回记录见 v1-published-issues.json 的 latestExecutionState，旧快照仅为历史。

2026-10-25 模型验收更新：用户配置根 .env 后，真实 API 合成小样通过 T01/#2 初始准入并关闭；T02/#3 三类合成识图未达门槛，保持开放。T08/#9 已远程读回开放阻塞为 0 并领取，后端与 UI 由子 Agent 并行实施；不启动或重启服务，实际运行仅用有限测试函数。当前累计 10/24 项子工单验收，最新映射记录后续进度。

2026-10-25 免费积分增量规格已发布：总规格 [#26](https://github.com/Olsondy/hestia/issues/26)，子工单 [C01/#27](https://github.com/Olsondy/hestia/issues/27)、[C02/#28](https://github.com/Olsondy/hestia/issues/28)。三张票均已核对正文及 `ready-for-agent`；原生父子关系为 #1→#26、#26→#27/#28，阻塞关系为 #27←#5（已关闭）、#28←#27/#9/#22，整体试用 #25 新增等待 #26。用户已确认三类测试入口，发布未启动服务或实施功能。规格与读回证据见 [免费积分发布目录](../planning/free-credits/README.md)，不改写原 24 项任务的历史验收记录。游客仅看示例、注册后赠送积分的最新范围覆盖旧邀请制上线约定；执行前仍需读取实际远程状态。

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.

2026-10-25 T08 整合验收：统一对话、真实 API 合成混合问答与准确修改、17张 UI 状态/宽度截图及独立视觉复核通过；最终 pnpm check（4原型/44核心/类型）与 pnpm test:db 93/93 通过。T08/#9 已关闭，原24项累计11项验收；T10/#11 开放阻塞读回为0并领取，由后端/UI子Agent协同实施。T02仍保持开放；本轮未启动或重启任何服务。

2026-10-25 T10 整合验收：真实API两轮合成需求、11项新增数据库测试、17张UI截图与独立后端/视觉复核通过。最终pnpm check通过，pnpm test:db 104/104。T10/#11关闭后原24项累计12项验收；远程读回T17/#18、T21/#22开放依赖均为0，已分派子Agent并行实施。T02仍未通过，不解除识图下游；本轮无服务启动或重启。

2026-10-27 T17/#18 与 T21/#22 本地验收并关闭，原24票累计14项通过；真实模型1次合成单房间候选、18张UI截图及俯视图通过，最终check 4原型/62核心/类型，test:db 121/121。T19/#20及开放注册积分基础C01/#27远程开放依赖为0并领取，分派独立工作流；T02保持开放。用户手动启动现有Next/PostgreSQL，本次未启动或重启服务。

2026-10-28 C01/#27 通过本地验收并关闭：开放注册和一次赠送、游客合成示例、跨账号隔离，HTTP/PG 5/5、check 4原型/68核心及类型、数据库125/125，UI独立复核ship。C02已无开放依赖，但用户明确要求其他未完成工单暂停，未开始。只继续T19收尾；无服务启动/重启。

2026-10-28 T19/#20 已通过真实模型合成续作、数据库与页面验收并关闭，原24项累计15项通过；C01/#27同日验收关闭。用户明确要求其余未完成工单全部暂停，等待用户通知；不得因依赖解除自行继续。未启动或重启服务，代码和报告未提交或推送。
