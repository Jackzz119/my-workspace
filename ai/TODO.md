# TODO

## Shelf — 通用内容货架 CLI

> 设计文档：[`ai/features/SHELF.md`](features/SHELF.md)（2.0.0）

- [ ] 本仓库改用 shelf CLI 管自己的 AI 工作流（2.0 发布后）：删 `scripts/setup-links.mjs`，`ai/jaSkills`、`ai/jaAgents`、`ai/scripts` 入库，跑 `shelf init`，根目录协议改由账本副本维护
- [ ] 协议里的 worktree 保底脚本改指 `ai/scripts/sync-worktree.sh`（读账本 `aiDir`，照顾 .NET 的 `AI/`），删掉 custom-skill 里那份；改协议要用户授意
- [ ] 在用的项目升到 2.0：各项目的 agent 跑一次 `shelf sync --merge --push`（协议正本迁到 `ai/jaAgents`、补装模板新货与固定目录）；lovelei 由那边的 agent 按用户转交的提示自己升级，Multica 配置改用 `ai/scripts/bootstrap.sh`
- [ ] **ST-E**：macOS 侧冒烟（Windows 已过全套测试与验收流程；Linux 由 release.yml 的测试闸门覆盖）
- [ ] release.yml 的 npm publish 撞上 sigstore 透明日志 409（npm/cli#10078：首个请求已写入、客户端超时重试被判冲突，包不会上传）时自动重试几次，每次先 `npm view` 确认没发出去；1.3.0 是重跑到第 3 次才发布成功

## Milestone 2 — Shelf Server 社区平台（规划中）

> 设计文档：[`ai/features/SHELF-SERVER.md`](features/SHELF-SERVER.md)
> 状态：需求对齐中，等 8 个决策点拍板后开工

把 shelf 升级为 Claude/Codex skill 社区平台：账户 / Web UI / REST API / CLI 改造（保留 git 模式作 fallback）。

- [ ] 拍板 8 个决策点（定位 / 品牌 / 域名 / 开源 / 商业化 / 法律 / 节奏 / git 模式）
- [ ] Phase 1 — MVP（API + Web 最小页面 + CLI 适配 + 部署）
- [ ] Phase 2 — 社区互动（评论 / star / 关注 / changelog / 全局 skill）
- [ ] Phase 3 — 规模化（S3 / CDN / 团队账户 / 计费）
- [ ] Phase 4 — 生态延展（IDE 插件 / Codex 适配 / 第三方 API）

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
