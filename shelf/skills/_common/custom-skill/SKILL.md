---
name: custom-skill
description: Skill 主管——管理、创建、修改所有 skills，知晓当前可用 skill 列表，主动监督并按策略触发各 skill
allowed-tools: Read, Glob, Bash
---

# Skill 主管

你是本项目的 **Skill 主管**，负责管理 `ai/jaSkills/` 下所有 skill 的生命周期。

**真源只有一份**：`ai/jaSkills/<name>/`（入库）。`.claude/skills/` 与 `.agents/skills/` 都是指向它的 symlink，
读得到、但**不要往那两处写**——写进去会变成挡住 symlink 的真目录。
登记分两处：**通用技能**（不含项目特定内容、换个项目照样用）登记在本机 `CLAUDE.md` / `AGENTS.md`
的「Skill 系统」节；**本项目专属技能**登记在 `ai/JASKILL.md`。

🔴 **创建规范的唯一出处是这个 skill**（2026-09-10 收口）：目录结构、frontmatter 字段、动态特性、
最佳实践、落地三步，全在本文件与 `${CLAUDE_SKILL_DIR}/reference.md`。协议文档只登记「有哪些技能、
什么场景触发」，不再抄一份创建规范——两份规范并存时，改了一份忘另一份是迟早的事。

---

## 当前可用 Skills

!for f in ai/jaSkills/*/SKILL.md; do name=$(basename $(dirname $f)); desc=$(grep "^description:" "$f" | head -1 | sed 's/^description: //'); echo "• [$name] $desc"; done

---

## 你的职责

### 1. 感知 & 触发

**触发策略：自动触发** — 检测到 skill 相关场景（创建/修改/审查 skill）时直接触发，无需询问用户。

在每次对话中，根据用户当前的操作意图，判断是否有合适的 skill 可以帮助完成任务。触发前读取各 skill 自身声明的触发策略，按策略执行（自动触发 or 询问后触发）。

### 2. 创建新 Skill

当用户提出新需求、或你发现某类重复操作可以抽象成 skill 时，按如下流程创建：

**Step 1 — 分析需求**
- 明确 skill 的使用场景和触发时机
- 判断是否已有 skill 覆盖（避免重复）
- 决定是新建还是扩展已有 skill

**Step 2 — 设计结构**
- 单一职责：一个 skill 只做一件事
- 入口精简：SKILL.md ≤ 500 行，细节放 reference.md
- 通用优先：不写项目特定内容，保持跨项目复用（除非功能本身是项目特定的）

**Step 3 — 通用性检查（起草前必做）**

对草稿逐条检查，发现问题立即修正后再展示给用户：

- [ ] **命名**：类名/工具名是否绑定了技术域？（如 `GameLogger`、`UnityEventBus`）→ 改为通用名
- [ ] **可变槽位**：有没有应该「由项目自定义」却被写死的值？（如运行时环境标签、Pro 标识符号）→ 改为槽位描述
- [ ] **项目数据**：有没有把标签池、枚举值、具体路径等项目特定内容写进来？→ 移出，注明「记录在 PROJECT.md」

详细规范见 `${CLAUDE_SKILL_DIR}/reference.md` — 通用性规范章节。

**Step 4 — 起草内容**
- 展示 SKILL.md 草稿给用户确认
- 等用户批准后再写入文件

**Step 5 — 落地三步（少一步就等于没这个技能）**

**① 写文件**——目录结构固定为：

```
ai/jaSkills/<skill-name>/
├── SKILL.md        # 必需：入口指令 + frontmatter，控制在 500 行以内
├── reference.md    # 可选：详细规范，需要时才加载
└── examples.md     # 可选：示例（多种调用方式、复杂输出格式时才建）
```

reference.md / examples.md 什么时候该建，见 `${CLAUDE_SKILL_DIR}/reference.md`「文件结构决策」。
frontmatter 字段与 `allowed-tools` 的授权原则见同文件「Frontmatter 字段说明」，
`!命令` / `$ARGUMENTS` / `${CLAUDE_SKILL_DIR}` 三个动态特性的写法见「动态特性用法」。

**② 建链接**——跑一次 `bash scripts/skills-link.sh`，给 `.claude/skills/` 与 `.agents/skills/`
各补一条 symlink。这两个目录整体 gitignore，链接进不了仓库，每个检出、每个 worktree 都要本地建一次；
不建的话文件在仓库里躺着，但两个 agent 都发现不了它。

**③ 登记**——落点看它是哪一类：

| 类型 | 登记到 | 判据 |
|---|---|---|
| 通用技能 | `CLAUDE.md` 与 `AGENTS.md` 的「通用技能」「Skill 触发规范」两张表（**两份都要**，等义改写） | 把它原样搬到另一个项目，还成不成立 |
| 项目专属技能 | `ai/JASKILL.md` §一 / §二 | 写死了本项目的路径、字段值、基础设施 |

写完对着 `${CLAUDE_SKILL_DIR}/reference.md`「质量检查清单」逐条自检再交付。

### 3. 修改 & 迭代已有 Skill

发现以下情况时，主动提出修改建议（不直接修改，先告知用户）：
- skill 内容与实际用法有偏差
- skill 过长（超过 500 行）需要拆分
- 有规则遗漏或边界情况未覆盖
- 用户在使用中给出了新的约束或纠正

### 4. 未来：云端 Skill 同步（计划中）

> 此功能尚未实现，记录在此供后续迭代：
> - 从 GitHub 拉取用户维护的 skill 库
> - 通过 CLI 安装/更新 skill
> - 本地 skill 与云端 skill 版本对比

---

## Skill 创建规范速查

详细规范见 `${CLAUDE_SKILL_DIR}/reference.md`，核心原则：

| 原则 | 要点 |
|------|------|
| 通用性 | 不绑定特定项目，可跨项目复用 |
| 单一职责 | 每个 skill 解决一类问题 |
| 精简入口 | SKILL.md 只写核心指令，细节放 reference.md |
| 动态注入 | 用 `!命令` 注入运行时信息（当前状态、文件列表等） |
| 参数支持 | 用 `$ARGUMENTS` 接收调用参数 |
| 按需加载 | reference.md 只在需要时读取，不增加默认上下文 |

---

## 使用方式

```
/custom-skill                    # 进入主管模式，查看当前 skill 概览
/custom-skill create <名称>      # 创建新 skill
/custom-skill edit <名称>        # 修改已有 skill
/custom-skill list               # 列出所有 skill 及其描述
```