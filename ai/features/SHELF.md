# Shelf — 通用内容货架 + push/pull

`shelf` CLI 与 `shelf/` 内容货架的设计与实现现状；命令用法与退出码的对外说明在 `packages/shelf/README.md`，待办在 `ai/TODO.md`。

---

## 一、功能目标

`shelf/` 是 monorepo 里的**内容货架**（唯一真源）：技能包、工作协议模板、以及任何想跨项目取用的文件/文件夹。git 仓库就是数据库，`shelf` CLI 是它的增删改查与同步入口，主要调用方是 agent（经 Bash、非交互），人也直接用：

- **接入**：`shelf init` — 按货架上的 `ai` 模板一条命令装好协议（`<ai>/jaAgents` 正本 + 根目录副本）、通用技能、技能链接、AI 工作流脚本与配置、gitignore 和 ai 资料区脚手架；已有账本时 = 按账本还原补齐（换设备、新 worktree）
- **查**：`shelf status`（只读对账）· `shelf diff`（三方对比）· `shelf ls`（列货架）· `shelf template`（看模板有哪些货）· `shelf`（交互浏览器，给人用）· `shelf home`
- **同步**：`shelf sync` — 跟模板最新版、货架新版且本地没动自动更新，本地改过的列为待决并给出下一步命令；`--merge --push` 一条命令合并双改、推本地领先，只把冲突留给人
- **改 / 增 / 删**：`shelf push`（更新已有货，自动定位）· `shelf create`（上架新货，全架查重名）· `shelf pull`（拉取 / `--force` 覆盖）· `shelf forget`（清记账）
- 输出不是终端时默认 JSON（`--text` 改回文字），退出码固定（0 成功 / 1 错误 / 2 待确认 / 3 冲突 / 4 提交失败）

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
| 9 | 落点规则（修订，现行规则见 #36） | 不按货架分类特判落点——货架分类会增多，逐类落点逻辑即冗余；只按两条与分类无关的事实定：记过账的回账上的位置，带 `SKILL.md` 的技能在已接入项目里进技能正本，其余落 `./<真实名>`（`--dest` 可覆盖） |
| 10 | 链接模式 | 同机引用真源用**链接**（本仓库 `.claude/skills` 即此模式，见 `scripts/setup-links.mjs`）；跨机用**复制** + manifest 版本追踪。远期可给 shelf 加 `pull --link` |
| 11 | `_` 前缀 | 文件系统**保留**（置顶用），CLI 显示层过滤：`common` ⇄ `_common` 输入双向解析，落盘与 manifest 永远用真实名 |
| 12 | `shelf init` | 在任意工作区落两样东西：`.shelf.json` manifest + shelf-ops 操作手册（→ `.claude/skills/shelf-ops`）；操作智能在手册，CLI 保持哑传输 |
| 13 | 非交互守卫 | 非 TTY / `--json` / `SHELF_NONINTERACTIVE=1`（agent 经 Bash 驱动）：pull 只自动做零损失的更新，本地改过的保留并退出 2；push / create 确认要求 `--yes`（否则打印清单退出 2）、异机冲突打印差异后退出 3 要求 `diff` → `merge`（人明示才 `--force`）——杜绝 agent 挂死在交互提问上 |
| 14 | 名字即 ID | **货物名（basename）全架唯一**：`shelf create` 上架前全架扫描重名，命中即拒绝并列出位置（想更新→push；想另起→改名）。这使名字成为可靠 ID，无需注册表 |
| 15 | push 定位链 | push **不接受 `--to`**（误传给迁移提示）。定位顺序：①记账原位；②原位失效→按名字全架找回（对比记账哈希提示纯搬家/有差异），确认后推新位置**并更新记账键**；③无记账→同名唯一匹配视为更新；④找不到→指路 `shelf create`。人与 AI 都不需要记忆或翻查远程路径 |
| 16 | 免 clone 运行（快照模式） | `npx -y -p github:Jackzz119/my-workspace shelf <命令>`：npm 安装副本无 `.git`（home 判定已加 git 仓库校验），识别为**快照**——读操作直接用包内 shelf，push/create 自动转临时 sparse clone，remote 取根 package.json `repository`（或 SHELF_REMOTE）；sourceCommit 回退读 npm 注入的 `gitHead`（实测当前 npm 对 git 依赖不注入 → 快照模式下为 null，仅影响溯源字段，冲突/搬家等哈希主逻辑不受影响）。老 atk 的 npx 直跑体验回归，且这次连写都行 |
| 17 | 托管档口（自动开档口） | 全局安装的 CLI 首次运行时，自动把内容仓 clone 到 `~/.shelf/home` 并长期使用：之后所有命令本地跑（可离线、写操作直接提交）。**保鲜策略（2026-08-18 修订，适配货架高频更新）**：读操作每次都 `git pull --ff-only`（60 秒戳记只用于去重连环命令），写操作无条件强制先拉；push 被远端拒收（non-fast-forward）时自动 `pull --rebase --autostash` 后重推一次，多设备竞写自愈。离线时拉取失败仅警告，不阻断。用户**永不需要手动 clone**。`shelf home [--update]` 查看/立即更新；`SHELF_EPHEMERAL=1` 或 `~/.shelfrc {"ephemeral": true}` 可退回一次性 clone（临时机器/CI） |
| 18 | 工具自建 clone 的健壮性 | ①**git 身份兜底**：全新机器没配 user.name/email 时，给工具自建的 clone（档口/临时）设 `shelf <shelf@主机名>`，不碰用户自己的 clone；②**提交失败回滚**：commit 出错时把货架工作区恢复原状（reset/checkout/clean），避免半改状态被下次 push 误判成"异机修改"；③**换行符**：档口 clone 时带 `-c core.autocrlf=false`，否则 CRLF 转换让工作区永远"脏"、卡住自动更新；④**临时目录不泄漏**：`process.exit` 会跳过 finally，临时 clone 注册退出钩子兜底清理（push 失败要保留现场时用 `keep()` 解除） |
| 19 | `shelf sync` 对账 | 开跑先强制刷新货架并体检（#30 / #32）；对账本每件物品比三哈希（记账 R/库上 S/本地 L）：①全等→静默；②L=S≠R（内容已一致、账本落后）→只刷新账本；③S≠R,L=R→**自动覆盖本地**（零损失，有入库副本两处一起写）；④S=R,L≠R（本地领先）→待决，下一步 `push`；⑤双改→待决，下一步 `diff` → `merge`；⑥merge 过且货架没再变→待决「已合并待推送」（冲突标记没删干净的标「合并后还有冲突」）；⑦库上路径失效→按名字找回并迁记账，找不到报「已移除」（下一步 `forget`）；⑧本地文件丢失→待决（`pull --force` 或 `forget`）；⑨正本与入库副本不一致→待决；植入物不对账，单列「植入，不对账」。交互模式（人在终端）④⑤当场看逐行 diff 选 [p]推上库 / [o]覆盖本地 / [m]三方合并 / [s]跳过；sync 内不提供 --force-secret（拦下即跳过）。非交互只自动做②③，有待决退出 2；`--dry-run` / `status` 全程只读，有待决同样退出 2 |
| 20 | 老版技能命令清退（2026-08-18 用户指示） | `shelf skills list/sync`、`shelf list`、裸 `shelf pull` 整包同步垫、`atk shelf` 嵌套垫全部移除（打旧命令会得到指路错误）；连带删除只服务它们的 lib/commands/list.mjs、pull.mjs、frontmatter.mjs、format.mjs 与 manifest 的 skills 段写接口。老 manifest 的 `skills` 段仍可被解析但无人再写——物品重新 `shelf pull` 一次即迁入 `shelf` 段接受 sync 管理 |
| 21 | `shelf init` 植入协议（2026-08-30 需求） | init = 新项目完整接入：①根目录植入 `CLAUDE.md`（←货架 agents/claude/CLAUDE.md）、`AGENTS.md`（←agents/codex/AGENTS.md）、`multica/`（货架上存在才植入，暂无则提示跳过）；②`ai/JASKILL.md`（←货架 docs/JASKILL.md，common 包基础技能名册）；③common 包全部技能进技能正本（落点与链接现行规则见 #26 / #32 / #33）；④.gitignore 补行（现行规则见 #35）；⑤全部经 pullEntry 入账 `.shelf.json` → **init 幂等 = 接入+体检**：重跑补缺失、报冲突，永不盲覆盖已有文件；⑥**账本还原（2026-08-30 用户确认）**：标准清单之外、账上有而本地缺失的货架物品 init 一并补拉（货架路径失效的指路 sync）——换设备带上「账本 + ai 文件夹」一条 init 全就位（local 技能随 ai/ 的 git 到场，shelf 物品从货架补拉），无需再跑 sync |
| 22 | 镜像规则 | 一件货一条账（key→localPath 不变），`.agents/skills/<名>` 作为账目的 `mirrors` 字段挂在 `.claude` 正本上：init 植入时写入，sync 每轮结束后校对全部镜像（哈希不符即从正本重刷）。**改技能只改正本或直接 push**，镜像永远被动跟随 |
| 23 | init 防呆 | 在货架 home 本体（cwd==货架根）里跑 init 直接拒绝——防止把 gitignore 规则误写进 my-workspace 自己 |
| 24 | agent 目标可选（2026-08-30 需求） | init 不再硬编码植入目录，改为**目标选择**：`claude`（.claude/skills + CLAUDE.md）/ `codex`（.agents/skills + AGENTS.md，见 #32）/ `kimi`（.kimi/skills + AGENTS.md，查证：Kimi 走 AGENTS.md 标准且项目级也认 .claude/.codex/.agents 目录）。交互 init 出多选菜单；非交互必须 `--agents claude,codex`（或 all）；选择持久化在 `.shelf.json` 顶层 `agents` 字段，重跑 init 沿用不再问。各目标的技能目录都是指向技能正本的链接（#26）；AGENTS.md 在 codex/kimi 同选时只植一份。gitignore 行随所选目标生成（#35）。新命令 **`shelf agents`**（查看已配/可用）与 **`shelf agents add <名>`**（后补目标：植协议文档+建技能目录链接+补 gitignore） |
| 25 | CLI 自动发版（GitHub Actions + npm Trusted Publishing） | **概念纠偏：货架内容更新不需要发版**——npm 包只含 bin/lib 代码，技能/模板/文档走 git 由档口每次操作自动拉取。需要发版的只有 CLI 代码变更，交给 `.github/workflows/release.yml`：push 到 main 时对比 packages/shelf 版本与 npm 注册表，出现新版本号即自动 `npm publish`（OIDC 信任发布，零 token 零验证码）+ 打 `v<版本>` tag + GitHub Release。一次性配置在 npmjs.com 包设置里指定 Trusted Publisher（repo=Jackzz119/my-workspace, workflow=release.yml）。私有仓不支持 --provenance，发布本身不受影响 |

| 26 | 项目技能正本 jaSkills（2026-08-30 用户重构，**取代 #22 的复制镜像**） | 项目里技能的唯一正本 = **`<ai>/jaSkills/`**（`<ai>` 按 #33 定；common 技能 pull 至此，账本 localPath 指此）；所选 agent 目标的技能目录（`.claude/skills`、`.agents/skills`、`.kimi/skills`）一律做成**指向正本的链接**（Windows junction 免管理员 / POSIX 相对 symlink；删链接只删链接本身，绝不递归进正本）。**从任何 agent 目录改技能 = 直接改正本**，不再有"镜像手改丢失"问题；账本不再需要 mirrors 字段（改写条目时顺手清掉）。init/agents add 建链；sync / adopt 每轮校验链接完整性（断链/实体目录自动修复）；遇实体目录（#22 时代的复制镜像、外部安装器重建的）自动并入正本后原地替换为链接——**同名但内容不同时停下、什么都不删**，提示人工合并。技能正本随 ai 区进项目 git（项目自带技能，队友 clone 即有；shelf 同步的部分由账本继续对账） |

| 27 | `shelf adopt` 收编外来技能（2026-08-30 需求） | 外来技能的常态：agent 目录是链接 → 任何下载器往 `.claude/skills/` 装技能，**实际透明落进正本 ai/jaSkills**，零处理。异常态：安装器暴力重建实体目录毁掉链接 → adopt（以及 init/sync）自动迁移并重链。**账本 `local` 段（2026-08-30 方案2 修订：增量对账+缺失守护）**：正本里未被 shelf 段追踪的技能登记 `{ contentHash, addedAt, origin }`。维护改为**增量**（init / sync / adopt 三处共用 reconcileLocalSkills）：在场→刷指纹；缺失→**告警并保留记录**（带上次指纹供比对，仅 adopt 交互提供 [r]清账）；升格→移除；新目录→登记。新设备流：init 重拉货架物品并告警缺失的本地技能 → 用户以通用安装器重装（经链接直落正本）→ sync 恢复入账（指纹一致原样、新版刷新）。本地技能无远端，账本以现实为准，不仲裁版本。想跨项目复用的升格路径：`shelf create ai/jaSkills/<名> --to skills/<包>`。sync 顺带核对 local 段技能是否都登记在 JASKILL.md（按名字整词匹配），漏的提示补一行 |
| 28 | `shelf diff` 三方对比（1.3.0） | 只读。三个版本：账本 `sourceCommit` 那一版（上次拉取的）、货架 HEAD、本地。默认两段统一 diff：① 货架在上次拉取之后改了什么（sourceCommit → HEAD）② 推上去会改成什么（HEAD → 本地）；`--stat` 只出统计。基准从货架 git 历史重建：`ls-tree` 列文件 + `cat-file --filters` 按工作区换行规则还原（与当初 pull 从工作区拷到本地的字节一致，自建 clone 开 autocrlf 也不会整篇飘红），并用账本指纹核对；浅克隆缺那个提交时按 sha 补取一次（完整克隆不加 `--depth`），还取不到就退回只出 ② 并说明。diff 是自带的 Myers 行 diff（零依赖，标签写在 `---`/`+++` 行的制表符后）。有差异退出 2，一致退出 0。输入可以是货架路径或本地路径（含入库副本路径、Windows 反斜杠） |
| 29 | `shelf merge` 三方合并（1.3.0） | 给「双方都改过」的物品用：以 sourceCommit 版为基准合并货架 HEAD 与本地。逐文件：只一边改的取改的那边（新增 / 删除同理）；两边都改的文本用 `git merge-file`（标签 `本地` / `货架 <sha>`，标准冲突标记）；一边删一边改 → 工作区留改过的那份并列为冲突（与 git 一致）；二进制两边都改 → 留本地并列为冲突。结果写回本地（有入库副本两处一起写）；有冲突退出 3 并列文件。**账本不动**：merge 在本机 `~/.shelf/state/merges.json` 记「本地已合进货架哪一版」，push 据此放行（不要 `--force`），但冲突标记没删干净就退出 3；push 成功才改写账本并清掉标记。再次 merge 以上次合进来的那一版为基准（merge base 前移）；货架在 merge 后又变了，push 退出 3 提示再 merge |
| 30 | 植入物不对账（1.3.0） | init 植入、之后归项目维护的文件（目前是 `docs/JASKILL.md` → `<ai>/JASKILL.md`）账本标 `planted: true`：sync / status 列为「植入，不对账」，push / merge 拒绝（退出 1）；init 已有就不覆盖。要重新植入：`shelf pull docs/JASKILL.md --force`（保留 planted）。已有账本里的 docs/JASKILL.md 条目在 init / sync 体检时自动补标记（status 只读，只当作 planted 显示）。2.0 起哪些是植入物由模板条目的 `planted` 决定（#37），植入物本地缺失时 init 补植入 |
| 31 | 副本 mirror（1.3.0 引入，2.0 起规则见 #38） | 账本条目可选 `mirror: "<相对路径>"`：pull / 自动更新 / merge 两处一起写；只改了一份就按账本基准同步给另一份，两份各改各的才停下（push / merge 退出 1 并列出差异、下一步给 `git diff --no-index`，sync 列为 `mirror-mismatch` 待决），不替人选。副本只由模板的 `copy` 登记（init 时），手动登记的 `shelf mirror` 命令 2.0 删除（#44）；1.x 手动登记过的副本照常维护 |
| 32 | Codex 技能目录 `.agents/skills`（1.3.0） | Codex 从 cwd 到仓库根逐级扫描 `.agents/skills`（支持链接），从不读 `.codex/skills`。codex 目标改为 `.agents/skills` + gitignore `/.agents/skills`。老项目的 `.codex/skills`：链接直接拆、实体目录内容并入正本，`.codex/` 空了一并删（里面有别的配置就留着），再建 `.agents/skills` 链接——init / sync / adopt / agents add 体检时自动做并提示一句 |
| 33 | init 的 ai 资料区：命名规范 + 脚手架（1.3.0，用户 2026-10-18 需求） | **ai 区目录名**：项目里已有 `ai`（不分大小写）就沿用磁盘上的名字；否则 .NET / C# 项目（根目录或一层子目录有 `.sln/.slnx/.csproj/.fsproj/.vbproj`、`Directory.Build.props`，或 Unity 工程）用 `AI`，其余（JS / TS / Java…）用 `ai`；`--ai-dir` 可指定；记进账本顶层 `aiDir`，之后不再变（换名要手动搬家，init 拒绝悄悄改）。技能正本 `<ai>/jaSkills`、JASKILL `<ai>/JASKILL.md` 都跟着走。**脚手架**（只补缺，已有不碰，目录放 `.gitkeep`；2.0 起目录由各技能自己声明，见 #43；`PROJECT.md` / `TODO.md` 骨架是模板自带的植入物并代入项目名与日期，货架没有模板时由内置配方生成）：协议要的 `PROJECT.md` / `TODO.md` 骨架（按 intj 的结构）+ 已装技能要用的目录：`features`（feature / intj）、`sessions`（intj）、`design_system`（monet / ui-tailor / codex-visual，名字跟 codex-visual 的探测路径一致）、`project-audit`（project-audit）；技能也可在 `SKILL.md` frontmatter 的 `metadata` 里写 `shelf-scaffold: a, b/c`（相对 ai 区，只建目录，绝对路径与 `..` 丢弃），新技能要文件夹不必改 CLI |
| 34 | agent 友好的输出与调用约定（1.3.0） | 调研结论落地（machine-readable、非交互、稳定退出码、给出下一步、可内省）：①JSON 输出：stdout 只有一份 `{ok, command, exitCode, cliVersion, schemaVersion, data, next, warnings?, error?}`，人读叙述不输出，隐含非交互（2.0 起输出不是终端时默认就是 JSON，见 #41）；②退出码固定 0/1/2/3/4（README 与 `shelf help` 有表），一次处理多件物品时取最重的（4 > 1 > 3 > 2）；③每个待决 / 要确认的场景都给出可直接执行的下一步命令（`next`，多条是并列选项）；④未知参数直接退出 1（agent 编造的参数不被悄悄忽略），`<命令> --help` 出该命令用法与例子，`help --json` 出命令表与退出码；⑤新增 `status`（= sync --dry-run）、`ls`（非交互列货架）、`forget`（清记账，让「下架 / 本地丢失」非交互可解）、`version` / `--version` / `-v`；⑥`fail()` 抛异常代替 `process.exit`，finally 照常执行、临时 clone 照常清理 |
| 35 | gitignore 只忽略 shelf 放进来的东西（1.3.0，取代 #21④ 的四行） | 写根锚定的精确行：`/CLAUDE.md`、`/AGENTS.md`、`/.claude/skills`、`/.agents/skills`、`/.kimi/skills`。不写裸 `CLAUDE.md`（按文件名匹配任意层级，会把 `ai/jaAgents/CLAUDE.md` 这类入库副本一起忽略）；不再忽略整个 `.claude/`（项目可能要提交 settings.json、launch.json）；链接行不带结尾 `/`（链接在 git 眼里不是目录，带 `/` 匹配不上）。已被更宽的规则盖住就不补：项目是 git 仓库时问 `git check-ignore --no-index`，否则认常见的父目录写法；文件原本是 CRLF 就按 CRLF 追加 |
| 36 | pull 的落点与覆盖（1.3.0） | 输入可以是货架路径或本地路径。记过账的回账上的 localPath（`--dest` 可改），新技能（带 `SKILL.md`）在已接入的项目里默认进技能正本，其余落当前目录。非交互：只有货架变了、本地没动 → 直接更新；本地改过（本地领先 / 双改 / 没记过账的同名文件）→ 保留本地、退出 2，下一步给 `push` / `pull --force` 或 `diff` / `merge`；内容一致只补记账。`--force` 用货架版本覆盖（含植入物重新植入），写入时带上入库副本 |
| 37 | 模板：货架的 `templates/` 类别（2.0，用户 2026-10-18 定） | `templates/<名>/template.json` 是一份**配方**：项目接入时该有哪些货、落在哪。条目 `{ from, to, copy?, planted?, render?, agents?, optional? }`：`from` 是货架路径（引用已有的货，每件货仍只有一份真源），`files/` 开头是模板自带的文件（放在模板目录的 `files/` 下），以 `/*` 结尾表示每个子目录各算一件；`to` 里 `{ai}` 换成 ai 区目录名；`copy` = 再写一份根目录副本（进 gitignore，记成账本 `mirror`）；`agents` 按接入的 agent 过滤；另有 `defaultAgents`，以及给老货架兜底的 `scaffold`（ai 模板不写，固定目录由技能声明，#43）。ai 模板装：协议 ×3、`skills/common/*` 通用技能、`skills/project-audit`（用户 2026-10-19 加）、JASKILL、`ai/scripts` 两个脚本、PROJECT / TODO / check-docs 骨架、`.worktreeinclude`、`.claude/settings.json`。init 与 sync 都按模板走，模板加了货，各项目下次 sync 自动装上（`installed`），模板去掉的货本地保留并提示；改模板只改货架内容，不发 CLI 新版。`shelf template [ls \| show <名>]` 查看。货架上没有 `templates/ai` 时用 CLI 内置的同款配方。模板自带的文件不参与按名字找货（`PROJECT.md`、`settings.json` 这种通用名字不会被 push / create 认错）；没记过账的模板货由 `pull` / `push` 按模板落点认（模板加的货本地已有同名且内容不同时，status 与 sync 都报 `untracked-differs` 待决，给的 `pull <货架路径> --force` / `push <本地路径> --yes` 两条都直接可用）。选「引用」不选「拷贝」：拷贝会让同一个技能在货架上有两份、各自漂移 |
| 38 | 协议正本在 `<ai>/jaAgents/`，根目录是副本（2.0，用户 2026-10-18 定） | 1.x 的协议正本是根目录 `CLAUDE.md`（gitignore，有的项目另存入库副本）；2.0 起正本是 `<ai>/jaAgents/CLAUDE.md` / `AGENTS.md`（进项目 git，换设备 / 新 worktree 随仓库到场），根目录那份是 init 维护的副本（agent 读它）。副本与正本按账本基准对齐：缺哪份补哪份；只有一份改过就同步给另一份（agent 照协议直接改根目录 CLAUDE.md 也不丢）；两份各改各的才停下交给人。1.x 项目第一次 init / sync 自动迁移：账本 localPath 从根目录改到 `<ai>/jaAgents`，正本不存在就按根目录那份建，两份都在且不同按账本判断谁改过，都改过就不迁并报出来 |
| 39 | init = 新接入或按账本还原（2.0，用户 2026-10-18 定） | 没有 `.shelf.json` → 按模板新接入（非交互不带 `--agents` 时取模板 `defaultAgents`，不再退出 2）；有 `.shelf.json` → 按账本还原补齐：技能链接、按 `<ai>/jaAgents` 补根目录副本、账上有本地缺的从货架补拉（`restored`）、货架新版且本地没动的更新、模板新增的装上、`<ai>/jaSkills` 里没记账的技能登记进 `local` 段（模板里的货不算，等人定的也不算）、JASKILL 双向核对（没登记的项目技能 / 登记了却不存在的技能）、账本被 gitignore 时告警。init 与 sync 共用同一个逐件对账核心（区别：init 补拉本地缺失、建脚手架；sync 把本地缺失当待决——可能是有意删的），本地改过的都列为待决（退出 2） |
| 40 | CLI 与货架解耦（2.0，用户 2026-10-18 定） | CLI 所在的 git clone（monorepo 里直跑、npm link）不再自动当货架：货架只来自 `SHELF_HOME` / `~/.shelfrc` / 托管档口。在 my-workspace 里用 shelf 也和任何项目一样走托管档口，项目自己的 AI 工作流（`ai/` 下）与同仓库的 `shelf/` 目录互不相干；也消除了「在 monorepo 里直跑 CLI 会把写操作直接推到真货架」的隐患 |
| 41 | agent 一条命令同步 + 默认 JSON（2.0，用户 2026-10-18 定） | `shelf sync --merge --push`：拿货架新版、三方合并双改的、推本地领先与合并干净的，只把冲突（退出 3）和要人定的待决（退出 2）留下——对应用户「本地有更新就 merge / push，远端有更新就拿过来，有冲突再问」。输出不是终端时默认 JSON（调研里 agent CLI 的通行做法），终端里仍是文字；`--json` / `--text` / `SHELF_OUTPUT` 强制，`version` 与 `help` 默认文字。`push` / `diff` / `merge` 收到已记账物品里面的文件路径（agent 常传它刚改的那个文件）按整件处理，不再按文件名在全架里找同名。配套的新版 `shelf-ops` 手册按这套写 |
| 42 | AI 工作流脚本进 `<ai>/scripts/`（2.0，用户 2026-10-18 定） | worktree 保底脚本 `sync-worktree.sh`（原在 custom-skill 技能里）与 Multica 开工脚本 `bootstrap.sh`（原在 lovelei 的 `ai/jaAgents/`）作为模板自带文件装到 `<ai>/scripts/`，不放项目根目录的 `scripts/`；两者都改成读账本 `aiDir`（.NET 项目的 `AI/` 也能用），`bootstrap.sh` 认旧位置生成的标记。Multica 协议上架为 `agents/multica/MULTICA.md`（引用路径改成 `ai/scripts/bootstrap.sh`）。lovelei 的其余 `scripts/` 是项目自己的检查与美术工具，不属于 AI 工作流 |
| 43 | ai 区固定目录由技能声明（2.0，用户 2026-10-19 定） | 每个项目的 ai 区要有同一副骨架，打开就知道文档在哪；规则写进各技能，由技能自己记住。技能在 `SKILL.md` frontmatter 写 `metadata.shelf-scaffold`（逗号分隔、相对 ai 区，只写目录），正文写一节「固定目录」说明每个目录放什么、入口文档何时写；`shelf init` / `sync` 把已装技能声明的、缺的目录建出来（`status` 只预告），`.gitkeep` 只放在最深一层，不预建空文档。现在的骨架：`features/`（feature、intj）· `sessions/`（intj）· `design_system/{concept,img,uiux,codex-visual}/`（monet；`uiux`、`codex-visual` 也由 ui-tailor、codex-visual 声明；参照 lovelei 的设计系统）· `project-audit/{runs,scripts}/`（project-audit）。模板的 `scaffold` 段删掉；内置配方保留同一副骨架给老货架兜底。写法进了 custom-skill 的创建规范 |
| 44 | 删除 `shelf mirror` 命令（2.0，用户 2026-10-19 定） | 副本机制只剩一个用处：根目录 `CLAUDE.md` / `AGENTS.md`，由模板登记、init / sync 维护，手动登记没有实际用途。根目录协议用复制而不是链接：Windows 上给单个文件建符号链接要管理员权限或开发者模式，硬链接会在 git 或编辑器整份重写文件时悄悄断开，Codex 读 `AGENTS.md` 也不认 `@` 引用；技能目录是整目录链接（junction），不需要副本 |

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

- [x] **ST-A**：transport 层——`lib/transport.mjs`：SHELF_HOME env → CLI 自身 clone（2.0 去掉，见 #40）→ `~/.shelfrc` home → remote 临时 sparse clone；commitAndPush（无 remote / push 失败均优雅降级）
- [x] **ST-B**：`shelf` 交互浏览器——目录导航 + `p 1,3-5` 多选 + `a` 全部 + 管道输入安全（自带行队列，EOF 即退出）
- [x] **ST-C**：`shelf pull`——展示名/真实名双向解析（`lib/shelfnames.mjs`）+ manifest `shelf` 段（真实路径为键）+ 四情景菜单
- [x] **ST-D**：`shelf push`——`--to`（缺失段自动新建）、异机冲突 d/f/a、变更清单确认、凭据拦截、大文件警告、commit/push、manifest 回写
- [x] **ST-F**：`shelf init` + `shelf-ops` 操作手册 skill（`shelf/skills/_common/shelf-ops/`）
- [x] **ST-G**：`shelf create`——全架重名检查（决策 #14）+ 选位浏览器（数字进入 / `m <名>` 新建目录 / `d` 放下 / `q` 取消）+ `--to <目录>` 非交互直达 + 提交信息 `shelf: add <路径>`
- [x] **ST-H**：push 定位链重构（决策 #15）——移除 `--to`、搬家找回（名字匹配 + 哈希对比提示）、记账键迁移、无记录同名匹配、`shelf create` 指路
- [x] **ST-I**：可发布形态——`packages/shelf` 独立成包（`files` 只含 bin/lib，18.5kB）、`publishConfig.access=public`、README/LICENSE；`paths.mjs` 改为向上探测（不再假设 monorepo 布局），`list`/`skills sync` 接入解析链
- [x] **ST-J**：托管档口 + 健壮性（决策 #17/#18），六场景冒烟：全新机器读/写、ephemeral 开关、npx 快照读/写、monorepo 回归
- [x] **ST-K**：`shelf sync`（决策 #19）——混合情景冒烟：自动更新/本地领先/双改/搬家迁账/下架/孤儿 + dry-run 只读 + 非交互 exit 2
- [x] **ST-L**：老版技能命令清退（决策 #20）——bin 精简为 7 命令，删 4 个遗留模块，引用审计清零
- [x] **ST-M**：init 植入协议（决策 #21/#22/#23）——七场景冒烟全过：全新接入(9 项+镜像 6+gitignore 4 行)、幂等重跑、自有文件保护(auto-skip)、防呆拒绝、镜像损坏自愈、multica 上架即植入(10 项)（2026-08-30，v1.1.0）
- [x] **ST-N**：agent 目标化（决策 #24）+ 自动发版（决策 #25）——五场景冒烟全过：--agents 定向接入(claude+codex：正本+镜像+4 gitignore 行)、重跑沿用记录、agents add kimi(镜像重算+补 .kimi/)、非交互无 flag exit 2、仅 kimi(正本落 .kimi)；release.yml 就位（2026-08-30）
- [x] **ST-O**：jaSkills 正本重构（决策 #26）——五场景冒烟：全新 init（正本+双链接）、透过链接改技能=改正本（sync 正确判本地领先）、老式复制项目自动迁移（实体目录并入正本+mirrors 字段清除）、断链 sync 自愈、agents add 建第三链接（2026-08-30）
- [x] **ST-P**：`shelf adopt` + local 段增量对账（决策 #27 方案2）——冒烟：透过链接安装直落正本+登记、幂等、毁链接自愈收编、create 升格移出、**账本单独迁移新设备全流程**（init 告警缺失→安装器重装→sync 恢复入账，指纹一致原样）（2026-08-30）
- [x] **ST-Q**：1.3.0（决策 #28–#36）——`diff` / `merge` / 植入物 / 入库副本 / Codex `.agents/skills` / `version` / `sync --dry-run` 退出码；init 的 ai 区命名规范与脚手架；agent 友好化（`--json`、`next`、`status` / `ls` / `forget` / `mirror`、未知参数拒绝、命令级 help）。代码拆出 `lib/output.mjs`（输出与退出码）、`spec.mjs`（命令表与参数校验）、`textdiff.mjs`、`threeway.mjs`、`scaffold.mjs`；首套自动化测试（见下节）+ release.yml 测试闸门（2026-10-18）
- [x] **ST-R**：2.0（决策 #37–#44）——货架 `templates/ai` 模板与 `lib/template.mjs`（配方展开、内置兜底、`shelf template`）；init / sync 共用逐件对账核心（新接入 / 按账本还原、模板新增自动装、`sync --merge --push`）；协议正本 `<ai>/jaAgents` + 根目录副本（单边改动按账本基准自动同步、1.x 自动迁移）；非终端默认 JSON；CLI 与货架解耦；`agents/multica/MULTICA.md` 上架、`<ai>/scripts/` 两个脚本；新版 `shelf-ops`；ai 区固定目录改由技能声明、project-audit 进模板、删 `shelf mirror`（2026-10-19）
- [ ] **ST-E**：macOS 侧冒烟（Windows 已过全套测试与验收流程；Linux 由 release.yml 的测试闸门覆盖）

## 六、测试

- `cd packages/shelf && npm test`：`node:test`，零依赖，36 个用例（单元 10 + init 7 + sync/pull/push/副本/模板/固定目录/JSON/解耦 11 + diff/merge 7 + 验收 1）。每个用例自建临时 bare 仓库当货架（内容 = 测试用的最小货 + 本仓库真实的 `shelf/templates/ai`，模板改了测试跟着测）、把 CLI 拷到临时目录当已安装的包、每台「设备」独立 HOME 与托管档口、git 配置隔离——不碰真货架。init 覆盖新接入（含 .NET `AI/`）、换设备按账本还原、1.x 布局迁移、内置模板兜底；Windows 上额外断言技能目录是 junction（`dir /AL`），并覆盖反斜杠路径输入与 autocrlf 自建 clone
- `.github/workflows/release.yml` 发布前在 Ubuntu 跑同一套测试（POSIX 相对软链分支），不过不发
- 2026-10-19 · 2.0 验收（npm pack 出的 2.0.0 包 + 本仓库工作区 `shelf/` 做的临时 bare 货架，两台设备）：新接入（22 件 + 链接 + gitignore + 技能声明的 8 个固定目录，重跑幂等）→ 非终端默认 JSON → 换设备 clone 后 init 按账本还原 → 不同处双改 `sync --merge --push` 自动合并推上 → 同一行双改退出 3、人解决后 `push <文件路径>` 按整件推 → 改根目录 CLAUDE.md 同步回正本并推、另一台跟上 → 模板加货两台 sync 都装上 → .NET 项目 `AI/` 与新 worktree 里 `bash AI/scripts/sync-worktree.sh` · 26/26 通过 · 记录在会话报告
- 2026-10-19 · 本仓库迁移试用（npm 上的 2.0.0 + 真货架）：删 `setup-links.mjs` 与旧空账本后 `shelf init` 新接入——9 件装上、5 件与旧拷贝一致直接记账、4 个 1.3.0 旧拷贝报待决（`pull --force` 换成货架版）、6 个固定目录补上；之后 `sync` 0 待决，拿到新版 intj 后补建它新声明的 `ai/sessions`。发现待决的模板技能被误登记进 `local` 段，已修（待发 2.0.1）· 通过
- 2026-10-18 · 1.x → 2.0 升级演练（在临时目录里用 lovelei 账本与 AI 文件的副本跑，真 lovelei 没动；真升级交给 lovelei 那边的 agent 自己做；货架 = 本仓库完整历史 + 本轮货架改动）：协议正本迁到 `ai/jaAgents` 并登记根目录副本、JASKILL 补 planted、模板新装 `ai/scripts` 两个脚本、已有的 PROJECT / TODO / check-docs / `.worktreeinclude` / `.claude/settings.json` 按植入物保留、11 个第三方技能登记进 local 段、链接修复、脚手架补齐；lovelei 自己那份 `MULTICA.md`（指旧路径）报待决，`pull agents/multica/MULTICA.md --force` 装回 `ai/jaAgents/` 后全一致 · 通过

## 七、与既有里程碑的关系

- SKILL-SYNC-CLI 的 ST-4/5/6（非交互 flag、update/diff、README）不受影响，顺序可与本 feature 交叉
- SHELF-SERVER（M2）：shelf 未来就是 server 上的一种资源类型，本期 git 版不白做
- NPM-PUBLISH：shelf 落地后工具的对外价值更完整，可作为发版内容之一
