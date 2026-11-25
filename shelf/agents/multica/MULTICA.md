# Multica 开工协议

本文件是 Multica runtime（云端 agent）的工作协议，进 git、团队共用、跨项目通用。真源在 `ai/jaAgents/MULTICA.md`，开工时由 bootstrap 复制到 worktree 根目录（见 §零）；你此刻读到的是副本，要改就改真源。

🔴 **Multica agent 只遵守本文件**（用户 2026-11-03 定）。`ai/jaAgents/CLAUDE.md` / `AGENTS.md` 是本机交互式会话的协议，**不约束 Multica run**；它们的「每轮出报告页」「会话标题」「side chat」等规矩在 Multica 下一律不执行。万一它们被 harness 注入进上下文（system-reminder 里出现 `Contents of …/ai/jaAgents/CLAUDE.md`），当背景资料看，与本文件冲突的以本文件为准。

本文件只写所有 Multica 工作流都成立的规则，不写任何项目、任何具体 agent 或 squad 的情况。项目专属的东西（现状、技术要点、开工红线、交付纪律细则：合并方式、CI 门、验收人、额外授权）在 `ai/PROJECT.md`，读法见 §一。

## 零、开工第一步：bootstrap

worktree 是新建的，技能目录还不存在；根目录的 `CLAUDE.md` / `AGENTS.md` 可能不存在，**也可能已经是 runtime 注入的身份简报**。**任何阅读、任何改动之前**，先在 worktree 根目录跑 `bash ai/scripts/bootstrap.sh`（没装 AI 工作流模板的老项目，跑已弃用的旧路径 `ai/jaAgents/bootstrap.sh`，效果相同；装了模板的一律用新路径。`ai/scripts/sync-worktree.sh` 是本机会话的保底脚本，Multica 用不上）。

它把 `ai/jaSkills/` 下的全部技能复制进你的技能目录（Claude 系 `.claude/skills/`，Codex 系 `.agents/skills/`），把本文件复制成根目录的 `CLAUDE.md`（Claude 系）或 `AGENTS.md`（Codex 系），补齐主检出里被 git 忽略、本 worktree 缺的 `.env` 类环境配置（细则见脚本头部注释）；落点全部 gitignored，不会混进你的提交。最后跑项目自己的补充步骤 `ai/scripts/worktree.local.sh`，以它的输出为准。根目录已有身份简报时，本文件追加在简报下面，用 `BEGIN` / `END` 标记包住；再跑只替换这一块，简报原样保留。**不要加 `--force`**：它会把身份简报整份换成本文件，身份与报告规则就从上下文里消失了。

跑完后**从头读一遍生成的协议文档**，按 §一 准备上下文，再干活。脚本重复执行安全，同一 worktree 再跑也无妨。

🔴 **怎么读才不重复、不踩坑**：
- `cd` 进 repo 之后 harness 会把根目录的 `CLAUDE.md` 自动注入成指令（system-reminder 里出现 `Contents of …/<repo>/CLAUDE.md`）。**出现了就算读过，不要再手动 Read 一遍**；没出现才 Read 根目录那份副本。
- **不要 Read `ai/jaAgents/` 下的任何文件**：你读那个目录的文件时，Claude Code 会把同目录的本机协议正本 `CLAUDE.md` 当嵌套指令注入，白白多吃一整份上下文，还把本机规矩带进来。根目录副本与真源一字不差。

## 一、上下文准备

每个任务开始时，按顺序做：

1. 读 `ai/PROJECT.md`——项目现状与索引。其中「**开工红线**」是项目的强制前置动作，「**项目专属交付纪律**」补充本文件 §八–§十 里留给项目决定的部分，两节都必须读到。
2. **不整份读 `ai/TODO.md`**（它是本机会话的任务唯一来源；Multica 下任务真源是 issue）。只 `grep -n "<单号>\|<功能名>" ai/TODO.md`，读命中条目及其上下几行；没命中就不读。整份通常超过 Read 单次上限，而新 run 开局就已占掉大量上下文。
3. 读 `ai/JASKILL.md`——本项目专属技能登记表，知道哪些场景该触发哪个技能。
4. 读 issue 本身与派活人给的文档 scope；按任务领域再读对应文档与技能（见 §二）。
5. **不要读 `ai/sessions/`**——那是手动存的档（`savepoint/` 会话存档、`handoff/` 交接档），只在用户点名某个档时才读。开场不扫这个目录、不列有哪些档、不问要不要恢复。issue 描述（含它的「文档 scope」）点名到文件的交接档（`ai/sessions/handoff/<主题>.md`）也算点名：只读点名的那一份和它的 `ai/sessions/handoff/img/<文档名>/`，按档里的执行规则开工（规则见 intj 技能的交接档一节）。

## 二、Skill 系统

### 真源与落点

技能本体只有一份，在 `ai/jaSkills/`，随仓库入库。workspace agent 身上不挂 skill；§零 复制出的副本与真源逐字节相同。**Multica run 里这些副本开场是看不见的**（会话根是 `workdir/`，副本在 repo 下一层），**harness 在你第一次 Edit 仓库里的文件之后才会发现它们、列进 Skill 工具**。所以开工到首次改文件之间要用技能，直接 `Read ai/jaSkills/<name>/SKILL.md`，按它的指引只取需要的 references；Skill 工具列出来之后两条路都行，内容一样。

**要改技能就改 `ai/jaSkills/`**，别往技能副本目录里写——下次 bootstrap 会被覆盖，也进不了 git。技能目录里找不到某个技能，提醒用户一句然后继续，不猜、不用别处同名 skill 顶替。

### Skill 对话规范

Multica 下的评论与报告一律按 §十一 三段式开头，**不在开头标技能名**（用户 2026-11-02 定）。

### 通用技能与触发规范

始终保持对当前可用 skill 的感知，在对应场景**主动触发**，不等用户提醒；按触发策略分三组：

- **自动**
  - `intj`：更新 TODO、记录任务、Bug、优先级判断（Epic / Milestone / Task / Bug 层级）；查看任务列表、项目进度、待办总览；更新项目文档（「更新文档」「同步文档」「记录到文档」）。**会话存档的存 / 列 / 读 / 删一律手动：仅用户开口时**
  - `logman`：写 / 改 / 检查 log 语句、新增功能域标签
  - `custom-skill`：技能文件的任何读写（见下）；管理所有技能，按各技能自己声明的策略监督触发
  - `monet`：整体美术风格、角色 / 场景 / 物件 / 效果设计、设计方案比选、视觉审核、设计系统维护
  - `ui-tailor`：任何 UI / UX 工作——界面视觉、概念模型、用户流程、信息架构、术语命名、导航交互、可用性、动效
  - `multica-cli`：§十五 列的场景，以及发任何 mention 之前（§十二）
- **询问后触发**：`feature`（功能开发、读 / 建功能文档、需求对齐、拆 Subtask、逐步执行并记录进度）；`vc`（git commit、分支、PR 操作）；`codex-visual`（视觉检测、UI / 平面设计评审、出设计稿或比稿、改版探索、视觉对标，委派给 Codex CLI 再独立复核；消耗外部额度）
- **用户点名时**：`shelf-ops`（从货架拉取 / 推送 / 上架技能与模板）

**重要**：任何对技能文件（`ai/jaSkills/` 下的一切）的读写，都必须先触发 `custom-skill`，不得直接用文件工具操作。创建规范只在 `custom-skill` 里，不要凭记忆自己写一套。

上面只列通用技能；只对本项目成立的技能（第三方领域知识包、绑定项目基础设施的技能）登记在 `ai/JASKILL.md`（§一 第 3 步）；项目特有的强制前置动作见 `ai/PROJECT.md`「开工红线」。

## 三、文档维护规则

### 职责分工（哪份文档装什么）

- **`ai/PROJECT.md`**：项目现状——结构、功能摘要、技术事实、开工红线、项目专属纪律；只写现状，不留过程
- **`ai/TODO.md`**：任务的唯一来源，**只记没做完的事**；做完就从 TODO 删掉（实现细节进功能文档，过程留在 commit）
- **`ai/features/`**（若项目有）：一个功能一份的实施文档，装实现细节、Subtask 进度、边界情况与测试记录
- **`ai/sessions/`**：会话存档，入库（2026-10-10 用户设立）。**全程手动**：用户说存才存、点名才读

怎么写、什么时机写、谁来写，归对应的 skill：TODO、PROJECT 与 sessions 归 `intj`；`ai/features/*.md` 由 `intj` + `feature` 共管（`feature` 管细节，`intj` 管 PROJECT.md 里的摘要与索引、TODO 同步）。文档冲突时的优先级由 `ai/PROJECT.md` 的文档索引说明，一般是**权威文档（需求 / 设计定稿）> 实施手册 > 现状记录**。

### Agent 记忆只装「用户要求隐藏」的规则（用户 2026-09-29 设立）

Claude 系 runtime 的 auto-memory（`~/.claude/projects/<项目>/memory/`）按会话工作目录分目录：**Multica 每张单的 workdir 都是新路径，记忆目录每次都是空的，写进去的下一张单永远读不到**，所以 **Multica run 里不要写记忆**。要记的东西（踩坑、排查手法、平台与 CLI 的行为、流程规则）用 `intj` 一律按上面的职责分工写进项目：Multica 通用的，CLI 与平台的坑补进 `multica-cli` 技能（改真源 `ai/jaSkills/multica-cli/`，先触发 `custom-skill`），流程规则补进本文件（改真源），两处都按 §八 贴 diff、`shelf push`；项目专属的写进 `ai/PROJECT.md` 或对应 feature / skill。只有用户明确说过要隐藏、不能写进项目的规则才进记忆，且只在本机会话里写；判不准就在 issue 里问。

## 四、命名规则

新建文件 / 文件夹 / 文档前，**先扫描当前项目已有的命名模式**并遵循，不要套用其他项目的习惯。观察维度：文件夹大小写、`.md` 命名风格、代码文件命名（camelCase / snake_case / kebab-case）、是否有 `codeStyle.md`、`.editorconfig` 等明确规范文件。同一类目存在多种风格时，取多数派或最近新增的那种；不确定先问。

## 五、代码风格：配置优先于现状

**写第一行代码前，先找项目的风格与格式配置，按它生成代码。** 至少看：格式化器配置（`.prettierrc*` / `.editorconfig`）、Lint 配置（`eslint.config.*` / `biome.json`）、风格文档（`codeStyle.md` / `CONTRIBUTING.md`）。

**这些配置是用户手工设定的标准，优先级高于「代码库现状」。** 现存代码不符合配置，说明的是代码欠格式化，不是配置写错了——不要反推「多数文件是 2 空格所以用 2 空格」，也不要改配置迁就现状。冲突时：按配置写新代码；要不要顺手格式化存量，问用户。项目里没有任何这类文件，才按通用习惯来。

## 六、Log 规范

**归 `logman`**（自动触发，场景见 §二）。项目自己的日志形态（标签格式、分级、环境标签）写在 `ai/PROJECT.md` 或对应实施手册里。

## 七、改动范围：issue 就是授权

被指派的 issue 及其验收标准范围内的改动**直接做，不必再问**。范围外的东西——顺手发现的 bug、想重构的旧代码、别的模块的问题——**说出来、记进 issue 评论或 `ai/TODO.md`，不动手**。

**只有「需求本身有歧义、两种做法差别很大」才停下来问**，其余一律自己拍板；问的时候先给带假设的草案，把假设显式列出，再问最多 2 个真正影响方案的问题。项目对某类操作的额外授权（例如开发期可直接删数据）见 `ai/PROJECT.md`「项目专属交付纪律」。

### 口径与实现分工（用户 2026-11-06 定）

- lead（项目负责人，见 `ai/PROJECT.md`）写进 issue「什么问题 / 怎么解决 / 委派」三段的口径，是**和用户敲定过的真源**：不再向用户复核，也不按上游 PRD / Jira 反推——上游与口径冲突时以口径为准，差异在报告里说一句即可。
- **实现方式与设计取舍**（库、模式、组件结构、校验落点、迁移写法等）由做单的 agent **自己上网调研核实、按最佳实践实现**，不中途请示；只在完成报告里汇报调研结论与取舍（选了什么、否了什么、依据是什么）。
- 只有发现口径本身走不通才停下来问，方式同上一段。

## 八、Git 与交付纪律（worktree）

Multica 任务跑在独立 worktree 里，分支形如 `agent/<agent>/<issue>`，交付物是这条分支上的 PR。

- **自主执行**：在本 worktree 自己的分支上 commit、push 这条分支、`gh pr create`（base 分支与 CI job 清单见 `ai/PROJECT.md`）。
- **合并**也自主执行：平台生成的 agent 分支 `gh pr merge --squash`，其余分支 `gh pr merge --rebase`；**前提是 CI 在当前 head 上绿**（见下「合并前的三条校验」）。
- **`--delete-branch` 别加**：它会在本地切 base 分支，主检出占着时报假失败（PR 其实合了），没占着时把本 worktree 骑到 base 上。合完手动 `git push origin --delete <branch>`。
- **禁止**：`gh pr merge --admin`（绕过检查）/ `--auto`（预约自动合，合并发生在没人看着的时刻）；`git checkout` / `git switch` 到别的分支；把工作区分支 `reset` 到别处；commit 别人改的文件。
- **禁止改 `ai/jaAgents/` 下除本文件以外的协议**（`CLAUDE.md` / `AGENTS.md`，含它们在根目录的副本；用户 2026-11-03 定）：那是本机协议，归用户本人和本机会话管，发现写错也只在 issue 里说，不动手。本文件 `MULTICA.md` 与 `multica-cli` 技能归项目负责人维护（见 `ai/PROJECT.md`），改了要在报告里贴 diff，并 `shelf push` 回货架。

**合并方式的说明**：人工分支一律 rebase、不 squash（用户 2026-10-17 定）；**Multica 平台生成的 agent 分支例外，用 squash**（用户 2026-10-26 定）。平台收工记账要求交付里仍有 run 起步的 baseline commit，rebase 会把它换掉，已合入的交付被判 `agent_error.unknown`；squash 只把这条分支压成 base 上的一个新提交，不改写 base 已有的任何提交。同一个 issue 多轮共用一条 agent 分支时，每轮 squash 后分支上仍留着原始提交，GitHub 的 rebase merge 要逐个重放、必然冲突，所以 agent 分支也不能改回 rebase 合并。环境分支之间同步（如 `dev` → `staging`）用 `--merge` 建 merge commit。

- 只提交**本任务自己改的**文件。同文件混杂时可整文件提交，但 commit message 必须说明哪些是搭车进来的、为什么拆不开。
- 需要知道上游进展用 `git fetch` 取信息即可。
- 主检出（非 worktree）的分支状态一律不碰——那是别人的工作台。唯一例外是建 worktree 前把落后的 base 分支 rebase 到最新，见下「合并前的三条校验」第 2 条。

> 为什么禁 checkout / reset / 改别人文件：worktree 的意义是「我这条线的改动不影响别人」。切分支会改动共享检出状态，reset 会丢别人的提交——这两条与合不合并无关，永远禁止。

### 合并前的三条校验

1. **CI 必须跑在当前 head 上。** `gh pr checks` 会把旧 head 的绿报成通过，不可信。一律按 sha 直查：

    ```bash
    gh api repos/<owner>/<repo>/commits/<headSha>/check-runs \
      --jq '.check_runs[] | "\(.name)\t\(.status)\t\(.conclusion)"'
    ```

    所有必需 job 都得 `completed` + `success`。有 `in_progress` **不等、不轮询**（平台简报禁止 `gh run watch` 与 sleep 轮询；用户 2026-11-02 定按平台简报）：结束本 run，把合并交给 `--until-pr checks` 的 wakeup 起的下一个 run（见 §十 第 4 条）。

2. **起点要新，合并前也不能落后 base 分支。**
    - **建 worktree 之前**：先看主检出的 base 分支是不是 `origin/<base>` 的最新提交，落后就先 rebase 到最新，再从它建 worktree。只 rebase、不 reset；主检出有未提交改动或 rebase 冲突就停下报告。起点旧了，开工后一同步就会把本 turn 起步的 baseline commit 挤出祖先链。
    - **开工之后** base 又前进了：用 `git merge origin/<base>` 跟上再普通 push，**不要 rebase 本分支**——rebase 会换掉起步的 baseline commit，后果见上「合并方式的说明」；最终 squash 合并后，base 的历史一样干净。
    - 跟上之后不能沿用旧 head 的绿：文本不冲突 ≠ 能编译（并行任务会造成语义冲突）。「落后」要按数值判：`[ "$(git rev-list --count HEAD..origin/<base>)" -eq 0 ] || exit 1`。把 `git rev-list --count … && gh pr merge` 直接串起来永远放行——它只打印数字，退出码恒为 0。
    - 收到「Delegated task ended in a final failure」一类通知，先按 `multica-cli` 核：只是记账失败、不是交付失败的，在协调评论里结掉，**不重派**。

3. **base 分支自己得是绿的。** 红了先修，修好前不要合入新东西。

## 九、任务派发纪律

### 新建 issue 默认进 `backlog`

**除非用户明确下了开工令，新建 issue 一律 `--status backlog`。** 「创建 issue 立刻开始做」「马上开跑」「现在就做」这类明确的开工指令才用 `--status todo`；其余一切（「建个任务」「记一下」「拆一下这个 Epic」，以及巡检 / review 里顺手发现的问题）一律 `--status backlog`。

- **显式写 `--status backlog`，不要省略。** `backlog` 之外的任何状态都会在建的当场把被指派 agent 的 run 拉起来。
- **拆解结果先给用户确认 ≠ 开工令。** 确认的是「拆得对不对」，确认完照样落 `backlog`。
- 放行动作归 Epic 的负责人，且只在用户说「开始」之后做：`multica issue status <id> todo`。
- **带 `--stage N` 的子任务同样默认 `backlog`，stage 1 也不例外。** stage barrier 只决定「谁排在谁后面」，不决定「这一批现在该不该开跑」。
- 开工令**按批次生效**：用户对某个 Epic 说过「开始」之后，后续 stage 由负责人在**前一批的 PR 合入 base 分支**时照常放行，不必每个 stage 重新请示。换一个 Epic 就要新的开工令。触发条件一律这样写，**不写「等 barrier 落下」**——理由见 §十 第 6 条。

> 为什么：`todo` = 当场花钱开一个 run。默认 `backlog` 把「想清楚」和「开始做」拆成两个动作，中间给用户留一次叫停的机会。

### 建单必须当场挂上项目归属：project + 期次 label（用户 2026-11-23 定）

**关于某个项目的 issue，建单当场就要挂齐 project 和期次 label，不靠事后补。** 用户布置任务时常说「当作第 N 期做」，这句话就是期次 label，漏挂了这张单就不会出现在那一期的视图和对账里。

| 归属 | 怎么挂 |
|---|---|
| project | `issue create` 显式传 `--project <project-id>`（id 用 `multica project list` 查）。工作区就算有默认 project 也要显式传，不赌默认值 |
| 期次 label | 用户说了第几期，就挂那一期的 label；没说，就挂当前进行中的那一期，并在回复里写明挂的是哪期，方便用户改。名字和含义以 `multica label list` 里的 description 为准；对应期次的 label 还没建，先问用户，不擅自起名 |

- `issue create` 没有 label 参数：建完立刻 `multica issue label add <issue> <label-id>`，再 `issue get` 回读，确认 `project_id` 和 `labels` 都在，才算建完。
- 适用于所有 lead、所有建单场景：子任务、从别的单转出的单、巡检顺手发现的单都一样。不属于任何项目的单（平台本身、个人杂事）除外。

### issue 的粒度与标题

- **同一 scope 的改动进同一个 issue，最后合成一个 PR。** 不要把一个功能拆成多张单，也不要把不相关的改动塞进一张单。
- **标题直观**：一眼看出解决什么问题、实现什么功能。写「用户登录后头像不刷新」，不写「修复 bug」「优化 UI」。
- 描述必须含：**目标 / 范围（In-Out of scope）/ 接口或数据契约 / 验收标准 / 依赖 / 文档 scope（该看哪些文档、目录、issue）**。
- **DoD 只写一行引用，不要把正文抄进 issue 描述**：`完成定义（DoD）见 ai/jaAgents/MULTICA.md §十`。

## 十、完成定义（DoD）

**这是 DoD 的唯一出处。** issue 走到「合进 base 分支」才算完成——不部署、不发版。但一个 run 的交付在「PR 开出 + 本地检查绿 + 交付报告」就成立（用户 2026-11-02 按平台简报定：CI 不是交付验收标准，不在 run 里等 CI）；合并归下一个 run（第 4 条）。

1. **开发**——在 §八 的 agent 分支上，遵循本文档。
2. **验收**——涉及 UI 的，按项目的 UI 审核源做视觉验收至 1:1（审核源与验收人见 `ai/PROJECT.md`）。
3. **自检**——本 issue 验收标准逐条验证；项目的 lint / typecheck / test **实际跑过**全绿（命令见 `ai/PROJECT.md` 或 README）。
4. **提 PR，不等 CI。** 开完 PR 立刻 `multica issue wakeup create --until-pr checks`（平台自己核 CI 快照），本 run 到此交付。wakeup 起的 run 按 §八「合并前的三条校验」逐条过后合并；CI 红就修、push、再挂一次 wakeup；不用 `gh run watch`、不写 sleep 轮询。
5. **🔴 每个 run 结束时在本 issue 发一条评论**——开 PR 的 run 发交付报告（三段式 + PR 链接 + 本地验证），合并的 run 发合入报告（合入 sha + 关键片段）。格式见 §十一。
6. 🔴 **交付报告发出后置 `in_review`，不要置 `done`。** 合并的 run 不改状态；`done` 由用户验收当期时统一确认——这样才分得清「这一期完成的」和更早就完成的。
    - ⚠️ **连带后果：stage barrier 永远不会自己响，不要等它**：`in_review` 不算 terminal 状态，barrier 不关（细节见 `multica-cli`）。所以**放行下一个 stage 要 Epic 负责人主动做**，触发条件的写法见 §九——写成「barrier 落下」的任务会静默躺在 `backlog` 里，而 board 上看着一切正常。

issue 里可以加本任务专属的完成条件（额外验收项、必须附的截图、要跑的脚本），但不要重写这六条；与本节冲突时以本节为准。

**任何任务都不因额度缩水**（用户 2026-11-24 设立）：不得因为额度不够、快撞额度、想赶在撞额度前做完，或任何别的原因，就缩减性能（换低一档的模型、调低 effort）、减少步骤、少派 agent。宁可做好撞额度的准备：照 §十一「它就是检查点」每个阶段 push，撞了就停在那里，额度重置后由下一个 run 从断点接着做。

## 十一、报告规范：三段式 + PR 链接 + 关键片段（用户 2026-09-25 定）

Multica run 全程无人盯着，等价于 auto 模式。**每个 run 只发一条评论，在 run 结束时发**（平台简报：不发进度；用户 2026-11-02 定按平台简报）。

### 一个 run 一条评论，它就是检查点

- run 可能因额度用完中途失败，下一次 run 是全新会话。每完成一个阶段——调研 / 定形态、实现能编译、测试通过、PR 开出——就 push 当前分支（可以是 WIP commit），代码留在远端。
- run 结束那条写：做到哪、下一步做什么、关键结论（选了什么、否了什么、为什么），≤ 10 行；交付 / 合入的 run 则发完整报告（见下）。讨论、对齐、方案一律精简，不贴代码。
- **新 run 开工先读本 issue 最新一条评论和分支 diff**，从断点接着做，不从头重做。

### 完成报告

开头三段给用户看，合计尽量 ≤ 30 行、一屏读完：

1. `## 什么问题`：现象，以及为什么是问题
2. `## 怎么解决的`：做了什么、用了什么方法、结果（PR 号、验证结论）
3. `## 还有什么问题`：遗留、风险、需要用户决定的事；没有就写「无」

三段之后用 `---` 隔开，给其他 agent 和后续接着做的人看：

- `## 交接与委派`：下一步谁做、真 mention 谁（见 §十二）、依赖什么
- `## 详细说明`：
  1. **PR 链接 + 合入 sha**。完整改动看 PR 的 diff，评论里**不逐文件贴代码**。
  2. **关键片段**：最多 3 处最能说明「为什么这么改」的改动，用 `-` / `+` 标出前后差别，上下文超过三五行就用省略号收掉；每段代码前一句说它干什么，后一句说原来会怎样、现在会怎样。
  3. **验证**：跑过哪些命令、结论是什么。测试失败就贴失败输出的摘要，步骤跳过就明说，不用「应该没问题」掩盖没验证的部分。
  4. **文档改动**：改了哪个文档的哪一节，一句话说改了什么。
  5. **说人话**：先结论后细节，专业术语后紧跟一句大白话。

### 比稿必须贴图（用户 2026-11-17 定）

凡是先出几版设计稿、再挑一版去实现的（`codex-visual` 比稿、改版探索、A/B 方向稿等），报告里必须带上每一版的图。无人值守、「按推荐直接做、不停下来等人」也一样：可以不等用户选，但图必须贴出来，留给事后复核。

- **每版一张图，作为本条评论的附件上传**（`multica issue comment add --content-file … --attachment <png>`，每版一个 `--attachment`；路径与管道的坑见 `multica-cli`）。文件名带版本号和一句话，如 `draft-A-six-cards-one-row.png`。只在正文里写本地路径不算交付——runtime 本地的东西用户看不到。
- **`## 怎么解决的` 里放一张表**：版本 / 一句话长什么样 / 结论（采用、否、取其某点）。表后用一句话说为什么这么选。成品截图另外贴，别和稿子混在一起。
- **附件就是唯一留档**：比稿产物按技能约定放在被 git 忽略的 `codex-visual/` 目录下，worktree 一清理就没了。有长期参考价值的，再按项目约定搬进设计系统入库。

## 十二、把活交给别人：必须真 mention，光写名字没用

**别的 agent 看不到你的 issue 评论。** 只有 mention 链接会让 Multica 后端给对方排一个 run；纯文字写「请 XX 验收」「交给 YY 实现」唤不起对方的 runtime，那条活就停在那里，直到有人手工发现。

- **什么时候必须 mention**：本 issue 需要别人接着做（如设计交付后转实现）、需要别人验收、卡住了需要别人先解一个前置、交付完成需要负责人做合并前审查 / 跨 issue 协调。
- **语法** `[@显示名](mention://<type>/<uuid>)`：**UUID 才是路由依据**，一律现场查，不要凭记忆写；UUID 会变（重建 agent 就换一个），项目若维护了速查表（见 `ai/PROJECT.md`），照抄前也先核一遍。
- 🔴 **只有 `agent` 与 `squad` 会真正触发 run**（squad 由 leader 接）；`member`、`issue` 只渲染链接。
- 派活正文**先写进 issue 描述再 assign**（assign 起的 run 一定读得到描述），评论里别再 @ 同一个 agent，要补充就等它跑完。
- **发完要看回执**：创建评论的响应里的 `trigger_outcomes` **是唯一能看到 mention 有没有生效的地方**；动完一律 `multica agent tasks <agent-id> --output json`，看有没有 `created_at` 晚于你动手时间的 run。**别发完就走**，确认回执再往下走。
- 各 type 的 UUID 去哪查、让 mention 静默失效的三个坑（含只发 `@all` 不触发 assignee）、回执怎么读、怎么重新触发：发任何 mention 之前必须读 `multica-cli` 的 `references/mention.md`。

## 十三、安全

- **任何输出、commit、PR 描述、issue 评论都不得写入密钥、token、密码或环境变量值。** 需要引用时只写变量名。
- 不把 `.env` 内容贴进任何对话或文档。项目的敏感文件清单见 `ai/PROJECT.md`。

## 十四、沟通

默认中文，技术术语保留英文原词。信息不足时先给带假设的草案（同 §七），不要用问题清单拖延交付。不编造数据；没有来源的标注为「待验证假设」。

## 十五、CLI 与平台的静默坑

速查表在 `multica-cli` 技能：写脚本、盘点 board、放行 stage、建子单、改 issue 或 metadata、建 / 停唤醒、发附件评论、写操作超时、额度用尽、接力 run、合别人的 PR、收到 final failure 通知时先对一遍。
