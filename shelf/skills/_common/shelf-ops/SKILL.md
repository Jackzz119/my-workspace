---
name: shelf-ops
description: 货架（shelf）操作手册——用户要求从货架拉取/推送/上架技能、模板、文档等任何内容，或提到"货架 / shelf / 拉技能 / 推上去 / 上架 / 同步到云端"时使用。封装 shelf 命令的全部用法、落点约定、退出码语义和冲突处理守则。
allowed-tools: Bash, Read
---

# Shelf 操作手册

shelf 是 my-workspace monorepo 里的内容货架（`shelf/` 目录，git 管理，**唯一真源**）。CLI 命令是 `shelf`（别名 `atk`，两者等价）。
`shelf` 是哑传输工具：浏览 / pull / push / create 只搬文件；**放哪、什么时候推、冲突怎么办**由你按本手册判断。
核心设计：**没有人（包括你）需要记忆或翻查货架的目录结构**——更新自动定位，上架实时选位。

## 命令总览

```bash
shelf                                  # 交互浏览货架（给人用；你在 Bash 里跑会因等待键盘输入而中止）
shelf pull <shelf路径> [...]            # 按路径拉取到当前目录，可多个
shelf pull <shelf路径> --dest <目录>    # 拉到指定目录
shelf create <本地路径> --to <货架目录>  # 上架新货；--to 目录不存在会自动新建
shelf push <本地路径> [--yes]           # 更新已有货：自动定位，不填地址
shelf push <本地路径> --force           # 覆盖"异机已修改"的冲突（仅限用户明确指示）
shelf init [--agents claude,codex,kimi]  # 项目接入（幂等）；非交互必须带 --agents（或 all）
shelf agents [add <名>]                  # 查看 / 追加 agent 目标（后补目录+文档+镜像+gitignore）
shelf adopt                             # 收编外来技能：实体目录迁入正本重链 + 未记账技能登记 local 段
shelf sync [--dry-run]                  # 按账本对账：库新→自动更新本地；本地改→待人决定方向
shelf home [--update]                   # 货架在哪、什么模式；--update 立即拉最新
```

老版 `shelf skills list/sync` 已清退：列清单用浏览器或 `ls`，装技能用 `shelf pull <路径> --dest .claude/skills`，保持最新用 `shelf sync`。

- 路径里 `_` 前缀可省略：`skills/common/intj` 和 `skills/_common/intj` 等价，落盘用真实名。
- 你（AI）在非交互环境运行：create **必须带 `--to`**；push/create 的最终确认**必须带 `--yes`**（先跑一遍不带 `--yes` 拿到变更清单转述给用户，用户同意后再加 `--yes` 重跑）；**首次 init 必须带 `--agents`**（先问用户要接入哪几个：claude / codex / kimi）。已 init 过的项目重跑会沿用记录的目标。
- 版本追踪在当前目录 `.shelf.json`（`shelf` 段，按 shelf 相对路径为键），不要手改；见到旧名 `.agent-toolkit.json` / `.atk.json` 属正常，任一次 pull/push 会自动迁移。
- **货架从哪来**：`SHELF_HOME` 环境变量 → CLI 自身所在 clone → `~/.shelfrc` 的 `home` → 托管档口 `~/.shelf/home`（全局安装场景下首次运行自动创建）。**每次操作前自动拉最新**（写操作强制拉，push 撞上别的设备刚推过会自动变基重推），所以正常情况下你永远在用最新货架；离线时用本地副本并警告。`shelf home` 一眼看清当前模式，`shelf home --update` 手动强刷。
- 临时机器不想留档口：`SHELF_EPHEMERAL=1` 走一次性 clone，用完即删。
- **免 clone 设备**：`npx -y -p github:Jackzz119/my-workspace shelf <命令>`——读操作用 npm 包内快照，push/create 自动走临时 clone（remote 内置在 package.json，前提是该设备 git 能访问私有仓）。所有命令用法完全一致。

## 这台机器还没装 shelf？

```bash
npm i -g @jackss119/shelf     # 装完命令就是裸 shelf；首次运行自动开档口，无需手动 clone
```

免安装临时用：`npx -y -p github:Jackzz119/my-workspace shelf <命令>`（读走包内快照，写走临时 clone）。

## create 还是 push？

| 情况 | 用哪个 | 定位逻辑 |
|---|---|---|
| 这个东西货架上还没有 | `shelf create <路径> --to <目录>` | 先全架查重名：**重名直接被拒**（名字即 ID）。被拒时把已有位置转述给用户——大概率该用 push |
| 更新从货架拉过的东西 | `shelf push <路径>` | 按 `.shelf.json` 记账推回原位；**原位被移走会自动按名字找回**、推新位置并更新记账 |
| 更新货架已有、但本工作区没拉过的东西 | `shelf push <路径>` | 按文件名全架匹配；唯一命中即视为更新它 |

push 不接受 `--to`；create 的 `--to` 是**货架目录**（不是完整条目路径），条目名 = 本地文件/文件夹名。

## 外来/三方技能（adopt）

- agent 技能目录是链接，所以**从网上装的技能会透明落进正本 `ai/jaSkills/`**，不需要任何处理；只是它没进账本。
- 用户装完新技能、或某个安装器把 skills 目录换成了实体目录时 → 跑 `shelf adopt`：实体内容迁入正本并恢复链接，正本里未被货架追踪的技能登记进账本 `local` 段——**不上货架但有账**。
- local 段由 init / sync / adopt 自动增量维护：登记过的技能**缺失时会告警但保留记录**（带上次指纹）；转述给用户，用户用惯用安装器重装后跑 `shelf sync` 即恢复入账（无需 adopt）。
- local 段技能不参与 sync 对账（没有远端）；用户想跨项目复用某个本地技能时 → `shelf create ai/jaSkills/<名> --to skills/<包>` 升格上架，下次 adopt 自动把它移出 local 段。

## sync 的行为（你替用户跑时）

`shelf sync` 逐条核对账本里的每件物品（三哈希对比：记账 R / 库上 S / 本地 L）：

- 库上有新版、本地没动过 → **自动覆盖本地**（安全，零损失），你只需转述更新清单；
- 本地有改动（领先或双改）、库上搬家找不回、本地文件丢失 → 全部进"待决"清单并 exit 2——把每条待决和 diff 摘要转述给用户，**由用户决定方向**；用户拍板后用 `shelf push <路径>`（推上库）或 `shelf pull <路径> --dest <原位置>`（库覆盖本地）逐条执行；
- `--dry-run` 只报告不动手，适合先给用户看全局。
- 交互模式下（用户自己跑）sync 会当场显示逐行 diff 并提供 [p]推上库/[o]覆盖本地/[s]跳过 菜单——不需要你介入。

## 退出码（你判断下一步的依据）

| 退出码 | 含义 | 你该做什么 |
|---|---|---|
| 0 | 成功 / 无需变更 | 转述结果（提交号或"已一致"） |
| 1 | 参数错误 / 重名被拒 / 无匹配 / 凭据拦截 | 按错误信息转述并和用户对齐（改名？用 push？去掉敏感文件？） |
| 2 | 需要确认 | 变更清单已打印——转述给用户，同意后加 `--yes` 重跑 |
| 3 | 异机冲突 / 多重同名无法自动选择 | 差异/候选已打印——转述给用户，**未经明示不得 `--force`** |
| 4 | 提交失败（如 git 环境异常） | 货架已自动回滚到改动前，无残留；把错误原文转述给用户 |

## 落点约定（pull 之后放哪）

CLI 一律拉到当前目录，分类落点由你执行：

| 拉的是什么 | 放到哪 |
|---|---|
| `shelf/skills/**` 下的技能 | **一律拉进正本 `ai/jaSkills/`**（`--dest ai/jaSkills`）；`.claude/.codex/.kimi` 的 skills 目录是指向正本的链接，agent 自动读到 |
| `shelf/agents/claude/CLAUDE.md` | 项目根 `CLAUDE.md`（已有则对比合并，别盲目覆盖） |
| `shelf/agents/codex/AGENTS.md` | 项目根 `AGENTS.md` |
| 其他文档/模板/文件 | 用户指定处，默认当前目录 |

技能落点可以一步到位：`shelf pull skills/common/intj --dest .claude/skills` 。

## Push / Create 守则

1. push/create 前先跑一遍不带 `--yes` 的命令，把变更清单（新增/删除/修改）或"将新建目录"提示转述给用户。
2. 遇到「货架已被其他设备修改」（exit 3）：把打印的差异转述给用户；**没有用户明确指示不得加 `--force`**。
3. 遇到「已被移动到 X」的搬家提示：这是正常的自动找回，转述新位置即可；记账会自动更新。
4. `--force-secret` 永远不主动使用；工具拦下疑似凭据文件（.env / *.key / *.pem / auth.json / credentials*）时，如实告知用户被拦的文件名。
5. create 被重名拒绝时，把已有条目位置告诉用户，问清是"更新它"（改用 push）还是"改名再上架"。
6. push/create 成功后提交信息是自动的（`shelf: update/add <路径> (from <主机名>)`），并会自动 git push 到远程；你不需要另外 commit。

## 给用户介绍浏览器时（你自己别跑）

用户手动运行 `shelf` 进入浏览器后的按键：数字 = 进入该目录；`p 1,3-5` = 拉取所选；`a` = 全部拉取；`..` = 上级；`q` = 退出。`shelf create`（不带 `--to`）的选位浏览器：数字 = 进入；`m <名>` = 新建目录并进入；`d` = 放在这里；`q` = 取消。

## 典型对话 → 命令

- "把 intj 技能拉到这个项目" → `shelf pull skills/common/intj --dest ai/jaSkills`（agent 目录是链接，自动可见）
- "看看货架上有什么" → 用 `ls <货架clone>/shelf` 逐层看，把目录结构转述给用户（交互浏览器留给用户手动用）
- "我改了这个技能，同步上去" → `shelf push ai/jaSkills/<名字>`（自动定位；先不带 --yes 看清单）
- "把这个项目的货架物品都对一遍/同步一下" → `shelf sync`（非交互会自动应用"库上新版"，其余待决转述给用户）
- "把这份部署清单存到货架" → `shelf create deploy-checklist.md --to docs`（新东西用 create；被拒说明已有同名，改用 push 或改名）
- "这个项目还没接货架" → 问清要接哪些 agent，然后 `shelf init --agents claude,codex`：按目标植入协议文档（CLAUDE.md / AGENTS.md，后者 codex+kimi 共用）、`multica/`（货架上有才装）、`ai/JASKILL.md`、技能正本目录 + 镜像目录、gitignore 对应行，并全部入账。幂等：重跑=补缺失+体检，已有文件绝不盲覆盖；后补目标用 `shelf agents add kimi`
- 链接规则：项目技能唯一正本在 `ai/jaSkills/`，agent 目录（.claude/.codex/.kimi 的 skills）全是指向它的链接——**从哪个目录改都等价**；链接断了/变实体目录，sync 与 init 会自动修复迁移
