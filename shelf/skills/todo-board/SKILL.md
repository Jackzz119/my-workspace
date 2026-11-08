---
name: todo-board
description: 用户的个人随手待办：正本在每个项目自己的待办页（claude.ai artifact，跟账号走，手机电脑都能开），副本在 ai 区的 board/board.md 加图片，不是项目任务来源。用户问「我的待办 / 个人待办 / board 上有什么」，或要你在个人待办里加一条、勾掉、改、删时使用。在 Claude Code 里这个目录同时是一个 mod：输入框上方打开待办页的按钮（项目还没有待办页时建一个），以及待办页和仓库副本之间的同步。
allowed-tools: Read, Glob, Grep
---

# 个人待办（todo-board）

**触发策略：用户提到才用。** 读随时可以；加、勾、改、删只在用户明确要求时做。项目任务仍以 ai 区的 `TODO.md` 为准，两边不互相搬运：用户说「记进 TODO」才进 TODO，说「记进待办 / board」才进这里。

下文的 `ai/` 指项目的 ai 区：目录名以货架账本 `.shelf.json` 的 `aiDir` 为准（.NET 项目是 `AI/`），没有账本时是 `ai/`。

## 数据在哪

- **正本：待办页**，每个项目一个，链接写在 `ai/board/board.md` 开头那段说明里。页面由本目录的 `page/board.html` 发布，标题是「<项目名> 待办」。待办是它数据库里 `todos` 集合的文档（`text`、`done`、`at`、`doneAt`、`order`、`images: [{id, w, h}]`、`updatedAt`），图片在它的资源库里，`meta/board` 文档的 `deleted` 记着页上删掉的编号。只有用户本人能打开，换设备登录 claude.ai 或 Claude app 都在。
- **副本：`ai/board/board.md`** 加 `ai/board/images/<图片编号>.<后缀>`，由 Claude Code 里的 mod 从正本同步过来，给读不到 artifact 的 agent（Codex 等）用。

副本的改动属于用户的个人数据。是否、何时提交由用户决定：用户说「一起提交」时，单独成一个提交（如 `chore(board): 待办更新`），不和代码改动混在一起；没说就留在工作区。开头那段说明里的链接例外：它是 mod 找页面用的，建页面后随这次改动提交，别的设备拉下来才找得到。

## 格式（board.md）

```markdown
# 个人待办

> 说明段，含待办页链接（第一条待办之前的内容原样保留）

- [ ] 修登录页 <!-- id:mhg2k1a9 at:2026-11-01T08:20Z -->
  登录后跳回首页
  ![1600×900](images/0f3a…e1.jpg)
- [x] 换图标 <!-- id:mhg2k1b2 at:2026-11-01T08:21Z done:2026-11-01T09:00Z -->
```

- 一条待办以 `- [ ] ` 或 `- [x] ` 开头；行尾注释里是编号（`id`，即正本里的文档编号）、写下的时间（`at`）、完成的时间（`done`，UTC，到分钟）。
- 第二行起缩进两个空格：`![宽×高](images/…)` 是图片，其余是正文的续行。
- 未完成的在前（新的在上），已完成的在后（按完成时间）。
- 列表之后另起的段落（不缩进、也不是 `- [ ]` 的行）原样保留。

## 怎么做

- **读**：Claude Code 里调 `todo_list`（先同步再列）；别的 agent 直接读 `board.md`。未完成的逐条列，已完成的只报数量。
- **加**：
  - 有 `ArtifactData` 工具的 agent，直接在待办页的 `todos` 集合里建一个文档（编号用 `m` 开头，`order` 用当前毫秒数，`updatedAt` 同 `at`），再同步一次。
  - 没有的，在 `board.md` 第一条待办之前加一行 `- [ ] 文字`，**不带注释**；下次同步时 mod 把它收进待办页，再写回带编号的那一行。
  - 图片只能在待办页上加。
- **勾掉 / 重新打开**：在待办页上做，或把 `board.md` 里带编号那行的 `[ ]` 改成 `[x]`（反之亦然）。下次同步时，只要页上这一条在上次同步后没被改过，就照文件里的改。
- **改文字**：同上，页上改最稳；文件里改的规则和勾掉一样。
- **删**：只在待办页上删。从 `board.md` 里删掉一行不会删正本，下次同步会写回来。

## Claude Code 里的 mod

本目录的 `.claude-plugin/`、`hooks/`、`types/` 是一个 Claude Code mod：项目的 `.claude/skills` 指向 ai 区的 `jaSkills/`，Claude Code 开会话时自动加载它。其他 agent 没有 mod，只读写 `board.md`。

- **输入框上方的「待办」条**（只在桌面端和终端显示）：还有几条待做，「打开」在 claude.ai 的 artifact 面板里打开待办页。
- **命令与工具**：`/todo` 打开待办页，`/todo <文字>` 直接记一条，`/todo 同步` 立刻同步，`/todo 更新页面` 把待办页换成本目录 `page/board.html` 的最新版（待办和图片不动）。模型能用的工具是 `todo_open`、`todo_list`、`todo_sync`。
- **项目还没有待办页时**：开会话只提示，不自动建。第一次点「打开」、发 `/todo` 或 `/todo <文字>` 时，mod 用 `page/board.html` 发布一个「<项目名> 待办」，把链接写进 `board.md` 开头（没有 `board.md` 就新建）。发布时把页面填好项目名、临时写在 `ai/board/` 下，发完就删。
- **什么时候同步**：开会话时、点「打开」时、每轮对话结束且离上次同步超过 3 分钟时。同步时先把 `board.md` 里新加的行和改过的勾收进待办页，再把待办页整份写回 `board.md`，并下载缺的图片、删掉没人引用的图片。
- **会问确认**：读待办页不用确认；mod 第一次往待办页里写（收进 `board.md` 新加的行、`/todo <文字>`）时，会弹出写 artifact 数据库的确认，同意后这个会话里不再问。没人能确认的运行（如 `claude -p`）里写入会被拒，这时 `board.md` 原样留着，下次再收。
- **手机**：手机 app 上没有这条按钮，也画不了 mod 的界面。直接在 Claude app 里打开待办页；把它固定在 claude.ai 侧边栏最方便。
- 改 mod 代码后在本目录跑 `claude plugin test .` 和 `claude plugin validate .`；类型检查要等引擎在 `.claude-plugin/types/`（已忽略、不入库）写好类型后 `tsc -p .`。那个目录不在时别跑：继承的配置找不到，`tsc` 会把 `.js` 编译进 `hooks/` 和 `tests/`。
- 改了 `page/board.html`（它用 `{{name}}`、`{{board}}` 两个占位，发布时由 mod 填）后，在每个用到它的项目里发 `/todo 更新页面`。
