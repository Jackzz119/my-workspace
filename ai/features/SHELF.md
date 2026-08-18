# Shelf — 通用内容货架 + push/pull

> 最后更新：2026-08-16
> 状态：已实现（Windows 全链路冒烟通过），余 macOS 冒烟 + README
> 关系：SKILL-SYNC-CLI 的「后续扩展：Push / 单个拉」在 monorepo 语境下的落地形态

---

## 一、功能目标

`shelf/` 是 monorepo 里的**内容货架**（唯一真源）：技能包、工作协议模板、以及任何想跨项目取用的文件/文件夹。`shelf` 在任意项目目录下提供三个动作：

- `shelf` — **交互浏览器**：从 `shelf/` 根开始按目录导航，任意层级可继续下钻、选择条目拉取、或拉取当前目录全部
- `shelf pull <shelf路径> [...]` — 非交互直拉，如 `shelf pull skills/common/intj agents/claude`
- `shelf create <本地路径> [--to <货架目录>]` — **上架新货**：全架查重名（重名拒绝），交互选位浏览器（`m <名>` 建目录、`d` 放下）或 `--to` 直达
- `shelf push <本地路径>` — **更新已有货**：按记账/名字自动定位，不接受手填地址

浏览器输入语法（零依赖 readline）：数字 `3` = 进入该目录；`p 1,3-5` = 拉取所选；`a` = 拉取当前目录全部；`..` = 返回上级；`q` = 退出。每屏显示条目类型与大小/子项数。

## 二、决策点（已锁定）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 内容区命名 | `shelf/`（货架：pull=取下 / push=放回；不用 template，因为模板只是货架上的一类东西） |
| 2 | 包形态 | `packages/shelf/`（CLI 是工具包不是 app；未来可视化引擎才进 `apps/`） |
| 3 | 内容归属 | 原 `skills/`、`agents/` 整体挪入 `shelf/` 之下，`shelf/skills/` 仍是 skill 真源 |
| 4 | 传输策略 | 见下节「三层传输」：优先本地 workspace clone，否则临时 sparse clone，与 monorepo 体积解耦 |
| 5 | push 冲突保护 | push 前比对云端当前 contentHash 与本地 manifest 记录：不一致（他机改过）给 `[d]iff / [f]orce / [a]bort`，不静默覆盖 |
| 6 | 版本记录 | manifest 更名 **`.shelf.json`**（跟 CLI 命令走，与全局 `~/.shelfrc` 成对；旧名 `.agent-toolkit.json` 读取兼容、存盘自动迁移）。新增 `shelf` 段，**以 shelf 相对路径为键**：`"skills/common/intj": { sourceCommit, contentHash, pulledAt, localPath }` |
| 7 | 分发方式 | `npx github:` 模式随单仓库废弃；短期 = 本机 workspace clone 里 `npm link`（或 node 直跑），长期 = npm publish（挂 NPM-PUBLISH） |
| 8 | 结构解耦 | pull/push **不硬编码任何目录名**（common、skills 等都只是普通目录），纯文件系统导航；shelf 结构可随时重排，CLI 不用改 |
| 9 | 落点规则（修订） | CLI 一律拉到 `./<真实名>`（`--dest` 可覆盖），**不做分类特判**——货架分类会增多，逐类落点逻辑即冗余；「技能放 `.claude/skills/`」这类智能放在 shelf-ops 手册里由 agent 执行 |
| 10 | 链接模式 | 同机引用真源用**链接**（本仓库 `.claude/skills` 即此模式，见 `scripts/setup-links.mjs`）；跨机用**复制** + manifest 版本追踪。远期可给 shelf 加 `pull --link` |
| 11 | `_` 前缀 | 文件系统**保留**（置顶用），CLI 显示层过滤：`common` ⇄ `_common` 输入双向解析，落盘与 manifest 永远用真实名 |
| 12 | `shelf init` | 在任意工作区落两样东西：`.shelf.json` manifest + shelf-ops 操作手册（→ `.claude/skills/shelf-ops`）；操作智能在手册，CLI 保持哑传输 |
| 13 | 非交互守卫 | 非 TTY（agent 经 Bash 驱动）：pull 冲突自动选安全项（skip/keep）；push 确认要求 `--yes`、异机冲突打印差异后中止（exit 3）要求 `--force`——杜绝 agent 挂死在交互提问上 |
| 14 | 名字即 ID | **货物名（basename）全架唯一**：`shelf create` 上架前全架扫描重名，命中即拒绝并列出位置（想更新→push；想另起→改名）。这使名字成为可靠 ID，无需注册表 |
| 15 | push 定位链 | push **不接受 `--to`**（误传给迁移提示）。定位顺序：①记账原位；②原位失效→按名字全架找回（对比记账哈希提示纯搬家/有差异），确认后推新位置**并更新记账键**；③无记账→同名唯一匹配视为更新；④找不到→指路 `shelf create`。人与 AI 都不需要记忆或翻查远程路径 |
| 16 | 免 clone 运行（快照模式） | `npx -y -p github:Jackzz119/my-workspace shelf <命令>`：npm 安装副本无 `.git`（home 判定已加 git 仓库校验），识别为**快照**——读操作直接用包内 shelf，push/create 自动转临时 sparse clone，remote 取根 package.json `repository`（或 SHELF_REMOTE）；sourceCommit 回退读 npm 注入的 `gitHead`（实测当前 npm 对 git 依赖不注入 → 快照模式下为 null，仅影响溯源字段，冲突/搬家等哈希主逻辑不受影响）。老 atk 的 npx 直跑体验回归，且这次连写都行 |
| 17 | 托管档口（自动开档口） | 全局安装的 CLI 首次运行时，自动把内容仓 clone 到 `~/.shelf/home` 并长期使用：之后所有命令本地跑（秒起、可离线、写操作直接提交），按小时节流 `git pull --ff-only` 保持最新。用户**永不需要手动 clone**。`shelf home [--update]` 查看/立即更新；`SHELF_EPHEMERAL=1` 或 `~/.shelfrc {"ephemeral": true}` 可退回一次性 clone（临时机器/CI） |
| 18 | 工具自建 clone 的健壮性 | ①**git 身份兜底**：全新机器没配 user.name/email 时，给工具自建的 clone（档口/临时）设 `shelf <shelf@主机名>`，不碰用户自己的 clone；②**提交失败回滚**：commit 出错时把货架工作区恢复原状（reset/checkout/clean），避免半改状态被下次 push 误判成"异机修改"；③**换行符**：档口 clone 时带 `-c core.autocrlf=false`，否则 CRLF 转换让工作区永远"脏"、卡住自动更新；④**临时目录不泄漏**：`process.exit` 会跳过 finally，临时 clone 注册退出钩子兜底清理（push 失败要保留现场时用 `keep()` 解除） |

## 三、三层传输（解决「push 要不要整库 clone」）

monorepo 会随 apps 变大，但 shelf 操作的传输量必须只跟 shelf 内容有关：

1. **SHELF_HOME 模式（默认）**：机器上本来就有 my-workspace 的 clone（它是工作台）。shelf 通过环境变量 `SHELF_HOME` 或 `~/.shelfrc` 找到它，pull/push 直接在这个 clone 里 copy + commit + push——零额外 clone，可离线攒提交。
2. **临时 sparse clone 模式（兜底）**：没有本地 clone 的机器（如临时 VPS）：
   `git clone --depth=1 --filter=blob:none --sparse <repo> $TMP && git -C $TMP sparse-checkout set shelf`
   只传 HEAD 树对象 + shelf/ 的 blob，成本 ≈ shelf 自身大小，与 monorepo 其他部分无关。用完清理。
3. **逃生舱（远期，非本期）**：若 shelf 内容膨胀到不适合放主仓库（大二进制等），`git filter-repo` 拆出独立内容仓库，shelf 只需改一个 remote URL。决策可逆，现在不预拆。

## 四、安全阀

- push 前列出将变更的文件清单，确认后才 commit（信息格式：`shelf: update <name> (from <hostname>)`）
- 默认忽略 `node_modules/`、`.git/`、`.DS_Store`
- 单文件 >50MB 警告（GitHub 100MB 硬限）
- 凭据类文件（`.env`、`*.key`、`*.pem`、`auth.json`、`credentials*`）默认拒绝，需 `--force-secret` 显式放行

## 五、Subtask

- [x] **ST-A**：transport 层——`lib/transport.mjs`：SHELF_HOME env → CLI 自身 clone → `~/.shelfrc` home → remote 临时 sparse clone；commitAndPush（无 remote / push 失败均优雅降级）
- [x] **ST-B**：`shelf` 交互浏览器——目录导航 + `p 1,3-5` 多选 + `a` 全部 + 管道输入安全（自带行队列，EOF 即退出）
- [x] **ST-C**：`shelf pull`——展示名/真实名双向解析（`lib/shelfnames.mjs`）+ manifest `shelf` 段（真实路径为键）+ 四情景菜单
- [x] **ST-D**：`shelf push`——`--to`（缺失段自动新建）、异机冲突 d/f/a、变更清单确认、凭据拦截、大文件警告、commit/push、manifest 回写
- [x] **ST-F**：`shelf init` + `shelf-ops` 操作手册 skill（`shelf/skills/_common/shelf-ops/`）
- [x] **ST-G**：`shelf create`——全架重名检查（决策 #14）+ 选位浏览器（数字进入 / `m <名>` 新建目录 / `d` 放下 / `q` 取消）+ `--to <目录>` 非交互直达 + 提交信息 `shelf: add <路径>`
- [x] **ST-H**：push 定位链重构（决策 #15）——移除 `--to`、搬家找回（名字匹配 + 哈希对比提示）、记账键迁移、无记录同名匹配、`shelf create` 指路
- [x] **ST-I**：可发布形态——`packages/shelf` 独立成包（`files` 只含 bin/lib，18.5kB）、`publishConfig.access=public`、README/LICENSE；`paths.mjs` 改为向上探测（不再假设 monorepo 布局），`list`/`skills sync` 接入解析链
- [x] **ST-J**：托管档口 + 健壮性（决策 #17/#18），六场景冒烟：全新机器读/写、ephemeral 开关、npx 快照读/写、monorepo 回归
- [ ] **ST-E**：macOS 侧冒烟（Windows 已过：pull/push/冲突/守卫/init 全链路）+ README 补 shelf 章节

## 六、与既有里程碑的关系

- SKILL-SYNC-CLI 的 ST-4/5/6（非交互 flag、update/diff、README）不受影响，顺序可与本 feature 交叉
- SHELF-SERVER（M2）：shelf 未来就是 server 上的一种资源类型，本期 git 版不白做
- NPM-PUBLISH：shelf 落地后工具的对外价值更完整，可作为发版内容之一
