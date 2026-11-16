#!/usr/bin/env bash
#
# sync-main-checkout.sh —— 把主检出快进到远端集成分支的最新提交。
# AI 工作流模板（货架 templates/ai）的一部分，由 shelf init 装到 <ai>/scripts/。
#
# 为什么需要它：worktree 根目录没有 .claude/skills 时（它被 git 忽略，新 worktree 里本来就没有），
# Claude Code 会改读主检出的技能；根目录协议副本也是从主检出复制过来的。主检出落后远端，新会话读到的就是旧版。
# 所以每次合并进集成分支后跑一次，会话开场钩子（session-start.sh）也会跑一次兜底。
#
# 只在全部安全条件成立时动手，其余情况只报告、退出 0：
#   - 主检出当前就在集成分支上（不切分支）
#   - 没有进行中的 merge / rebase / cherry-pick，已跟踪文件没有未提交改动（那可能是别的会话的工作台）
#   - 远端是主检出的直系后代（只快进，主检出有本地提交或已分叉就不动）
# 动手 = git fetch 集成分支 + git merge --ff-only；不 reset、不 checkout、不碰未跟踪文件。
# 主检出在最新时，再用它自己的 protocol-mirror.sh --sync 对齐根目录协议副本（被 git 忽略，新 worktree 按 .worktreeinclude 从这里复制）；
# 副本被人改过就两份都不动、只报告。
#
# 集成分支：--branch 指定；否则取 origin/HEAD 指向的分支；都没有就用 main。
#
# 用法：
#   bash ai/scripts/sync-main-checkout.sh                 # 快进主检出（条件不满足就只报告）
#   bash ai/scripts/sync-main-checkout.sh --dry-run       # 只报告会不会快进
#   bash ai/scripts/sync-main-checkout.sh --branch dev    # 集成分支不是 origin/HEAD 时指定
set -euo pipefail

DRY=0; BRANCH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --branch=*) BRANCH="${1#*=}"; shift ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "✗ 未知参数：$1（用 --help 看用法）"; exit 2 ;;
  esac
done

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
MAIN_ROOT="$(git worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
if [[ -z "$MAIN_ROOT" ]]; then echo "= 主检出：不在 git 仓库里，跳过"; exit 0; fi
g() { git -C "$MAIN_ROOT" "$@"; }

if ! g remote get-url origin >/dev/null 2>&1; then echo "= 主检出：没有 origin 远端，跳过"; exit 0; fi
if [[ -z "$BRANCH" ]]; then
  BRANCH="$(g symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  BRANCH="${BRANCH#origin/}"
  [[ -n "$BRANCH" ]] || BRANCH="main"
fi

current="$(g branch --show-current 2>/dev/null || true)"
if [[ "$current" != "$BRANCH" ]]; then
  echo "= 主检出在「${current:-游离 HEAD}」上，不是集成分支 $BRANCH，不动"; exit 0
fi

gitdir="$(g rev-parse --absolute-git-dir)"
for f in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply; do
  if [[ -e "$gitdir/$f" ]]; then echo "⚠ 主检出有进行中的 merge / rebase / cherry-pick（$f），不动"; exit 0; fi
done
if [[ -n "$(g status --porcelain --untracked-files=no)" ]]; then
  echo "⚠ 主检出有未提交的改动（可能是别的会话在用），不动；要更新请在那边提交后再跑本脚本"; exit 0
fi

fetch=(g fetch --quiet origin "$BRANCH")
if command -v timeout >/dev/null 2>&1; then fetch=(timeout 20 git -C "$MAIN_ROOT" fetch --quiet origin "$BRANCH"); fi
if ! "${fetch[@]}" 2>/dev/null; then echo "⚠ 取远端 $BRANCH 失败（没网或超时），按上次取到的远端状态判断"; fi

remote_ref="refs/remotes/origin/$BRANCH"
if ! g rev-parse --verify --quiet "$remote_ref" >/dev/null; then echo "= 主检出：远端没有 $BRANCH，跳过"; exit 0; fi
local_sha="$(g rev-parse HEAD)"; remote_sha="$(g rev-parse "$remote_ref")"
mirror_copies() {   # 主检出最新后对齐它的根目录协议副本
  local ai mirror
  ai="$(sed -n 's/^[[:space:]]*"aiDir"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MAIN_ROOT/.shelf.json" 2>/dev/null | head -n 1 || true)"
  mirror="$MAIN_ROOT/${ai:-ai}/scripts/protocol-mirror.sh"
  [[ -f "$mirror" ]] || return 0
  local args=(--sync); (( DRY )) && args+=(--dry-run)
  (cd "$MAIN_ROOT" && bash "$mirror" "${args[@]}" 2>&1 | grep -E '↻|⚠|✗' | sed 's/^/  主检出：/') || true
}
if [[ "$local_sha" == "$remote_sha" ]]; then echo "= 主检出 $BRANCH 已是最新（${local_sha:0:7}）"; mirror_copies; exit 0; fi
if ! g merge-base --is-ancestor "$local_sha" "$remote_sha"; then
  echo "⚠ 主检出 $BRANCH 有远端没有的本地提交（或已分叉），只快进不合并，不动"; exit 0
fi

n="$(g rev-list --count "$local_sha..$remote_sha")"
if (( DRY )); then echo "  [dry-run] 主检出 $BRANCH 会快进 $n 个提交（${local_sha:0:7} → ${remote_sha:0:7}）"; exit 0; fi
if g merge --ff-only --quiet "$remote_ref"; then
  echo "✓ 主检出 $BRANCH 快进 $n 个提交（${local_sha:0:7} → ${remote_sha:0:7}）"
  mirror_copies
else
  echo "⚠ 主检出快进失败（多半是有未跟踪文件会被覆盖），见上方 git 输出；主检出原样未动"
fi
