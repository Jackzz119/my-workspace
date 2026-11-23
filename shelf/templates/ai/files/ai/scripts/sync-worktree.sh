#!/usr/bin/env bash
#
# sync-worktree.sh —— worktree（或任何新检出）开工第一步的保底：把技能链接、协议副本、本地配置就地补齐。
# AI 工作流模板（货架 templates/ai）的一部分，由 shelf 装到 <ai>/scripts/。本脚本不需要 shelf、不联网，重复执行安全；
# 机器上装了 shelf 的，新 worktree 直接 `shelf init`（按账本还原）效果更全。
#
# 为什么需要它：`.claude/skills` `.agents/skills`、根目录 CLAUDE.md / AGENTS.md、.env 这类本地配置都被 git 忽略，
# git worktree add 只材料化入库的文件。Claude Code / Codex 桌面版建 worktree 时按 .worktreeinclude 复制一部分（技能链接谁都不带），
# 会话开场钩子会补齐；Codex CLI `--worktree`、手动 `git worktree add`、没装钩子的项目就靠本脚本。Multica 用 bootstrap.sh。
#
# 本脚本只按顺序调同目录下的模块（各自只做一件事、可单跑）：
#   1. skills-link.sh：技能目录建成指向 <ai>/jaSkills 的链接（Claude 读 .claude/skills，Codex 读 .agents/skills）
#   2. protocol-mirror.sh --sync：根目录 CLAUDE.md / AGENTS.md 与正本 <ai>/jaAgents/ 一致——没有就建、没人改过的旧副本
#      换成正本、副本被人改过就两份都不动并报告，等用户看过 diff 再定方向（用户 2026-10-26 定）
#   3. local-config.sh：按 .worktreeinclude 从主检出补被 git 忽略的本地配置（钩子配置、.env 类…），.mcp.json 单独处理，
#      最后跑项目自己的 <ai>/scripts/worktree.local.sh
#   <ai>/jaSkills 不存在 → 退出码 1，把错误原文反馈给用户，不要自己猜着建。
# ai 资料区目录名取账本 .shelf.json 的 aiDir（.NET / C# 项目是 AI），没有账本就取本脚本所在的那一层。
#
# 用法：
#   bash ai/scripts/sync-worktree.sh                # 两个 agent 都补
#   bash ai/scripts/sync-worktree.sh --agent claude # 只补 Claude 侧（.claude/skills + CLAUDE.md + .mcp.json）+ 本地配置
#   bash ai/scripts/sync-worktree.sh --agent codex  # 只补 Codex 侧（.agents/skills + AGENTS.md）+ 本地配置
#   bash ai/scripts/sync-worktree.sh --dry-run      # 只报告，不动手
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
AGENT="all"; DRY=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT="${2:-}"; shift 2 ;;
    --agent=*) AGENT="${1#*=}"; shift ;;
    --dry-run) DRY=(--dry-run); shift ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "✗ 未知参数：$1（用 --help 看用法）"; exit 2 ;;
  esac
done
case "$AGENT" in claude|codex|all) ;; *) echo "✗ --agent 只接受 claude / codex / all，收到：$AGENT"; exit 2 ;; esac
for m in lib/common.sh skills-link.sh protocol-mirror.sh local-config.sh; do
  [[ -f "$SCRIPTS/$m" ]] || { echo "✗ 缺 $SCRIPTS/$m（AI 工作流模板的货）：装了 shelf 就跑 shelf init 补上，没装就从主检出或货架拷过来"; exit 1; }
done
ROOT="$(cd "$SCRIPTS/../.." && pwd -P)"

bash "$SCRIPTS/skills-link.sh" --root "$ROOT" --agent "$AGENT" "${DRY[@]+"${DRY[@]}"}"
drift=0
bash "$SCRIPTS/protocol-mirror.sh" --sync --root "$ROOT" --agent "$AGENT" "${DRY[@]+"${DRY[@]}"}" || drift=1
bash "$SCRIPTS/local-config.sh" --root "$ROOT" --agent "$AGENT" "${DRY[@]+"${DRY[@]}"}"

echo ""
echo "✓ sync-worktree（agent=$AGENT$( (( ${#DRY[@]} )) && echo '，dry-run')）：技能链接、协议副本、本地配置都过了一遍$( ((drift)) && echo '；⚠ 有协议副本被人改过，见上')"
case "$AGENT" in
  claude) [[ -f "$ROOT/CLAUDE.md" ]] && echo "→ 下一步：从头读一遍 ./CLAUDE.md 再开工" ;;
  codex)  [[ -f "$ROOT/AGENTS.md" ]] && echo "→ 下一步：从头读一遍 ./AGENTS.md 再开工" ;;
  all)    [[ -f "$ROOT/CLAUDE.md" ]] && echo "→ 下一步：从头读一遍 ./CLAUDE.md（Codex 读 ./AGENTS.md）再开工" ;;
esac
exit 0
