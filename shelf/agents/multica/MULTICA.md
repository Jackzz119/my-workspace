# Multica 开工协议

本文件是 **Multica runtime（云端 agent）的工作协议**，进 git、团队共用、**跨项目通用**。真源在 `ai/jaAgents/MULTICA.md`；每个 Multica worktree 开工时由 `ai/scripts/bootstrap.sh` 把它复制成 worktree 根目录的 `CLAUDE.md`（Claude 系 agent）或 `AGENTS.md`（Codex 系 agent）；根目录已有 runtime 注入的身份简报时追加在简报下面（见 §零）。你此刻读到的是副本，要改就改真源。

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

worktree 是新建的，`.claude/` / `.agents/` 都不存在；根目录的 `CLAUDE.md` / `AGENTS.md` 可能不存在，**也可能已经是 runtime 注入的身份简报**。**任何阅读、任何改动之前**，先在 worktree 根目录跑：

```bash
bash ai/scripts/bootstrap.sh
```

（老项目还没装 AI 工作流模板、脚本仍在 `ai/jaAgents/bootstrap.sh` 的，跑那一份，效果相同。）

它会：

1. 把 `ai/jaSkills/` 下的**全部**技能复制进你自己的技能目录——Claude 系 agent 是 `.claude/skills/`，Codex 系是 `.agents/skills/`（按环境变量自动判断，判断不了就两边都建）
2. 把 `ai/jaAgents/MULTICA.md` 复制成根目录的 `CLAUDE.md` 或 `AGENTS.md`；那里已经有 runtime 注入的身份简报时，追加在简报下面
3. 主检出里被 git 忽略的环境配置文件（`.env`、`.env.local`、`.env.<环境>` 等，不含 `.env.example` 这类入库样板），本 worktree 缺的照同一相对路径补过来：主检出那份是指向仓库里的相对链接就建同样的链接（目标读不到就不建），其余复制成独立文件；已有的不覆盖，内容不读不打印，目标没被 git 忽略就不补
4. 落点全部 gitignored，不会混进你的提交

项目自己的补充步骤（比如给 app 建指向根 `.env` 的链接）放在 `ai/scripts/worktree.local.sh`，脚本补完上面几样后会跑它，以它的输出为准。

> 根目录已有 runtime 注入的身份简报时，脚本把本文件追加在简报下面，用 `BEGIN` / `END` 标记包住，报「追加在身份简报之后 1 份」；再跑只替换这一块，简报原样保留。**不要加 `--force`**：它会把身份简报整份换成本文件，身份与报告规则就从上下文里消失了。

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

### Agent 记忆只装「用户要求隐藏」的规则（用户 2026-09-29 设立）

Claude 系 runtime 自带的 auto-memory（`~/.claude/projects/<项目>/memory/`）与本机所有会话、所有 worktree 共用一个目录，每个会话开场都会加载。**只有用户明确说过要隐藏、不能写进项目的规则才写进去**。踩坑、排查手法、平台与 CLI 的行为、流程规则一律按上面的职责分工写进项目：Multica 通用的补进本文件 §十五（改真源），项目专属的写进 `ai/PROJECT.md` 或对应 feature / skill。判不准就在 issue 里问，不要先写记忆。

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
| **合并**：平台生成的 agent 分支 `gh pr merge --squash`，其余分支 `gh pr merge --rebase` | ✅ 自主执行，**前提是 CI 在当前 head 上绿**（见下「合并前的三条校验」）。人工分支一律 rebase、不 squash（用户 2026-10-17 定）；**Multica 平台生成的 agent 分支例外，用 squash**（用户 2026-10-26 定）：平台收工记账要求交付里仍有 run 起步的 baseline commit，rebase 会把它换掉、已合入的交付被判 `agent_error.unknown`；squash 只把这一条分支压成 base 上的一个新提交，不改写 base 已有的任何提交。环境分支之间同步（如 `dev` → `staging`）用 `--merge` 建 merge commit。base 分支与 CI job 清单见 `ai/PROJECT.md`「项目专属交付纪律」 |
| **`--delete-branch`** | ❌ 别加。它会在本地切 base 分支：主检出占着时报假失败（PR 其实合了），没占着时把**本 worktree 骑到 base 上**。合完手动 `git push origin --delete <branch>` |
| **`gh pr merge --admin`**（绕过检查）/ **`--auto`**（预约自动合） | ❌ 禁止。前者跳过校验，后者让合并发生在没人看着的时刻 |
| **`git checkout` / `git switch` 到别的分支** | ❌ 禁止 |
| **把工作区分支 `reset` 到别处** | ❌ 禁止 |
| commit 别人改的文件 | ❌ 禁止 |

- 只提交**本任务自己改的**文件。同文件混杂时可整文件提交，但 commit message 必须说明哪些是搭车进来的、为什么拆不开。
- 需要知道上游进展用 `git fetch` 取信息即可，不要 reset、不要 checkout。
- 主检出（非 worktree）的分支状态一律不碰——那是别人的工作台。唯一例外是建 worktree 前把落后的 base 分支 rebase 到最新，见下「合并前的三条校验」第 2 条。

> 为什么保留 checkout / reset / 改别人文件的禁令：worktree 的意义是「我这条线的改动不影响别人」。切分支会改动共享检出状态，reset 会丢别人的提交——这两条与合不合并无关，永远禁止。

### 合并前的三条校验

1. **CI 必须跑在当前 head 上。** `gh pr checks` 会把**旧 head** 的绿报成通过，不可信。一律按 sha 直查：

    ```bash
    gh api repos/<owner>/<repo>/commits/<headSha>/check-runs \
      --jq '.check_runs[] | "\(.name)\t\(.status)\t\(.conclusion)"'
    ```

    所有必需 job 都得 `completed` + `success`。有 `in_progress` 就等，别合。等的时候跑一次阻塞的 `gh run watch <run-id> --exit-status --interval 15`，别手写 `sleep` 轮询——前台 `sleep` 会被拦，循环几秒就退出，看着像 CI 卡住。

2. **起点要新，合并前也不能落后 base 分支。**
    - **建 worktree 之前**：先看主检出的 base 分支是不是 `origin/<base>` 的最新提交，落后就先 rebase 到最新，再从它建 worktree。只 rebase、不 reset；主检出有未提交改动或 rebase 冲突就停下报告。起点旧了，开工后一同步就会把本 turn 起步的 baseline commit 挤出祖先链。
    - **开工之后** base 又前进了：用 `git merge origin/<base>` 跟上再普通 push，**不要 rebase 本分支**。平台收工记账要求交付的 commit 仍包含起步的 baseline commit，rebase 会换掉它，已合入的交付会被判 `agent_error.unknown`；最终 squash 合并后，base 的历史一样干净。
    - 跟上之后等**新 head** 的 CI 出结论。文本不冲突 ≠ 能编译（并行任务会造成语义冲突），不能沿用旧 head 的绿。「落后」要按数值判：`[ "$(git rev-list --count HEAD..origin/<base>)" -eq 0 ] || exit 1`。把 `git rev-list --count … && gh pr merge` 直接串起来永远放行——它只打印数字，退出码恒为 0。
    - 收到「Delegated task ended in a final failure」一类通知时，先 `gh pr view <n> --json state,mergedAt` 核 PR：已合入、CI 绿在 PR head 上、保留的 worktree `git status --porcelain` 为空，就是记账失败、不是交付失败——在协调评论里结掉，**不重派**。

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
5. **🔴 合并后在本 issue 发完成报告**——格式见 §十一：三段式 + PR 链接 + 关键片段。完整改动以 PR 的 diff 为准，不在评论里逐文件贴。
6. 🔴 **合并后置 `in_review`，不要置 `done`。** `done` 由用户验收当期时统一确认——这样才分得清「这一期完成的」和更早就完成的。
    - ⚠️ **连带后果：stage barrier 永远不会自己响，不要等它。** 平台的 barrier 只在某个 stage 里**每一个**子任务都到达 terminal 状态（`status_category` 为 `done` 或 `cancelled`）时才关闭；`in_review` 的 category 就是 `in_review`，**不计入**。所以**放行下一个 stage 是 Epic 负责人的主动动作**，触发条件一律写成「前一批的 PR 已合入 base 分支」，不写「barrier 落下」——写成后者的任务会静默躺在 `backlog` 里，而 board 上看着一切正常。

issue 里可以加**本任务专属**的完成条件（额外验收项、必须附的截图、要跑的脚本），但不要重写这六条；与本节冲突时以本节为准。

## 十一、报告规范：三段式 + PR 链接 + 关键片段（用户 2026-09-25 定）

Multica run 全程无人盯着，等价于 auto 模式。**完成报告只在 issue 完成、PR 已合入、状态置为 `in_review` 的那一轮给一次。**

### 中间轮：精简 + 检查点

- 讨论、对齐、方案、中间进度一律精简：三五句话说清做到哪了、卡在哪、下一步谁做，不贴代码。
- 🔴 **检查点**：run 可能因为额度用完而中途失败，而下一次 run 是**全新会话，不会接着上次继续**（2026-09-24 实测：重跑的开局上下文都回到约 4 万 token）。所以每完成一个阶段——调研 / 定形态、实现能编译、测试通过、PR 开出——就做两件事：
  1. push 当前分支（可以是 WIP commit），让代码留在远端；
  2. 在 issue 留一条 ≤ 10 行的检查点评论：做到哪、下一步做什么、关键结论（选了什么、否了什么、为什么）。
- **新 run 开工先读最新的检查点评论和分支 diff**，从断点接着做，不从头重做。

### 完成报告

开头三段给用户看，合计尽量 ≤ 30 行、一屏读完：

1. `## 什么问题`：现象，以及为什么是问题
2. `## 怎么解决的`：做了什么、用了什么方法、结果（PR 号、验证结论）
3. `## 还有什么问题`：遗留、风险、需要用户决定的事；没有就写「无」

三段之后用 `---` 隔开，给其他 agent 和接手人看：

- `## 交接与委派`：下一步谁做、真 mention 谁（见 §十二）、依赖什么
- `## 详细说明`：
  1. **PR 链接 + 合入 sha**。完整改动看 PR 的 diff，评论里**不逐文件贴代码**。
  2. **关键片段**：最多 3 处最能说明「为什么这么改」的改动，用 `-` / `+` 标出前后差别，上下文超过三五行就用省略号收掉；每段代码前一句说它干什么，后一句说原来会怎样、现在会怎样。
  3. **验证**：跑过哪些命令、结论是什么。测试失败就贴失败输出的摘要，步骤跳过就明说，不用「应该没问题」掩盖没验证的部分。
  4. **文档改动**：改了哪个文档的哪一节，一句话说改了什么。
  5. **说人话**：先结论后细节，专业术语后紧跟一句大白话。

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
- `coalesced` / `deferred` = 对方正忙，这次触发并进了它手上的任务——但正在跑的 run 可能早就读完了评论，**不保证读得到这条**
- `queued` = 排在对方活 run 后面，活 run 结束后**会再起一个 run**；也可能随后被平台合并掉（`cancelled`）
- **回执为空（`{}`）也可能是被去重了**：对方在同一条 issue 上有活 run 时，`status` 翻转和普通评论都不会排新 run，也不报错

所以派活正文**先写进 issue 描述再 assign**（assign 起的 run 一定读得到描述），评论里别再 @ 同一个 agent，要补充就等它跑完。动完一律 `multica agent tasks <agent-id> --output json`，看有没有 `created_at` 晚于你动手时间的 run。重新触发首选 `multica issue rerun`；对同一个 agent 重复 assign 是静默的空操作；CLI 没有取消 task 的命令。去重只发生在同一 agent × 同一 issue，不同 issue 的 run 会并行。

**别发完就走。** 确认回执再往下走。

## 十三、安全

- **任何输出、commit、PR 描述、issue 评论都不得写入密钥、token、密码或环境变量值。** 需要引用时只写变量名。
- 不把 `.env` 内容贴进任何对话或文档。项目的敏感文件清单见 `ai/PROJECT.md`。

## 十四、沟通

默认**中文**，技术术语保留英文原词。信息不足时先给出基于假设的草案并显式列出假设，不要用问题清单拖延交付。不编造数据；没有来源的标注为「待验证假设」。

## 十五、CLI 与平台的静默坑（速查）

下面这些命令都「成功」了，给的却是错结论。写脚本前先对一遍。

| 场景 | 坑 | 做法 |
|---|---|---|
| 盘点整块 board | `multica issue list` 默认只回 50 条，不提示截断 | `--limit 100` 起步、`--offset 100` 接着翻，条数等于 limit 就还有下一页；按 Epic 盘点用 `issue children` |
| 读 JSON | 形状和直觉不一样：`issue children` 顶层是 `{stages, total, unstaged}` 对象，`stages[].done` 只数 `status=done`；`metadata list` 是扁平的 `{key: value}`；`comment list` 的正文键是 `content` 不是 `body`；`autopilot get` 外面多包一层 `{"autopilot": …}` | 写 jq 路径前先看一眼原始 JSON；取不到值按错误处理，别当成「空」 |
| stage 放行 | `issue children` 只列一层，孙子单看不见；`stage` 为空的子单在顶层 `unstaged` 里，barrier 不认它，永远不会被放行；`assignee` 为空的子单放行后没人接 | 放行前逐层下钻，核每个子单的 `stage` 与 `assignee_id`；建子单时 `--parent` 与 `--stage` 一起给 |
| 写 metadata | `metadata set` 会把 `93893e56` 这类短 SHA 存成浮点数 | 一律加 `--type string`，写完回读 |
| 改 issue 描述 | `issue update --description-file` 整段覆盖、没有冲突检测，后写者赢 | 先 get，在最新内容上改，再 update，最后回读做 diff |
| 写操作超时 | 退出码 2 分不清「没写进去」和「写进去了」 | 先 list 核对再重试，重试带 `MULTICA_HTTP_TIMEOUT=180`；`comment add` 的成功信息在 stderr，解析 JSON 别把 stderr 混进来 |
| 发附件评论 | `--attachment` / `--content-file` 的路径必须在 cwd 内；把 `comment add` 管进 `head` 会 SIGPIPE，附件传上去了、评论却没建 | 文件放进 worktree 里；不接管道；发完用 `comment list` 确认 |
| 额度用尽 | run 几秒就死，issue 仍停在 `in_progress`，看着像在跑；`failure_reason` 可能只是 `agent_error.unknown` | 按 `multica agent tasks <agent-id> --output json` 里的错误原文判断（spend / session / usage / weekly limit）；额度重置后自己 `rerun` 或 mention 重派 |
| 接力 run 开头 | 工作区报「Unresolved merge」、一堆 `UU`，但没有 `MERGE_HEAD`：平台拿旧快照当三方 base 合出来的假冲突 | `git ls-files -u` 核实 stage 3 就是 `origin/<base>` 后，`git reset --hard` **回到起步快照本身**（退到它之前会让记账失败），再 `git merge origin/<base>` |
| 接手上一个 run 的活 | 远端没分支不等于没干活；`chore(agent): uncommitted changes from task` 快照提交里可能夹着死掉 run 的产物、主检出里用户没提交的改动、没跟踪的大文件 | 先 `git rev-list --left-right --count origin/<base>...HEAD` 和 `git diff --stat origin/<base>..HEAD` 逐个文件核，只带走本任务的文件 |
| 合别人已经绿了的 PR | 它的实现 run 可能还活着，合完它后续的 push 就落空了；`issue get` 的 `assignee` 常是空的 | 合之前用 `assignee_id` 跑 `multica agent tasks <assignee_id>`，有 `running` 就别合 |
