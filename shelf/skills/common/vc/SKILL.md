---
name: vc
description: 版本控制助手 — 执行 git 操作时调用，包含 commit 规范、分支规范、安全规范及常用操作参考
---

**触发策略：询问后触发** — 检测到 git 操作场景时，先提示用户确认是否触发，等用户同意后再执行。

你是本项目的版本控制助手，负责执行所有 git 操作。以下规范适用于所有项目。

---

## Commit 规范

### 格式

```
<type>: <description>
```

**Commit message 必须用英语**（全项目统一，便于跨语言协作和工具链识别）。

全小写，简洁描述改动内容，聚焦"做了什么"而非"怎么做的"。专有名词（类名、文件名、缩写、audio key 等）保持原始大小写，其余全部小写。

### Type 列表

| type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | bug 修复 |
| `refactor` | 重构（不改行为） |
| `ui` | 样式、布局改动 |
| `visual` | 特效、动画、视觉表现 |
| `docs` | 文档更新 |
| `chore` | 构建、依赖、配置等杂项 |
| `build` | CI/CD、集成、构建相关 |
| `minor` | 小改动、清理、无功能影响 |
| `test` | 测试相关 |
| `perf` | 性能优化 |

特别小的改动可省略前缀，直接写描述。

### 示例

```
feat: add freespin result digit animation
fix: displaytime not overriding totalstarttime
refactor: extract socket init into separate module
minor: clean up unused fields
chore: update dependencies
```

---

## 执行流程

### 每次 commit 前必须先 add

```bash
git add <具体文件>     # 优先指定文件，避免误提交
# 或
git add .             # 确认内容后才使用
```

**不能跳过 add 直接 commit。**

### 标准流程

```bash
git status            # 1. 确认当前改动
git add <files>       # 2. 暂存改动
git diff --staged     # 3. 确认暂存内容
git commit -m "..."   # 4. 提交
git push              # 5. 推送（用户要求时）
```

### Commit message 传参方式

始终用 HEREDOC 传递，避免特殊字符问题：

```bash
git commit -m "$(cat <<'EOF'
type: 描述

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## 分支规范

- `main` / `master`：线上稳定版本，不直接推送
- `dev` / `develop`：日常开发集成分支
- `feat/<功能名>`：独立功能开发
- `fix/<问题描述>`：问题修复

PR/MR 方向：功能分支 → 开发分支 → 主分支

---

## 安全规范

- **禁止** `git push --force` 到 `main`/`master`
- **禁止** `--no-verify` 跳过 hooks，除非用户明确要求
- **禁止** 提交敏感文件（`.env`、credentials、密钥、token 等）
- **禁止** amend 已推送的 commit，除非用户明确要求
- 破坏性操作（`reset --hard`、`clean -f`、`branch -D`）执行前必须用户确认

---

## Gitignore 原则

- 敏感配置、本地环境文件必须 gitignore
- 已追踪的文件加入 gitignore 后，需执行 `git rm --cached <file>` 才能生效
- 文件必须同时存在于远程和本地（但内容不同）时，使用 `git update-index --skip-worktree <file>` 保护本地版本，避免被 pull/rebase 覆盖

---

## 常用操作参考

### 查看状态

```bash
git status
git log --oneline -10
git diff
git diff --staged
```

### 撤销操作

```bash
git restore <file>              # 丢弃工作区改动
git restore --staged <file>     # 取消暂存
git revert HEAD                 # 安全撤销最近一次 commit（保留历史）
```

### 同步远程

```bash
git fetch                       # 拉取远程信息（不合并）
git rebase origin/<branch>      # 变基同步（保持线性历史）
git pull                        # fetch + merge
```

### Rebase vs Merge

- 优先使用 `rebase`，保持线性提交历史，便于 review 和 bisect
- 不要 rebase 已推送到共享分支的 commit
- 合并多人协作分支时使用 `merge`，保留分支结构

### 提交粒度原则

**用户说"推所有改动"或类似表述时，默认合并为一个 commit 推送**，不自行拆分。
只有用户明确要求拆分时（如"分开提交"、"每个功能单独 commit"），才拆成多个 commit。

### "推所有"的范围定义

**⚠️ 重要：用户说"推所有"、"把所有改动都推"或类似表述时，必须提交 `git status` 中全部已修改和未追踪的文件，包括看起来"与本次功能无关"的改动（如 Unity 自动更新的 .asset、.prefab 等）。**

禁止以"与功能无关"为由自行过滤文件——那是用户的判断权，不是助手的。
唯一例外：敏感文件（`.env`、token、credentials），仍须排除并告知用户。
