# TODO

## Shelf — 通用内容货架 CLI

> 设计文档：[`ai/features/SHELF.md`](features/SHELF.md)（1.3.0 已实现）

- [ ] **ST-E**：macOS 侧冒烟（Windows 已过全套测试与验收流程；Linux 由 release.yml 的测试闸门覆盖）
- [ ] 货架 `shelf-ops` 手册跟上 1.3.0：diff / merge / forget / mirror / ls / status、`--json` 与退出码表、Codex 改用 `.agents/skills`（由在用它的项目改完 push 上来，本仓库不直接改 `shelf/`）
- [ ] 协议与技能里写死的 `ai/` 路径照顾 .NET 项目的 `AI/`：custom-skill 的 `sync-worktree.sh` 按账本 `aiDir` 找技能正本（大小写敏感的文件系统上 `ai/jaSkills` 找不到 `AI/jaSkills`）
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
