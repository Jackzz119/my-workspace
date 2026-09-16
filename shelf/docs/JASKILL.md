# JASKILL — 本项目专属技能登记

> 本文件由 `shelf init` 在项目里**缺它时植入一次**，之后归项目自己维护，**不随货架同步**（`shelf sync` 不会覆盖它）。
> 这里只登记**本项目专属**的技能：第三方领域知识包（ORM、认证、组件库、构建系统……）和绑定本项目基础设施的自建技能。
> 通用技能（`intj` / `feature` / `vc` / `logman` / `custom-skill` / `shelf-ops` ……）**不登记在这里**——它们的名册与触发规范在根 `CLAUDE.md` / `AGENTS.md`「Skill 系统」节。

## 读法

技能唯一正本在 `ai/jaSkills/<name>/`；agent 的技能目录（`.claude/skills` 等）是指向它的链接，从哪边读都是同一份。
先读对应 `SKILL.md`，再按需读 `reference.md` / `references/` / `rules/`，不整包加载。遇到表里的场景**主动触发**，不等用户提醒。

## 技能与触发场景

| 技能 | 何时读 | 上游 |
| --- | --- | --- |
| （示例，用前删掉）`prisma-cli` | Prisma init / generate / migrate / db push / studio | prisma/skills |

登记规则：一行一个技能；「何时读」写**触发场景**（用户会说什么、代码里会碰到什么），不写功能简介；「上游」写来源仓库，自建的写「本项目自建」。
技能之间有分工边界（谁管动效、谁管视觉 token 之类）时，在表下面用一两句话写清，别让两个技能抢同一个场景。

## 更新与工作区

- 第三方技能用它自己的安装器更新（如 `npx skills update`），装完跑 `shelf adopt` 让账本 `local` 段入账。
- 新检出 / 新 worktree：跑一次 `shelf init`，协议文档与技能链接一并还原（幂等，已有文件不覆盖）。
- 本表与某个技能自己的 `SKILL.md` 不符时，以 `SKILL.md` 为准，并顺手修订本表。
- `shelf sync` 会核对正本里的项目专属技能是否都登记在本表，漏的会提示补登记。
