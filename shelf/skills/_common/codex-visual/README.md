# codex-visual · 安装与使用

把视觉检测 / 设计稿生成 / 设计比稿委派给 Codex CLI 的 Claude Code skill。
**项目内置版**——直接放进项目就能用，不需要安装 plugin。

移植自 `codex-visual-in-cc` 插件（Apache-2.0，见 LICENSE / NOTICE），
已适配 **codex-cli ≥ 0.147**（上游 `--full-auto` 被移除，本版改用 `--sandbox workspace-write`，
插件原版在 0.147 上会直接报 `unexpected argument '--full-auto'` 跑不通）。

## 安装

把整个 `codex-visual/` 文件夹放到任一位置：

| 放置位置 | 生效范围 |
| --- | --- |
| `<项目>/.claude/skills/codex-visual/` | 只在该项目可用 |
| `~/.claude/skills/codex-visual/` | 所有项目可用 |

放好后**重启 Claude Code 会话**（skill 在会话启动时发现）。

## 前置要求

1. **Node ≥ 18.18**
2. **Codex CLI ≥ 0.142**：`npm i -g @openai/codex`
3. **登录**：`codex login`
   用 ChatGPT 账号登录会走订阅额度；不登录则可能走 API key 计费。

自检：

```bash
node .claude/skills/codex-visual/scripts/codex-visual.mjs status
```

看到 `Ready: yes` 即可用。

## 使用

对 Claude 说「让 codex 看一眼这个设计」「用 codex 出三版设计稿」「让 codex 做视觉检测」即可触发；
也可以直接跑脚本：

```bash
node .claude/skills/codex-visual/scripts/codex-visual.mjs run \
  --mode design \
  --ref "C:\path\to\reference.png" \
  "你的 brief：产品是什么、受众、视口、约束、判断标准、要交付什么"
```

- `--mode`：`audit`（挑毛病）/ `design`（调研+出图）/ `compare`（多方案比稿）/ `auto`
- `--target` 被审查的成品 · `--candidate` 竞争方案 · `--ref` 风格/品牌参考
- 图片总数 ≤ 5 张，必须是本地已存在的文件

网页要截图当输入时，用 headless Chrome 落盘：

```bash
chrome.exe --headless=new --disable-gpu --window-size=1400,1500 \
  --screenshot="out.png" "http://localhost:5173/your-page"
```

## 产物

输出根目录按优先级取：`--out <dir>` → 环境变量 `CODEX_VISUAL_OUT` → 当前目录下有 `ai/design_system/` 就落 `ai/design_system/codex-visual/` → 否则 `./codex-visual/`。每次委派建一个 `<时间戳>/` 子目录，输出：

- `codex-report.md` — 调研、判断、token 表、风险
- `*.png` — 设计稿 / 标注图

并打印机器可读行 `CODEX_VISUAL_REPORT:` / `CODEX_VISUAL_ARTIFACT:` 供 Claude 读取复核。

## 项目设计依据

从项目共享登记找到常驻 `design-system.md`，沿链接读取当前领域/UI 规范和实际素材位置。
项目决定与资产地址留在项目文档；技能保持通用。普通验证报告在会话汇报，只有有复用价值的研究/比稿归入项目 research。
