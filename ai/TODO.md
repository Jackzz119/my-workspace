# TODO

## Milestone 0 — Monorepo 迁移 ✅（2026-08-16）

agent-toolkit 按 GitHub HEAD 并入 my-workspace monorepo：CLI → `packages/atk/`（后更名 `packages/shelf/`），`skills/` + `agents/` → `shelf/`，工作协议与 ai/ 文档升级为工作区级。原独立仓库保留为历史。

- [x] 目录迁移 + `paths.mjs` 适配（repoRoot = monorepo 根，packsRoot = `shelf/skills/`）
- [x] monorepo 脚手架：根 `package.json`（workspaces）+ `.gitignore`
- [x] `.claude/skills` 从拷贝改为链接引用真源（`scripts/setup-links.mjs`，junction/symlink，幂等）；`_common` 包更名 `common`
- [ ] 迁移遗留：旧仓库**本地未提交改动**（`blender-create/SKILL.md`、`extra-skills → other-skills` 重命名，见 Phase 2）需从旧工作副本找回或放弃
- [ ] 在 GitHub 创建 `my-workspace` 私有仓库并 push（待用户执行或授权）

## Shelf — 通用内容 push/pull

> 设计文档：[`ai/features/SHELF.md`](features/SHELF.md)
> 状态：已实现（2026-08-16，Windows 全链路冒烟通过）

- [x] **ST-A**：transport 层（SHELF_HOME → 自身 clone → ~/.shelfrc → 临时 sparse clone）
- [x] **ST-B**：`shelf` 交互浏览器（导航 + 多选 + 管道输入安全）
- [x] **ST-C**：`shelf pull`（展示名解析 + manifest shelf 段 + 四情景菜单）
- [x] **ST-D**：`shelf push`（异机冲突保护 + 变更清单 + 凭据拦截 + 非交互守卫）
- [x] **ST-F**：`shelf init` + `shelf-ops` 操作手册 skill
- [ ] **ST-E**：macOS 侧冒烟 + README shelf 章节

## 发版策略（npm publish）

> 设计文档：[`ai/features/NPM-PUBLISH.md`](features/NPM-PUBLISH.md)
> 触发条件：M1 完成 + M2 品牌敲定

- [ ] 查名字可用性（`shelf` 已被占，走 scoped 包或 M2 新品牌）
- [ ] 补全 package.json + 写 LICENSE
- [ ] 编写 README.md
- [ ] `npm pack --dry-run` 验证打包内容
- [ ] 正式 `npm publish` + GitHub Release

## Milestone 2 — Shelf Server 社区平台（规划中）

> 设计文档：[`ai/features/SHELF-SERVER.md`](features/SHELF-SERVER.md)
> 状态：需求对齐中，等 8 个决策点拍板后开工

把 shelf 升级为 Claude/Codex skill 社区平台：账户 / Web UI / REST API / CLI 改造（保留 git 模式作 fallback）。

- [ ] 拍板 8 个决策点（定位 / 品牌 / 域名 / 开源 / 商业化 / 法律 / 节奏 / git 模式）
- [ ] Phase 1 — MVP（API + Web 最小页面 + CLI 适配 + 部署）
- [ ] Phase 2 — 社区互动（评论 / star / 关注 / changelog / 全局 skill）
- [ ] Phase 3 — 规模化（S3 / CDN / 团队账户 / 计费）
- [ ] Phase 4 — 生态延展（IDE 插件 / Codex 适配 / 第三方 API）

## Milestone 1 — Skill 双向同步 CLI（最高优先级）

目标：在任何目标项目里，一条命令就能拉取/推送 skill，与 agent-toolkit 仓库双向同步。

> 设计文档：[`ai/features/SKILL-SYNC-CLI.md`](features/SKILL-SYNC-CLI.md)（本期聚焦 Pull · common 包）

**需求对齐已完成 ✅**：6 个决策点全部锁定（CLI=Node 脚本 + npx github、落点默认 `.claude/skills/`、common 包 = 全部 `skills/`、pull 已存在报错、版本双轨）。

Subtask 进度（详见 Feature 文档）：

- [x] **ST-1**：搭骨架 `package.json` + `bin/atk.mjs`，实现 `atk list`
- [x] **ST-2**：实现 `atk pull`（common 包主路径，交互菜单 u/s/q）
- [x] **ST-3**：`.agent-toolkit.json` + per-skill 版本 + 4 情景智能菜单（contentHash 驱动）+ 文件夹分包（`skills/_common/`、`skills/<pack>/`）
- [ ] **ST-4**：非交互 flag——`--dest` / `--mode` / `--pack`
- [ ] **ST-5**：`shelf skills update` + `shelf skills diff` 独立命令，含孤儿 entry 清理
- [ ] **ST-6**：README + 跨平台冒烟 + 本仓库 dogfood

后续（非本期）：

- [x] `atk pull <name>` 单个拉 → 已由 `shelf pull <路径>` 覆盖
- [x] `atk pull --pack <xxx>` 其他包 → 已由 `shelf pull <任意路径>` 覆盖
- [ ] `atk pull --from other` 拉 `other-skills/`
- [ ] Push 命令（推回主仓库）→ 已立项，设计见 [`SHELF.md`](features/SHELF.md)（注：分发方式随 monorepo 修订，`npx github:` 废弃，见 SHELF.md 决策 #7）

## Phase 2 — 仓库整理

- [ ] 处理 `skills/blender-create/SKILL.md` 未提交修改，确认要保留的版本
- [ ] 整合 `other-skills/blender-create/` 与 `skills/blender-create/`，决定单一来源
- [ ] 提交当前 rename（`extra-skills/ → other-skills/`）

## Phase 3 — 协议与文档

- [ ] 抽出 CLAUDE.md / AGENTS.md 的共享内容，减少双份维护
- [ ] 写仓库根 `README.md`：toolkit 定位、引入方式、skill 一览
- [ ] 给 `intj` / `feature` / `vc` 各补一份 `examples.md`

## Phase 4 — Skill 完善

- [ ] `custom-skill` 补全触发策略字段
- [ ] `blender-create` 验证在最新 Blender MCP 下的工具列表是否仍准确
- [ ] 评估是否新增 `test`、`review` 等通用 skill

## Bug

- （暂无）

## Done

- [x] Milestone 1 需求对齐：6 个决策点拍板（2026-05-17）
- [x] 重命名 skill creator，泛化 AI 协议（commit 3233c46）
- [x] 为 codex 适配所有 skill（commit b10e317）