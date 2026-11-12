---
name: jira-cli
description: Jira 读写守则与工作流挂点——任何要读或要动 Jira 的时候（查单、复验 AC、开工转 In Progress、交付写「与 PRD 的差异」留言草稿、测试环境验完后批量发留言并转 QA、对账打回）先读本文。项目的站点、项目键、状态名、人员与常设授权记在 PROJECT.md「Jira」节。
allowed-tools: Bash(jira:*), Bash(curl:*), Read
---

**触发策略：自动触发**：任何要读或改 Jira 的时候，先读本文再动手。回复开头标 `**JIRA-CLI**`。

本技能是通用的：**不写任何项目数据**。项目键、状态与转移名、QA 是谁、reporter 是谁、哪些写操作已获常设授权，都在项目的 `<ai>/PROJECT.md`「Jira」节（下称「项目 Jira 节」）。项目没有这一节，就只读、不写，并提醒用户补。

---

## 一、🔴 权限边界（高于本文其余一切）

CLI 用的是**用户本人的账号**：Jira 上的人分不清哪句是用户说的、哪句是 agent 发的。代发一条评论会被当成我方正式口径引用；转错一次状态，QA 就会按错误的时间点开测。

| 写操作 | 许可从哪来 | 没有许可时 |
|---|---|---|
| 改状态 / 改 assignee / 改 reporter | ① 当次对话用户就这张单的明确一句话；② 项目 Jira 节「常设授权」表里列出的动作 + 触发条件 | 不做，在 issue 里写清楚要转成什么、为什么，等用户回话 |
| 发评论 | **只有一种**：Jira 收尾批次里，用户在汇总清单中点了头的「Jira 留言草稿」定稿，原文发出，一字不加 | 不发 |
| 改描述、补 AC、在单里 @ 人、建单、删单 | 无，一律不做 | 写成草稿交用户 |

- 不算许可的：交付纪律说该转、PR 已合、DoD 打完勾、上一轮说过类似的话、别的单放行过。
- 🔴 **QA 打回专用的转移（比如 `QA Failed`）我方永远不用**：那等于替 QA 写下一条「测试未通过」。要把单退回来，找用户。
- 常设授权表外的单、或方向和表不一致的转移：先问。
- 用户撤回常设授权（比如说「先不回写 Jira」）：立刻停用，表内的也停，直到用户重新开口；同时在项目 Jira 节注明撤回日期。

## 二、工作流挂点：Jira 动作插在哪、谁来做

Multica issue 和 Jira ticket 的对应关系：issue 标题里的 `[<项目键>-n]`，或「执行细节」里写的 ticket 号；对多个 ticket 时逐张做。没有对应 ticket 的单跳过本节。

Jira 动作分两拨人做：**单张 issue 的 agent** 只管开工和写草稿；**留言和交 QA** 要等用户确认已经部署到测试环境、自己测过之后，由用户单独派一个「Jira 收尾」agent 一次处理一批。

```mermaid
flowchart LR
  subgraph 单张 issue 的 agent
    A[开工<br/>issue 转 in_progress] -->|J1| B[Jira → 开发中]
    C[交付<br/>转 in_review 前] -->|J2| D[issue 内写<br/>Jira 留言草稿]
  end
  D -.-> E[用户部署到测试环境<br/>并测过]
  subgraph Jira 收尾 agent（用户单独派，一批）
    E --> F[汇总清单<br/>用户一次确认]
    F -->|J3| G[发留言]
    G -->|J4| H[转待测 + 指派 QA<br/>+ reporter 改成用户]
  end
```

| 挂点 | 谁 · 什么时候 | 做什么 | 许可 |
|---|---|---|---|
| **J1 开工** | 单张 issue 的 agent，本 issue 第一次转 `in_progress` 时（读完检查点之后、动代码之前） | 把 ticket 转到项目 Jira 节写的「开发中」状态。已经是这个状态或更靠后的就不动；被 QA 打回后又回到开发中的，也不动 | 常设授权表 |
| **J2 写草稿** | 单张 issue 的 agent，交付报告发出前 | 对照 PRD / Jira AC 写「Jira 留言草稿」（格式见下），作为交付报告里单独的一节。和 PRD 完全一致就写一句「与 PRD 一致，无需留言」。**不碰 Jira** | 不需要 |
| **J3 发留言 + J4 交 QA** | **Jira 收尾 agent**，用户确认部署、测完后单独派 | 见下「收尾批次」 | 用户派单就算 J4 的许可（只覆盖他点名的这一批）；J3 要用户在汇总清单里逐条点头 |

单张 issue 的 agent **永远不做 J3 / J4**，哪怕用户在本 issue 里已经回了「草稿可以」：那只表示稿子定了，不表示环境好了。
做完 J1，在本 run 那一条 issue 评论里写一行回执，比如 `J1 BOP-63 → In Progress ✓`。失败就贴错误摘要，不重试。

### 收尾批次（Jira 收尾 agent 的流程）

1. **定范围**：用户点名的 issue / Epic / ticket，加上部署的环境。没点名就先列候选：已合入该环境分支、对应 ticket 还没到「待测」的那些单。列出来问用户，不自己扩大范围。
2. **汇总清单**：逐张取 issue 里最新的「Jira 留言草稿」（以用户在 issue 里给的改稿为准），排成一张表发给用户：ticket · 草稿全文（或「与 PRD 一致」）· 当前 Jira 状态 · 计划动作。草稿缺的标「缺草稿」，这一张不做，报给用户。
3. **用户一次回复**：「全部可以」，或者逐条改稿 / 剔除。没点头的不发。
4. **执行**：逐张做 J3（发定稿原文，一字不加；「与 PRD 一致」的跳过 J3），再做 J4（转待测、assignee 改成 QA、reporter 改成我方负责人）。转之前先 `view` 看当前状态，已经到位的跳过。
5. **回执**：结果写成一张表（ticket · J3 · J4 · 失败原因），发在这次收尾的 issue 里；单张失败不影响其余各张，也不重试第二次。

### Jira 留言草稿格式（J2）

```
**Jira 留言草稿 · <ticket>**
与 PRD 的差异（共 n 条）：
1. PRD 写的是 X → 我们做成了 Y。原因：Z。
2. …
```

- 只写**和 PRD 不一样**的地方：最多 5 条、≤ 10 行，说人话。原因写给 PM / QA 看：最佳实践、数据、风险、用户体验。
- 不写代码路径、内部 issue 号、agent 名字、PR 链接。
- 语言跟 ticket 原文一致。
- 差异会影响 QA 怎么测的（比如入口换了、交互变了），在那条末尾加「QA 请按此测」。

## 三、访问

- CLI 是 `jira`（ankitpokhrel/jira-cli）。token 放在项目 Jira 节写的位置（常见是 `~/.jira-token`），用之前 `export JIRA_API_TOKEN="$(cat <路径>)"`。**token 不回显，也不写进任何输出**。忘了导出时，CLI 只打一段 "needs a Jira API token" 的帮助，看着像没装。
- 配置文件 `~/.config/.jira/.config.yml` 里**没有默认项目**：命令一律带 `-p <项目键>`，否则报「No result found … project ""」，看着像没有单。
- `-q` 里别写 `ORDER BY`（会被拼进 project 子句，报 400）；排序用 `--order-by updated`。
- REST 直调用 `curl -u "<login>:<token>"`。写成 `Authorization: Basic …` 会**伪装成 404**。REST v2 收纯文本，v3 要 ADF。
- 人员字段要的是 **accountId**，不是显示名。先用 `jira user search "<名>"` 或 REST `/rest/api/2/user/search?query=` 查，查到的 id 记进项目 Jira 节，下次直接用。

## 四、操作配方

| 动作 | 命令 | 坑 |
|---|---|---|
| 看单 | `jira issue view <KEY> --plain` | 巡检不能只看 status：最新评论里可能有「先别开测」这类人工闸 |
| 转状态 | `jira issue move <KEY> "<转移名>"` | 按**转移名**转，不是目标状态名；多跳的按项目 Jira 节的顺序逐跳。转之前先 `view` 看当前状态，已到位就不转 |
| 改 assignee | `jira issue assign <KEY> <accountId>` | 用 accountId |
| 改 reporter | REST v2 `PUT /rest/api/2/issue/<KEY>`，body `{"fields":{"reporter":{"accountId":"…"}}}` | CLI 改不了 reporter。返回 400 / 403 多半是 reporter 字段不在编辑界面上，或账号没有 Modify Reporter 权限：如实报告，不绕 |
| 发评论 | `jira issue comment add <KEY> --template <文件>`，或 REST v2 `POST /rest/api/2/issue/<KEY>/comment` | 🔴 **正文别当位置参数传**：进程会挂住，而且会重复落评论。发完 `view` 回读，确认只有一条 |

## 五、读与对账

- 复验 AC 有没有变：取 `expand=changelog` 里描述字段的 `fromString` / `toString`，以我方交付那一刻为切点做 diff，不整篇重读。
- 对账「哪些单还没交 QA」时要连「开发中」一起筛：QA 打回的单会退回开发中，和正在开发的单长得一样。打回也不等于实现是错的，修复可能挂在兄弟单名下。

## 六、项目 Jira 节模板（复制到 `<ai>/PROJECT.md`）

```markdown
## Jira（jira-cli 技能读这里）
- 站点 / 项目键 / token 位置：
- 状态与转移：开发中 = <状态>（从 <起点> 走 <转移名>）；待测 = <状态>（<转移名>，多跳写顺序）；QA 打回专用转移 = <名>（我方禁用）
- 测试环境与对应分支（收尾批次用来列候选）：
- 人员：QA = <名>（accountId）；我方负责人 / reporter = <名>（accountId）
- 常设授权（用户 <日期> 定；撤回就在这里注明日期）：
  | 挂点 | 动作 | 触发条件 |
- 不在 Jira 的工作：（例：后端 / DevOps 的活在 Jira 转给谁）
```
