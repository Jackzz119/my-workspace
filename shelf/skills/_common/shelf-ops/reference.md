# Shelf 参考（按需读）

> 不随技能常驻：排查状态、解释账本、在新机器或没装 shelf 的地方开工、改模板时才读。常用流程在 `SKILL.md`。

## JSON 输出

每条命令输出一份：

```json
{"ok": false, "command": "sync", "exitCode": 2, "cliVersion": "2.0.0", "schemaVersion": 1,
 "data": {"items": [{"key": "skills/_common/intj", "localPath": "ai/jaSkills/intj", "state": "local-ahead",
   "pending": true, "next": ["shelf push ai/jaSkills/intj"]}], "counts": {"same": 12, "pending": 1}},
 "next": ["shelf push ai/jaSkills/intj"]}
```

`ok` = 退出码是 0；`next` 是建议的下一步；出错时多一个 `error.message`，警告在 `warnings`。终端里给人看时输出文字，`--json` / `--text` 或环境变量 `SHELF_OUTPUT=json|text` 可以强制。

## 物品状态（init / sync / status 的 `data.items[].state`）

| state | 含义 | 要处理吗 |
|---|---|---|
| `same` | 一致 | — |
| `updated` / `would-update` | 货架有新版、本地没动 → 已更新 / 将更新 | — |
| `installed` / `would-install` | 模板新增的货 → 已装 / 将装 | — |
| `restored` / `would-restore` | 本地缺的已补拉（init）；被 git 忽略的植入物本地没了，已补回 / 将补回（sync / status，2.2 起） | — |
| `hooks-merged` / `would-merge-hooks` | 已有的钩子配置补上了 / 将补上模板里缺的钩子（2.2 起） | 新钩子从下一个会话起生效 |
| `refreshed` | 内容本来就和货架一样，只刷新了账本 | — |
| `planted` | 植入物，不对账 | — |
| `pushed` | 已推上货架（sync --push） | — |
| `local-ahead` | 本地改过、货架没变 | `shelf push` |
| `both-changed` | 本地和货架都改过 | `shelf diff` → `shelf merge` |
| `merged` | 已合并货架的改动，待推送 | `shelf push` |
| `merge-conflict` | 合并后还有冲突标记 | 解决后 `shelf push` |
| `removed` / `ambiguous` | 货架上下架了 / 同名多义 | 问用户，`shelf forget` |
| `local-missing` | 本地没了 | `shelf pull --force` 或 `shelf forget` |
| `mirror-ahead` | 副本改过、正本没动（2.1 起不自动收进正本） | 给用户看差异；要留 → `push <正本> --take-mirror`，不要 → `pull <正本> --force` |
| `mirror-mismatch` | 正本与副本各改各的 | 用户定以哪份为准 |
| `untracked-differs` | 本地有同名文件、没记过账、内容不同 | 用户选货架版或本地版 |

## 账本 `.shelf.json`

```jsonc
{
  "source": "<货架仓库地址>",
  "aiDir": "ai",                       // ai 区目录名（.NET / C# 项目是 AI）
  "agents": ["claude", "codex"],
  "template": { "name": "ai", "commit": "<装模板时货架的提交>" },
  "shelf": {
    "skills/_common/intj": { "sourceCommit": "…", "contentHash": "sha256:…", "pulledAt": "…", "localPath": "ai/jaSkills/intj", "fromTemplate": true },
    "agents/claude/CLAUDE.md": { "…": "…", "localPath": "ai/jaAgents/CLAUDE.md", "mirror": "CLAUDE.md" },
    "docs/JASKILL.md": { "…": "…", "localPath": "ai/JASKILL.md", "planted": true }
  },
  "local": { "<项目自己的技能>": { "contentHash": "…", "addedAt": "…", "origin": "adopted" } }
}
```

- `sourceCommit` / `contentHash`：上次拉取或推送时货架的提交和内容指纹，diff / merge 的基准
- `mirror`：副本路径；`planted`：植入物；`fromTemplate`：模板装进来的（模板去掉它时 sync 会提示）
- `local`：技能正本里不来自货架的技能（网上装的、项目自建没上架的），不参与对账

## 货架从哪来

`SHELF_HOME` 环境变量 → `~/.shelfrc` 的 `home` → 托管档口 `~/.shelf/home`（首次运行自动 clone，以后每次操作前自动拉最新）。CLI 所在的仓库不会被自动当成货架。

- 换内容仓库：`SHELF_REMOTE=<git 地址>` 或 `~/.shelfrc` 的 `remote`
- 临时机器不想留档口：`SHELF_EPHEMERAL=1`，写操作走一次性 clone

## 没装 shelf 的机器、worktree、Multica

- 装：`npm i -g @jackss119/shelf`，之后 `shelf init`
- 装不了或没网：`bash ai/scripts/sync-worktree.sh`（依次调 `skills-link.sh` 建技能链接、`protocol-mirror.sh --sync` 让根目录协议副本和 `ai/jaAgents` 正本一致、`local-config.sh` 按 `.worktreeinclude` 从主检出补本地配置（钩子配置、`.env` 类…；`.mcp.json` 单独处理）再跑项目的 `ai/scripts/worktree.local.sh`；不对账）
- Multica 的 worktree：`bash ai/scripts/bootstrap.sh`（`skills-link.sh --copy` 把技能复制进 agent 目录，`MULTICA.md` 复制成根目录协议（已有 runtime 身份简报就追加在它下面），`local-config.sh --multica` 按 `.worktreeinclude` 补本地配置但不补会话钩子配置和 `.mcp.json`，再跑项目的 `ai/scripts/worktree.local.sh`）
- 这几个模块各只做一件事、可单跑、重复执行安全，都认 `--root <检出>` 和 `--dry-run`：`lib/common.sh`（只被 source：认检出与主检出、ai 区目录名、锁）、`skills-link.sh`、`local-config.sh`、`protocol-mirror.sh`、`shelf-step.sh`（跑一遍 `shelf sync` 并报告）。入口 `session-start.sh` / `sync-worktree.sh` / `bootstrap.sh` 只按顺序调它们；`sync-worktree.sh` 与 `bootstrap.sh` 的名字和不带参数的用法不变（协议与 Multica agent 指令写死了它们）

- 协议副本的钩子：模板的 `.claude/settings.json` 在 `SessionStart` / `UserPromptSubmit` 上挂了 `bash ai/scripts/protocol-mirror.sh --hook`——每条消息都对齐一次 `CLAUDE.md`，会话开场读到的协议过期就往上下文里插一句「先重读」，副本被人改过就提醒走 review；没事时一个字都不打印、约 50ms。比对的是会话所在的检出：脚本读钩子输入 JSON 的 `cwd`，指纹记在那个检出自己的 git 目录（`<git-dir>/ai-mirror/`）。Codex 同理：模板的 `.codex/hooks.json` 挂 `--hook codex`，对齐 `AGENTS.md`；Codex 只跑人信任过的项目钩子，第一次（以及钩子内容改了之后）要用户在 Codex 的 `/hooks` 里点信任，agent 替不了

## 会话开场钩子与主检出快进

- **钩子在哪跑**：桌面版 worktree 会话的设置、钩子、技能都从主检出读，钩子在主检出根目录启动、`$CLAUDE_PROJECT_DIR` 指向主检出；只有钩子输入 JSON 的 `cwd` 是会话所在的 worktree（`CLAUDE.md` 仍从 worktree 读）。Codex 的钩子在会话 `cwd` 里跑，输入里同样有 `cwd`。所以 `session-start.sh` 与 `protocol-mirror.sh --hook` 都先读 `cwd` 找会话所在的检出，读不到（终端里手动跑、旧版客户端）或不在同一个仓库，就按脚本所在的检出算
- **`session-start.sh` 做什么**：用的是脚本旁边那一份模块（桌面版就是主检出的），`--root` 指向要处理的检出，所以 worktree 的分支旧、还没有这些模块也照样处理。拿到主检出锁的那个会话先把 shelf 升到 npm 最新版；然后**先主检出**：`protocol-mirror.sh --sync` → `shelf-step.sh`（`shelf sync`）；会话开在 linked worktree 时**再处理那个 worktree**：`local-config.sh` → `skills-link.sh` → `protocol-mirror.sh --sync`（准备：从主检出复制来的旧副本先换成本分支正本，免得 shelf 当成「副本领先」）→ `shelf-step.sh` → `protocol-mirror.sh --sync`（收尾）。任何地方都不跑 `shelf init`；`sync` 都不带 `--merge` / `--push`，有人改过的货不动、列成待决。最后输出 `reloadSkills`，本会话当场用上同步后的技能
- **新 worktree 的副本假警报**：主检出被开场钩子同步到货架新版、集成分支还没跟上时，桌面版从主检出复制来的根副本既不是本分支正本的历史版本、也没有指纹，原来会被当成「副本被人改过」。现在 `protocol-mirror.sh` 发现副本和主检出的根副本逐字节相同就换成本分支正本；shelf 2.2 的 `sync` 也认「副本就是货架当前版」，让正本跟上
- **主检出那一遍的规矩**：几个会话同时开场时只有一个真正跑（锁是主检出 git 目录下的 `ai-shelf-sync.lock`，持有进程不在了或放了 10 分钟以上算残留）；主检出有进行中的 merge / rebase / cherry-pick 就跳过；只有账本 `.shelf.json` 的记账字段变了、文件一个没变，就把账本还原（shelf 2.1 及以前 `shelf init` 每次都改写模板提交号；2.2 起内容没变不改账，这条只剩兜底）。真改到的文件留在主检出，本会话不提交、不还原
- **主检出里同步出来的改动怎么收尾**：合并进集成分支后跑 `bash ai/scripts/sync-main-checkout.sh`。它拿同一把锁（最多等 90 秒），逐个文件和远端比：全部和远端逐字节一致 → 还原成 HEAD 版本（快进要写的未跟踪文件一致就删掉）再 `--ff-only`；有一个不一致 → 整批不动，列出文件并标出哪些是货架管的。账本 `.shelf.json` 例外：其余改动都和远端一致时，它的差异当记账噪音一起丢掉（不同时间同步的两个检出，来源提交与拉取日期本来就不同，CLI 修好了也一样）。有暂存的改动、不在集成分支上、有本地提交都不动。不 reset、不 stash、不切分支
- **上游一直没有的同步改动**：货架在两次合并之间又更新过，主检出的同步结果比上游新，快进脚本会停在「不一致」。这时在某个 worktree 会话里跑一次 `shelf sync`、把改动提交合进集成分支，再跑快进脚本
- **钩子配置怎么进项目**：新项目 `shelf init` 整份植入；已有 `.claude/settings.json` / `.codex/hooks.json` 的老项目，shelf 2.2 起 `shelf sync`（开场钩子每次都跑）就补上缺的钩子，本地没了也补回。改的是 gitignored 的本机文件，不进提交；新钩子从下一个会话起生效

## 模板写法（`templates/<名>/template.json`）

```json
{
  "name": "ai",
  "defaultAgents": ["claude", "codex"],
  "items": [
    { "from": "agents/claude/CLAUDE.md", "to": "{ai}/jaAgents/CLAUDE.md", "copy": "CLAUDE.md", "agents": ["claude"] },
    { "from": "skills/common/*", "to": "{ai}/jaSkills/" },
    { "from": "files/ai/PROJECT.md", "to": "{ai}/PROJECT.md", "planted": true, "render": true }
  ],
  "scaffold": [{ "dir": "{ai}/features", "skills": ["feature", "intj"] }]
}
```

- `from`：货架路径；`files/` 开头是模板自带的文件（在模板目录的 `files/` 下）；以 `/*` 结尾表示每个子目录各算一件
- `to`：落点，`{ai}` 换成 ai 区目录名；`copy`：再写一份副本（根目录协议），进 gitignore
- `planted`：植入一次之后归项目；`render`：植入时把 `{{project}}`、`{{date}}`、`{{ai}}` 换成实际值
- `merge: "hooks"`（只对植入的 JSON 钩子配置有效，shelf 2.2 起）：本地已有时 `init`、`sync` 与 `pull` 只补模板里缺的钩子——同一事件下按 `command` 文本比，本地已有的不加、本地多出来的保留，其余键、缩进、结尾换行原样；JSON 读不懂就不动、只警告
- `agents`：只在接入了其中某个 agent 时才装；`scaffold`：装了对应技能才建的目录（放 `.gitkeep`），一般不用写——
- 技能自己声明固定目录：`SKILL.md` frontmatter 的 `metadata` 里写 `shelf-scaffold: "目录a, 目录b"`（相对 ai 区），init / sync 缺了就建；写法与「固定目录」一节的要求见 custom-skill
- 模板加了货 → 各项目下次 sync 自动装上；模板去掉的货，项目里保留，sync 提示可以 forget

## 给用户介绍交互浏览器时（你自己别跑）

在终端里直接跑 `shelf` 进入浏览器：数字 = 进入该目录；`p 1,3-5` = 拉取所选；`a` = 全部拉取；`..` = 上级；`q` = 退出。`shelf create` 不带 `--to` 时的选位浏览器：数字 = 进入；`m <名>` = 新建目录并进入；`d` = 放在这里；`q` = 取消。
