#!/usr/bin/env bash
#
# session-start.sh —— 会话开场钩子：会话一开就把 AI 工作流同步到货架最新，主检出、worktree 开的会话都同步。
# AI 工作流模板（货架 templates/ai）的一部分，由 shelf 装到 <ai>/scripts/；模板的 .claude/settings.json（Claude Code）
# 与 .codex/hooks.json（Codex）在 SessionStart 上调它，项目里已有这两份配置时 shelf sync（2.2 起）补上缺的钩子。
#
# 本脚本只按顺序调模块（同目录下，各自只做一件事、可单跑、重复执行安全），用的是本脚本旁边那一份，--root 指向要处理的检出：
#   0. 认检出：读钩子输入 JSON 的 cwd。桌面版 worktree 会话的钩子在主检出里启动（$CLAUDE_PROJECT_DIR 指向主检出），
#      只有 cwd 是那个 worktree；cwd 读不到（终端里手动跑、旧版客户端）或不在同一个仓库，就按本脚本所在的检出算
#   1. 拿到主检出锁的那个会话把 shelf 升到 npm 最新版（没网 / 超时就用现有版本）
#   2. 主检出（每次都跑；锁被别的会话占着、或有进行中的 merge / rebase / cherry-pick 就跳过）：
#        protocol-mirror.sh --sync → shelf-step.sh --kind main（shelf sync；有人改过的货不动；改到的文件留在主检出、谁都不提交）
#   3. 会话开在 linked worktree 时，再处理这个 worktree（同一个 worktree 同时开场只跑一个）：
#        local-config.sh（按 .worktreeinclude 从主检出补本地配置，再跑项目的 worktree.local.sh）
#        → skills-link.sh（技能目录建成指向 <ai>/jaSkills 的链接；命令行开的 worktree 会话读它，没装 shelf 时也有）
#        → protocol-mirror.sh --sync（准备：从主检出复制来的旧副本先换成本分支正本，免得 shelf 当成「副本领先」）
#        → shelf-step.sh --kind worktree（改到的已跟踪文件算本会话的改动，随本轮任务提交）
#        → protocol-mirror.sh --sync（收尾）
#   4. 请 Claude Code 重扫技能（reloadSkills），本会话当场用上同步后的技能
# 开场钩子里任何地方都不跑 shelf init：init 只在新项目、新分支、新 worktree 第一次接入时由人跑，
# 修复与更新都归 shelf sync（用户 2026-11-19 定）。失败只报告、不挡开场。
#
# 输出：Claude 侧是一段 JSON（reloadSkills + 给 agent 看的摘要，分「主检出」「worktree」两段）；Codex 侧是纯文本摘要。
# 环境变量：SESSION_START_SKIP_SHELF=1 跳过升级与 shelf sync；SHELF_NPM_PKG 指定 shelf 的 npm 包名。
#
# 用法（一般由钩子调用，钩子输入 JSON 从标准输入进来；终端里直接跑不读输入，按本脚本所在的检出算）：
#   bash ai/scripts/session-start.sh                 # Claude Code
#   bash ai/scripts/session-start.sh --agent codex   # Codex
set -uo pipefail

AGENT="claude"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT="${2:-claude}"; shift 2 ;;
    --agent=*) AGENT="${1#*=}"; shift ;;
    -h|--help) sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) shift ;;
  esac
done

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
notes=()
say() { notes+=("$@"); }
# 模块的输出只留结论行（✓ ⚠ ✗ ↻ ＋ → = 与待决清单），免得把整段日志塞进上下文
keep() { while IFS= read -r l; do [[ -n "$l" ]] && notes+=("$l"); done < <(printf '%s\n' "$1" | grep -E '^[[:space:]]*(✓|⚠|✗|↻|＋|→|=|·)' | grep -v '下一步：从头读一遍' | head -n 14); }
# 协议副本只报有动作的（换了、建了、被人改过），「一致」不报
keepm() { while IFS= read -r l; do [[ -n "$l" ]] && notes+=("$l"); done < <(printf '%s\n' "$1" | grep -E '^(✓|↻|⚠|✗)' | head -n 4); }

finish() {
  local ctx="" l
  if (( ${#notes[@]} )); then
    ctx="会话开场钩子 session-start.sh 已把 AI 工作流同步到货架最新："
    for l in "${notes[@]}"; do ctx+=$'\n'"$l"; done
  fi
  if [[ "$AGENT" == "codex" ]]; then [[ -n "$ctx" ]] && printf '%s\n' "$ctx"; exit 0; fi
  json_escape() { local s="$1"; s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\r'/}"; s="${s//$'\t'/\\t}"; s="${s//$'\n'/\\n}"; printf '%s' "$s"; }
  if [[ -n "$ctx" ]]; then
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true,"additionalContext":"%s"}}\n' "$(json_escape "$ctx")"
  else
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}\n'
  fi
  exit 0
}

if [[ ! -f "$SCRIPTS/lib/common.sh" ]]; then say "⚠ 缺 $SCRIPTS/lib/common.sh（AI 工作流模板的新货），这次没同步；跑一次 shelf sync 装上"; finish; fi
# shellcheck source=lib/common.sh
source "$SCRIPTS/lib/common.sh"

# 0. 认检出
ai_read_hook_input
SELF_ROOT="$(ai_toplevel "$SCRIPTS" || true)"
SESSION_ROOT="$(ai_resolve_root "$(ai_hook_field cwd)" "$SELF_ROOT")"
[[ -n "$SESSION_ROOT" ]] || finish
MAIN_ROOT="$(ai_main_root "$SESSION_ROOT" || true)"
[[ -n "$MAIN_ROOT" ]] || finish
in_worktree=0; [[ "$SESSION_ROOT" != "$MAIN_ROOT" ]] && in_worktree=1
got_main=0; ai_take_lock "$(ai_lock_of "$MAIN_ROOT")" && got_main=1
run() { bash "$SCRIPTS/$1" "${@:2}" 2>&1 </dev/null; }

# 1. shelf 自己先升到最新（拿到主检出锁的那个会话才升，免得几个会话同时 npm install -g）
if (( got_main )) && command -v shelf >/dev/null 2>&1 && [[ "${SESSION_START_SKIP_SHELF:-0}" != "1" ]]; then
  pkg="${SHELF_NPM_PKG:-@jackss119/shelf}"
  cur="$(shelf version --text 2>/dev/null | tr -d '[:space:]')"
  latest=""
  if command -v npm >/dev/null 2>&1; then
    if command -v timeout >/dev/null 2>&1; then latest="$(timeout 15 npm view "$pkg" version 2>/dev/null </dev/null | tr -d '[:space:]')"
    else latest="$(npm view "$pkg" version 2>/dev/null </dev/null | tr -d '[:space:]')"; fi
  fi
  if [[ -z "$latest" ]]; then
    say "⚠ 查不到 shelf 的最新版（没网或超时），用本机的 ${cur:-未知版本}"
  elif [[ "$cur" != "$latest" && "$(printf '%s\n%s\n' "$cur" "$latest" | sort -V | tail -n 1)" == "$latest" ]]; then
    if npm install -g "$pkg@$latest" --silent >/dev/null 2>&1 </dev/null; then say "✓ shelf 升级 $cur → $latest"
    else say "⚠ shelf 升级到 $latest 失败，用本机的 $cur"; fi
  fi
fi

# 2. 主检出（桌面版的技能、设置、钩子从这里读）
say "【主检出：$MAIN_ROOT$( (( in_worktree )) || printf '（本会话就开在这里）')】"
if (( ! got_main )); then
  say "= 另一个会话正在同步主检出，这次跳过"
elif busy="$(ai_busy "$MAIN_ROOT")"; then
  say "⚠ 主检出有进行中的 merge / rebase / cherry-pick（$busy），这次不同步主检出"
else
  keepm "$(run protocol-mirror.sh --sync --root "$MAIN_ROOT" --agent all)"
  keep "$(run shelf-step.sh --root "$MAIN_ROOT" --kind main)"
fi
(( got_main )) && ai_release_locks

# 3. 会话所在的 worktree
if (( in_worktree )); then
  say "【本会话的 worktree：$SESSION_ROOT】"
  if ! ai_take_lock "$(ai_lock_of "$SESSION_ROOT")"; then
    say "= 另一个会话正在同步这个 worktree，这次跳过"
  elif busy="$(ai_busy "$SESSION_ROOT")"; then
    say "⚠ 这个 worktree 有进行中的 merge / rebase / cherry-pick（$busy），这次不同步"
  else
    keep "$(run local-config.sh --root "$SESSION_ROOT" --agent "$AGENT")"
    keep "$(run skills-link.sh --root "$SESSION_ROOT" --agent "$AGENT" | grep -E '^(↻|＋|⚠|✗)|^✓ \.|^  ⚠')"   # 只报新建、重建的链接
    run protocol-mirror.sh --sync --root "$SESSION_ROOT" --agent all >/dev/null
    keep "$(run shelf-step.sh --root "$SESSION_ROOT" --kind worktree)"
    keepm "$(run protocol-mirror.sh --sync --root "$SESSION_ROOT" --agent all)"
  fi
fi

# 4. reloadSkills（在 finish 的 JSON 里）
finish
