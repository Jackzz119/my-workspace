# JASKILL — 本项目专属技能登记

> 从货架模板 `shelf/docs/JASKILL.md` 植入，之后归本仓库自己维护，不随货架同步。只登记**本项目专属**或**第三方包**的技能；通用工作流技能（`intj` / `feature` / `vc` / `logman` / `custom-skill` / `shelf-ops` / `annotated-report`）的名册与触发规范在根协议「Skill 系统」节。

## 读法

技能正本在 `ai/jaSkills/<name>/`——本仓库里是从 `shelf/skills/` 拷来的 gitignored 副本，由 `node scripts/setup-links.mjs` 生成；`.claude/skills`、`.agents/skills` 是指向它的整目录链接。先读对应 `SKILL.md`，再按需读 `reference.md` / `references/`，不整包加载。

## 技能与触发场景

| 技能 | 何时读 | 上游 |
| --- | --- | --- |
| （暂无） | | |

## 本仓库口径

- 根协议名册里的 `monet` / `ui-tailor` / `codex-visual` 在本仓库**没有启用**（这里是 CLI 与内容货架，没有界面与美术工作）；要用时把它加进 `scripts/setup-links.mjs` 顶部的 `ACTIVE`，再跑一次脚本。
- `shelf/skills/` 里的技能是库存，不读、不用；只认 `ai/jaSkills/` 里的。
