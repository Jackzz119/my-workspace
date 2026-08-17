---
name: shelf-ops
description: 货架（shelf）操作手册——用户要求从货架拉取/推送/上架技能、模板、文档等任何内容，或提到"货架 / shelf / 拉技能 / 推上去 / 上架 / 同步到云端"时使用。封装 shelf 命令的正确用法、落点约定和冲突处理守则。
allowed-tools: Bash, Read
---

# Shelf 操作手册

shelf 是 my-workspace monorepo 里的内容货架（`shelf/` 目录，git 管理，**唯一真源**）。
`shelf` 是哑传输工具：浏览 / pull / push / create 只搬文件；**放哪、什么时候推、冲突怎么办**由你按本手册判断。
核心设计：**没有人（包括你）需要记忆或翻查货架的目录结构**——更新自动定位，上架实时选位。

## 命令参考

```bash
shelf                                 # 交互浏览（脚本里别用，会挂住等输入）
shelf pull <shelf路径> [...]           # 按路径拉取到当前目录，可多个
shelf pull <shelf路径> --dest <目录>   # 拉到指定目录
shelf create <本地路径> --to <货架目录> # 上架新货（重名会被拒绝；--to 可为新目录）
shelf push <本地路径>                  # 更新已有货：自动定位，不填地址
shelf push <本地路径> --yes            # 跳过确认（仅在用户明确要求时用）
shelf init                             # 初始化工作区（manifest + 本手册）
```

- 路径里 `_` 前缀可省略：`skills/common/intj` 和 `skills/_common/intj` 等价，落盘用真实名。
- 找不到货架时先检查 `SHELF_HOME` 环境变量或 `~/.shelfrc`（`{"home": "<my-workspace clone 路径>"}`）。
- 版本追踪在当前目录 `.shelf.json`（`shelf` 段，按 shelf 相对路径为键），不要手改；见到旧名 `.agent-toolkit.json` / `.atk.json` 属正常，任一次 pull/push 会自动迁移。

## create 还是 push？

| 情况 | 用哪个 | 定位逻辑 |
|---|---|---|
| 这个东西货架上还没有 | `shelf create <路径> --to <目录>` | 先全架查重名：**重名直接被拒**（名字即 ID）。被拒时把已有位置转述给用户——大概率该用 push |
| 更新从货架拉过的东西 | `shelf push <路径>` | 按 `.shelf.json` 记账推回原位；**原位被移走会自动按名字找回**、推新位置并更新记账 |
| 更新货架已有、但本工作区没拉过的东西 | `shelf push <路径>` | 按文件名全架匹配；唯一命中即视为更新它 |

push 不接受 `--to`；create 的 `--to` 是**货架目录**（不存在会新建），条目名 = 本地文件/文件夹名。

## 落点约定（pull 之后放哪）

CLI 一律拉到当前目录，分类落点由你执行：

| 拉的是什么 | 放到哪 |
|---|---|
| `shelf/skills/**` 下的技能 | Claude Code 项目：`./.claude/skills/<技能名>/`；Codex：`~/.codex/skills/` 或项目 `.codex/skills/` |
| `shelf/agents/claude/CLAUDE.md` | 项目根 `CLAUDE.md`（已有则对比合并，别盲目覆盖） |
| `shelf/agents/codex/AGENTS.md` | 项目根 `AGENTS.md` |
| 其他文档/模板/文件 | 用户指定处，默认当前目录 |

技能落点可以一步到位：`shelf pull skills/common/intj --dest .claude/skills` 。

## Push / Create 守则

1. push/create 前先跑一遍不带 `--yes` 的命令，把变更清单（新增/删除/修改）或"将新建目录"提示转述给用户。
2. 遇到「货架已被其他设备修改」：非交互环境会打印差异后自动中止（exit 3），把差异转述给用户；**没有用户明确指示不得加 `--force`**。
3. 遇到「已被移动到 X」的搬家提示：这是正常的自动找回，转述新位置即可；记账会自动更新。
4. `--force-secret` 永远不主动使用；工具拦下疑似凭据文件时，如实告知用户被拦的文件名。
5. create 被重名拒绝时，把已有条目位置告诉用户，问清是"更新它"（改用 push）还是"改名再上架"。
6. push/create 成功后提交信息是自动的（`shelf: update/add <路径> (from <主机名>)`），不需要你另外 commit。

## 典型对话 → 命令

- "把 intj 技能拉到这个项目" → `shelf pull skills/common/intj --dest .claude/skills`
- "看看货架上有什么" → 用 `ls <SHELF_HOME>/shelf` 逐层看，把目录结构转述给用户（交互浏览器留给用户手动用）
- "我改了这个技能，同步上去" → `shelf push .claude/skills/<名字>`（自动定位，不用查它在货架哪里）
- "把这份部署清单存到货架" → `shelf create deploy-checklist.md --to docs`（新东西用 create；被拒说明已有同名，改用 push 或改名）
