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
| `restored` | 本地缺的已补拉（init） | — |
| `refreshed` | 内容本来就和货架一样，只刷新了账本 | — |
| `planted` | 植入物，不对账 | — |
| `pushed` | 已推上货架（sync --push） | — |
| `local-ahead` | 本地改过、货架没变 | `shelf push` |
| `both-changed` | 本地和货架都改过 | `shelf diff` → `shelf merge` |
| `merged` | 已合并货架的改动，待推送 | `shelf push` |
| `merge-conflict` | 合并后还有冲突标记 | 解决后 `shelf push` |
| `removed` / `ambiguous` | 货架上下架了 / 同名多义 | 问用户，`shelf forget` |
| `local-missing` | 本地没了 | `shelf pull --force` 或 `shelf forget` |
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
- 装不了或没网：`bash ai/scripts/sync-worktree.sh`（建技能链接、按 `ai/jaAgents` 补根目录协议副本、复制主检出的 `.mcp.json`；不对账）
- Multica 的 worktree：`bash ai/scripts/bootstrap.sh`（技能复制进 agent 目录，`MULTICA.md` 复制成根目录协议）

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
- `agents`：只在接入了其中某个 agent 时才装；`scaffold`：装了对应技能才建的目录（放 `.gitkeep`），一般不用写——
- 技能自己声明固定目录：`SKILL.md` frontmatter 的 `metadata` 里写 `shelf-scaffold: "目录a, 目录b"`（相对 ai 区），init / sync 缺了就建；写法与「固定目录」一节的要求见 custom-skill
- 模板加了货 → 各项目下次 sync 自动装上；模板去掉的货，项目里保留，sync 提示可以 forget

## 给用户介绍交互浏览器时（你自己别跑）

在终端里直接跑 `shelf` 进入浏览器：数字 = 进入该目录；`p 1,3-5` = 拉取所选；`a` = 全部拉取；`..` = 上级；`q` = 退出。`shelf create` 不带 `--to` 时的选位浏览器：数字 = 进入；`m <名>` = 新建目录并进入；`d` = 放在这里；`q` = 取消。
