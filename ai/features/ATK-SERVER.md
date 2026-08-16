# ATK Server 系统设计文档

> 最后更新：2026-05-26
> 状态：需求对齐中（未开工）
> 关系：基于 [SKILL-SYNC-CLI](SKILL-SYNC-CLI.md) 的本地 CLI，向"在线社区平台"演进

---

## 一、功能目标

把 agent-toolkit 从"GitHub 仓库 + 本地 CLI"升级为**Claude / Codex skill 社区平台**：

- 任何人能注册账户，上传 / 管理自己的 skill
- 通过 CLI 一行命令拉取**任意用户**的 skill（不局限于 agent-toolkit 自有的 `_common` 包）
- 通过 Web UI 浏览、搜索、查看 skill 详情，社区互动（评论、收藏、版本变更）
- 同时保留现在 git-based 模式作为离线/自托管备选

差异化定位（相对官方 marketplace 和 GitHub awesome-list）：
- **强社区互动**：评论、版本 changelog、关注作者
- **细粒度权限**：public / unlisted / private
- **CLI 一等公民**：命令行体验对标 npm

---

## 二、整体架构

```
┌────────────────┐         ┌─────────────────┐         ┌──────────────┐
│   atk CLI      │ ─HTTPS→ │   atk Server    │ ←────→  │   Database   │
│ （本地终端）   │         │   (REST API)    │         │  (Postgres)  │
└────────────────┘         └─────────────────┘         └──────────────┘
                                    ↑
                                    │ HTTPS
                                    ↓
                            ┌─────────────────┐
                            │   Web UI        │  浏览器
                            │ (浏览/账户/管理)│
                            └─────────────────┘
```

CLI 与 Web UI 共享同一套 REST API。

---

## 三、模块设计

### 3.1 命名空间与标识

每个 skill 由 `@<owner>/<skill-name>` 唯一标识，例：

- `@alice/cool-skill`
- `@anthropic/intj`（如官方账号上传）

无 owner 前缀时（如 `atk pull intj`）走默认源——可能是登录用户自己的，或服务端配置的 fallback 命名空间。

### 3.2 账户系统

| 字段 | 说明 |
|---|---|
| `username` | 唯一标识，URL slug |
| `email` | 登录用 |
| `display_name` | 公开展示 |
| `avatar_url` | 头像（OAuth 同步） |
| `created_at` / `updated_at` | 时间戳 |

**认证**：OAuth（GitHub + Google），自建邮箱密码作为备选。MVP 仅 GitHub OAuth。

**API token**：用户在 Web UI 生成长 token，CLI `atk login` 粘贴存到 `~/.atk/credentials.json`。后续 API 请求带 `Authorization: Bearer <token>`。

### 3.3 Skill 存储

#### 元数据（Postgres）

```
skills
  id              uuid
  owner_id        uuid → users.id
  name            text          # 'cool-skill'
  visibility      enum(public, unlisted, private)
  description     text
  latest_version  text          # '1.2.0'
  created_at      timestamp
  updated_at      timestamp
  download_count  int

skill_versions
  id              uuid
  skill_id        uuid → skills.id
  version         text          # '1.2.0'
  content_hash    text          # sha256:...
  changelog       text
  files           jsonb         # { "SKILL.md": "...", "reference.md": "..." }
  uploaded_at     timestamp

skill_stars / skill_comments / ...  （V2）
```

#### 文件内容

MVP 直接存 `skill_versions.files` 的 jsonb 字段（skill 文件总量小，<100KB 通常）。

V2 上量后迁 S3 兼容对象存储，DB 只存元数据 + URL。

### 3.4 REST API（MVP）

| 路径 | 方法 | 用途 | 认证 |
|---|---|---|---|
| `/api/auth/github/start` | GET | 启动 OAuth | 无 |
| `/api/auth/github/callback` | GET | OAuth 回调 | 无 |
| `/api/me` | GET | 当前用户信息 | token |
| `/api/me/tokens` | POST/DELETE | 管理 CLI token | session |
| `/api/skills` | GET | 列 public skill（搜索 / 分页） | 无 |
| `/api/users/:u/skills` | GET | 某用户的 skill 列表 | 视 visibility |
| `/api/users/:u/skills/:s` | GET | skill 元数据 + 最新版本 | 视 visibility |
| `/api/users/:u/skills/:s/v/:ver` | GET | 指定版本完整内容 | 视 visibility |
| `/api/users/:u/skills/:s` | PUT | 创建/更新 skill（含文件） | token + ownership |
| `/api/users/:u/skills/:s` | DELETE | 删除 skill | token + ownership |

### 3.5 CLI 改造

新增 / 修改命令：

```
atk login                       # 浏览器 OAuth 或粘贴 token
atk logout
atk whoami

atk list                        # 服务端 public skill 搜索
atk list --mine                 # 我自己的 skill
atk list --installed            # 本地已装

atk pull @alice/cool-skill      # 拉指定用户的 skill
atk pull @alice/cool-skill@1.2.0   # 锁版本
atk pull -g @alice/cool-skill   # 装到全局 ~/.claude/skills/

atk push intj                   # 推本地改动到服务端（隐含 @me/intj）
atk push -g intj                # 推全局 skill
```

manifest 字段扩展：

```json
{
  "intj": {
    "source": "@alice/intj",
    "version": "1.2.0",
    "contentHash": "sha256:...",
    "pulledAt": "2026-05-26",
    "scope": "project"
  }
}
```

**Git 模式保留**：原 `atk pull` 拉本地 `skills/_common/` 的行为继续可用，作为离线 / 私有部署 fallback。配置文件（`~/.atk/config.json`）决定默认 backend：`git` 还是 `api`。

### 3.6 全局 skill 支持

当前 CLI 已规划 `-g` / `--global` flag，新版同样适用：

| 位置 | manifest | skill 落点 |
|---|---|---|
| 项目级 | `<project>/.agent-toolkit.json` | `<project>/.claude/skills/` |
| 全局级 | `~/.claude/.agent-toolkit.json` | `~/.claude/skills/` |

### 3.7 Web UI（MVP）

最小可用页面：

- 登录 / 登出（GitHub OAuth）
- 首页：搜索 + 最近上传 / 热门
- 用户主页：`/u/<username>` 列出该用户 public skill
- skill 详情页：`/u/<u>/s/<s>` —— 描述、版本列表、SKILL.md 渲染、复制安装命令按钮
- 个人后台：管理自己的 skill / token

V2 加：评论、收藏、关注、changelog 时间线、依赖图

---

## 四、技术选型（待拍板）

| 维度 | 候选 | 倾向 |
|---|---|---|
| 后端语言 | Node + Fastify / Python + FastAPI / Go + Echo | **Node + Fastify**（与 CLI 同栈，复用 hash / format 等 lib） |
| DB | Postgres / SQLite | **Postgres**（Supabase 免费档够 MVP） |
| 文件存储 | DB jsonb / S3 | **DB jsonb**（MVP），上量后迁 S3 |
| Web 框架 | Next.js / SvelteKit / Astro | **Next.js**（生态成熟） |
| 认证 | NextAuth / Lucia / 自建 | **NextAuth**（GitHub OAuth 现成） |
| 托管 | Vercel + Supabase / Fly.io / 自建 VPS | **Vercel + Supabase**（零运维启动） |
| 域名 | 待注册 | 待定（建议 `.dev` 或 `.app`） |

---

## 五、阶段拆分

### Phase 1 — MVP（验证可行性）

目标：能让 5 个朋友注册、上传、拉到 skill 用起来。

- 后端：API 基础（auth + skill CRUD）
- DB：3 张表（users / skills / skill_versions）
- Web：登录 + skill 详情 + 个人后台
- CLI：`login / whoami / list / pull @user/skill / push @user/skill`
- 部署：Vercel + Supabase 免费档

### Phase 2 — 社区互动

- 评论、星标、关注
- changelog、版本对比
- 搜索增强（标签、分类）
- 依赖图（skill 之间的引用）
- 全局 skill `-g` flag

### Phase 3 — 规模化

- 文件存储迁 S3
- CDN
- 团队 / 组织账户
- 计费（可选）
- 安全审核（防恶意 skill）

### Phase 4 — 生态延展

- VS Code / Cursor 插件直接装 skill
- Codex / 其他 agent 协议适配
- 官方策展频道
- 第三方 API 开放

---

## 六、关键决策点（待用户拍板）

1. **范围定位**：私有工具 / 公开平台 / 混合？
2. **品牌**：保留 `agent-toolkit` / 改新名（更像产品）？
3. **域名**：愿意花钱注册吗？预算？
4. **开源策略**：服务端代码开源 / 闭源？
5. **商业化**：纯免费 / Freemium / 完全付费？
6. **法律**：TOS / 隐私政策起草由谁负责？
7. **上线节奏**：MVP 想多久内交付？（影响投入强度）
8. **保留 git 模式**：是 / 否？（我建议是）

---

## 七、待实现 / 已知风险

- **法律责任**：用户上传内容、版权、隐私——账户系统一开必须处理
- **安全**：恶意 skill（含 prompt injection、命令注入）需审核机制
- **滥用**：spam 账户、刷下载量
- **官方动向**：Anthropic 推官方社区版的可能性
- **数据迁移**：MVP 后若从 jsonb 迁 S3，需平滑过渡
- **CLI 兼容**：新版 CLI 同时支持 git 模式和 API 模式，配置切换需简洁

---

## 实现计划

进度：0 / 0 subtasks 完成（0%）

> 待 Section 六 决策点全部拍板后再拆 Subtask。
> 预计骨架（仅参考）：
> - **ST-1**: 选定技术栈 + 注册域名 + 初始化 monorepo（apps/server, apps/web, packages/cli）
> - **ST-2**: 后端搭起来——Postgres schema + auth (GitHub OAuth) + 健康检查
> - **ST-3**: API CRUD（skill / version 上传下载），Postman / curl 跑通
> - **ST-4**: CLI 适配——`login / whoami / list / pull @user/skill`
> - **ST-5**: Web UI 最小页面（首页 + 详情 + 后台）
> - **ST-6**: 部署到 Vercel + Supabase，自测一遍 dogfood
> - **ST-7**: 邀请 5 个朋友试用，收反馈
> - **ST-8**: CLI push 命令 + 版本 changelog
> - **ST-9**: 全局 skill `-g` 支持

---

## 测试记录

（待开工后填）