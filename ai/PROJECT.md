# My Workspace

> 最后更新：2026-08-16

管理所有个人工作流的 monorepo：`atk` CLI + `shelf/` 内容货架（skill 库、AI 工作协议模板、跨项目取用的任意文件），未来承载可视化工作流引擎等 app。前身是独立仓库 agent-toolkit，2026-08-16 按 GitHub HEAD 并入（原仓库 `Jackzz119/agent-toolkit` 保留为历史）。

## 项目结构

- `packages/atk/` — `atk` CLI 实现（`bin/atk.mjs` + `lib/`），详见 [`ai/features/SKILL-SYNC-CLI.md`](features/SKILL-SYNC-CLI.md) 与 [`ai/features/SHELF.md`](features/SHELF.md)
- `shelf/` — 内容货架（唯一真源），任何条目均可被 `atk` 拉到目标项目 / 推回
  - `shelf/skills/` — 主 skill 集，按**包**组织：`common/`（默认包）、`<pack>/`（领域包，如 `blender/`）
  - `shelf/agents/` — AI 平台工作协议模板：`claude/CLAUDE.md`（用 `.claude/skills/`、`${CLAUDE_SKILL_DIR}`）、`codex/AGENTS.md`（平台中立，用 `skills/`、`${SKILL_DIR}`）
- `apps/` — 应用（预留，当前为空；可视化工作流引擎将落在这里）
- `ai/` — 工作区级 PROJECT.md / TODO.md / features/ 文档
- `scripts/setup-links.mjs` — 把 shelf 技能链接进 `.claude/skills/`（clone 后跑一次，幂等；铁律见 CLAUDE.md）

## Skill 清单

| Skill | 触发策略 | 职责 |
|---|---|---|
| `intj` | 自动 | 任务主管，Epic/Task/Bug 分级，维护 PROJECT.md / TODO.md |
| `feature` | 询问 | 功能驱动开发，读写 Feature 文档，拆分 Subtask |
| `vc` | 询问 | git commit / 分支 / PR 规范 |
| `custom-skill` | — | Skill 主管，管理所有 skill 的生命周期 |
| `logman` | 自动 | log 语句格式与功能域标签规范 |
| `blender-create` | — | Blender MCP 建模 / 材质 / Retopo / Rigging / 导出流程 |
| `shelf-ops` | 自动 | 货架操作手册——agent 执行 shelf pull/push 的用法、落点约定与冲突守则（`atk shelf init` 会装进目标工作区） |

## AI 工作协议核心

- 每次对话先读 `ai/PROJECT.md` + `ai/TODO.md`，扫描 `.claude/skills/` 感知可用 skill
- skill 上下文回复以 `**SKILL名称**` 开头
- 文档维护：TODO.md 是任务唯一来源；任务完成后才把实现细节回填到 PROJECT.md
- 默认中文沟通；commit message 用英文
- 未授权不直接改文件，先说改哪、为什么、给 diff，等确认

## Skill 真源规则

- **`shelf/skills/` 是唯一真源**，所有 skill 修改只在这里进行
- **`.claude/skills/` 是指向真源的链接**（Windows junction / POSIX symlink，git 忽略），由 `node scripts/setup-links.mjs` 生成；通过链接改技能 = 直接改真源，不存在第二份拷贝
- 新 clone 后跑一次 `node scripts/setup-links.mjs`；shelf 里增删 skill 后重跑即可（幂等）

## 功能文档

详细设计沉淀在 `ai/features/`，PROJECT.md 仅作索引：

| 文档 | 状态 | 说明 |
|---|---|---|
| [`ai/features/SHELF.md`](features/SHELF.md) | 设计定稿，待开工 | Shelf — 通用内容货架 + push/pull（含三层传输策略） |
| [`ai/features/SKILL-SYNC-CLI.md`](features/SKILL-SYNC-CLI.md) | 50% (3/6 ST) | Milestone 1 — Skill 双向同步 CLI（本地 git-based） |
| [`ai/features/ATK-SERVER.md`](features/ATK-SERVER.md) | 需求对齐中 | Milestone 2 — ATK Server 社区平台（账户 / Web / REST API） |
| [`ai/features/NPM-PUBLISH.md`](features/NPM-PUBLISH.md) | 策略已定，待执行 | npm 发布策略与流程（等 M2 品牌敲定后启动） |

## Brain Dump

- CLI 双向同步（Milestone 1）是 toolkit 能否真正跨项目复用的关键，决定整个项目存在的意义
- 是否把 `other-skills/` 与 `skills/` 合并成单一来源（目前 blender-create 两边都有）
- 是否给每个 skill 补 `examples.md`，沉淀真实调用案例
- 协议模板是否抽出 `agents/_shared.md` 共用片段，避免 CLAUDE.md / AGENTS.md 双份维护漂移
- 是否加一份 `README.md` 给外部用户讲怎么把 toolkit 引入到目标项目