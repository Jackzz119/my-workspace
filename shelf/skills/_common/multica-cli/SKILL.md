---
name: multica-cli
description: Multica 平台与 multica CLI 的操作速查——哪些命令「成功」了却给出错结论（列表默认截断、JSON 形状、metadata 被存成浮点、唤醒参数、附件路径、写操作超时）、stage barrier 什么时候才关、mention 怎么写才真给对方排 run、回执怎么读、接力 run 遇到假冲突或旧快照怎么接。用 multica CLI 写脚本或操作 issue（建单、改描述、盘点 board、放行 stage、写 metadata、建或停唤醒、发带附件的评论）、派活与 mention 别的 agent、判断 run 是死是活、接着做上一个 run 的活、合别人的 PR、收到 final failure 通知时使用。交付纪律、DoD 与合并方式不在这里，归 Multica 协议。
---

# Multica CLI 与平台速查

本技能只收跨项目都成立的用法与坑。交付纪律、DoD、合并方式和 mention 的必守规则在 Multica 协议（Multica worktree 根目录的 `CLAUDE.md` / `AGENTS.md` §八–§十二；真源 `ai/jaAgents/MULTICA.md` 只在要改协议时打开，别为查规则去读它，原因见协议 §零）；项目自己的参数与例外在 `ai/PROJECT.md`。

## 先核再信

下表是某一版 CLI 与平台的实测结论，CLI 升级后可能已经变了：

- 参数以当前版本的 `multica <命令> --help` 为准；对不上时照 `--help` 做，并按下面的办法改表
- 写操作做完回读核对，不把退出码 0 当成「写进去了」

某条已经不成立、或踩到新坑：改本技能的真源 `ai/jaSkills/multica-cli/`（先触发 `custom-skill`），改了在报告里贴 diff 并 `shelf push`（维护归属见 Multica 协议 §八），不写进 agent 记忆。

## 速查表

这些命令都「成功」了，给的却是错结论。写脚本前先对一遍。

| 场景 | 坑 | 做法 |
|---|---|---|
| 盘点整块 board | `multica issue list` 默认只回 50 条，不提示截断 | `--limit 100` 起步、`--offset 100` 接着翻，条数等于 limit 就还有下一页；按 Epic 盘点用 `issue children` |
| 读 JSON | 形状和直觉不一样：`issue children` 顶层是 `{stages, total, unstaged}` 对象，`stages[].done` 只数 `status=done`；`metadata list` 是扁平的 `{key: value}`；`comment list` 的正文键是 `content` 不是 `body`；`autopilot get` 外面多包一层 `{"autopilot": …}` | 写 jq 路径前先看一眼原始 JSON；取不到值按错误处理，别当成「空」 |
| stage 放行 | `issue children` 只列一层，孙子单看不见；`stage` 为空的子单在顶层 `unstaged` 里，barrier 不认它，永远不会被放行；`assignee` 为空的子单放行后没人接 | 放行前逐层下钻，核每个子单的 `stage` 与 `assignee_id`；建子单时 `--parent` 与 `--stage` 一起给 |
| 核父子关系 | `issue get` / `issue create` 返回的 `parent_id` 对已挂父单的子单也可能是 `null` | 用 `multica issue children <epic-id> --output json` 核（它列得出、stage 也对），别因为 `null` 重复 update parent |
| 写 metadata | `metadata set` 会把 `93893e56` 这类短 SHA 存成浮点数 | 一律 `multica issue metadata set <issue> --key k --value v --type string`，写完回读 |
| 取消 / 停用唤醒 | `multica issue wakeup delete` / `disable` 只给 wakeup id 会报 `accepts 2 arg(s), received 1` | 两个参数都给：`multica issue wakeup delete <issue-id> <wakeup-id>`（`disable` 同） |
| 条件唤醒 | `--until-status` 这类条件唤醒触发一次后自动变成 `enabled: false`，看着像被关掉了 | 不用再手动 disable，还要等就重新建一个；例：等对方交付后复核用 `multica issue wakeup create <issue> --until-status in_review --instruction-file ./wk.md --expires-in 336h` |
| 等用户留言 | 要等的是评论、不是状态变化时，`--until-status` 永远不触发 | `multica issue wakeup create <issue> --event comment.created --filter-actor-type member --filter-actor-id <uuid> --mode once --expires-in 168h`，uuid 取用户评论 JSON 的 `author_id` |
| 定时唤醒 | 只写 `--after 25m` 会报 `select at least one supported event` | 加 `--kind at`：`--kind at --after 25m --instruction-file ./wk.md` |
| 改 issue 描述 | `issue update --description-file` 整段覆盖、没有冲突检测，后写者赢 | 先 get，在最新内容上改，再 update，最后回读做 diff |
| 写操作超时 | 退出码 2 分不清「没写进去」和「写进去了」 | 先 list 核对再重试，重试带 `MULTICA_HTTP_TIMEOUT=180`；`comment add` 的成功信息在 stderr，解析 JSON 别把 stderr 混进来 |
| 发附件评论 | `--attachment` / `--content-file` 的路径必须在 cwd 内；把 `comment add` 管进 `head` 会 SIGPIPE，附件传上去了、评论却没建 | 文件放进 worktree 里；不要把输出接进管道；发完用 `comment list` 确认 |
| 额度用尽 | run 几秒就死，issue 仍停在 `in_progress`，看着像在跑；`failure_reason` 可能只是 `agent_error.unknown` | 按 `multica agent tasks <agent-id> --output json` 里的错误原文判断（spend / session / usage / weekly limit）；额度重置后自己 `rerun` 或 mention 重派 |
| 接力 run 开头（Multica run 的 worktree 里） | 工作区报「Unresolved merge」、一堆 `UU`，但没有 `MERGE_HEAD`：平台拿旧快照当三方 base 合出来的假冲突 | `git ls-files -u` 核实 stage 3 就是 `origin/<base>` 后，`git reset --hard` **回到起步快照本身**（退到它之前会让记账失败），再 `git merge origin/<base>` |
| 接着做上一个 run 的活 | 远端没分支不等于没干活；`chore(agent): uncommitted changes from task` 快照提交里可能夹着死掉 run 的产物、主检出里用户没提交的改动、没跟踪的大文件 | 先 `git rev-list --left-right --count origin/<base>...HEAD` 和 `git diff --stat origin/<base>..HEAD` 逐个文件核，只带走本任务的文件 |
| 合别人已经绿了的 PR | 它的实现 run 可能还活着，合完它后续的 push 就落空了；`issue get` 的 `assignee` 常是空的 | 合之前用 `assignee_id` 跑 `multica agent tasks <assignee_id>`，有 `running` 就别合 |
| 收到「Delegated task ended in a final failure」一类通知 | 看着像交付失败，可能只是平台记账失败 | 先 `gh pr view <n> --json state,mergedAt` 核 PR：已合入、CI 绿在 PR head 上、保留的 worktree `git status --porcelain` 为空，就是记账失败、不是交付失败——在协调评论里结掉，**不重派** |
| 等 stage barrier 放行下一批 | 平台的 barrier 只在某个 stage 里**每一个**子任务都到达 terminal 状态（`status_category` 为 `done` 或 `cancelled`）时才关闭；`in_review` 的 category 就是 `in_review`，**不计入** | 不等 barrier：放行下一个 stage 是 Epic 负责人的主动动作（Multica 协议 §九、§十 第 6 条） |

## 派活与 mention

发任何 mention 之前，读 [references/mention.md](references/mention.md)：各 type 的 UUID 去哪查、三个让 mention 静默失效的坑、回执各状态的含义、重新触发与去重。什么时候必须 mention、先写描述再 assign、发完核回执，这些规则在 Multica 协议 §十二。

## 经验摘录

- mention 发了、对方没起 run → 先看评论响应里的 `trigger_outcomes`：不在数组里多半是写了名字没写 UUID，`blocked` + `invocation_not_allowed` 多半是 UUID 抄错（和权限拒绝同一个码），`{}` 可能是被去重 → [references/mention.md](references/mention.md)「三个会让 mention 静默失效的坑」「发完要看回执」
- 只发了 `@all`，assignee 却没被触发 → `@all` 会压掉隐式路由 → 同上「三个坑」第 3 条
