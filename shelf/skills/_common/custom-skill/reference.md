# Skill 创建详细规范

> 按需加载。仅在创建或审查 skill 时读取此文件。

---

## Frontmatter 字段说明

```yaml
---
name: skill-name                  # 必需，kebab-case
description: 一句话描述触发场景    # 必需，用于判断何时触发
allowed-tools: Read, Edit, Bash   # 可选，预批准工具列表
---
```

**allowed-tools 原则：只列读取类工具，不预授权写操作。**

- 推荐组合：`Read, Glob, Grep, Bash`（Bash 仅用于只读命令）
- `Write`、`Edit` **不加入 allowed-tools** — 文件修改必须每次经用户 accept 确认
- 不填 allowed-tools = 每次工具调用都需确认（最严格，适合高风险 skill）

> **原因**：`allowed-tools` 中的工具会被自动批准执行，绕过用户确认。
> 「自动触发 skill」≠「自动执行写操作」，两者是不同层级的控制。

---

## 动态特性用法

### `!命令` — 运行时注入

```markdown
当前 git 状态：
!git status --short

当前 skill 列表：
!for f in .claude/skills/*/SKILL.md; do echo $(basename $(dirname $f)); done
```

注意：`!` 命令在 skill **加载时**执行，结果直接嵌入上下文。适合注入"当前状态"类信息。

### `$ARGUMENTS` — 接收参数

```markdown
目标功能：$ARGUMENTS
```

用户调用 `/custom-skill create bigwin` 时，`$ARGUMENTS` = `create bigwin`。

### `${CLAUDE_SKILL_DIR}` — 引用同目录文件

```markdown
详细规范见 ${CLAUDE_SKILL_DIR}/reference.md
```

---

## 文件结构决策

### 什么时候需要 reference.md？

- SKILL.md 超过 200 行
- 有大量示例代码
- 有详细的规范表格或参数说明
- 内容不是每次都需要，可以按需加载

### 什么时候需要 examples.md？

- skill 有多种调用方式
- 有复杂的输出格式示例
- 用户经常问"这种情况怎么用"

---

## 质量检查清单

创建完 skill 后，自检以下项目：

- [ ] `name` 和 `description` 填写完整且准确
- [ ] `description` 能让人清楚判断"什么时候该用这个 skill"
- [ ] SKILL.md 控制在 500 行以内
- [ ] 没有硬编码项目特定路径（除非 skill 本身是项目特定的）
- [ ] 动态注入的命令在当前环境可以运行
- [ ] 参数用法有说明（如果接收 `$ARGUMENTS`）
- [ ] 有明确的"等用户确认"节点（涉及文件修改的 skill）

---

## 通用 vs 项目特定

| 类型 | 存放位置 | 示例 |
|------|----------|------|
| 通用 skill | `.claude/skills/` (项目内) 或 `~/.claude/skills/` (全局) | vc, custom-skill |
| 项目特定 skill | `.claude/skills/` (项目内) | feature (含项目文档路径) |

通用 skill 未来可以发布到 GitHub skill 库供复用。

---

## 通用性规范

通用 skill 必须能跨项目复用，以下三条是常见的通用性失误：

### 1. 命名不要绑定技术域

类名、工具名不能反映特定技术栈。

| ❌ 错误 | ✅ 正确 | 原因 |
|--------|--------|------|
| `GameLogger` | `Logman` / `AppLogger` | 用户不一定在做游戏 |
| `UnityEventBus` | `EventBus` | 不一定用 Unity |
| `ReactPage` | `Page` | 不一定用 React |

### 2. 可变槽位不要硬编码

有些值在不同项目里不同，应描述为「由项目自定义」，而不是写死。

常见可变槽位示例：

| 槽位 | ❌ 硬编码 | ✅ 通用写法 |
|------|----------|------------|
| 运行时环境标签 | `[Unity]` | `[运行时环境]`，由项目自定义（如 `Unity`、`React`、`Node`） |
| Pro 环境标识 | `#if !PRODUCTION` | 由项目自定义（Unity Define Symbols / NODE_ENV / REACT_APP_ENV 等） |
| 日志级别枚举 | `LogLevel.Debug` | 由项目实现决定 |

### 3. 项目特定数据不写进 skill

以下内容属于**项目数据**，不属于**通用规范**，应存放在 `PROJECT.md` 或项目文档中：

- 标签池（功能域标签列表）
- 具体的枚举值、配置项名称
- 项目内的文件路径、模块名

Skill 只写「原则」，不写「清单」。

---

## 常见反模式

**不要这样做：**
- SKILL.md 里写大量示例代码 → 放 examples.md
- 一个 skill 做多件不相关的事 → 拆分成多个 skill
- 把项目路径硬编码进通用 skill → 用 `$ARGUMENTS` 或动态查找
- 每次加载都注入大量静态文本 → 静态规范放 reference.md 按需读取
- description 写得太宽泛（如"帮助开发"）→ 应该具体到场景
- 类名/工具名绑定技术域（如 `GameLogger`）→ 用通用名
- 可变槽位硬编码（如运行时标签写死为 `Unity`）→ 描述为「由项目自定义」
- 把项目标签池、枚举值写进 skill → 留在 PROJECT.md

---

## 迭代时机

以下情况应主动提出更新 skill：

1. 用户纠正了 skill 的某个行为 → 立即更新规范
2. 发现 skill 缺少某个常用场景的覆盖 → 补充
3. SKILL.md 超过 500 行 → 拆分到 reference.md
4. 某个 `!命令` 在当前环境报错 → 修复命令
5. 用户添加了新的全局约束（如新的代码风格规范）→ 检查是否需要更新相关 skill