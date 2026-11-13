---
name: custom-skill
description: Skill 主管：技能（Agent Skills / SKILL.md）的创建规范、审查清单与 Claude Code、Codex 两边的兼容口径。创建、修改、审查、拆分或登记技能时使用，包括写 description、frontmatter、allowed-tools、注入命令和技能脚本；读写 ai/jaSkills/ 下任何文件或 ai/JASKILL.md 之前先用它。
---

# Skill 主管

你是本项目的 **Skill 主管**，负责管理 `ai/jaSkills/` 下所有 skill 的生命周期。

**真源只有一份**：`ai/jaSkills/<name>/`（入库）。`.claude/skills/` 与 `.agents/skills/` 都是指向它的 symlink（Claude Code 读前者、Codex 读后者），
读得到、但**不要往那两处写**——写进去会变成挡住 symlink 的真目录。
登记分两处：**通用技能**（不含项目特定内容、换个项目照样用）登记在本机 `CLAUDE.md` / `AGENTS.md`
的「Skill 系统」节；**本项目专属技能**登记在 `ai/JASKILL.md`。

**创建规范的唯一出处是这个 skill**，协议文档只登记「有哪些技能、什么场景触发」，不抄创建规范——两份规范并存时，改了一份忘另一份是迟早的事。本技能的四份文件：

- 本文件：规则与流程
- [reference.md](reference.md)：详细规范——frontmatter 字段、description 写法、谁能触发、allowed-tools、动态特性、正文写法、文件结构、脚本、两个 agent 的差异、安全、测试与迭代、通用性。动手写或改技能前读对应的节
- [checklist.md](checklist.md)：质量检查清单。建完自检、审查别的技能都用它
- [sources.md](sources.md)：规范的出处与日期、与官方口径的取舍。要更新本规范、或用户问「这条依据是什么」时读

---

## 当前可用 Skills

名称与 description 都在 agent 启动时注入的技能清单里，以它为准；要核对真源目录就 `ls ai/jaSkills/`。

---

## 你的职责

### 1. 感知 & 触发

**触发策略：自动触发** — 检测到 skill 相关场景（创建 / 修改 / 审查 / 登记 skill，或要读写 `ai/jaSkills/`、`ai/JASKILL.md`）时直接触发，无需询问用户。

加载之后，在本会话里留意用户当前的操作有没有合适的 skill 可用。各 skill 的触发策略以协议「通用技能与触发」表和 `ai/JASKILL.md` 为准（技能正文里那句「触发策略」要等技能加载后才看得到），按策略执行（自动 / 询问后 / 点名时）。

### 2. 创建新 Skill

当用户提出新需求、或你发现某类重复操作可以抽象成 skill 时，按如下流程创建：

**Step 1 — 分析需求**

- 明确 skill 的使用场景和触发时机
- 判断是否已有 skill 覆盖（避免重复），决定新建还是扩展已有 skill
- **先不带技能做一遍**：让 agent 在没有这个技能的情况下做 2–3 个真实任务，记下它缺什么、做错什么。技能只补这些缺口，不为想象中的需求写内容
- 素材取自真实经验：这次对话里用户的纠正、项目文档、踩过的坑、改过的提交。只靠「通用最佳实践」写出来的技能空泛无用

**Step 2 — 设计结构**

- 单一职责：一个 skill 是一件连贯的事。太窄，一个任务要同时加载几个技能；太宽，触发不准
- **description 决定会不会被用**：写清做什么 + 什么时候用，关键用途放最前（写法见 reference.md「name 与 description」）
- 渐进披露：SKILL.md 正文 ≤ 500 行、约 5000 token，只放每次都要的规则与流程；细节拆进支持文件，从 SKILL.md 直接链接（只下一层），并写明什么情况读哪份
- 自由度随脆弱度：有多种合理做法的给原则和默认做法；易错、要一致、顺序固定的给确切命令或脚本
- 确定性步骤写成脚本（校验、转换、批量操作），SKILL.md 写清是「运行」还是「参考」
- 谁能触发：默认用户和模型都能触发；要不要收紧见 reference.md「谁能触发」
- 通用优先：不写项目特定内容，保持跨项目复用（除非功能本身是项目特定的）
- 固定目录：要在项目 ai 区用固定文件夹的，frontmatter 的 `metadata.shelf-scaffold` 声明 + 正文写「固定目录」一节，`shelf init` / `sync` 就会在每个项目建出来（写法见 reference.md「Frontmatter」）

**Step 3 — 通用性检查（起草前必做）**

对草稿逐条检查，发现问题立即修正后再展示给用户：

- [ ] **命名**：类名/工具名是否绑定了技术域？（如 `GameLogger`、`UnityEventBus`）→ 改为通用名
- [ ] **可变槽位**：有没有应该「由项目自定义」却被写死的值？（如运行时环境标签、Pro 标识符号）→ 改为槽位描述
- [ ] **项目数据**：有没有把标签池、枚举值、具体路径等项目特定内容写进来？→ 移出，注明「记录在 PROJECT.md」

详细规范见 reference.md「通用性规范」。

**Step 4 — 起草内容**

- 展示 SKILL.md 草稿给用户确认
- 等用户批准后再写入文件

**Step 5 — 落地三步（少一步就等于没这个技能）**

**① 写文件**——推荐结构：

```
ai/jaSkills/<skill-name>/     # 目录名与 frontmatter 的 name 相同
├── SKILL.md        # 必需：frontmatter + 入口指令
├── reference.md    # 可选：详细规范（小技能平铺即可）
├── examples.md     # 可选：示例（多种调用方式、复杂输出格式时才建）
├── references/     # 可选：参考文档多、按领域或模式分份时用目录
├── scripts/        # 可选：要执行的脚本
└── assets/         # 可选：模板、静态资源
```

平铺（reference.md / examples.md）和分目录（references/ 等，开放标准的约定）一个技能里选一种。什么时候拆、怎么链接，见 reference.md「文件结构与渐进披露」。
frontmatter 字段见「Frontmatter」，`allowed-tools` 的含义与收窄原则见「allowed-tools」，
注入命令、调用参数、技能目录三个动态特性的写法见「动态特性」——本文件不写它们的占位符，写进 SKILL.md 的占位符会在调用时被替换。

**② 确认链接在**——`.claude/skills` 与 `.agents/skills` 各是一条指向 `ai/jaSkills/` 的整目录 symlink，
新技能放进真源即自动可见，不用逐个建链接。链接不在（新检出、新 worktree）就补齐：装了 shelf 跑 `shelf init`（按账本还原）；
没装 shelf 跑 AI 工作流模板带的保底脚本 `bash ai/scripts/sync-worktree.sh`（.NET 项目是 `AI/scripts/`；它还会补根目录协议副本等其他 gitignored 文件，用法以脚本头部注释为准）。

**③ 登记**——落点看它是哪一类：

| 类型 | 登记到 | 判据 |
| --- | --- | --- |
| 通用技能 | `CLAUDE.md` 与 `AGENTS.md` 的「通用技能与触发」表（**两份都要**，等义改写；改协议前先按其「修改授权」问用户） | 把它原样搬到另一个项目，还成不成立 |
| 项目专属技能 | `ai/JASKILL.md` 的技能登记表 | 写死了本项目的路径、字段值、基础设施 |

**Step 6 — 验证**——在新会话里测（写技能时的上下文会掩盖文字里的缺口），做法见 reference.md「测试与迭代」：

- 触发：几条该触发、几条不该触发（相近但不该用）的真实说法，看 agent 有没有读这个技能
- 效果：同一任务带 / 不带技能各跑一次，对比结果
- 两边：Claude Code 与 Codex 各跑一次关键场景
- 最后对着 [checklist.md](checklist.md) 逐条自检再交付

### 3. 修改 & 迭代已有 Skill

发现以下情况时，主动提出修改建议（不直接修改，先告知用户）：

- skill 内容与实际用法有偏差
- skill 超出篇幅预算需要拆分
- 有规则遗漏或边界情况未覆盖
- 用户在使用中给出了新的约束或纠正
- 该触发时没触发、或抢了别的技能的触发

改了 description、拆分或挪动内容后，按 Step 6 重新验证。

### 4. 审查 Skill

审一个或全部技能时，逐条过 [checklist.md](checklist.md)；第三方技能加查 reference.md「安全」。结论按「必须改 / 建议改」列给用户，不直接改（同第 3 条）。

### 5. 云端同步

技能与货架之间的拉取、推送、对账归 `shelf-ops`，按它的守则走；本技能不重复那套命令。

---

## Skill 创建规范速查

| 原则 | 要点 |
| --- | --- |
| 描述决定触发 | 做什么 + 什么时候用，关键用途在前；太宽抢别的技能，太窄不触发 |
| 单一职责 | 一个 skill 是一件连贯的事 |
| 精简入口 | SKILL.md 只放每次都要的规则与流程，细节放支持文件 |
| 按需加载 | 支持文件从 SKILL.md 直接链接（只下一层），并写明什么时候读 |
| 最小授权 | `allowed-tools` 只是免确认、不是限制；默认不写，要写就写到具体命令 |
| 确定性给脚本 | 易错、要一致的步骤写成脚本，执行它而不是读它 |
| 两边兼容 | 开放标准的六个字段两边都能解析（Codex 只用 name、description）；注入命令、调用参数、技能目录占位符只有 Claude Code 处理，技能离了它们也要能用 |
| 通用性 | 不绑定特定项目，可跨项目复用 |
| 经验摘录 | 解决过的问题细节写进 references，SKILL.md 的「经验摘录」留一行症状 → 结论 → 去哪读，遇到相似情形先在主技能里找到它 |
| 先测后写 | 先看没有技能时错在哪，写完在新会话里复测 |

---

## 经验摘录

- 在 worktree 里改完技能，再调用它看到的还是旧内容 → 看调用输出开头的 Base directory：指向主检出的 `.claude/skills` 时，加载的是主检出那份，worktree 里的改动没生效。测法见 reference.md「测试与迭代」

---

## 使用方式

```
/custom-skill                    # 进入主管模式，查看当前 skill 概览
/custom-skill create <名称>      # 创建新 skill
/custom-skill edit <名称>        # 修改已有 skill
/custom-skill audit <名称|all>   # 按 checklist.md 审查
/custom-skill list               # 列出所有 skill 及其描述
```
