# Skill 双向同步 CLI 系统设计文档

> 最后更新：2026-05-17
> 状态：需求已对齐，待拆 Subtask 开工
> 当前阶段：聚焦 **Pull**，本期最小可用产物 = `atk pull` 拉取 common 包

---

## 一、功能目标

在任何目标项目里，通过一条命令从 `agent-toolkit` 仓库拉取 / 更新 skill，无需手动复制粘贴。

**本期范围（Pull · common 包优先）**：
- `atk pull` — 拉 common 包（= 当前 `skills/` 下全部 skill）
- `atk list` — 查看仓库内可用 skill
- `atk update` — 更新已引入的 skill
- `atk diff <name>` — 对比本地 vs 远端
- 版本追踪（sourceCommit + contentHash）+ 本地修改保护

**后续扩展（非本期）**：
- `atk pull <name>` 单个拉
- `atk pull --pack <xxx>` 其他包（领域包，如 blender）
- `atk pull --from other` 拉 `other-skills/`
- Push（推回主仓库）
- npm registry 发布

---

## 二、决策点（已锁定）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | CLI 分发 | 仓库内 Node 脚本 + `npx --yes github:<user>/agent-toolkit`，稳定后再考虑迁 npm 包 |
| 2 | 实现语言 | Node（无外部依赖，标准库够用） |
| 3 | 落点策略 | 默认写入目标项目的 `.claude/skills/`；支持 `--dest <path>` 覆盖 |
| 4 | 包概念 | 引入"common 包" = 当前 `skills/` 全部内容；本期只实现 common，后续再支持单个 / 其他包 |
| 5 | pull 已存在 skill | 报错，提示用 `atk update`，避免误覆盖本地改动 |
| 6 | 版本机制 | `sourceCommit`（拉取时主仓库 HEAD hash）+ `contentHash`（skill 目录内容 sha256），写入 `.agent-toolkit.json`，不污染 SKILL.md |

---

## 三、调用链路

```
用户在目标项目目录
  └─ npx --yes github:<user>/agent-toolkit pull
       └─ 临时目录 git clone --depth=1 agent-toolkit
            └─ 读取 skills/* （= common 包）
                 └─ 复制到 ./.claude/skills/<name>/
                      └─ 写入/更新 ./.agent-toolkit.json 记录版本
                           └─ 清理临时目录
```

---

## 四、模块设计

### 4.1 数据源策略

`git clone --depth=1` 到系统临时目录（`os.tmpdir()`），读取后清理。
- 完整、能拿 HEAD hash、离线友好
- 不走 GitHub API，无 rate limit 风险

### 4.2 包定义（文件夹分包）

源仓库布局：

```
skills/
  _common/           ← 默认包，atk pull 不带参数时拉这个
    intj/
    feature/
    vc/
    custom-skill/
    logman/
  blender/           ← 领域包，atk pull --pack blender 触发（ST-4）
    blender-create/
  <other-pack>/
    ...
```

约定：
- 第一层子目录 = 包名（`_common` 加下划线让文件浏览器把它排最前）
- 第二层 = 实际 skill 目录
- 不引入 `packs.json`——目录结构本身即为真源，避免双重维护漂移

### 4.3 命令形态（本期）

```
atk pull                          # 拉 common 包
atk pull --dest <path>            # 指定落点（默认 ./.claude/skills/）
atk pull --mode <m>               # 冲突模式：skip(默认) / overwrite / diff
atk list                          # 列出 common 包内 skill
atk update                        # 更新所有已引入的 skill
atk update <name>                 # 更新单个
atk diff <name>                   # 对比本地 vs 远端
```

### 4.4 冲突 / 更新策略

| 场景 | 行为 |
|---|---|
| 目标已存在同名 skill，`pull` | 报错，建议用 `update` |
| 默认 `pull --mode skip` | 已存在则跳过该 skill，其他继续 |
| `pull --mode overwrite` | 强制覆盖 |
| `pull --mode diff` | 只打印 diff 不写入 |
| `update`，本地 contentHash == 记录值 | 直接覆盖到最新 |
| `update`，本地 contentHash ≠ 记录值（用户改过） | 提示 keep / overwrite / diff |

### 4.5 配置文件 `.agent-toolkit.json`

放在目标项目根目录：

```json
{
  "source": "github:<user>/agent-toolkit",
  "skillsDir": ".claude/skills",
  "skills": {
    "intj": {
      "sourceCommit": "9875f7f",
      "contentHash": "sha256:abc...",
      "pulledAt": "2026-05-17",
      "pack": "common"
    }
  }
}
```

### 4.6 入口

仓库根加：

```
bin/atk.mjs            # Node 入口，shebang #!/usr/bin/env node
package.json           # 含 "bin": { "atk": "bin/atk.mjs" }，无依赖
```

`npx --yes github:<user>/agent-toolkit pull` 会自动识别 bin。

---

## 五、待实现 / 已知风险

- Windows / macOS / Linux 下临时目录清理需可靠（异常退出不能留垃圾）—— 用 `try/finally` 包
- skill 内若引用 `${CLAUDE_SKILL_DIR}` 等变量，复制后路径仍正确（验证）
- 本仓库自身也是 toolkit 的"使用者"：`.claude/skills/` 是真源 `skills/` 的本地缓存，需要 dogfood `atk pull` 验证

---

## 实现计划

进度：3 / 6 subtasks 完成（50%）

- [x] **ST-1**：仓库内搭骨架——`package.json` + `bin/atk.mjs`，实现 `atk list`（读身边 `skills/_common/` 列目录，CJK 感知换行）
- [x] **ST-2**：实现 `atk pull`（common 包，固定落点 `.claude/skills/`，模块化拆 `lib/commands/`，交互菜单 u/s/q）
- [x] **ST-3**：`.agent-toolkit.json` 读写 + per-skill sourceCommit + contentHash；4 情景智能菜单（up-to-date / 上游更新 / 本地手改 / 双改）；**判断逻辑由 contentHash 单一驱动**，sourceCommit 仅作溯源
- **ST-4**：非交互 flag——`--dest <path>` / `--mode skip|overwrite|diff` / `--pack <name>`
- **ST-5**：实现 `atk update` + `atk diff` 独立命令；处理 manifest 孤儿 entry（上游已删但本地还在）
- **ST-6**：README + 跨平台冒烟（Win/macOS/Linux）+ 本仓库 dogfood

---

## 测试记录

（待开工后填）