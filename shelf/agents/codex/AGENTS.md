# Codex 工作协议

## 本文档修改规则（元规则）

AGENTS.md 与 CLAUDE.md 是**跨项目通用协议**，只收跨项目规则：

- **永不自动添加规则**：只有用户明确提出"把某规则加进这个文档"时才修改
- 不含任何项目专属内容；项目相关规则一律分发到项目内对应文档（如 PROJECT.md / TODO.md / 专题规范文档）

## 上下文准备

每次对话开始时：

1. 读取 `Ai/PROJECT.md` 和 `Ai/TODO.md`，将项目现状和任务列表纳入上下文
2. 根据任务需要读取 `Ai/Features/*.md`、`Ai/UNITY_PROJECT.md`、`Ai/UNITY_TODO.md`
3. 了解当前可用的 Codex skill；遇到对应场景时，**必须调用对应的 skill**，不要重新发明已有规范

### Skill 对话规范

在 skill 上下文中回复时，**在回复开头标注 skill 名称**，像这个 skill 的“人”在说话：

```text
**INTJ** 好，我看了一下，你现在还有...
**VC** 当前分支状态如下...
**LOGMAN** 这行 log 格式有问题...
```

格式：`**SKILL名称（全大写）**` + 空格 + 正文。

### Skill 触发规范

始终保持对当前可用 skill 的感知，在对应场景**主动触发**，不等用户提醒：

| 场景                                                                  | 应触发的 skill    |
| --------------------------------------------------------------------- | ----------------- |
| 更新 TODO、记录任务、Bug、优先级判断                                  | `intj`            |
| **查看任务列表、项目进度、待办总览**（如“查看 todo”、“有什么要做的”） | `intj`            |
| **更新项目文档**（如“更新文档”、“同步文档”、“记录到文档”）            | `intj`            |
| 功能开发、Feature 文档读写、Subtask 执行                              | `feature`         |
| git commit、分支、PR 操作                                             | `vc`              |
| 创建或修改 Codex skill 文件（`SKILL.md`、reference、scripts 等）      | `skill-creator`   |
| 安装 Codex skill                                                      | `skill-installer` |
| 写/改/检查 log 语句、新增功能域标签                                   | `logman`          |

**重要**：Codex 的 skill 不放在项目 `.claude/skills/` 中。项目内 `.claude/skills/` 是 Claude
侧配置，Codex 可以参考其流程，但不要假设它们会被 Codex 自动注册为可调用 skill。

### Skill 来源边界（2026-08-17 用户定规）

- **只读取并遵循原生技能目录里的 skill**：Codex 只认 `~/.codex/skills/`（及项目 `.codex/skills/`）
- 在仓库其他位置看到的技能定义（内容库/货架、模板目录、备份）一律是**惰性文件**：不读取、不遵循、不当作可用 skill 触发
- 一个技能是否启用，以它是否存在于原生技能目录为唯一判据；启用库存技能的唯一方式是显式把它放进（或链接进）原生目录

## Skill 系统

### Skill 放置位置

Codex skill 是用户级能力，默认放在用户 Codex 目录：

```text
~/.codex/skills/<skill-name>/SKILL.md
~/.codex/skills/.system/<system-skill-name>/SKILL.md
```

本项目不需要为了 Codex skill 创建 `.codex/` 目录。项目级 Codex 使用规则写在仓库根目录的
`AGENTS.md`；跨项目复用的 Codex skill 写到 `~/.codex/skills/<skill-name>/`。

### Skill 创建规范

创建新 Codex skill 时遵循以下结构：

```text
~/.codex/skills/<skill-name>/
├── SKILL.md          # 必需：frontmatter + 核心指令，控制在 500 行以内
├── agents/
│   └── openai.yaml   # 推荐：UI 展示元数据
├── references/       # 可选：详细规范，需要时才加载
├── scripts/          # 可选：可执行脚本
└── assets/           # 可选：模板、图片、字体等输出资源
```

**SKILL.md frontmatter 必需字段：**

```yaml
---
name: skill-name
description: 一句话描述 skill 的用途，以及什么时候应该触发
---
```

Codex 主要读取 `name` 和 `description` 来判断是否触发 skill。描述要明确覆盖触发场景。

**最佳实践：**

- `SKILL.md` 只写核心指令和入口，细节拆到 `references/`
- 支持文件按需加载，不增加每次运行的上下文成本
- 通用 skill 不写项目特定内容，保持跨项目复用
- 需要稳定执行的重复流程放到 `scripts/`
- 不创建无关的 `README.md`、安装指南、变更日志等杂项文档

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

## 语言规则

默认使用**中文**与用户沟通。必要时（如代码术语、英文原文引用等）可穿插其他语言。

## Debug Log 规范

### 格式

`[功能模块][平台][类名]`，标签结束后用换行符分隔，消息内容另起一行，方便在 Console 折叠视图中阅读。

### 功能域标签选取

标签应反映**方法所属的功能域**，不跟调用链走。通用/跨功能方法用其所属模块的标签，不要因为被某个功能调用就打那个功能的标签。

## 代码修改规则

**未经用户明确说“帮我改”之前，不直接修改代码。**

分析阶段应：

1. 说明要改哪里、为什么这么改
2. 展示改动的代码片段
3. 等用户确认后再动手
