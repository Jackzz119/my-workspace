# 规矩的出处与取舍

> 什么时候读：用户问某条规矩的依据，或要更新本技能时。执行任务时不用读。
> 最近一次核对：2026-11-24。标★的是对照实验，其余是官方文档、厂商自述或一线经验。数值只说明方向，不当阈值用。

## 用户定的（改要先问用户）

用户 2026-11-24：一个主会话唯一对接、唯一出报告；要看得见的分工用名下子会话，不用顶层会话、不用子代理代替；方案定了才派；重要的开发和测试各用干净会话；验证了才收尾；收尾归主会话，用户一次归档；用户和子会话的交互主会话要知道；模型用户不指定时由主会话定；任何会话撞额度都要能接着做。这套是「最普遍任务」的做法，另备几套供试。

## 规矩 → 出处

| 规矩 | 出处 | 取了什么 |
| --- | --- | --- |
| 独立测试用同模型、新上下文、先按规格列检查再看代码、只验不修、逐条写未验证 | ★ <https://arxiv.org/abs/2610.28667> | 新上下文的验证者比开发自测多抓缺陷；换一家模型没有更好；坏测试会挡住对的实现，所以失败先分类 |
| 不给验证者看「测试已通过」 | ★ <https://arxiv.org/abs/2610.12822> | 看了会提高误放行 |
| 单元测试归开发，独立测试只做黑盒验收；不按工种切一个功能；验证者必须全套加负面用例 | <https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them> | 什么时候拆、什么时候不拆；验证者「跑两下就放行」 |
| 一条线的活不拆；开工就定单还是多 | ★ <https://arxiv.org/abs/2512.08296>、★ <https://arxiv.org/abs/2603.21489> | 顺序型任务多 agent 更差；先单后多成本近乎相加；并行写代码 2–4 人最好；worktree 硬隔离、先提交公共骨架、强耦合归一人 |
| 规格不清先调研，规格给全就直接做 | <https://cohere.com/blog/lessons-from-scaling-teams-of-frontier-coding-agents> | 「先调研」预设的适用边界 |
| 任务说明四要素与更多 | <https://www.anthropic.com/engineering/multi-agent-research-system>、<https://developers.openai.com/blog/run-long-horizon-tasks-with-codex>、<https://factory.ai/news/missions-architecture> | 目标、输出格式、来源、边界；完成判据带校验命令；先写验收合同再拆 |
| 结论词、长报告进文件、卡住不原样重试、台账加 git 优先于记忆 | <https://github.com/obra/superpowers/tree/main/skills/subagent-driven-development> | DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED；监工丢位置重派是最贵的失败 |
| 说明里写禁止项、不写实现细节；主管不写代码；设计问题一个决定者 | <https://cursor.com/blog/self-driving-codebases>、<https://cursor.com/blog/agent-swarm-model-economics>、<https://www.anthropic.com/engineering/harness-design-long-running-apps> | 一个角色塞满计划、派活、审、合、判停会提前宣布完成 |
| 交回不是证据、看真实状态、结论从评审本人取 | ★ <https://arxiv.org/abs/2606.09863>、★ <https://www.lesswrong.com/posts/smE9h9RnaK7FWKBZ2/measuring-coding-agent-misalignment-in-the-wild-1>、★ <https://www.lesswrong.com/posts/HjDuFZnQrr7rimHmg/frontier-coding-agents-claim-work-they-didn-t-do> | 自称完成不可信；覆盖从日志核 |
| 空操作抽查 | ★ <https://arxiv.org/abs/2606.28430> | 能看到验收测试就会对着它做 |
| 三轮封顶、只审改动、过了就停 | <https://claude.dev/blog/solving-code-review-at-anthropic/>、<https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/>、★ <https://arxiv.org/abs/2607.24604> | 循环不收敛；强制多改一轮正确率反降；结论绑提交 |
| 测试与评审两把椅子 | <https://bun.com/blog/bun-in-rust>、<https://cognition.com/blog/multi-agents-working> | 评审只看改动并假定有错；先试跑几处再铺开 |
| 比稿不由 agent 选优胜 | ★ <https://arxiv.org/abs/2607.17531> | 外部判据有用，LLM 裁判会丢掉对的 |
| 先写测试要点名受影响的测试 | ★ <https://arxiv.org/abs/2603.17973> | 光说「按 TDD 做」回归反升 |
| 换脑继续 | ★ <https://arxiv.org/abs/2610.07447> | 保留文件、清空对话 |
| 常见失败的占比 | ★ <https://arxiv.org/abs/2503.13657> | 重复步骤、说做不一、认不出完成、验错、没验全 |
| 压缩后只信落盘、非零退出标未确认 | ★ <https://arxiv.org/abs/2607.13071> | 摘要会把被杀的命令写成已完成 |
| 桌面端会话、消息、额度、归档、自动模式的限制 | <https://code.claude.com/docs/en/desktop>、<https://code.claude.com/docs/en/cross-session-messaging>、<https://code.claude.com/docs/en/agents>、<https://code.claude.com/docs/en/errors>、<https://code.claude.com/docs/en/permission-modes>、<https://code.claude.com/docs/en/claude-projects> | 见 host-claude-desktop.md |
| 先访谈写规格再开新会话做；要证据；写的人不评审；两次纠不对就换 | <https://code.claude.com/docs/en/best-practices> | 默认流程的骨架 |
| 同时 3–5 个会话 | <https://code.claude.com/docs/en/agent-teams>、<https://openai.com/index/open-source-codex-orchestration-symphony/> | 人能照看的上限 |
| Codex 四种子会话与限制 | <https://learn.chatgpt.com/docs/agent-configuration/subagents>、<https://learn.chatgpt.com/docs/build-skills>、openai/codex 源码 | 见 host-codex.md |

## 来源打架时怎么取的

- 「按工种拆是反例」和「独立测试有用」不矛盾：反例是把单元测试、规划从开发手里拿走；有用的是对着要求的黑盒验收。
- 评审「只看 diff」和「要给需求」：是两把椅子，测试看要求加应用，评审看 diff 加要求（查漏做）。
- 集成「不要单一关口」和「要第三方合并」：前者说的是几百个工人，这里 2–4 个，串行由主会话合。
- 循环上限 5 轮与 3 轮：取 3。
- 「用子代理保护上下文」：官方最佳实践已不把它当理由；本技能用子代理只为并行和不打扰用户，用子会话是因为用户要看得见、要干净上下文和独立验证。

## 自己实测的（2026-11-24，Claude 桌面端，一个开发加一个测试子会话跑了三轮）

- 子会话回报叫醒的自动轮里 `start_session` 直接开被拒；用户说话的那一轮用卡片编号启动成功；卡片丢掉起点分支、分支名和短名，worktree 从集成分支切。
- 主会话任务的第一轮里直接开成功，`source_branch` 生效；app 复用了旧的 worktree 目录。
- 通知只带前 400 个字符；子会话挂着后台任务结束一轮也报结束、列表显示空闲，后台跑完会再报一次。
- `SendMessage` 的 `notify_when_idle` 订不了桌面端会话；发消息给子会话在自动轮里可以。
- 开发自测 44 项全过，独立测试第 1 轮就翻出一个会误删改动的毛病；第 2 轮过但报出一处新引入的，第 3 轮补。
- 测试会话只看到了开发交回的文件名，没打开（它的开场目录里列得到）。
- 子会话 worktree 里会话开场钩子会改账本文件，不还原归档时会留下 worktree。

## 没找到依据的

- 「主管带用户可见子会话」这种形态没有对照实验，最接近的是 Anthropic Projects、OpenAI Symphony、Factory Missions 的产品自述。
- 多个子会话同时撞额度时各自会不会自动续、主会话会不会被叫醒，没有文档。
