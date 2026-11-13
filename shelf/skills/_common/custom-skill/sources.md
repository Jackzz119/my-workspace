# 规范出处与取舍

> 更新本规范、或要回答「这条依据是什么」时读。最近一次全面核对：2026-11-12。
> 官方页面多数不标日期，写的是访问日期；GitHub 来源写的是该文件最近一次提交的日期。再核对时先看下面「未核实」一节。

## 官方：Anthropic

| 来源 | 日期 | 用到的结论 |
| --- | --- | --- |
| [Claude Code：Extend Claude with skills](https://code.claude.com/docs/en/skills) | 访问 2026-11-12（页面提到的最新版本 v2.1.309，本机 2.1.322） | frontmatter 字段全表与默认值；description 与 `when_to_use` 合计截到 1536 字符；技能清单预算约为上下文 1%，超了先丢最少用的技能的描述；`allowed-tools` 只在调用那一轮免确认、不是限制、工作区信任不拦；`disallowed-tools`；注入命令的语法、失败即中止、`\|\| true`、auto 模式不中止、`disableSkillShellExecution`；参数与目录变量的替换与转义；正文作为一条消息留在对话里、不重读，压缩后每个技能保留前 5000 token（合计 25000）；规则必须每次成立时用钩子；YAML 写坏时字段全空；出了 Claude Code 只允许六个字段；新会话、带 / 不带技能对比的评估；skill-creator 插件、`/skill-doctor` |
| [Claude Code：Configure permissions](https://code.claude.com/docs/en/permissions) | 访问 2026-11-12 | 内置只读命令免确认；`Bash(x *)` 与 `Bash(x:*)` 等价、`:*` 只在末尾；复合命令逐段判定；`npx`、`devbox run` 这类运行器会执行后面的任意命令；按参数收窄的规则很脆；deny → ask → allow 的顺序 |
| [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | 访问 2026-11-12 | 只写模型不知道的；自由度随脆弱度；用到的模型都测；name 规则与保留词；description 第三人称、做什么 + 什么时候用、≤ 1024；正文 < 500 行；引用只下一层；超过 100 行的参考文件放目录；避免会过期的信息；用词一致；模板、清单、校验回路；先建评估再写文档；一个 Claude 写、另一个 Claude 测；观察模型怎么读技能；正斜杠；脚本自己处理错误、常量写明来由、MCP 工具写全名 |
| [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) | 访问 2026-11-12 | 三层加载（元数据约 100 token、正文 < 5000 token、资源按需）；安全注意事项（只用可信来源、审完所有文件、外部 URL 风险）；Claude Code 有完整网络、不要全局装包 |
| [Skills for enterprise](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise) | 访问 2026-11-12 | 风险分级与审查清单（脚本、指令操纵、MCP、网络、凭据、文件范围）；评估维度（触发准确、单独可用、共存、遵循、产出质量）；每个技能 3–5 条查询；技能太多会降低选中率 |
| [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) | 2025-10-16 | 背景：渐进披露是核心设计原则 |
| [anthropics/skills：skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) | 最近提交 2026-03-06 | 模型倾向少用技能，描述可以「积极」一点；解释为什么胜过全大写 MUST；超过 300 行的参考放目录；评估循环；描述调优用约 20 条查询、60/40 拆分、每条跑 3 次；简单请求本来就不一定触发 |
| [Improving skill-creator](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills) | 2026-03-03（取自韩文版页面的日期） | 评估在干净上下文里并行跑；触发准确度单独调 |

## 开放标准：Agent Skills（agentskills.io）

| 来源 | 日期 | 用到的结论 |
| --- | --- | --- |
| [Specification](https://agentskills.io/specification) | 源文件最近提交 2026-08-04 | 六个字段与约束；name 与目录同名、不连写 `--`；`metadata` 是字符串映射；`allowed-tools` 是实验字段、空格分隔；正文 < 5000 token、< 500 行；相对路径、只下一层 |
| [Best practices for skill creators](https://agentskills.io/skill-creation/best-practices) | 访问 2026-11-12 | 从真实经验出发；用真实执行迭代、看执行轨迹；只补模型缺的；技能是一件连贯的事；适度详略；写明什么时候读哪个文件；给默认不给菜单；教方法不给答案；坑放 SKILL.md；模型反复重写同一段逻辑时做成脚本 |
| [Optimizing skill descriptions](https://agentskills.io/skill-creation/optimizing-descriptions) | 访问 2026-11-12 | 写用户意图而非实现；列全适用场景；相近的反例最有价值；说法要像真用户；看触发率；拆训练 / 验证两组防过拟合 |
| [Using scripts in skills](https://agentskills.io/skill-creation/using-scripts) | 访问 2026-11-12 | 不交互是硬要求；`--help`；报错写清怎么改；stdout 放数据、stderr 放诊断；幂等；`--dry-run`；退出码；输出量可控；版本钉住 |
| [GOVERNANCE.md](https://github.com/agentskills/agentskills/blob/main/GOVERNANCE.md) | 2026-11-04 通过 | 背景：规范改由 LF Projects 下的项目治理，不再只属于一家 |

## 官方：OpenAI Codex

| 来源 | 日期 | 用到的结论 |
| --- | --- | --- |
| [Codex：Agent Skills](https://developers.openai.com/codex/skills)（现跳转到 learn.chatgpt.com/docs/build-skills） | 访问 2026-11-12 | 发现位置（`.agents/skills` 在当前目录、上级、仓库根；`~/.agents/skills` 等）；支持 symlink；name、description 必需；`$名字` 或 `/skills` 显式调用、按描述隐式调用；`agents/openai.yaml`（界面、`allow_implicit_invocation`、依赖）；清单预算为上下文的 2% 或 8000 字符；每个技能只做一件事、确定性需要时才写脚本、步骤写成祈使句并写明输入输出、拿提示词测描述 |
| [openai/codex：parser.rs](https://github.com/openai/codex/blob/main/codex-rs/skills/src/parser.rs) | 最近提交 2026-08-17 | 只解析 `name`、`description`、`metadata.short-description`，其他字段忽略；name 上限 64 字符；description 为空则不加载 |
| [openai/codex：skill-creator 样例](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/skill-creator/SKILL.md) | 最近提交 2026-08-13 | 假定模型已经能干；保持用户意图和范围、不暗示额外授权；具体程度随风险；描述要精确、别写包罗万象的清单、只在防误触发时写排除项；500 行是上限不是目标；不加辅助文档；不要因操作敏感就改成只许显式调用，而是在动手前要授权；用不带提示的独立 agent 做行为验证 |

## 社区（观点，非官方）

| 来源 | 日期 | 用到的结论 |
| --- | --- | --- |
| [obra/superpowers：writing-skills](https://github.com/obra/superpowers/blob/main/skills/writing-skills/SKILL.md) | 最近提交 2026-10-21 | 描述只写触发条件，不概述流程——agent 读到流程摘要会照着做、不去读正文；先看 agent 在没有技能时怎么失败，再写技能 |
| [Snyk：Exploring the Threat Landscape of Agent Skills](https://research.snyk.io/blog/agent-skills-threat-landscape/) | 2026-02-05 | 审计 3,984 个公开技能：76 个确认恶意，13.4% 有严重问题；恶意技能 91% 同时用提示注入；常见手法 `curl \| bash`、运行时拉远程指令、外传凭据（厂商研究，口径以原文为准） |

## 与官方口径的差异与取舍

| 本项目口径 | 官方 / 开放标准 | 取舍 |
| --- | --- | --- |
| 真源在 `ai/jaSkills/`，`.claude/skills`、`.agents/skills` 是两条整目录 symlink | Claude Code 写的是「技能条目可以是 symlink」；Codex 支持 symlink | 保留；两边实际都能读到 |
| `allowed-tools` 默认不写，不放 `Write`、`Edit` | 官方示例给只能手动调用的提交技能预批准 `git add`、`git commit` | 保留本项目更严的口径 |
| 自建技能不写 `model`（用户 2026-10-16 定） | `model` 只影响本轮剩余部分 | 一致 |
| 触发策略「自动 / 询问后 / 点名时」写在协议表 | Claude Code 用 `disable-model-invocation`；Codex 用 `allow_implicit_invocation`，并建议敏感操作也保持可被发现 | 保留；「询问后」不改字段；要收紧成只许显式调用先问用户 |
| description 开头留人设称呼 | 关键用途在前、第三人称 | 保留短称呼，后面紧跟用途 |
| 用户决定标日期（「用户 YYYY-MM-DD 定」） | 避免会过期的时间条件 | 不冲突：日期用来溯源，不是生效条件 |
| 正文里用技能目录占位符拼支持文件路径（旧写法） | 开放标准用相对路径 | 读支持文件改用相对链接；要执行的命令里保留占位符 |
| 起草后先给用户看、批准再写入 | 先建评估、先测后写 | 互补，两步都做 |
| SKILL.md 的「经验摘录」 | 开放标准：坑放 SKILL.md | 一致 |
| `metadata.shelf-scaffold`（用户 2026-10-19 定） | `metadata` 是字符串映射，键名要独特 | 一致 |
| 目录结构曾「固定为」SKILL.md + reference.md + examples.md | 开放标准约定 `scripts/`、`references/`、`assets/`；本项目已有技能两种都在用 | 改为推荐结构，两种都允许，一个技能里选一种 |
| `jira-cli` 保留 `Bash(jira:*)`、`Bash(curl:*)` | 最小授权 | 用户 2026-11-10 批准的例外（ADR-34） |

## 未核实

- Codex 改了 SKILL.md 后是否要重启才生效（文档只说改 `config.toml` 后要重启）。
- Claude Code 监视技能目录时，是否跟着整目录 symlink 的 `.claude/skills` 生效。
- 在 worktree 目录里直接新开会话时，Claude Code 是否只发现 worktree 自己的 `.claude/skills`（已实测的只有 2026-11-12 这一次：工作目录在 worktree，加载的却是主检出那份；这个会话最初从哪个目录开起来的未核对）。
- 内置只读命令作为注入命令时，是否不写 `allowed-tools` 也能通过权限检查（按文档推断，以实际调用为准）。
- `claude plugin validate`：本机 2.1.322 上对 symlink 的 `.claude/skills` 直接拒绝；把技能目录拷成真目录后，故意写坏的 SKILL.md 也没报错——别拿它当 frontmatter 检查。
