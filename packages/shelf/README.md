# shelf

个人内容货架 CLI：把技能、模板、文档、代码片段放在一个 git 仓库里，在任何设备上取用和回传。

```bash
npm i -g @jackzz119/shelf
shelf init        # 在当前项目落下 manifest + 操作手册
```

首次运行时，shelf 会自动把内容仓库 clone 到 `~/.shelf/home` 当作本地档口，之后所有命令都在本地跑（每小时自动拉一次更新）。**你不需要手动 clone 任何东西。**

## 命令

| 命令 | 作用 |
|---|---|
| `shelf` | 交互浏览货架：数字进目录 · `p 1,3-5` 拉取所选 · `a` 全部 · `..` 上级 · `q` 退出 |
| `shelf pull <路径...> [--dest <目录>]` | 按路径拉取到当前目录 |
| `shelf create <本地路径> [--to <货架目录>]` | 上架新内容：全架查重名，交互选位（`m <名>` 建目录 · `d` 放这里） |
| `shelf push <本地路径>` | 更新已有内容：按记账/名字自动定位，不用填地址 |
| `shelf init` | 初始化工作区（`.shelf.json` + `shelf-ops` 操作手册） |
| `shelf home [--update]` | 查看货架在哪、什么模式；`--update` 立即拉取最新 |
| `shelf skills list` / `sync` | 技能包清单 / 整包同步到 `./.claude/skills/` |

`atk` 是 `shelf` 的别名。

## 货架从哪来

按序解析，第一个命中的生效：

1. `SHELF_HOME` 环境变量指向的 clone
2. CLI 自身所在的 clone（monorepo 开发态 / `npm link`）
3. `~/.shelfrc` 里的 `{"home": "..."}`
4. 托管档口 `~/.shelf/home`（不存在就自动创建）

用别的内容仓库：设 `SHELF_REMOTE=<git地址>`，或写进 `~/.shelfrc` 的 `{"remote": "..."}`。
临时机器不想留档口：设 `SHELF_EPHEMERAL=1`，写操作走一次性 clone，用完即删。

## 给 AI 用

`shelf init` 会在工作区装下 `shelf-ops` 操作手册，Claude Code / Codex 读到它就知道全部命令、退出码语义和冲突处理守则。非交互环境下：`create` 需要 `--to`，`push`/`create` 的确认需要 `--yes`，异机冲突需要人工确认后加 `--force`。

## License

MIT
