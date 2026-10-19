# JASKILL — 本项目专属技能登记

> 从货架模板 `shelf/docs/JASKILL.md` 植入，之后归本仓库自己维护，不随货架同步。只登记**本项目专属**或**第三方包**的技能；通用工作流技能（`intj` / `feature` / `vc` / `logman` / `custom-skill` / `shelf-ops` / `annotated-report`）的名册与触发规范在根协议「Skill 系统」节。

## 读法

技能正本在 `ai/jaSkills/<name>/`（入库，由 `shelf init` / `sync` 从货架装、按账本 `.shelf.json` 对账）；`.claude/skills`、`.agents/skills` 是指向它的整目录链接。先读对应 `SKILL.md`，再按需读 `reference.md` / `references/`，不整包加载。

## 技能与触发场景

| 技能 | 何时读 | 上游 |
| --- | --- | --- |
| （暂无） | | |

## 本仓库口径

- 和其他项目一样，`ai` 模板装的技能全都在：根协议名册里的 `monet` / `ui-tailor` / `codex-visual` 也装上了，但本仓库是 CLI 与内容货架，没有界面与美术工作，一般用不到。
- `project-audit` 随模板装上（项目自审），登记在根协议的通用技能名册（点名时触发）。
- `shelf/skills/` 里的技能是货架库存，不读、不用；只认 `ai/jaSkills/` 里的。
