# Shelf — 通用内容货架 + push/pull

> 最后更新：2026-08-16
> 状态：设计定稿，待确认开工
> 关系：SKILL-SYNC-CLI 的「后续扩展：Push / 单个拉」在 monorepo 语境下的落地形态

---

## 一、功能目标

`shelf/` 是 monorepo 里的**内容货架**（唯一真源）：技能包、工作协议模板、以及任何想跨项目取用的文件/文件夹。`atk` 在任意项目目录下提供三个动作：

- `atk shelf` — 列出 `shelf/` 根下的条目（文件夹 + 文件，含类型与大小/条目数）
- `atk shelf pull [name ...]` — 把 `shelf/<name>` 复制到当前目录 `./<name>`；无参数时编号多选
- `atk shelf push <path> [--as <name>]` — 把本地文件/文件夹推回 `shelf/<name>` 并同步到 GitHub

## 二、决策点（已锁定）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 内容区命名 | `shelf/`（货架：pull=取下 / push=放回；不用 template，因为模板只是货架上的一类东西） |
| 2 | 包形态 | `packages/atk/`（CLI 是工具包不是 app；未来可视化引擎才进 `apps/`） |
| 3 | 内容归属 | 原 `skills/`、`agents/` 整体挪入 `shelf/` 之下，`shelf/skills/` 仍是 skill 真源 |
| 4 | 传输策略 | 见下节「三层传输」：优先本地 workspace clone，否则临时 sparse clone，与 monorepo 体积解耦 |
| 5 | push 冲突保护 | push 前比对云端当前 contentHash 与本地 manifest 记录：不一致（他机改过）给 `[d]iff / [f]orce / [a]bort`，不静默覆盖 |
| 6 | 版本记录 | 复用 `.agent-toolkit.json`，新增 `shelf` 段：`{ sourceCommit, contentHash, pulledAt, localPath }` |
| 7 | 分发方式 | `npx github:` 模式随单仓库废弃；短期 = 本机 workspace clone 里 `npm link`（或 node 直跑），长期 = npm publish（挂 NPM-PUBLISH） |

## 三、三层传输（解决「push 要不要整库 clone」）

monorepo 会随 apps 变大，但 shelf 操作的传输量必须只跟 shelf 内容有关：

1. **ATK_HOME 模式（默认）**：机器上本来就有 my-workspace 的 clone（它是工作台）。atk 通过环境变量 `ATK_HOME` 或 `~/.atkrc` 找到它，pull/push 直接在这个 clone 里 copy + commit + push——零额外 clone，可离线攒提交。
2. **临时 sparse clone 模式（兜底）**：没有本地 clone 的机器（如临时 VPS）：
   `git clone --depth=1 --filter=blob:none --sparse <repo> $TMP && git -C $TMP sparse-checkout set shelf`
   只传 HEAD 树对象 + shelf/ 的 blob，成本 ≈ shelf 自身大小，与 monorepo 其他部分无关。用完清理。
3. **逃生舱（远期，非本期）**：若 shelf 内容膨胀到不适合放主仓库（大二进制等），`git filter-repo` 拆出独立内容仓库，atk 只需改一个 remote URL。决策可逆，现在不预拆。

## 四、安全阀

- push 前列出将变更的文件清单，确认后才 commit（信息格式：`shelf: update <name> (from <hostname>)`）
- 默认忽略 `node_modules/`、`.git/`、`.DS_Store`
- 单文件 >50MB 警告（GitHub 100MB 硬限）
- 凭据类文件（`.env`、`*.key`、`*.pem`、`auth.json`、`credentials*`）默认拒绝，需 `--force-secret` 显式放行

## 五、Subtask

- [ ] **ST-A**：transport 层——ATK_HOME 发现（env → ~/.atkrc → 向上查找）+ 临时 sparse clone + push helper（commit/push/清理）
- [ ] **ST-B**：`atk shelf`（list：根条目 + 类型 + 大小/条目数）
- [ ] **ST-C**：`atk shelf pull`——单个/多选、写 manifest `shelf` 段、复用四情景智能菜单
- [ ] **ST-D**：`atk shelf push`——冲突检测、变更清单确认、commit + push、回写 manifest
- [ ] **ST-E**：跨平台冒烟（Windows 主力 + macOS）+ README 补 shelf 章节

## 六、与既有里程碑的关系

- SKILL-SYNC-CLI 的 ST-4/5/6（非交互 flag、update/diff、README）不受影响，顺序可与本 feature 交叉
- ATK-SERVER（M2）：shelf 未来就是 server 上的一种资源类型，本期 git 版不白做
- NPM-PUBLISH：shelf 落地后 atk 的对外价值更完整，可作为发版内容之一
