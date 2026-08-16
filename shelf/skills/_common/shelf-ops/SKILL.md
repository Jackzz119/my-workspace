---
name: shelf-ops
description: 货架（shelf）操作手册——用户要求从货架拉取/推送技能、模板、文档等任何内容，或提到"货架 / shelf / 拉技能 / 推上去 / 同步到云端"时使用。封装 atk shelf 命令的正确用法、落点约定和冲突处理守则。
allowed-tools: Bash, Read
---

# Shelf 操作手册

shelf 是 my-workspace monorepo 里的内容货架（`shelf/` 目录，git 管理，**唯一真源**）。
`atk shelf` 是哑传输工具：list / pull / push 只搬文件；**放哪、什么时候推、冲突怎么办**由你按本手册判断。

## 命令参考

```bash
atk shelf                                 # 交互浏览（脚本里别用，会挂住等输入）
atk shelf pull <shelf路径> [...]           # 按路径拉取到当前目录，可多个
atk shelf pull <shelf路径> --dest <目录>   # 拉到指定目录
atk shelf push <本地路径> --to <shelf路径>  # 推回货架（--to 是完整目标路径，不是父目录）
atk shelf push <本地路径> --yes            # 跳过确认（仅在用户明确要求时用）
atk shelf init                             # 初始化工作区（manifest + 本手册）
```

- 路径里 `_` 前缀可省略：`skills/common/intj` 和 `skills/_common/intj` 等价，落盘用真实名。
- 找不到货架时先检查 `ATK_HOME` 环境变量或 `~/.atkrc`（`{"home": "<my-workspace clone 路径>"}`）。
- 版本追踪在当前目录 `.agent-toolkit.json`（`shelf` 段，按 shelf 相对路径为键），不要手改。

## 落点约定（pull 之后放哪）

CLI 一律拉到当前目录，分类落点由你执行：

| 拉的是什么 | 放到哪 |
|---|---|
| `shelf/skills/**` 下的技能 | Claude Code 项目：`./.claude/skills/<技能名>/`；Codex：`~/.codex/skills/` 或项目 `.codex/skills/` |
| `shelf/agents/claude/CLAUDE.md` | 项目根 `CLAUDE.md`（已有则对比合并，别盲目覆盖） |
| `shelf/agents/codex/AGENTS.md` | 项目根 `AGENTS.md` |
| 其他文档/模板/文件 | 用户指定处，默认当前目录 |

技能落点可以一步到位：`atk shelf pull skills/common/intj --dest .claude/skills` 。

## Push 守则

1. push 前先跑一遍不带 `--yes` 的命令，把变更清单（新增/删除/修改）转述给用户。
2. 遇到「货架已被其他设备修改」：非交互环境会打印差异后自动中止（exit 3），把差异转述给用户；**没有用户明确指示不得加 `--force`**。
3. `--force-secret` 永远不主动使用；工具拦下疑似凭据文件时，如实告知用户被拦的文件名。
4. 新内容第一次上架用 `--to` 给它一个有意义的分类路径（如 `--to templates/nextjs-starter`），不要堆在货架根。
5. push 成功后提交信息是自动的（`shelf: update <路径> (from <主机名>)`），不需要你另外 commit。

## 典型对话 → 命令

- "把 intj 技能拉到这个项目" → `atk shelf pull skills/common/intj --dest .claude/skills`
- "看看货架上有什么" → `atk shelf pull` 不适用；用 `ls <ATK_HOME>/shelf` 或逐层 `ls`，把目录结构转述给用户（交互浏览器留给用户手动用）
- "我改了这个技能，同步上去" → `atk shelf push .claude/skills/<名字> --to skills/common/<名字>`（先确认它源自货架的哪个路径，manifest 里查得到）
- "把这份部署清单存到货架" → `atk shelf push deploy-checklist.md --to docs/deploy-checklist.md`
