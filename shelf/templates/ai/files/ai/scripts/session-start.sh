#!/usr/bin/env bash
#
# session-start.sh —— 会话开场钩子：新会话一开就把 AI 工作流补齐。
# AI 工作流模板（货架 templates/ai）的一部分，由 shelf init 装到 <ai>/scripts/；
# 模板的 .claude/settings.json（Claude Code）与 .codex/hooks.json（Codex）在 SessionStart 上调它。
#
# 做两件事，都可重复执行，失败只报告、不挡开场：
#   1. 本目录是 worktree → 跑同目录的 sync-worktree.sh：建本 worktree 自己的技能链接、对齐协议副本、补环境配置，
#      再跑项目的 worktree.local.sh。worktree 根目录没有 .claude/skills 时 Claude Code 会改读主检出的技能，
#      主检出落后就读到旧版；链接建好后请 Claude Code 重扫技能（reloadSkills），本会话当场换成本分支的版本。
#   2. 跑 sync-main-checkout.sh：主检出干净、在集成分支上、能快进时，快进到远端最新。
#
# 输出：Claude 侧是一段 JSON（reloadSkills + 给 agent 看的摘要）；Codex 侧是纯文本摘要。
#
# 用法（一般由钩子调用）：
#   bash ai/scripts/session-start.sh                 # Claude Code
#   bash ai/scripts/session-start.sh --agent codex   # Codex
set -uo pipefail

AGENT="claude"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT="${2:-claude}"; shift 2 ;;
    --agent=*) AGENT="${1#*=}"; shift ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) shift ;;
  esac
done

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPTS/../.." || exit 0

notes=()
keep_lines() {   # 只留结论行（✓ ⚠ ✗ ↻ ＋ →），最多 12 行，免得把整段日志塞进上下文
  grep -E '^[[:space:]]*(✓|⚠|✗|↻|＋|→)' | grep -v '下一步：从头读一遍' | head -n 12
}

git_dir="$(git rev-parse --absolute-git-dir 2>/dev/null || true)"
common_dir="$(cd "$(git rev-parse --git-common-dir 2>/dev/null || echo .)" 2>/dev/null && pwd -P)"
if [[ -n "$git_dir" && "$git_dir" != "$common_dir" && -f "$SCRIPTS/sync-worktree.sh" ]]; then
  out="$(bash "$SCRIPTS/sync-worktree.sh" --agent "$AGENT" 2>&1)" || notes+=("⚠ sync-worktree.sh 退出码 $?，见下")
  while IFS= read -r line; do [[ -n "$line" ]] && notes+=("$line"); done < <(printf '%s\n' "$out" | keep_lines)
fi
if [[ -f "$SCRIPTS/sync-main-checkout.sh" ]]; then
  out="$(bash "$SCRIPTS/sync-main-checkout.sh" 2>&1)" || true
  while IFS= read -r line; do [[ -n "$line" ]] && notes+=("$line"); done < <(printf '%s\n' "$out" | keep_lines)
fi

ctx=""
if (( ${#notes[@]} )); then
  ctx="会话开场钩子 session-start.sh 已补齐 AI 工作流："
  for line in "${notes[@]}"; do ctx+=$'\n'"$line"; done
fi

if [[ "$AGENT" == "codex" ]]; then
  [[ -n "$ctx" ]] && printf '%s\n' "$ctx"
  exit 0
fi
json_escape() { local s="$1"; s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\r'/}"; s="${s//$'\t'/\\t}"; s="${s//$'\n'/\\n}"; printf '%s' "$s"; }
if [[ -n "$ctx" ]]; then
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true,"additionalContext":"%s"}}\n' "$(json_escape "$ctx")"
else
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}\n'
fi
exit 0
