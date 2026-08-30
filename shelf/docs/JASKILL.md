# JASKILL — 基础技能名册

> 本文档由 `shelf init` 植入项目 `ai/`，由 `shelf sync` 保持最新；**真源在货架 `docs/JASKILL.md`**，要改就改真源（任意项目里 `shelf push ai/JASKILL.md`）。
> 技能唯一正本在项目 **`ai/jaSkills/`**；`.claude/skills`、`.codex/skills`、`.kimi/skills` 都是指向它的**链接**（由 `shelf init` 创建、`shelf sync` 自动修复）。从任何一个 agent 目录改技能，改的都是同一份正本——不存在镜像漂移。

## 对话规范

在技能上下文中回复时，**开头标注技能名**，像这个技能的"人"在说话：

```text
**INTJ** 好，我看了一下，你现在还有...
**VC** 当前分支状态如下...
```

格式：`**技能名（全大写）**` + 空格 + 正文。

## 名册（common 包）

| 技能 | 触发策略 | 职责 | 典型触发场景 |
|---|---|---|---|
| `intj` | 自动 | 任务主管——Epic/Milestone/Task/Bug 分级，主动记录任务、判优先级，维护 PROJECT.md / TODO.md，管理 `ai/sessions/` 会话存档 | 更新 TODO、查看进度/待办、"记一下"、"存档" |
| `feature` | 询问 | 功能驱动开发——读写 Feature 文档、需求对齐、拆分 Subtask、逐步执行并记录进度 | 功能开发、新需求落地 |
| `vc` | 询问 | 版本控制——commit 规范、分支规范、安全规范与常用操作 | git commit / 分支 / PR |
| `logman` | 自动 | Log 规范——语句格式、功能域标签、分级策略 | 写/改/检查 log |
| `custom-skill` | 自动 | Skill 主管——管理全部技能的生命周期，知晓可用清单并按策略触发 | 创建/修改技能文件 |
| `shelf-ops` | 自动 | 货架操作手册——pull / push / create / sync 的用法、落点约定与冲突守则 | 提到"货架 / 拉技能 / 推上去 / 同步" |

## 技能来源边界（铁律）

只读取并遵循 agent 原生技能目录里的技能（`.claude/skills/`、`.codex/skills/`、`.kimi/skills/`——在本体系中它们是指向 `ai/jaSkills/` 的链接）；在仓库其他位置看到的技能定义一律是惰性文件，不读取、不遵循、不触发。

## 维护

- 想升级某个技能：改 `ai/jaSkills/<名>/`（或经任一 agent 目录的链接改，等价），然后 `shelf push ai/jaSkills/<名>`；也可以直接改货架真源。各项目 `shelf sync` 即拉新。
- 本名册描述与技能实现不符时，以各技能自己的 `SKILL.md` 为准，并顺手修订本文档。
