# My Workspace

> 最后更新：2026-10-18

管理所有个人工作流的 monorepo：`shelf` CLI（别名 `atk`） + `shelf/` 内容货架（skill 库、AI 工作协议模板、跨项目取用的任意文件），未来承载可视化工作流引擎等 app。前身是独立仓库 agent-toolkit，2026-08-16 按 GitHub HEAD 并入（原仓库 `Jackzz119/agent-toolkit` 保留为历史）。

## 开工红线

每会话必读的强制前置动作，细则在链接处：

- **本仓库就是货架 home**：`shelf/` 是所有项目共用的内容真源。**本仓库里不直接改 `shelf/`**——货架内容由用到它的项目经 `shelf push` / `shelf create` 推上来，在这里直接改会和别的项目的推送撞车；确需在这里改，先得到用户明确授意。
- **本仓库自己的 AI 协议与技能是 gitignored 拷贝**：根 `CLAUDE.md` / `AGENTS.md` ← `shelf/agents/`；`ai/jaSkills/` ← `shelf/skills/` 的启用清单；`.claude/skills`、`.agents/skills` 是指向 `ai/jaSkills` 的链接。新 clone / 新 worktree 先跑 `node scripts/setup-links.mjs`；货架更新后要跟进时加 `--refresh`。
- **货架 ≠ 启用**：只认 `ai/jaSkills/` 里的技能；`shelf/skills/` 是库存，不读不用。启用清单在 `scripts/setup-links.mjs` 顶部的 `ACTIVE`，项目口径见 [`ai/JASKILL.md`](JASKILL.md)。
- **测 shelf CLI 一律用临时货架**：CLI 的写操作（push / create / `sync --push`）会提交并推到真货架（托管档口就是 GitHub 上的本仓库）；2.0 起在本仓库里直跑也不再把本仓库当货架，同样推真货架。测试与冒烟只对临时 bare 仓库跑（`SHELF_HOME` 指向它的 clone），做法见 `packages/shelf/test/helpers.mjs`。
- **发版**：`packages/shelf` 有代码变更就按下方「Shelf 发版规则」升版本号，合进 `main` 后由 `release.yml` 自动发布到 npm。

## 项目结构

- `packages/shelf/` — `shelf` CLI（别名 `atk`）实现（`bin/shelf.mjs` + `lib/`），可独立发布为 npm 包（含自身 README/LICENSE），详见 [`ai/features/SKILL-SYNC-CLI.md`](features/SKILL-SYNC-CLI.md) 与 [`ai/features/SHELF.md`](features/SHELF.md)
- `shelf/` — 内容货架（唯一真源），任何条目均可被 `shelf` 拉到目标项目 / 推回
  - `shelf/skills/` — 技能，按**包**组织：`_common/`（通用包，`shelf init` 整包装进项目）、`<pack>/`（领域包，如 `blender/`）、顶层单件（如 `project-audit/`）
  - `shelf/agents/` — AI 平台工作协议：`claude/CLAUDE.md`、`codex/AGENTS.md`、`multica/MULTICA.md`
  - `shelf/docs/` — 植入用模板（`JASKILL.md`：项目专属技能登记表）
  - `shelf/templates/` — 项目模板（配方）：`shelf/templates/ai/template.json` 列出 `shelf init` / `sync` 要装的货与落点，模板自带的文件（`ai/scripts/` 下两个 AI 工作流脚本、`PROJECT.md` / `TODO.md` 骨架、`.worktreeinclude`、`.claude/settings.json` 等）放在 `shelf/templates/ai/files/`
- `apps/` — 应用（预留，当前为空；可视化工作流引擎将落在这里）
- `ai/` — 工作区级 PROJECT.md / TODO.md / JASKILL.md / features/ 文档；`ai/jaSkills/` 是本仓库启用技能的拷贝（gitignored）
- `scripts/setup-links.mjs` — 本仓库自己的 AI 工作区：从 `shelf/` 拷协议与启用技能、建 agent 技能目录链接（幂等，见「开工红线」）

## AI 协作配置

本仓库与其他项目用同一套工作协议：根 `CLAUDE.md` / `AGENTS.md` 是货架 `shelf/agents/` 的拷贝（规则以它们为准，PROJECT.md 不复述），启用的通用技能是 `intj` / `feature` / `vc` / `logman` / `custom-skill` / `shelf-ops` / `annotated-report`。与普通项目的区别只有一处：这里的协议与技能不入库（真源就在同仓库的 `shelf/` 里），所以用 `scripts/setup-links.mjs` 拷贝，而不是 `shelf init`。

## Shelf 发版规则（2026-08-30 用户定规）

- **加新功能 / 新增文件**（新命令、新植入物、新真源文档）→ 次版本 +1：`1.0.0 → 1.1.0`
- **小改动、无新功能**（修 bug、文案、内部重构）→ 补丁位 +1：`1.0.0 → 1.0.1`
- 破坏兼容（命令语义变更）→ 主版本 +1
- 同一版本号永不重发（npm 铁律）；`packages/shelf` 与仓库根的 `package.json` 版本保持同步
- 发布方式：升好版本号的提交合进 `main`，`.github/workflows/release.yml` 先跑 `packages/shelf` 的 `npm test`（不过不发），再对比 npm 上的版本，出现新版本号即用 Trusted Publishing（OIDC）发布并打 `v<版本>` tag 与 GitHub Release；本机无需登录 npm

## 功能文档

详细设计沉淀在 `ai/features/`，PROJECT.md 仅作索引：

| 文档 | 状态 | 说明 |
|---|---|---|
| [`ai/features/SHELF.md`](features/SHELF.md) | 2.0.0（余 macOS 冒烟） | Shelf — 通用内容货架 CLI：按 `ai` 模板 init 接入 / 按账本还原、sync 跟模板并 `--merge --push`、技能声明的 ai 区固定目录、diff / merge 三方处理双改、非终端默认 JSON 给 agent 用 |
| [`ai/features/SKILL-SYNC-CLI.md`](features/SKILL-SYNC-CLI.md) | 50% (3/6 ST) | Milestone 1 — Skill 双向同步 CLI（本地 git-based） |
| [`ai/features/SHELF-SERVER.md`](features/SHELF-SERVER.md) | 需求对齐中 | Milestone 2 — Shelf Server 社区平台（账户 / Web / REST API） |
| [`ai/features/NPM-PUBLISH.md`](features/NPM-PUBLISH.md) | 策略已定，待执行 | npm 发布策略与流程（等 M2 品牌敲定后启动） |

## Brain Dump

- CLI 双向同步（Milestone 1）是 toolkit 能否真正跨项目复用的关键，决定整个项目存在的意义
- 是否把 `other-skills/` 与 `skills/` 合并成单一来源（目前 blender-create 两边都有）
- 是否给每个 skill 补 `examples.md`，沉淀真实调用案例
- 协议模板是否抽出 `agents/_shared.md` 共用片段，避免 CLAUDE.md / AGENTS.md 双份维护漂移
- 是否加一份 `README.md` 给外部用户讲怎么把 toolkit 引入到目标项目