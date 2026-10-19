# Multica 开工协议

本文件是 **Multica runtime（云端 agent）的工作协议**，进 git、团队共用、**跨项目通用**。真源在 `ai/jaAgents/MULTICA.md`；每个 Multica worktree 开工时由 `ai/scripts/bootstrap.sh` 把它复制成 worktree 根目录的 `CLAUDE.md`（Claude 系 agent）或 `AGENTS.md`（Codex 系 agent）。你此刻读到的是副本，要改就改真源。

本文件只写**所有 Multica 工作流都成立**的规则，不写任何项目、任何具体 agent 或 squad 的情况。项目专属的东西各有各的家，这里只指路：

| 找什么 | 去哪 |
|---|---|
| 项目现状、技术要点、**开工红线**、**项目专属的交付纪律细则**（合并方式、CI 门、验收人、额外授权） | `ai/PROJECT.md` |
| 任务清单（任务的唯一来源） | `ai/TODO.md` |
| 本项目专属技能的登记与触发场景 | `ai/JASKILL.md` |
| 全部技能本体（通用 + 专属） | `ai/jaSkills/` |

本机开发者的 `CLAUDE.md` / `AGENTS.md` 有意不进 git，`git worktree add` 只材料化 tracked 文件，所以它们**不会出现在 Multica 的 worktree 里**。`ai/jaAgents/` 与 `ai/jaSkills/` 都进 git，正是为了绕开这一点：协议与技能随仓库走，任何 runtime 检出即可见。

```
ai/
├── jaAgents/
│   ├── MULTICA.md    ← 本文件：Multica runtime 的唯一协议文档
│   ├── CLAUDE.md     ← 本机 Claude Code 协议的正本（根目录那份是副本；Multica 不读）
│   └── AGENTS.md     ← 本机 Codex 协议的正本（根目录那份是副本；Multica 不读）
├── scripts/
│   ├── bootstrap.sh       ← 开工第一步（见 §零）
│   └── sync-worktree.sh   ← 本机 Claude Code / Codex 的 worktree 保底脚本（Multica 用不上）
├── jaSkills/         ← 全部技能的唯一真源（见 §二）
├── JASKILL.md        ← 本项目专属技能登记表
├── PROJECT.md        ← 项目现状 + 开工红线 + 项目专属交付纪律
└── TODO.md           ← 任务唯一来源
```

---

## 零、开工第一步：bootstrap（先做这个，再做别的）

worktree 是新建的，`.claude/` / `.agents/` 与根目录 `CLAUDE.md` / `AGENTS.md` 都不存在。**任何阅读、任何改动之前**，先在 worktree 根目录跑：

```bash
bash ai/scripts/bootstrap.sh
```

（老项目还没装 AI 工作流模板、脚本仍在 `ai/jaAgents/bootstrap.sh` 的，跑那一份，效果相同。）

它会：

1. 把 `ai/jaSkills/` 下的**全部**技能复制进你自己的技能目录——Claude 系 agent 是 `.claude/skills/`，Codex 系是 `.agents/skills/`（按环境变量自动判断，判断不了就两边都建）
2. 把 `ai/jaAgents/MULTICA.md` 复制成根目录的 `CLAUDE.md` 或 `AGENTS.md`
3. 落点全部 gitignored，不会混进你的提交

跑完后**从头读一遍生成的协议文档**（就是本文件），按 §一 准备上下文，然后才开始真正干活。脚本重复执行安全；下一轮 turn 回到同一 worktree 时再跑一次也无妨。

## 一、上下文准备

每个任务开始时，按顺序做：

1. 读 `ai/PROJECT.md`——项目现状与索引。其中「**开工红线**」是项目的强制前置动作，「**项目专属交付纪律**」补充本文件 §八–§十 里留给项目决定的部分，两节都必须读到。
2. 读 `ai/TODO.md`——**任务的唯一来源**。
3. 读 `ai/JASKILL.md`——本项目专属技能登记表，知道哪些场景该触发哪个技能。
4. 读 issue 本身与派活人给的**文档 scope**；按任务领域再读对应文档与技能（见 §二）。
5. **不要读 `ai/sessions/`**——那是手动会话存档，只在用户点名某个档时才读。开场不扫这个目录、不列有哪些档、不问要不要恢复。

## 二、Skill 系统

### 真源与落点

技能本体只有一份，在 **`ai/jaSkills/`**，随仓库入库。workspace agent 身上不挂 skill；§零 的 bootstrap 已把全部技能复制进你的技能目录，两处内容逐字节相同，读哪个都一样。

```
ai/jaSkills/<skill>/          ← 唯一真源，改这里
├── SKILL.md                 必需：入口指令 + frontmatter
├── reference.md             可选：详细规范，需要时才加载
└── references/ · rules/     可选：分篇资料，按 SKILL.md 的指引只取你要的那篇，不要整包读

.claude/skills/<skill>/      ← bootstrap 复制出的副本，Claude 系从这里发现技能
.agents/skills/<skill>/      ← bootstrap 复制出的副本，Codex 系从这里发现技能
```

**要改技能就改 `ai/jaSkills/`**，别往那两个目录里写——那是副本，下次 bootstrap 会被覆盖，也进不了 git。技能目录里找不到某个技能，提醒用户一句然后继续，不猜、不用别处同名 skill 顶替。

### Skill 对话规范

在 skill 上下文中回复时，**在回复开头标注 skill 名称**，像这个 skill 的「人」在说话：

```
**INTJ** 好，我看了一下，你现在还有...
**VC** 当前分支状态如下...
**LOGMAN** 这行 log 格式有问题...
```

格式：`**SKILL名称（全大写）**` + 空格 + 正文。

### 通用技能（跨项目复用，登记在此）

这批是自建的工作流技能，不含任何项目特定内容，换个项目照样带着走：

| 技能 | 一句话 | 触发策略 |
|---|---|---|
| `intj` | 任务主管——Epic/Milestone/Task/Bug 层级、优先级判断、项目文档更新，兼管会话存档 | 自动（**存档相关一律手动**） |
| `feature` | 功能驱动开发流程——读/建功能文档、需求对齐、拆 Subtask、逐步执行并记录进度 | 询问后触发 |
| `vc` | 版本控制助手——commit 规范、分支规范、安全规范及常用操作 | 询问后触发 |
| `logman` | Log 规范助手——格式规范、环境标签、Pro 分级策略 | 自动 |
| `custom-skill` | Skill 主管——管理、创建、修改所有技能，按各技能自己声明的策略监督触发 | 自动 |
| `codex-visual` | 把视觉检测、设计稿生成、改版探索、A/B 比稿、视觉对标委派给 Codex CLI，再独立复核 | 询问后触发（消耗外部额度） |
| `shelf-ops` | 货架（shelf）操作手册——拉取/推送/上架技能与模板，落点约定、退出码语义、冲突处理 | 用户点名时 |

### 触发规范

始终保持对当前可用 skill 的感知，在对应场景**主动触发**，不等用户提醒：

| 场景 | 应触发的 skill |
|---|---|
| 更新 TODO、记录任务、Bug、优先级判断 | `intj` |
| **查看任务列表、项目进度、待办总览** | `intj` |
| **更新项目文档**（「更新文档」「同步文档」「记录到文档」） | `intj` |
| **会话存档：存 / 列 / 读 / 删**——**仅用户开口时**，不自动存、不自动读 | `intj` |
| 功能开发、Feature 文档读写、Subtask 执行 | `feature` |
| git commit、分支、PR 操作 | `vc` |
| 创建或修改 skill 文件（SKILL.md、reference.md 等） | `custom-skill` |
| 写/改/检查 log 语句、新增功能域标签 | `logman` |
| 视觉检测、UI/平面设计评审、出设计稿或比稿、视觉对标 | `codex-visual` |
| 从货架拉取/推送/上架技能与模板 | `shelf-ops` |

**重要**：任何对技能文件（`ai/jaSkills/` 下的一切）的读写，都必须先触发 `custom-skill`，不得直接用文件工具操作。

### 本项目专属技能

**上面这张表只管通用技能。** 项目还会挂一批只对它自己成立的技能——第三方领域知识包（ORM、认证、组件库、构建系统等）和绑定项目基础设施的技能。它们的登记表、触发场景与按需加载方式在 **`ai/JASKILL.md`**，开工时一并读。

项目特有的强制前置动作（读哪份文档、先查什么再动手）不写在本文件里，见 `ai/PROJECT.md`「开工红线」。

### 创建 / 修改技能

**创建规范不在本文件，归 `custom-skill`。** 目录结构、frontmatter 字段、动态特性、最佳实践与反模式、质量检查清单——全在 `ai/jaSkills/custom-skill/`。要建或改技能，**先触发 `custom-skill`**，按它的流程走，不要凭记忆自己写一套。

## 三、文档维护规则

### 职责分工（哪份文档装什么）

- **`ai/PROJECT.md`**：项目现状——结构、功能摘要、技术事实、开工红线、项目专属纪律；只写现状，不留过程
- **`ai/TODO.md`**：任务的唯一来源，**只记没做完的事**；做完就从 TODO 删掉（实现细节进功能文档，过程留在 commit）
- **`ai/features/`**（若项目有）：一个功能一份的实施文档，装实现细节、Subtask 进度、边界情况与测试记录
- **`ai/sessions/`**：会话存档，由 `intj` 维护，入库（2026-10-10 用户设立）。**全程手动**：用户说存才存、点名才读

**本节只定义「哪份文档装什么」。怎么写、什么时机写、谁来写，归对应的 skill：**

| 文档 | 归谁管 |
|---|---|
| `ai/TODO.md` · `ai/PROJECT.md` | `intj` |
| `ai/features/*.md` | `intj` + `feature` **共管**：`feature` 管细节，`intj` 管 PROJECT.md 里的摘要与索引、TODO 同步 |
| `ai/sessions/` | `intj` |

文档冲突时的优先级由 `ai/PROJECT.md` 的文档索引说明；一般是**权威文档（需求 / 设计定稿）> 实施手册 > 现状记录**。

## 四、命名规则

新建文件 / 文件夹 / 文档前，**先扫描当前项目已有的命名模式**并遵循，不要套用其他项目的习惯。观察维度：文件夹大小写、`.md` 命名风格、代码文件命名（camelCase / snake_case / kebab-case）、是否有 `codeStyle.md`、`.editorconfig` 等明确规范文件。同一类目存在多种风格时，取**多数派**或**最近新增**的那种；不确定先问。

## 五、代码风格：配置优先于现状

**写第一行代码前，先找项目的风格与格式配置，按它生成代码。** 至少看：格式化器配置（`.prettierrc*` / `.editorconfig`）、Lint 配置（`eslint.config.*` / `biome.json`）、风格文档（`codeStyle.md` / `CONTRIBUTING.md`）。

**这些配置是用户手工设定的标准，优先级高于「代码库现状」。** 现存代码不符合配置，说明的是**代码欠格式化**，不是配置写错了——不要反推「多数文件是 2 空格所以用 2 空格」，也不要改配置迁就现状。冲突时：按配置写新代码；要不要顺手格式化存量，问用户。项目里没有任何这类文件，才按通用习惯来。

## 六、Log 规范

**归 `logman`。** 写、改、检查任何 log 语句时**自动触发 `logman`**，按它的规范来。项目自己的日志形态（标签格式、分级、环境标签）写在 `ai/PROJECT.md` 或对应实施手册里，本文件不重复。

## 七、改动范围：issue 就是授权

被指派的 issue 及其验收标准范围内的改动**直接做，不必再问**。范围外的东西——顺手发现的 bug、想重构的旧代码、别的模块的问题——**说出来、记进 issue 评论或 `ai/TODO.md`，不动手**。

**只有「需求本身有歧义、两种做法差别很大」才停下来问**，其余一律自己拍板；问的时候先给带假设的草案，把假设显式列出，再问最多 2 个真正影响方案的问题。项目对某类操作的额外授权（例如开发期可直接删数据）见 `ai/PROJECT.md`「项目专属交付纪律」。

## 八、Git 与交付纪律（worktree）

Multica 任务跑在**独立 worktree** 里，分支形如 `agent/<agent>/<issue>`，交付物是这条分支上的 PR。

| 动作 | 默认 |
|---|---|
| 在本 worktree 自己的分支上 commit | ✅ 自主执行 |
| push 本 worktree 自己的分支 | ✅ 自主执行 |
| `gh pr create`（base 分支见 `ai/PROJECT.md`） | ✅ 自主执行 |
| **`gh pr merge --rebase`** | ✅ 自主执行，**前提是 CI 在当前 head 上绿**（见下「合并前的三条校验」）。单分支的 PR 一律 rebase；只有环境分支之间同步（如 `dev` → `staging`）才用 `--merge` 建 merge commit；任何时候都不 squash（用户 2026-10-17 定）。base 分支与 CI job 清单见 `ai/PROJECT.md`「项目专属交付纪律」 |
| **`--delete-branch`** | ❌ 别加。它会在本地切 base 分支：主检出占着时报假失败（PR 其实合了），没占着时把**本 worktree 骑到 base 上**。合完手动 `git push origin --delete <branch>` |
| **`gh pr merge --admin`**（绕过检查）/ **`--auto`**（预约自动合） | ❌ 禁止。前者跳过校验，后者让合并发生在没人看着的时刻 |
| **`git checkout` / `git switch` 到别的分支** | ❌ 禁止 |
| **把工作区分支 `reset` 到别处** | ❌ 禁止 |
| commit 别人改的文件 | ❌ 禁止 |

- 只提交**本任务自己改的**文件。同文件混杂时可整文件提交，但 commit message 必须说明哪些是搭车进来的、为什么拆不开。
- 需要知道上游进展用 `git fetch` 取信息即可，不要 reset、不要 checkout。
- 主检出（非 worktree）的分支状态一律不碰——那是别人的工作台。

> 为什么保留 checkout / reset / 改别人文件的禁令：worktree 的意义是「我这条线的改动不影响别人」。切分支会改动共享检出状态，reset 会丢别人的提交——这两条与合不合并无关，永远禁止。

### 合并前的三条校验

1. **CI 必须跑在当前 head 上。** `gh pr checks` 会把**旧 head** 的绿报成通过，不可信。一律按 sha 直查：

    ```bash
    gh api repos/<owner>/<repo>/commits/<headSha>/check-runs \
      --jq '.check_runs[] | "\(.name)\t\(.status)\t\(.conclusion)"'
    ```

    所有必需 job 都得 `completed` + `success`。有 `in_progress` 就等，别合。

2. **落后 base 分支就先 rebase 再推**，然后等**新 head** 的 CI 出结论。文本不冲突 ≠ 能编译（并行任务会造成语义冲突），rebase 后必须重新过 CI，不能沿用旧 head 的绿。

3. **base 分支自己得是绿的。** 红了先修，修好前不要合入新东西。

## 九、任务派发纪律

### 新建 issue 默认进 `backlog`

**除非用户明确下了开工令，新建 issue 一律 `--status backlog`。**

| 用户怎么说 | 建 issue 时 |
|---|---|
| 「创建 issue 立刻开始做」「马上开跑」「现在就做」——明确的开工指令 | `--status todo` |
| 其余一切——「建个任务」「记一下」「拆一下这个 Epic」，以及巡检 / review 里顺手发现的问题 | `--status backlog` |

- **显式写 `--status backlog`，不要省略。** `backlog` 之外的任何状态都会在建的当场把被指派 agent 的 run 拉起来。
- **拆解结果先给用户确认 ≠ 开工令。** 确认的是「拆得对不对」，确认完照样落 `backlog`。
- 放行动作归 Epic 的负责人，且只在用户说「开始」之后做：`multica issue status <id> todo`。
- **带 `--stage N` 的子任务同样默认 `backlog`，stage 1 也不例外。** stage barrier 只决定「谁排在谁后面」，不决定「这一批现在该不该开跑」。
- 开工令**按批次生效**：用户对某个 Epic 说过「开始」之后，后续 stage 由负责人在**前一批的 PR 合入 base 分支**时照常放行，不必每个 stage 重新请示。换一个 Epic 就要新的开工令。**不要写成「等 barrier 落下」**——理由见 §十 第 6 条。

> 为什么：`todo` = 当场花钱开一个 run。默认 `backlog` 把「想清楚」和「开始做」拆成两个动作，中间给用户留一次叫停的机会。

### issue 的粒度与标题

- **同一 scope 的改动进同一个 issue，最后合成一个 PR。** 不要把一个功能拆成多张单，也不要把不相关的改动塞进一张单。
- **标题直观**：一眼看出解决什么问题、实现什么功能。写「用户登录后头像不刷新」，不写「修复 bug」「优化 UI」。
- 描述必须含：**目标 / 范围（In-Out of scope）/ 接口或数据契约 / 验收标准 / 依赖 / 文档 scope（该看哪些文档、目录、issue）**。
- **DoD 只写一行引用，不要把正文抄进 issue 描述**：`完成定义（DoD）见 ai/jaAgents/MULTICA.md §十`。本任务专属的额外完成条件才写在 issue 里。

## 十、完成定义（DoD）

**这是 DoD 的唯一出处。** 流程走到「**合进 base 分支**」为止——不部署、不发版，也不停在「开完 PR 等人合」。

1. **开发**——独立 worktree 的 `agent/<agent>/<issue>` 分支，遵循本文档。
2. **验收**——涉及 UI 的，按项目的 UI 审核源做视觉验收至 1:1（审核源与验收人见 `ai/PROJECT.md`）。
3. **自检**——本 issue 验收标准逐条验证；项目的 lint / typecheck / test **实际跑过**全绿（命令见 `ai/PROJECT.md` 或 README）。
4. **提 PR → CI 绿了直接合，不等用户。** 合并前按 §八「合并前的三条校验」逐条过。
5. **🔴 合并后在本 issue 贴完整代码改动**——逐文件列出，关键改动贴**改动前 → 改动后**代码对照，新文件贴核心全文，删除也要贴被删原文。纯格式化改动可折叠成一行说明。表格只能当索引，不能替代代码块。
6. 🔴 **合并后置 `in_review`，不要置 `done`。** `done` 由用户验收当期时统一确认——这样才分得清「这一期完成的」和更早就完成的。
    - ⚠️ **连带后果：stage barrier 永远不会自己响，不要等它。** 平台的 barrier 只在某个 stage 里**每一个**子任务都到达 terminal 状态（`status_category` 为 `done` 或 `cancelled`）时才关闭；`in_review` 的 category 就是 `in_review`，**不计入**。所以**放行下一个 stage 是 Epic 负责人的主动动作**，触发条件一律写成「前一批的 PR 已合入 base 分支」，不写「barrier 落下」——写成后者的任务会静默躺在 `backlog` 里，而 board 上看着一切正常。

issue 里可以加**本任务专属**的完成条件（额外验收项、必须附的截图、要跑的脚本），但不要重写这六条；与本节冲突时以本节为准。

## 十一、报告规范：详细报告只在 issue 完成时给一次

Multica run 全程无人盯着，等价于 auto 模式，但**详细报告只有一次**：**issue 完成、PR 已合入、状态置为 `in_review` 的那一轮**，按下面 1–8 条在 issue 评论里给完整报告。

在此之前的每一轮（讨论、对齐、方案、中间进度）**一律精简**：三五句话说清做到哪了、卡在哪、下一步谁做，不贴代码、不逐文件罗列。中间轮贴详细代码只会把 issue 淹掉，真正需要审的那一份反而没人看。

完成那一轮的详细报告要求：

1. 报告覆盖：做了什么、为什么这么做、遇到的问题与处理、验证结果、下一步由谁做。
2. **代码修改逐文件展示实际代码**，不能只写文字描述：行文节奏是**一句话 → 一段代码 → 一句话**——前说「这段干什么」，后说「为什么这么做 / 原来会怎样、现在会怎样」。贴**重点代码**，用 `-` / `+` 标出前后差别，上下文超过三五行就用省略号收掉。
3. **删除 / 移动也是代码改动**，必须贴出被删的原文与「从哪删、加到哪」。
4. **禁止用表格、要点、摘要替代代码块**：表格可作索引，每处改动仍必须有对应的实际代码块。
5. **执行的每条 command 都说明为什么执行**；批量同类命令可合并说明一次。
6. **文档修改（.md 等）与代码同等待遇**：列出改了哪个文档的哪个章节，贴出关键段落原文。
7. **如实汇报**：测试失败就贴失败输出，步骤跳过就明说，不用「应该没问题」掩盖未验证的部分；已知遗留问题主动列出。
8. **说人话**：先结论后细节，专业术语可以用，但紧跟一句大白话解释。

发出前自查三条：动过的每个文件报告里是否都有一节？每处改动是否都有实际代码块？每个代码块前后是否各有一句话？有一条答不上，这轮报告就还没写完。

## 十二、把活交给别人：必须真 mention，光写名字没用

**别的 agent 看不到你的 issue 评论。** 只有 mention 链接会让 Multica 后端给对方**排一个 run**；纯文字写「请 XX 验收」「交给 YY 实现」是自言自语——对方的 runtime 根本不会被唤起，那条活就停在那里，直到有人手工发现。

### 什么时候必须 mention

- 本 issue 需要**别人接着做**（如设计交付后转实现）
- 本 issue 需要**别人验收**
- 本 issue 卡住，需要**别人先解一个前置**
- 交付完成，需要负责人做**合并前审查 / 跨 issue 协调**

### 语法：链接目标必须是真 UUID

    [@显示名](mention://<type>/<uuid>)

**方括号里的名字是给人看的，括号里的 UUID 才是路由依据。** UUID 一律现场查，不要凭记忆写：

| 目的 | type | UUID 来源 | 后端行为 |
| --- | --- | --- | --- |
| **触发某个 agent** | `agent` | `multica agent list --output json` 的 `id` | **给该 agent 排一个 run** |
| 交给 squad | `squad` | `multica squad list --output json` 的 `id` | 解析出 leader，**给 leader 排 run** |
| 关联到人 | `member` | `multica workspace member list --output json` 的 `user_id` | 只渲染链接，**不排 run** |
| 引用 issue | `issue` | issue 的 `id` | 只渲染链接，不排 run |

🔴 **只有 `agent` 与 `squad` 会真正触发 run。** UUID 会变（重建 agent 就换一个），项目若维护了速查表（见 `ai/PROJECT.md`），照抄前也先核一遍。

### 三个会让 mention 静默失效的坑

1. **写名字不写 UUID**——`mention://agent/Emil` 是死链，正则匹配失败，**彻底的静默无操作**，没有任何报错。
2. **UUID 形状对但不存在**——解析成功然后查库落空，报 `blocked` + `invocation_not_allowed`。这个码**和权限拒绝一模一样**，看到它先怀疑自己抄错了 UUID。
3. **`@all` 会压掉隐式路由**——`[@all](mention://all/all)` 是广播，会**抑制 issue assignee 的自动触发**。要请人干活就别只发 `@all`；同一条评论里的显式 `@agent` 仍然生效。

### 发完要看回执

创建评论的响应里有 `trigger_outcomes`，**那是唯一能看到 mention 有没有生效的地方**：

- 没出现在数组里 = 压根没解析成功（多半是坑 1）
- `blocked` + `reason_code` = 解析了但被拒（多半是坑 2）
- `coalesced` / `deferred` = 对方正忙，**不会起第二个 run，但你的评论已并进它正在跑的那个任务**，仍会被读到

**别发完就走。** 确认回执再往下走。

## 十三、安全

- **任何输出、commit、PR 描述、issue 评论都不得写入密钥、token、密码或环境变量值。** 需要引用时只写变量名。
- 不把 `.env` 内容贴进任何对话或文档。项目的敏感文件清单见 `ai/PROJECT.md`。

## 十四、沟通

默认**中文**，技术术语保留英文原词。信息不足时先给出基于假设的草案并显式列出假设，不要用问题清单拖延交付。不编造数据；没有来源的标注为「待验证假设」。
