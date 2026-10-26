# shelf

个人内容货架 CLI：把技能、工作协议、文档、模板放在一个 git 仓库（货架）里，在任何项目、任何设备上一条命令接入 AI 工作流、随时同步、把改动推回去。主要使用者是 AI agent（Claude Code / Codex 经 Bash 调用），人也可以直接用。

```bash
npm i -g @jackss119/shelf
cd my-project
shelf init                    # 初始化 ai 工作流：新项目按模板接入；有账本就按账本还原（换设备 / 新 worktree）
shelf status                  # 看一眼：哪些货架有更新、哪些本地改过
shelf sync --merge --push     # 同步：拿货架新版、三方合并双改、推本地改动；只有冲突要人定
```

首次运行时 shelf 会把货架仓库 clone 到 `~/.shelf/home`（托管档口），之后所有命令都在本地跑，每次操作前自动拉最新。**不需要手动 clone 任何东西。**

## AI 工作流模板

货架上的 `templates/ai/template.json` 是一份配方：项目接入 AI 工作流时该有哪些货、落在哪。它只引用货架上已有的货（每件货仍只有一份真源），模板独有的文件放在模板目录的 `files/` 下。`shelf template show ai` 按当前项目展开它。目前的 ai 模板：

| 项目里的位置 | 来源 | 同步方式 |
|---|---|---|
| `ai/jaAgents/CLAUDE.md` + 根目录 `CLAUDE.md`（副本） | `agents/claude/CLAUDE.md` | 随货架同步（接 claude 时） |
| `ai/jaAgents/AGENTS.md` + 根目录 `AGENTS.md`（副本） | `agents/codex/AGENTS.md` | 随货架同步（接 codex / kimi 时） |
| `ai/jaAgents/MULTICA.md` | `agents/multica/MULTICA.md` | 随货架同步 |
| `ai/jaSkills/<名>/` | `skills/common/*`（通用技能包，每个技能一件）+ `skills/project-audit` | 随货架同步 |
| `ai/scripts/sync-worktree.sh`、`ai/scripts/bootstrap.sh` | 模板自带 | 随货架同步 |
| `ai/JASKILL.md` | `docs/JASKILL.md` | 植入一次，之后归项目 |
| `ai/PROJECT.md`、`ai/TODO.md`、`ai/check-docs.json` | 模板自带 | 植入一次（代入项目名、日期、ai 区目录名） |
| `.worktreeinclude`、`.claude/settings.json` | 模板自带 | 植入一次（`.claude/settings.json` 只在接 claude 时） |

另外按接入的 agent 建技能目录链接（`.claude/skills`、`.agents/skills`、`.kimi/skills` → `ai/jaSkills`）。模板改了不用发 CLI 新版：各项目下次 `sync` 自动装上新增的货。

**固定目录由技能自己声明**：技能在 `SKILL.md` frontmatter 里写 `metadata.shelf-scaffold`（逗号分隔、相对 ai 区），装了它的项目 `init` / `sync` 就把缺的目录建出来（空目录放 `.gitkeep`，只放在最深一层），每个项目的 ai 区都是同一副骨架。现在的声明：

| 目录 | 声明它的技能 |
|---|---|
| `ai/features/` | feature、intj |
| `ai/sessions/` | intj |
| `ai/design_system/concept/`、`img/`、`uiux/`、`codex-visual/` | monet（`uiux/`、`codex-visual/` 也由 ui-tailor、codex-visual 声明） |
| `ai/project-audit/runs/`、`scripts/` | project-audit |

## 命令

| 命令 | 作用 |
|---|---|
| `shelf init [--agents claude,codex,kimi\|all] [--ai-dir <名>] [--template <名>]` | 初始化 ai 工作流（幂等）。没有账本 = 按模板新接入（默认 claude + codex）；有账本 = 按账本还原补齐 |
| `shelf sync [--merge] [--push] [--dry-run]` | 同步：装模板新增的货；货架新版且本地没动的更新本地；`--merge` 三方合并双改的；`--push` 推本地领先与合并干净的；补上技能声明的固定目录；其余列为待决 |
| `shelf status` | 只读对账（等同 `sync --dry-run`），附下一步命令 |
| `shelf diff <货架路径或本地路径> [--stat]` | 三方对比：① 货架在上次拉取后改了什么 ② 推上去会改成什么 |
| `shelf merge <货架路径或本地路径>` | 三方合并双改的物品，结果写回本地；账本等 push 成功才更新 |
| `shelf push <本地路径> [--yes] [--force] [--force-secret]` | 更新货架上已有的物品：按账本 / 模板落点 / 名字自动定位，传物品里面的文件也按整件推；不带 `--yes` 只列变更清单 |
| `shelf pull <货架路径或本地路径...> [--dest <目录>] [--force]` | 拉取：记过账的回原位，模板里的货按模板落点，新技能进技能正本；`--force` 用货架版本覆盖本地改动（植入物 = 重新植入） |
| `shelf create <本地路径> [--to <货架目录>] [--yes]` | 上架新物品：全架查重名（名字即 ID）；非交互必须 `--to` |
| `shelf forget <货架路径或本地路径...>` | 从账本删掉物品（本地文件不动） |
| `shelf template [ls \| show [<名>]]` | 列出货架上的模板 / 展开某个模板会装哪些货 |
| `shelf ls [货架路径]` | 列出货架某一层：类型、大小、本项目是否已装 |
| `shelf` | 交互浏览货架（给人用，终端里跑） |
| `shelf agents [add <名>]` | 查看 / 追加 agent 目标 |
| `shelf adopt` | 收编外来技能：实体目录迁入技能正本并重链，未记账技能登记进账本 `local` 段 |
| `shelf home [--update]` | 货架在哪、什么模式；`--update` 立即拉最新 |
| `shelf version`（`--version` / `-v`） | 打印版本 |
| `shelf help [命令]`（`<命令> --help`） | 用法；`help --json` 输出机器可读的命令表与退出码 |

路径里 `_` 前缀可省（`skills/common/intj` = `skills/_common/intj`），Windows 反斜杠路径照样认；`push` / `diff` / `merge` 传已记账物品里面的文件（如 `ai/jaSkills/intj/SKILL.md`）按整件处理。`atk` 是 `shelf` 的别名。

## 退出码

| 退出码 | 含义 | 下一步 |
|---|---|---|
| 0 | 成功 / 无需变更 / 全部一致 | — |
| 1 | 参数错误、未知命令或参数、找不到物品或模板、重名、凭据拦截、正本与副本各改各的、植入物不推 | 按 `error.message` 改 |
| 2 | 要人或 agent 处理：变更清单已打印；`init` / `sync` / `status` 有待决；`diff` 有差异；`pull` 因本地改动没覆盖；`push` / `merge` 遇到副本改过、正本没动 | 按 `next` 走（确认后加 `--yes`；副本的差异先给人看，确认后加 `--take-mirror`） |
| 3 | 冲突：货架在你上次拉取后被改过、多个同名无法自动选、`merge` / `sync --merge` 有冲突、冲突标记还没解决 | 解决冲突后 `push`；未经人明示不加 `--force` |
| 4 | 提交或推送失败（货架已回滚到改动前） | 把错误原文转给人 |

## 给 agent 用

- **输出不是终端时默认 JSON**（agent 经 Bash 调用就是这种情况）；终端里给人看是文字。`--json` / `--text` 或 `SHELF_OUTPUT=json|text` 强制其一。`version` 与 `help` 默认文字。

  ```json
  {"ok":false,"command":"sync","exitCode":2,"cliVersion":"2.0.0","schemaVersion":1,
   "data":{"items":[{"key":"skills/_common/intj","localPath":"ai/jaSkills/intj","state":"local-ahead","pending":true,
     "next":["shelf push ai/jaSkills/intj"]}],"counts":{"same":12,"pending":1}},
   "next":["shelf push ai/jaSkills/intj"]}
  ```

  `ok` = 退出码是 0；`next` 是建议的下一步命令（多条时是并列选项，方向由人定）；出错时多一个 `error.message`，警告在 `warnings`。
- **从不等键盘**：非交互时要确认的操作打印清单后退出 2，冲突退出 3。
- **未知参数直接报错**（退出 1），编造的参数不会被悄悄忽略。
- 配套的操作手册是货架上的 `shelf-ops` 技能（随 ai 模板装进每个项目）。

物品状态（`data.items[].state`）：`same` 一致 · `updated` / `would-update` 货架新版已更新 / 将更新 · `installed` / `would-install` 模板新增已装 / 将装 · `restored` 补拉 · `refreshed` 只刷新账本 · `planted` 植入物 · `pushed` 已推 · `local-ahead` 本地领先 · `both-changed` 双方都改过 · `merged` 已合并待推 · `merge-conflict` 合并后有冲突 · `removed` / `ambiguous` 下架 / 同名多义 · `local-missing` 本地没了 · `mirror-ahead` 副本改过、正本没动（等人确认） · `mirror-mismatch` 正本与副本各改各的 · `untracked-differs` 本地有同名文件、没记过账。

## init：新接入与还原

- **没有 `.shelf.json`**：按模板新接入。agent 目标默认取模板的 `defaultAgents`（claude + codex），终端里会问。ai 区目录名按项目命名规范定：已有 `ai` / `AI` 就沿用；否则 .NET / C# 项目（根目录或一层子目录有 `.sln` / `.csproj`，或 Unity 工程）用 `AI`，JS / TS / Java 等用 `ai`；`--ai-dir` 可指定；结果记进账本 `aiDir`。
- **有 `.shelf.json`**（换设备、新 clone、新 worktree）：按账本还原——建技能链接；按 `ai/jaAgents` 补根目录协议副本；账上有、本地缺的货从货架补拉；货架有新版且本地没动的更新；模板新增的货装上；`ai/jaSkills` 里没记账的技能登记进账本 `local` 段；核对 `ai/JASKILL.md`（没登记的项目技能、登记了却不存在的技能都会列出来）。
- 已有的文件永不盲覆盖；重跑只补缺、只做零损失的更新。本地改过的列为待决（退出 2）。

**协议的正本与副本**：`ai/jaAgents/CLAUDE.md` 是正本（进项目 git），根目录 `CLAUDE.md` 是给 agent 读的副本（gitignore）。只改了正本，`sync` / `push` 自动同步给副本；只改了副本（`mirror-ahead`），不会自动收进正本——`sync` 列为待决、`pull` 不动它、`push` / `merge` 先列出差异退出 2，人看过差异、确认后加 `--take-mirror` 才把副本的改动收进正本再推；不要这些改动就 `shelf pull <正本> --force`。两份各改各的也停下，交给人定。副本是复制出来的文件而不是链接：Windows 上给单个文件建符号链接要管理员权限或开发者模式，硬链接又会在 git 或编辑器整份重写文件时悄悄断开，Codex 读 `AGENTS.md` 也不认 `@` 引用。技能目录是整目录链接（Windows 上是 junction），不需要副本。副本由模板登记、`init` / `sync` 维护，没有手动登记的命令。

## 双方都改过：diff → merge → push

```bash
shelf sync --merge --push        # 一条命令：能合的合、能推的推，只剩冲突（退出 3）
# 或者手动一步步来：
shelf diff ai/jaSkills/intj      # ① 货架在上次拉取之后改了什么  ② 推上去会改成什么
shelf merge ai/jaSkills/intj     # 干净退出 0，有冲突退出 3（标准冲突标记：<<<<<<< 本地 / >>>>>>> 货架 <sha>）
shelf push ai/jaSkills/intj --yes
```

merge 逐文件处理：只有一边改的文件取改过的那边，新增 / 删除同理；两边都改的文本用 `git merge-file`；一边删一边改的留下改过的那份并列为冲突。merge 不改账本——它在本机 `~/.shelf/state/` 记一笔「本地已合进货架哪一版」，push 据此放行（不用 `--force`）；push 成功才更新账本。

## 账本 `.shelf.json`

进项目 git，不要手改（登记的增删用 pull / forget）。

```jsonc
{
  "source": "https://github.com/Jackzz119/my-workspace.git",
  "aiDir": "ai",
  "agents": ["claude", "codex"],
  "template": { "name": "ai", "commit": "…" },
  "shelf": {
    "skills/_common/intj": { "sourceCommit": "…", "contentHash": "sha256:…", "pulledAt": "2026-10-18", "localPath": "ai/jaSkills/intj", "fromTemplate": true },
    "agents/claude/CLAUDE.md": { "…": "…", "localPath": "ai/jaAgents/CLAUDE.md", "mirror": "CLAUDE.md" },
    "docs/JASKILL.md": { "…": "…", "localPath": "ai/JASKILL.md", "planted": true }
  },
  "local": { "emil-design-eng": { "contentHash": "sha256:…", "addedAt": "2026-09-30", "origin": "adopted" } }
}
```

## 从 1.x 升级

- 第一次 `shelf init` / `shelf sync` 自动迁移：协议正本从根目录挪到 `ai/jaAgents/`（根目录变副本；两份不同时按账本判断谁改过，都改过就停下）、`docs/JASKILL.md` 补 `planted`、老的 `.codex/skills` 迁到 `.agents/skills`、模板新增的货装上。
- 输出不是终端时默认 JSON；脚本要文字加 `--text`。
- CLI 所在的 git 仓库不再被自动当成货架；要用某个 clone 当货架就设 `SHELF_HOME`。
- 非交互首次 `init` 不带 `--agents` 时按模板默认接入（以前是退出 2）。

## 货架从哪来

按序解析，第一个命中的生效：

1. `SHELF_HOME` 环境变量指向的 clone
2. `~/.shelfrc` 里的 `{"home": "..."}`
3. 托管档口 `~/.shelf/home`（不存在就自动创建）

用别的内容仓库：设 `SHELF_REMOTE=<git地址>`，或写进 `~/.shelfrc` 的 `{"remote": "..."}`。临时机器不想留档口：设 `SHELF_EPHEMERAL=1`，写操作走一次性 clone，用完即删。没装 shelf 的地方，项目里的 `ai/scripts/sync-worktree.sh` 能离线补技能链接与根目录协议副本。

## 开发

```bash
cd packages/shelf
npm test    # node:test，零依赖；每个用例用临时 bare 仓库当货架（含真实的 templates/ai），不碰真货架
```

## License

MIT
