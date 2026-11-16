#!/usr/bin/env bash
#
# session-start.sh —— 会话开场钩子：新 worktree 会话一开就把 AI 工作流同步到货架最新。
# AI 工作流模板（货架 templates/ai）的一部分，由 shelf init 装到 <ai>/scripts/；
# 模板的 .claude/settings.json（Claude Code）与 .codex/hooks.json（Codex）在 SessionStart 上调它。
#
# 只在 linked worktree 里动手（主检出是别的会话的工作台，这里不改它的文件；主检出的更新靠合并后的 sync-main-checkout.sh）。
# 依次做，都可重复执行，失败只报告、不挡开场：
#   1. 装了 shelf → 查 npm 上的最新版，本机旧了就升级（没网 / 超时就用现有版本）
#   2. protocol-mirror.sh --sync：根目录协议副本是从主检出复制来的，可能是旧的；没人改过就先换成本分支正本，免得 shelf init 停在「副本领先」
#   3. shelf init（按账本补齐链接、副本、缺的货）→ shelf sync（装模板新增的货，货架新版且本地没动的更新到本地）。
#      不带 --merge / --push：双改和冲突留给人，推货架等任务做完再说
#   4. sync-worktree.sh：补技能链接、对齐协议副本、补环境配置，再跑项目的 worktree.local.sh（没装 shelf 时只有这一步）
# 第 3 步改到的已跟踪文件算本会话的改动：随本轮任务一起提交、推送，提交信息写明来自货架同步。
# 最后请 Claude Code 重扫技能（reloadSkills），本会话当场换成本 worktree 的版本。
#
# 输出：Claude 侧是一段 JSON（reloadSkills + 给 agent 看的摘要）；Codex 侧是纯文本摘要。
# 环境变量：SESSION_START_SKIP_SHELF=1 跳过 1–3 步；SHELF_NPM_PKG 指定 shelf 的 npm 包名。
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
    -h|--help) sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) shift ;;
  esac
done

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$SCRIPTS/../.." || exit 0

notes=()
keep_lines() {   # 只留结论行（✓ ⚠ ✗ ↻ ＋ →），最多 12 行，免得把整段日志塞进上下文
  grep -E '^[[:space:]]*(✓|⚠|✗|↻|＋|→)' | grep -v '下一步：从头读一遍' | head -n 12
}
add_lines() { while IFS= read -r line; do [[ -n "$line" ]] && notes+=("$line"); done < <(printf '%s\n' "$1" | keep_lines); }
shelf_items() {  # shelf 把待决逐件列成「  · 物品（状态）→ 下一步命令」，最多带 6 件
  while IFS= read -r line; do [[ -n "$line" ]] && notes+=("  $line"); done < <(printf '%s\n' "$1" | grep -E '^[[:space:]]+·.*→' | sed 's/^[[:space:]]*//' | head -n 6)
}
run_t() { local s="$1"; shift; if command -v timeout >/dev/null 2>&1; then timeout "$s" "$@"; else "$@"; fi; }
tracked_changes() { git status --porcelain --untracked-files=all 2>/dev/null | sort; }

git_dir="$(git rev-parse --absolute-git-dir 2>/dev/null || true)"
common_dir="$(cd "$(git rev-parse --git-common-dir 2>/dev/null || echo .)" 2>/dev/null && pwd -P)"
in_worktree=0
[[ -n "$git_dir" && "$git_dir" != "$common_dir" ]] && in_worktree=1

if (( in_worktree )); then
  # 1. shelf 自己先升到最新
  if command -v shelf >/dev/null 2>&1 && [[ "${SESSION_START_SKIP_SHELF:-0}" != "1" ]]; then
    pkg="${SHELF_NPM_PKG:-@jackss119/shelf}"
    cur="$(shelf version --text 2>/dev/null | tr -d '[:space:]')"
    latest=""
    command -v npm >/dev/null 2>&1 && latest="$(run_t 15 npm view "$pkg" version 2>/dev/null | tr -d '[:space:]')"
    if [[ -z "$latest" ]]; then
      notes+=("⚠ 查不到 shelf 的最新版（没网或超时），用本机的 ${cur:-未知版本}")
    elif [[ "$cur" != "$latest" && "$(printf '%s\n%s\n' "$cur" "$latest" | sort -V | tail -n 1)" == "$latest" ]]; then
      if run_t 120 npm install -g "$pkg@$latest" --silent >/dev/null 2>&1; then
        notes+=("✓ shelf 升级 $cur → $latest")
      else
        notes+=("⚠ shelf 升级到 $latest 失败，用本机的 $cur")
      fi
    fi

    # 2. 先把从主检出带来的旧协议副本换掉（只换没人改过的）
    [[ -f "$SCRIPTS/protocol-mirror.sh" ]] && bash "$SCRIPTS/protocol-mirror.sh" --sync --agent all >/dev/null 2>&1

    # 3. 按账本补齐，再同步到货架最新
    before="$(tracked_changes)"
    out="$(shelf init --text 2>&1)"; rc=$?
    (( rc == 0 || rc == 2 )) || { notes+=("⚠ shelf init 退出码 $rc，没补齐"); add_lines "$out"; }   # 2 = 有待决，下面 sync 会逐件列出
    out="$(shelf sync --text 2>&1)"; rc=$?
    case $rc in
      0) ;;
      2) notes+=("⚠ shelf sync 有待决（退出码 2）：没自动处理的物品逐件列在下面，按 shelf-ops 处理"); shelf_items "$out" ;;
      3) notes+=("✗ shelf sync 有冲突（退出码 3）：冲突的物品没动，按 shelf-ops 处理"); shelf_items "$out" ;;
      *) notes+=("⚠ shelf sync 退出码 $rc，没同步成"); add_lines "$out" ;;
    esac
    changed="$(comm -13 <(printf '%s\n' "$before") <(tracked_changes) | sed 's/^...//' | grep -v '^$' || true)"
    if [[ -n "$changed" ]]; then
      n="$(printf '%s\n' "$changed" | wc -l | tr -d ' ')"
      list="$(printf '%s\n' "$changed" | head -n 8 | awk 'NR > 1 { printf " · " } { printf "%s", $0 }')"
      (( n > 8 )) && list+=" 等"
      notes+=("→ 货架同步改了 $n 个文件，算本会话的改动：随本轮任务一起提交、推送，提交信息写明来自 shelf sync：$list")
    else
      notes+=("✓ 货架同步没有改到文件")
    fi
  elif ! command -v shelf >/dev/null 2>&1; then
    notes+=("⚠ 没装 shelf，只跑保底脚本；AI 工作流停在本分支的版本")
  fi

  # 4. 保底脚本：链接、协议副本、环境配置、项目补充步骤
  if [[ -f "$SCRIPTS/sync-worktree.sh" ]]; then
    out="$(bash "$SCRIPTS/sync-worktree.sh" --agent "$AGENT" 2>&1)" || notes+=("⚠ sync-worktree.sh 退出码 $?，见下")
    add_lines "$out"
  fi
fi

ctx=""
if (( ${#notes[@]} )); then
  ctx="会话开场钩子 session-start.sh 已把 AI 工作流同步到最新："
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
