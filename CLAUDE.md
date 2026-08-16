# Claude 工作协议

## 上下文准备

每次对话开始时：
1. 读取 `ai/PROJECT.md` 和 `ai/TODO.md`，将项目现状和任务列表纳入上下文
2. 扫描 `.claude/skills/` 目录，了解当前有哪些可用 skill
3. 遇到对应场景时，**必须调用对应的 skill**，不要重新发明已有规范

### Skill 对话规范

在 skill 上下文中回复时，**在回复开头标注 skill 名称**，像这个 skill 的"人"在说话：

```
**INTJ** 好，我看了一下，你现在还有...
**VC** 当前分支状态如下...
**Logman** 这行 log 格式有问题...
```

格式：`**SKILL名称（全大写）**` + 空格 + 正文。

### Skill 触发规范

始终保持对当前可用 skill 的感知，在对应场景**主动触发**，不等用户提醒：

| 场景 | 应触发的 skill |
|---|---|
| 更新 TODO、记录任务、Bug、优先级判断 | `intj` |
| **查看任务列表、项目进度、待办总览**（如"查看 todo"、"有什么要做的"） | `intj` |
| **更新项目文档**（如"更新文档"、"同步文档"、"记录到文档"） | `intj` |
| 功能开发、Feature 文档读写、Subtask 执行 | `feature` |
| git commit、分支、PR 操作 | `vc` |
| 创建或修改 skill 文件（SKILL.md、reference.md 等） | `skill-creator` |
| 写/改/检查 log 语句、新增功能域标签 | `logman` |

**重要**：任何对 `.claude/skills/` 目录下文件的读写，都必须先触发 `skill-creator`，不得直接用 Read/Edit 工具操作。

## Skill 系统

### Skill 创建规范

创建新 skill 时遵循以下结构：

```
.claude/skills/<skill-name>/
├── SKILL.md        # 必需：入口指令 + frontmatter，控制在 500 行以内
├── reference.md    # 可选：详细规范，需要时才加载
└── examples.md     # 可选：示例
```

**SKILL.md frontmatter 常用字段：**

```yaml
---
name: skill-name
description: 一句话描述，用于决定何时触发
allowed-tools: Bash, Read, Edit   # 预批准工具，免去每次确认
---
```

**支持的动态特性：**
- `!`shell命令`` — skill 运行前注入命令输出（如 `!git status`）
- `$ARGUMENTS` — 接收调用时传入的参数
- `${CLAUDE_SKILL_DIR}` — 引用 skill 目录内的文件或脚本

**最佳实践：**
- `SKILL.md` 只写核心指令和入口，细节拆到 `reference.md`
- 支持文件按需加载，不增加每次运行的上下文成本
- 通用 skill 不写项目特定内容，保持跨项目复用

## 文档维护规则

### 职责分工

- **PROJECT.md**：记录项目结构、已完成功能的详细描述、数据库表结构等技术细节、以及 Brain Dump 想法区
- **TODO.md**：时刻跟踪所有待办和已完成条目，是任务的唯一来源

### 工作流程

1. **新想法出现** → 直接加入 `TODO.md` 对应 Phase，或先记入 `PROJECT.md` 的 Brain Dump 区
2. **Brain Dump → 决定做** → 从 Brain Dump 移出，加入 `TODO.md` 对应 Phase
3. **任务完成** → 在 `TODO.md` 标记 `[x]`
4. **标记完成后** → 将实现细节（功能描述、数据库结构、模块说明等）更新到 `PROJECT.md`

### 具体规则

- 技术实现细节（数据库结构、配置等）只在实际执行完成后才更新到 PROJECT.md，待办的改动只写在 TODO.md
- TODO.md 只写高层描述，不写数据结构细节
- PROJECT.md 的功能模块和数据库章节保持与线上实际状态一致
- **Feature 文档已记录的细节不重复写入 PROJECT.md**：`Ai/Features/*.md` 中有详细说明的内容，PROJECT.md 只写一句摘要 + 文档路径引用，不做内容搬运

## 命名规则

新建文件 / 文件夹 / 文档前，**先扫描当前项目已有的命名模式**，遵循它，不要凭习惯套用其他项目的规则。

需观察的维度：
- 文件夹大小写（全小写 / PascalCase / kebab-case）
- 文档（.md）命名风格（全大写 / 全小写 / 混合）
- 代码文件命名（camelCase / snake_case / kebab-case）
- 是否有 `codeStyle.md`、`.editorconfig` 等明确规范文件

如果同一类目内存在多种风格，挑**多数派**或**最近新增**的那种；不确定时先问用户。
发现历史遗留不一致的，顺手改正。

## 语言规则

默认使用**中文**与用户沟通。必要时（如代码术语、英文原文引用等）可穿插其他语言。

## Debug Log 规范

### 格式

`[功能模块][平台][类名]`，标签结束后用换行符分隔，消息内容另起一行，方便在 Console 折叠视图中阅读。

### 功能域标签选取

标签应反映**方法所属的功能域**，不跟调用链走。通用/跨功能方法用其所属模块的标签，不要因为被某个功能调用就打那个功能的标签。

## 代码风格

写代码或重命名前，参考项目根目录的 codestyle 文件（如 `codeStyle.md`、`.editorconfig`）；若项目内没有则按通用习惯，不强行套用其它项目的规则。

## 代码修改规则

**未经用户明确说"帮我改"之前，不直接修改代码。**

分析阶段应：

1. 说明要改哪里、为什么这么改
2. 展示改动的代码片段
3. 等用户确认后再动手

## Monorepo 结构

my-workspace 是管理所有个人工作流的 monorepo：

- `packages/atk/` — `atk` CLI（shelf 内容的 list / pull / push 工具）
- `shelf/` — 内容货架（**唯一真源**）：`skills/`（技能包）、`agents/`（工作协议模板）、以及任何要跨项目取用的文件/文件夹
- `apps/` — 应用（如未来的可视化工作流引擎），当前为空
- `ai/` — 工作区级 PROJECT.md / TODO.md / features/ 文档
- `.claude/skills/` — 指向 `shelf/skills/` 的链接（`node scripts/setup-links.mjs` 生成，git 忽略）；通过链接修改技能就是修改真源

### 技能真源铁律

- 新建或修改技能，一律发生在 `shelf/skills/<pack>/<skill>/`；**禁止在 `.claude/skills/` 下创建真实文件**
- shelf 里增删技能后，运行 `node scripts/setup-links.mjs` 重建链接（幂等，Windows 用 junction 无需管理员权限）
- `.claude/skills/` 只应包含链接（git 已忽略整个目录）；发现真实目录即违规——把内容迁回 shelf，重建链接
- 新 clone 本仓库后，先跑一次 `node scripts/setup-links.mjs` 再开工
