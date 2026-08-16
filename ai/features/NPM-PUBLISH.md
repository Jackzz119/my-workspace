# NPM 发布策略文档

> 最后更新：2026-05-26
> 状态：策略待执行（等 M2 品牌决策）
> 关系：服务于 [SKILL-SYNC-CLI](SKILL-SYNC-CLI.md) 的分发体验

---

## 一、功能目标

把 `atk` CLI 从"GitHub 仓库 + `npx github:...`"升级到 npm registry 上的标准包，让用户：

- `npx agent-toolkit list` 代替 `npx --yes github:Jackzz119/agent-toolkit list`
- `npm install -g agent-toolkit` 后全局 `atk` 命令直接可用
- 享受 npm 的版本管理、SEO、自动更新提示等基础设施

短期目标只是**确定策略 + 抢名占位**，**正式发版等 M2 品牌敲定**后再做，避免 npm 包名锁死带来的反复。

---

## 二、调用链路对照

```
现在（GitHub raw）
  npx --yes github:Jackzz119/agent-toolkit#main pull
    └─ npx clone 仓库到 npm 缓存 → 读 package.json.bin → 执行 atk.mjs

发布后（npm registry）
  npx agent-toolkit pull              ← 短命令
    └─ npx 从 registry.npmjs.org 拉 tarball → 缓存 → 执行

  npm install -g agent-toolkit
  atk pull                            ← 全局命令
    └─ 全局 npm bin 目录里的 atk 软链直接执行
```

---

## 三、关键决策

### 3.1 包名策略

| 方案 | 包名 | 命令 | 评价 |
|---|---|---|---|
| **A. 无 scope** | `agent-toolkit` | `npx agent-toolkit list` | 最短最美，但要求 `agent-toolkit` 在 npm 上空闲 |
| **B. 个人 scope** | `@jackzz119/agent-toolkit` | `npx @jackzz119/agent-toolkit list` | 一定可用，但命令更长 |
| **C. 组织 scope** | `@anthropic-ish/agent-toolkit` | 同 B | M2 上线后或注册组织后可走 |

**前置检查**：

```
npm view agent-toolkit
```

返回 404 → A 可走；否则降级 B。

**初步建议**：先做 `npm view`，能走 A 就走 A。

### 3.2 版本号策略（Semver）

| 阶段 | 版本 | 含义 |
|---|---|---|
| 占位发布 | `0.0.1-placeholder` | 抢名，README 写"under construction" |
| MVP（M1 完成 + 占位用） | `0.1.0` | 公开尝鲜，可能 breaking |
| 稳定第一版 | `1.0.0` | 公开承诺 API 稳定 |
| 后续 | 按 semver | major：breaking；minor：兼容新增；patch：bug fix |

**M2 ATK Server 上线后**，CLI major version 可能跳 `2.0.0`，因为 `atk login / push @user/skill` 等命令是新范式。

### 3.3 发布时机

**不立刻发版**，原因（详见 SKILL-SYNC-CLI / ATK-SERVER 文档）：

1. M2 品牌可能改名——npm 包名几乎不可逆
2. M1 还有 ST-4/5/6 未完，会有破坏性变更
3. 现在的 `npx github:` 模式功能完全够用，仅命令长 20 字符

**触发发版的信号**：

- M1 全部 ST 完成
- M2 第 2 个决策点（品牌）拍板
- 至少 3 个外部用户主动询问 npm 安装方式

---

## 四、发布前准备清单

### 4.1 完善 package.json

当前最小版需补齐以下字段：

```json
{
  "name": "agent-toolkit",
  "version": "0.1.0",
  "description": "Cross-platform skill library and CLI for Claude Code / Codex agent protocols.",
  "type": "module",
  "bin": { "atk": "bin/atk.mjs" },
  "files": [
    "bin/",
    "lib/",
    "skills/",
    "package.json",
    "README.md",
    "LICENSE"
  ],
  "keywords": ["claude", "claude-code", "codex", "agent", "skill", "cli", "ai"],
  "homepage": "https://github.com/Jackzz119/agent-toolkit",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Jackzz119/agent-toolkit.git"
  },
  "bugs": { "url": "https://github.com/Jackzz119/agent-toolkit/issues" },
  "license": "MIT",
  "engines": { "node": ">=18" },
  "author": "Jackzz119 <cheng.zheng@bituslabs.com>"
}
```

注意：

- `files` 字段**白名单**机制——只发布列出的目录/文件。未列出的（如 `ai/`、`agents/`、`other-skills/`、`.claude/`）不会进 npm tarball
- `keywords` 影响 npm 搜索排名，写准确
- `engines.node` 提示 Node 版本要求；用户 Node 太低 npm 会警告

### 4.2 必备文件

- `README.md` —— npm 详情页直接展示，是用户的第一印象
- `LICENSE` —— MIT/Apache-2 等明确许可
- `.npmignore` —— 兜底排除（如果 `files` 已设白名单，理论上不需要，但加上更稳）

### 4.3 测试打包内容

发布前先**本地预演**：

```
npm pack --dry-run
```

输出会列出实际进 tarball 的所有文件——核对没多余、没缺漏。

```
npm pack
```

生成 `agent-toolkit-0.1.0.tgz`，可以解压看里面到底是什么。

### 4.4 测试安装流程

```
# 在临时目录验证
cd D:\temp
npm install ../agent-toolkit-0.1.0.tgz
./node_modules/.bin/atk list
```

走通了再 publish。

---

## 五、发布流程

### 5.1 一次性配置

```
npm login                              # 浏览器走 OAuth 或粘贴 token
npm whoami                             # 验证已登录
```

### 5.2 正式发布

**无 scope**：

```
npm publish
```

**有 scope（默认 private，要显式 public）**：

```
npm publish --access public
```

### 5.3 验证发布成功

```
npm view agent-toolkit              # 看 metadata
npx --yes agent-toolkit list        # 端到端拉一次
```

### 5.4 发布后必做

- GitHub 仓库打 tag：`git tag v0.1.0 && git push --tags`
- GitHub Release 写 changelog
- README 顶部加 badge：`![npm](https://img.shields.io/npm/v/agent-toolkit)`

---

## 六、版本迭代流程

每次想发新版：

```
# 1. 改完代码、测好
# 2. bump version（自动改 package.json + 打 git tag）
npm version patch                   # 0.1.0 → 0.1.1（bug fix）
npm version minor                   # 0.1.0 → 0.2.0（新增兼容）
npm version major                   # 0.1.0 → 1.0.0（breaking）

# 3. 推 tag
git push --follow-tags

# 4. 发版
npm publish
```

`npm version` 会自动 commit + tag，比手动改 package.json 安全。

---

## 七、撤回 / 修复策略

### 7.1 发错版本 24 小时内

```
npm unpublish agent-toolkit@0.1.0
```

72 小时内可 unpublish，过期就只能 deprecate。

### 7.2 发错版本但超过 72 小时

```
npm deprecate agent-toolkit@0.1.0 "fatal bug, use 0.1.1 instead"
```

包仍在 registry，但安装时会显示警告。

### 7.3 包名改名（M2 品牌变更后）

不能直接改名。流程：

1. 在老包发最后一版，README 写"已迁移至 `<new-name>`"
2. `npm deprecate agent-toolkit "moved to <new-name>"`
3. 用新名重新 publish 整个项目
4. 老包不再维护

**这正是为什么不建议过早 publish**——一旦名字定了，迁移成本就是用户的痛苦。

---

## 八、待实现 / 已知问题

- `npm view agent-toolkit` **未查证可用性**——下一步立刻查
- `README.md` 尚未编写——发版前必须完成
- `LICENSE` 文件未创建——发版前必须完成
- 当前 CLI 在 npm 缓存路径下运行时，`push` 命令应明确报错（避免 commit 进 npm 缓存目录）
- `files` 字段未在 package.json 里设置——会导致整个仓库被打包，太大
- 版本号没跟 git tag 联动——`npm version` 流程跑通前先手动同步

---

## 实现计划

进度：0 / 5 subtasks 完成（0%）

> 触发条件：M1 全部完成 + M2 品牌拍板。

- **ST-1**：`npm view` 查名 + 决定 scope/无 scope 策略
- **ST-2**：补全 `package.json`（files / keywords / repository / license / engines / author）+ 写 `LICENSE`
- **ST-3**：编写 `README.md`（项目定位 / 安装 / 命令一览 / 链接 ATK-SERVER 文档）
- **ST-4**：`npm pack --dry-run` 校验 + 本地 tgz 安装测试
- **ST-5**：正式 `npm publish` + 打 tag + 写 GitHub Release

---

## 测试记录

（待发版后填）