# shelf

个人内容货架 CLI：把技能、工作协议、文档、模板放在一个 git 仓库（货架）里，在任何项目、任何设备上接入、同步、回传。主要使用者是 AI agent（Claude Code / Codex 经 Bash 调用），人也可以直接用。

```bash
npm i -g @jackss119/shelf
cd my-project
shelf init --agents claude,codex   # 新项目接入：协议 + 通用技能 + 技能链接 + gitignore + ai 资料区脚手架
shelf status                       # 随时看：哪些物品货架有更新、哪些本地改过
shelf sync                         # 货架新版且本地没动 → 自动更新；本地改过的列为待决
```

首次运行时 shelf 会把货架仓库 clone 到 `~/.shelf/home`（托管档口），之后所有命令都在本地跑，每次操作前自动拉最新。**不需要手动 clone 任何东西。**

## 命令

| 命令 | 作用 |
|---|---|
| `shelf init [--agents claude,codex,kimi\|all] [--ai-dir <名>]` | 项目接入（幂等，重跑 = 补缺失 + 体检），见下方「init 做了什么」 |
| `shelf status` | 只读对账（等同 `sync --dry-run`）：每件物品是一致、待更新还是待决，附下一步命令 |
| `shelf sync [--dry-run]` | 按账本对账：货架新版且本地没动 → 自动更新本地；本地改过 / 双改 / 搬家下架 / 本地丢失 → 列为待决 |
| `shelf diff <货架路径或本地路径> [--stat]` | 三方对比（只读）：① 货架在上次拉取之后改了什么 ② 推上去会改成什么 |
| `shelf merge <货架路径或本地路径>` | 三方合并「双方都改过」的物品，结果写回本地；账本等 push 成功才更新 |
| `shelf pull <货架路径或本地路径...> [--dest <目录>] [--force]` | 拉取：记过账的回原位，新技能默认进技能正本，其余落当前目录；`--force` 用货架版本覆盖本地改动 |
| `shelf push <本地路径> [--yes] [--force] [--force-secret]` | 更新货架上已有的物品：按账本 / 名字自动定位；不带 `--yes` 只列变更清单 |
| `shelf create <本地路径> [--to <货架目录>] [--yes]` | 上架新物品：全架查重名（名字即 ID）；非交互必须 `--to` |
| `shelf forget <货架路径或本地路径...>` | 从账本删掉物品（本地文件不动），处理「货架已下架」「本地已删」 |
| `shelf mirror <本地路径> [<副本路径> \| --off]` | 登记 / 查看 / 取消入库副本（如 `CLAUDE.md` ↔ `ai/jaAgents/CLAUDE.md`） |
| `shelf ls [货架路径]` | 列出货架某一层：类型、大小、本项目是否已装、装在哪 |
| `shelf` | 交互浏览货架（给人用）：数字进目录 · `p 1,3-5` 拉取 · `a` 全部 · `..` 上级 · `q` 退出 |
| `shelf agents [add <名>]` | 查看 / 追加 agent 目标（claude / codex / kimi） |
| `shelf adopt` | 收编外来技能：实体目录迁入技能正本并重链，未记账技能登记进账本 `local` 段 |
| `shelf home [--update]` | 货架在哪、什么模式；`--update` 立即拉最新 |
| `shelf version`（`--version` / `-v`） | 打印版本 |
| `shelf help [命令]`（`<命令> --help`） | 用法；`help --json` 输出机器可读的命令表与退出码 |

所有命令都接受全局参数 `--json`。路径里 `_` 前缀可省（`skills/common/intj` = `skills/_common/intj`），Windows 反斜杠路径照样认。`atk` 是 `shelf` 的别名。

## 退出码

| 退出码 | 含义 | 下一步 |
|---|---|---|
| 0 | 成功 / 无需变更 / 全部一致 | — |
| 1 | 参数错误、未知命令或参数、找不到物品、重名、凭据拦截、正本与副本不一致、植入物不推 | 按错误信息改 |
| 2 | 要人确认：变更清单已打印；`sync` / `status` 有待决；`diff` 有差异；`pull` 因本地改动没覆盖 | 看清单 / 差异，按 `next` 走（确认后加 `--yes`） |
| 3 | 冲突：货架在你上次拉取后被改过、多个同名无法自动选、`merge` 有冲突、冲突标记还没解决 | `diff` → `merge` → 解决冲突 → `push`；未经人明示不加 `--force` |
| 4 | 提交或推送失败（货架已回滚到改动前） | 把错误原文转给人 |

## 给 agent 用

- **非交互绝不等键盘**：stdin 不是终端、带 `--json`、或设了 `SHELF_NONINTERACTIVE=1` 时，要确认的操作打印清单后退出 2，冲突退出 3。
- **`--json`**：stdout 只有一份 JSON，人读的叙述不输出：

  ```json
  {"ok":false,"command":"sync","exitCode":2,"cliVersion":"1.3.0","schemaVersion":1,
   "data":{"items":[{"key":"skills/_common/intj","localPath":"ai/jaSkills/intj","state":"both-changed",
     "next":["shelf diff ai/jaSkills/intj","shelf merge ai/jaSkills/intj"]}],"counts":{"same":9,"pending":1}},
   "next":["shelf diff ai/jaSkills/intj","shelf merge ai/jaSkills/intj"]}
  ```

  `ok` = 退出码是 0；`next` 是建议的下一步命令（多条时是并列选项，方向由人定）；出错时多一个 `error.message`，警告在 `warnings`。
- **未知参数直接报错**（退出 1），编造的参数不会被悄悄忽略。
- **sync / status 的物品状态**：`same` 一致 · `would-update` / `updated` 货架新版（本地没动，自动更新）· `refreshed` 内容已一致、只刷新账本 · `local-ahead` 本地领先 · `both-changed` 双方都改过 · `merged` 已合并待推送 · `merge-conflict` 合并后还有冲突标记 · `removed` 货架已下架 · `ambiguous` 同名多义 · `local-missing` 本地文件没了 · `mirror-mismatch` 正本与入库副本不一致 · `planted` 植入物不对账。

## init 做了什么

`shelf init` 在项目里落下（已有的不覆盖，重跑只补缺）：

| 落点 | 内容 |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | 工作协议（按 `--agents` 选的目标；codex 与 kimi 共用 AGENTS.md），之后 `shelf sync` 保持最新 |
| `<ai>/JASKILL.md` | 项目专属技能登记表：**植入一次，之后归项目维护**，账本标 `planted`，sync / push 不对账（要重新植入：`shelf pull docs/JASKILL.md --force`） |
| `<ai>/jaSkills/<名>/` | 货架通用包（`skills/common`）的全部技能——项目里技能的唯一正本，进项目 git |
| `.claude/skills` · `.agents/skills` · `.kimi/skills` | 指向技能正本的整目录链接（Windows junction 免管理员 / POSIX 相对软链）；Codex 从 `.agents/skills` 发现项目技能 |
| `<ai>/PROJECT.md` · `<ai>/TODO.md` | 协议要求的项目文档骨架 |
| `<ai>/features/` · `sessions/` · `design_system/` · `project-audit/` | 已装技能要用的目录（对应 feature / intj / monet·ui-tailor·codex-visual / project-audit，没装的不建），放 `.gitkeep` 让结构进 git |
| `.gitignore` | 只补缺的行：`/CLAUDE.md`、`/AGENTS.md`、`/.claude/skills`、`/.agents/skills`……（根锚定，不误伤 `ai/jaAgents/CLAUDE.md` 这类入库副本；已被 `.claude/` 之类的规则盖住就不补） |
| `.shelf.json` | 账本，进项目 git；换设备 / 队友 clone 后 `shelf init` 按账本还原 |

**`<ai>` 的名字按项目命名规范定**：项目里已有 `ai` / `AI` 目录就沿用；否则 .NET / C# 项目（根目录或一层子目录有 `.sln` / `.csproj`，或 Unity 工程）用 `AI`，JS / TS / Java 等用 `ai`；`--ai-dir` 可指定，结果记在账本 `aiDir`。

技能可以在 `SKILL.md` frontmatter 里声明自己要的目录，init 会一并建出（逗号分隔，相对 ai 目录）：

```yaml
metadata:
  shelf-scaffold: design_system/codex-visual, references
```

重跑 init / sync 还会体检：老项目的 `.codex/skills` 迁到 `.agents/skills`，账本里的 `docs/JASKILL.md` 补上 `planted`，断掉或被安装器换成实体目录的技能链接修回来。

## 双方都改过：diff → merge → push

```bash
shelf sync                       # 报「双方都改过」，退出 2
shelf diff ai/jaSkills/intj      # ① 货架在上次拉取之后改了什么  ② 推上去会改成什么
shelf merge ai/jaSkills/intj     # 以上次拉取的版本为基准三方合并；干净退出 0，有冲突退出 3
#   冲突文件里是标准冲突标记（<<<<<<< 本地 / ======= / >>>>>>> 货架 <sha>），改好再推
shelf push ai/jaSkills/intj      # 先看变更清单（退出 2）
shelf push ai/jaSkills/intj --yes
shelf sync                       # 全一致，退出 0
```

merge 逐文件处理：只有一边改的文件直接取改过的那边，新增 / 删除同理；两边都改的文本用 `git merge-file` 合并；一边删一边改的留下改过的那份并列为冲突。merge 不改账本——它在本机 `~/.shelf/state/` 记一笔「本地已合进货架哪一版」，push 据此放行（不用 `--force`）；push 成功才更新账本。

## 账本 `.shelf.json`

```jsonc
{
  "source": "https://github.com/Jackzz119/my-workspace.git",
  "aiDir": "ai",
  "agents": ["claude", "codex"],
  "shelf": {
    "skills/_common/intj": {
      "sourceCommit": "…",          // 上次拉取 / 推送时货架的提交（diff / merge 的基准）
      "contentHash": "sha256:…",    // 当时的内容指纹
      "pulledAt": "2026-10-18",
      "localPath": "ai/jaSkills/intj"
    },
    "agents/claude/CLAUDE.md": { "…": "…", "localPath": "CLAUDE.md", "mirror": "ai/jaAgents/CLAUDE.md" },
    "docs/JASKILL.md": { "…": "…", "localPath": "ai/JASKILL.md", "planted": true }
  },
  "local": { "emil-design-eng": { "contentHash": "sha256:…", "addedAt": "2026-09-30", "origin": "adopted" } }
}
```

- `mirror`：入库副本。根目录协议常被 gitignore，有的项目另存一份进 git。pull / sync 两处一起写；push / merge 前核对两处一致，不一致就列出差异停下（退出 1），不替人选。用 `shelf mirror` 登记，不要手改。
- `planted`：植入后归项目的文件，sync 列为「植入，不对账」，push 拒绝。
- `local`：技能正本里不来自货架的技能（网上装的第三方技能等），不参与对账；sync 会提示还没登记进 JASKILL.md 的。

## 货架从哪来

按序解析，第一个命中的生效：

1. `SHELF_HOME` 环境变量指向的 clone
2. CLI 自身所在的 clone（monorepo 开发态 / `npm link`）
3. `~/.shelfrc` 里的 `{"home": "..."}`
4. 托管档口 `~/.shelf/home`（不存在就自动创建）

用别的内容仓库：设 `SHELF_REMOTE=<git地址>`，或写进 `~/.shelfrc` 的 `{"remote": "..."}`。临时机器不想留档口：设 `SHELF_EPHEMERAL=1`，写操作走一次性 clone，用完即删。

## 开发

```bash
cd packages/shelf
npm test    # node:test，零依赖；每个用例用临时 bare 仓库当货架，不碰真货架
```

## License

MIT
