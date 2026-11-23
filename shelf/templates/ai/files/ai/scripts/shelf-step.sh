#!/usr/bin/env bash
#
# shelf-step.sh —— 在一个检出里跑一遍 shelf sync，报告它改了什么（重复执行安全；不跑 shelf init）。
# AI 工作流模板（货架 templates/ai）的一部分，由 shelf 装到 <ai>/scripts/；会话开场钩子调它。
#
# shelf sync 装模板新增的货、把货架新版且本地没动的更新到本地、补回缺的技能链接与根目录协议副本；
# shelf 2.2 起还补回被 git 忽略、本地缺了的植入物（钩子配置等），给已有的钩子配置补上模板里缺的钩子，内容没变不改账本。
# 不带 --merge / --push：有人改过的货（本地领先、双改、冲突）一律不动，逐件列成待决，留给人按 shelf-ops 处理。
# init 只在新项目、新分支、新 worktree 第一次接入时由人跑（用户 2026-11-19 定：主检出不自动跑 init）。
#
# --kind 决定改动怎么报：
#   worktree：改到的已跟踪文件算本会话的改动，随本轮任务一起提交，提交信息写明来自 shelf sync
#   main    ：改到的文件留在主检出、谁都不提交，上游带上同样内容后由 sync-main-checkout.sh 丢掉再快进；
#             只有账本 .shelf.json 变了、文件一个没变，就把账本还原（shelf 2.1 及以前每次都改写模板提交号，2.2 起只剩兜底）
# 没装 shelf、设了 SESSION_START_SKIP_SHELF=1、没有账本 .shelf.json → 跳过并说明。
# 输出：给 agent 看的结论行（✓ ⚠ ✗ → =），待决逐件列出（最多 6 件）。
#
# 用法：
#   bash <ai>/scripts/shelf-step.sh [--root <检出>] [--kind worktree|main]
set -uo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
source "$SCRIPTS/lib/common.sh"

KIND=""
args=("$@")
while [[ $# -gt 0 ]]; do
  case "$1" in
    --kind) KIND="${2:-}"; shift 2 ;;
    --kind=*) KIND="${1#*=}"; shift ;;
    --root) shift 2 ;;
    --root=*) shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "✗ 未知参数：$1（用 --help 看用法）"; exit 2 ;;
  esac
done
ai_root_from_args "$SCRIPTS/../.." "${args[@]+"${args[@]}"}" || { echo "✗ 不在 git 仓库里"; exit 1; }
ROOT="$AI_ROOT"
if [[ -z "$KIND" ]]; then KIND=worktree; [[ "$(ai_main_root "$ROOT")" == "$ROOT" ]] && KIND=main; fi
case "$KIND" in worktree|main) ;; *) echo "✗ --kind 只接受 worktree / main，收到：$KIND"; exit 2 ;; esac

if [[ "${SESSION_START_SKIP_SHELF:-0}" == "1" ]]; then echo "= 设了 SESSION_START_SKIP_SHELF=1，不跑 shelf"; exit 0; fi
if ! command -v shelf >/dev/null 2>&1; then
  if [[ "$KIND" == worktree ]]; then echo "⚠ 没装 shelf，AI 工作流停在本分支的版本"; else echo "⚠ 没装 shelf，主检出没同步"; fi
  exit 0
fi
if [[ ! -f "$ROOT/.shelf.json" ]]; then echo "= 没有账本 .shelf.json（这个检出还没接 AI 工作流），不跑 shelf"; exit 0; fi

changes_of() { git -C "$ROOT" status --porcelain --untracked-files=all 2>/dev/null | sort; }
keep_lines() { grep -E '^[[:space:]]*(✓|⚠|✗|↻|＋|→|!)' | head -n 12; }
items() { grep -E '^[[:space:]]+·.*→' | sed 's/^[[:space:]]*/  /' | head -n 6; }

before="$(changes_of)"
out="$(cd "$ROOT" && shelf sync --text 2>&1 </dev/null)"; rc=$?
# 补钩子、补回植入物：报出来（新钩子从下一个会话起生效）
printf '%s\n' "$out" | grep -E '^[[:space:]]*✓.*模板里缺的钩子' | sed -e 's/^[[:space:]]*//' -e 's/$/（新钩子从下一个会话起生效）/' | head -n 4
printf '%s\n' "$out" | grep -E '^[[:space:]]*!.*没补模板里的钩子' | sed 's/^[[:space:]]*//' | head -n 4
case $rc in
  0) ;;
  2) echo "⚠ shelf sync 有待决（退出码 2）：没自动处理的物品逐件列在下面，按 shelf-ops 处理"; printf '%s\n' "$out" | items ;;
  3) echo "✗ shelf sync 有冲突（退出码 3）：冲突的物品没动，按 shelf-ops 处理"; printf '%s\n' "$out" | items ;;
  *) echo "⚠ shelf sync 退出码 $rc，没同步成"; printf '%s\n' "$out" | keep_lines ;;
esac
after="$(changes_of)"
changed="$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$after") | sed 's/^...//' | grep -v '^$' || true)"
if [[ "$KIND" == main && "$changed" == ".shelf.json" ]] && ! printf '%s\n' "$before" | grep -q ' \.shelf\.json$'; then
  git -C "$ROOT" restore --worktree -- .shelf.json 2>/dev/null && changed=""
fi
if [[ -z "$changed" ]]; then echo "✓ 货架同步没有改到文件"; exit 0; fi
n="$(printf '%s\n' "$changed" | wc -l | tr -d ' ')"
list="$(printf '%s\n' "$changed" | head -n 8 | awk 'NR > 1 { printf " · " } { printf "%s", $0 }')"
(( n > 8 )) && list+=" 等"
if [[ "$KIND" == worktree ]]; then
  echo "→ 货架同步改了 $n 个文件，算本会话的改动：随本轮任务一起提交、推送，提交信息写明来自 shelf sync：$list"
else
  echo "→ 货架同步改了主检出的 $n 个文件：留在主检出，本会话不提交、不还原；上游带上同样内容后 sync-main-checkout.sh 会丢掉它们再快进（上游一直没有的，在某个 worktree 会话里专门提交一次）：$list"
fi
