---
name: shelf-ops
description: 货架（shelf）与 AI 工作流的操作手册——用户要「初始化 / 还原 ai 工作流」「同步 / 更新 ai 工作流」「拉技能 / 推上去 / 上架」，或提到货架、shelf、模板、换设备、新 worktree 时使用。封装 shelf CLI 的用法、JSON 输出与退出码、双改合并与冲突守则。
allowed-tools: Read, Glob, Bash(shelf status *), Bash(shelf diff *), Bash(shelf ls *), Bash(shelf template *), Bash(shelf home *)
---

# Shelf 操作手册

shelf 是个人内容货架：一个 git 仓库（货架）放技能、协议和模板，`shelf` CLI（别名 `atk`）负责把它们装进项目、保持同步、把项目里的改动推回去。项目里的账本是根目录 `.shelf.json`（进项目 git，不要手改）。

## 先知道这几件事

- **输出是 JSON**：你在 Bash 里跑时（输出不是终端）默认拿到一份 JSON：`{ ok, exitCode, data, next, warnings?, error? }`。按 `exitCode` 判断结果，按 `next` 走下一步（多条是并列选项，方向由用户定），不去解析给人看的文字；要文字时加 `--text`。
- **退出码**：0 成功或一致 · 1 参数或输入错误（看 `error.message`）· 2 需要处理（待决、变更清单待确认、diff 有差异）· 3 冲突 · 4 提交失败（货架已回滚）。
- **从不等键盘**：要确认的操作退出 2，`next` 里给出带 `--yes` 的原命令。
- **模板**：货架上的 `templates/ai` 是 AI 工作流模板（协议、通用技能与 project-audit、技能登记表、worktree 与 Multica 开工脚本、文档骨架）。`shelf template show ai` 列出它会装哪些货、落在哪、会建哪些固定目录。
- **项目布局**（ai 区的目录名记在账本 `aiDir`：.NET / C# 项目是 `AI`，其余是 `ai`）：
  - `ai/jaAgents/CLAUDE.md`、`AGENTS.md` 是协议正本（入库）；根目录 `CLAUDE.md` / `AGENTS.md` 是给 agent 读的副本（gitignore）。**副本和正本永远一致**（用户 2026-10-26 定，没有「追加」）：正本更新了、副本没人动过 → `ai/scripts/protocol-mirror.sh` 用正本覆盖副本（Claude Code 与 Codex 的钩子每条消息都查一次，本会话读到的协议过期就提醒重读）；**副本被人改过** → 两份都不动，先用 `git diff --no-index ai/jaAgents/<名> <名>` 给用户看，用户确认后才 `shelf push ai/jaAgents/<名> --take-mirror`（收进正本再推，推前照样给清单）。shelf 2.1 起 CLI 自己也守这条：副本改过、正本没动是 `mirror-ahead`，`sync` 列待决、`pull` 不动、`push` / `merge` 列差异退出 2，**没有用户确认不加 `--take-mirror`**；不要副本的改动就 `shelf pull ai/jaAgents/<名> --force`。两份各改各的停下（`mirror-mismatch`）
  - `ai/jaSkills/<名>/` 是技能唯一正本，`.claude/skills`、`.agents/skills` 是指向它的链接
  - `ai/features/`、`ai/sessions/`、`ai/design_system/` 下的 `concept/ img/ uiux/ codex-visual/`、`ai/project-audit/` 下的 `runs/ scripts/` 是固定目录：各技能在 frontmatter 里声明，init / sync 缺了就建
  - `ai/JASKILL.md`、`ai/PROJECT.md`、`ai/TODO.md`、`ai/check-docs.json`、`.claude/settings.json`、`.worktreeinclude` 是植入物：装一次，之后归项目，shelf 不对账、不推
- **新 worktree 补什么**（三个入口同一口径：桌面版按 `.worktreeinclude`、本机保底 `ai/scripts/sync-worktree.sh`、Multica 的 `ai/scripts/bootstrap.sh`）：技能链接、协议副本，以及**被 git 忽略的环境配置文件**（`.env`、`.env.local`、`.env.<环境>` 等，不含 `.env.example` 这类入库样板）——从主检出照同一相对路径补进来，主检出那份是指向仓库里的相对链接就建同样的链接；指向仓库外的链接与普通文件复制成独立文件；已有的不覆盖，内容不读不打印，目标没被 git 忽略就不补，不留悬空链接。项目要额外步骤（比如给 app 建指向根 `.env` 的链接），放进项目自己的 `ai/scripts/worktree.local.sh`（模板不管），两个脚本补完后会调用它，主检出里也跑

## 用户这样说 → 你这样做

### 「帮我初始化 ai 工作流」（新项目 / 换设备 / 新 worktree）

跑 `shelf init`：

- 没有账本 → 按模板新接入（默认接 claude + codex；用户点名别的组合时加 `--agents`）
- 有账本 → 按账本还原：建技能链接、按 `ai/jaAgents` 补根目录协议副本、补拉缺的货、货架有新版且本地没动的直接更新、把 `ai/jaSkills` 里没记账的技能登记进账本
- 退出 0 → 完成，转述装了什么；退出 2 → 有待决，按下面「同步」一节的表处理
- `data.jaskill.unregistered` 里有名字 → 那些是项目自己的技能，按 custom-skill 的规范补进 JASKILL.md；`data.jaskill.stale` 是登记表里有、正本里没有的，问用户是装回来还是删掉那一行

### 「同步 / 更新 ai 工作流」

先跑 `bash ai/scripts/protocol-mirror.sh --sync` 把根目录旧副本对齐（它报「副本被人改过」就先按上面走 review，别让 sync 把副本的改动直接推上货架），再跑 `shelf sync --merge --push`：它会装上模板新增的货，把货架新版且本地没动的更新到本地，把双方都改过的做三方合并，再把本地领先的和合并干净的推上货架。

- 退出 0 → 全部一致，转述更新了哪些、推了哪些
- 退出 3 → 有合并冲突。冲突文件里是标准冲突标记（`<<<<<<< 本地` … `=======` … `>>>>>>> 货架 <sha>`）。先用 `shelf diff <路径>` 看清两边各改了什么讲给用户，按用户的决定改好、把标记删干净，再 `shelf push <路径> --yes`（传冲突文件本身的路径也行，按它所属的整件推）
- 退出 2 → 剩下要人定的（`data.items` 里 `pending` 为真的），按 `state` 处理：

| state | 含义 | 怎么办 |
|---|---|---|
| `removed` / `ambiguous` | 货架上下架了 / 找到多个同名 | 问用户；不要了就 `shelf forget <路径>` |
| `local-missing` | 账本里有、本地没了 | 问用户：拿回来 `shelf pull <路径> --force`，不要了 `shelf forget <路径>` |
| `mirror-ahead` | 根目录副本改过、正本没动 | 用 `next` 里的 `git diff` 给用户看；用户要留 → `shelf push <正本> --take-mirror`，不要 → `shelf pull <正本> --force` |
| `mirror-mismatch` | 正本和根目录副本各改各的 | 用 `next` 里的 `git diff` 给用户看，用户定以哪份为准、改成一致后再 sync |
| `untracked-differs` | 模板要装的货本地已有同名、内容不同、没记过账 | 先看差异：`git diff --no-index <localPath> <shelf home 给的 data.shelfDir>/<key>`，讲给用户；用货架版跑 `next` 第一条（`pull … --force`，按模板落点装），用本地版跑第二条（`push … --yes`——它会成为模板内容，所有项目跟着变，推前讲清楚） |

只想看不想动：`shelf status`（只读，同样的状态和下一步）。

### 「我改了某个技能 / 协议，推上去」

`shelf push <路径> --yes`（`ai/jaSkills/<名>`、`ai/jaAgents/CLAUDE.md`、根目录 `CLAUDE.md` 都认；技能里面的文件如 `ai/jaSkills/<名>/SKILL.md` 按整个技能推）：

- 退出 3「货架在你上次拉取后被改过」→ `shelf merge <路径>`：退出 0 再 push；退出 3 按上面的冲突处理
- 退出 1「植入物不推」→ 植入物归项目自己；要改货架上的模板，告诉用户到货架 clone 里改

### 其他

- 装货架上的某个技能：`shelf pull skills/<包>/<名>`（技能自动进技能正本）
- 新东西上架：`shelf create <本地路径> --to <货架目录> --yes`；被拒说明重名，问用户是更新它（push）还是改名再上架
- 看货架上有什么：`shelf ls [路径]`；看模板内容：`shelf template show ai`
- 从账本里清掉一件（本地文件不动）：`shelf forget <路径>`
- 外部安装器装了技能，或把技能目录弄成了实体目录：`shelf adopt`

## 守则

1. 只有冲突（退出 3）和 `next` 给了多个选项时才需要问用户；能安全自动做的，命令已经做掉了。
2. **`--force` 从不自己加**（它会整体覆盖货架上别人的改动）；`--force-secret` 永远不主动用，被拦下的凭据文件如实告诉用户。
3. 改技能、改协议只改项目里的正本（或根目录副本），不去改货架 clone；推上去用 push。
4. 账本 `.shelf.json` 不手改；登记的增删用 pull / forget。
5. Windows 上技能链接是 junction；删链接只用 `cmd /c rmdir <链接路径>`（不带 `/s`），递归删除会删到正本。

细节（JSON 里的物品状态全表、账本字段、货架从哪来、没装 shelf 的机器与 worktree、模板写法）见 ${CLAUDE_SKILL_DIR}/reference.md。
