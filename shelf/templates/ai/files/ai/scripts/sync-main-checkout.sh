#!/usr/bin/env bash
#
# sync-main-checkout.sh —— 把主检出快进到远端集成分支的最新提交。
# AI 工作流模板（货架 templates/ai）的一部分，由 shelf init 装到 <ai>/scripts/。
#
# 为什么需要它：桌面版 worktree 会话的技能、设置、钩子都从主检出读；命令行开的 worktree 根目录没有 .claude/skills 时
# （它被 git 忽略）也改读主检出的技能；根目录协议副本也是从主检出复制过来的。主检出落后远端，新会话读到的就是旧版。
# 所以每次合并进集成分支后跑一次。
#
# 只在全部安全条件成立时动手，其余情况只报告、退出 0：
#   - 主检出当前就在集成分支上（不切分支）
#   - 没有进行中的 merge / rebase / cherry-pick，没有暂存（git add 过）的改动（那是有人正要提交）
#   - 远端是主检出的直系后代（只快进，主检出有本地提交或已分叉就不动）
#   - 未提交的改动（会话开场钩子在主检出跑货架同步留下的，或别的会话的）逐个文件和远端比：
#       全部和远端逐字节一致（上游已经带上同样内容）→ 还原成 HEAD 版本再快进；有一个不一致 → 整批不动，列出不一致的文件。
#       快进会写到的未跟踪文件同样比：一致就删掉再快进，不一致就不动。
#       账本 .shelf.json 例外：它的模板提交号、拉取时间每次同步都会变，几乎不会和远端逐字节一致；其余改动都和远端一致时，
#       账本的差异当记账噪音一起丢掉（下次 shelf init / sync 会按磁盘上的文件重新记账）
# 动手 = git fetch 集成分支 + 丢掉与远端一致的改动 + git merge --ff-only；不 reset、不 checkout、不 stash。
# 开场钩子同步主检出时拿着同一把锁（主检出 git 目录下的 ai-shelf-sync.lock），本脚本最多等它 90 秒。
# 主检出在最新时，再用它自己的 protocol-mirror.sh --sync 对齐根目录协议副本（被 git 忽略，新 worktree 按 .worktreeinclude 从这里复制）；
# 副本被人改过就两份都不动、只报告。
#
# 集成分支：--branch 指定；否则取 origin/HEAD 指向的分支；都没有就用 main。
#
# 用法：
#   bash ai/scripts/sync-main-checkout.sh                 # 快进主检出（条件不满足就只报告）
#   bash ai/scripts/sync-main-checkout.sh --dry-run       # 只报告会不会快进、会丢掉哪些改动
#   bash ai/scripts/sync-main-checkout.sh --branch dev    # 集成分支不是 origin/HEAD 时指定
set -euo pipefail

DRY=0; BRANCH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --branch=*) BRANCH="${1#*=}"; shift ;;
    -h|--help) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
busy() {
  local f
  for f in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply; do [[ -e "$gitdir/$f" ]] && { echo "$f"; return 0; }; done
  return 1
}
if f="$(busy)"; then echo "⚠ 主检出有进行中的 merge / rebase / cherry-pick（$f），不动"; exit 0; fi

# 和开场钩子的主检出同步互斥（同一把锁）；只读的 --dry-run 不拿锁
lock="$gitdir/ai-shelf-sync.lock"
release_lock() { [[ -n "${HELD:-}" ]] && rm -rf "$lock"; return 0; }
trap release_lock EXIT
take_lock() {
  local pid
  if mkdir "$lock" 2>/dev/null; then echo $$ > "$lock/pid"; HELD=1; return 0; fi
  pid="$(cat "$lock/pid" 2>/dev/null || true)"
  if [[ -n "$(find "$lock" -maxdepth 0 -mmin +10 2>/dev/null)" ]] || { [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; }; then
    rm -rf "$lock"
    if mkdir "$lock" 2>/dev/null; then echo $$ > "$lock/pid"; HELD=1; return 0; fi
  fi
  return 1
}
if (( ! DRY )); then
  waited=0
  until take_lock; do
    if (( waited >= 90 )); then echo "⚠ 会话开场钩子正在同步主检出（等了 90 秒还没完），这次不动；过一会儿再跑本脚本"; exit 0; fi
    sleep 3; waited=$((waited + 3))
  done
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
  (cd "$MAIN_ROOT" && bash "$mirror" "${args[@]}" 2>&1 </dev/null | grep -E '↻|⚠|✗' | sed 's/^/  主检出：/') || true
}

if [[ -n "$(g diff --cached --name-only)" ]]; then
  echo "⚠ 主检出有暂存（git add 过）的改动（可能是别的会话正要提交），不动"; exit 0
fi
g update-index -q --refresh >/dev/null 2>&1 || true

AI="$(sed -n 's/^[[:space:]]*"aiDir"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MAIN_ROOT/.shelf.json" 2>/dev/null | head -n 1 || true)"
AI="${AI:-ai}"
LEDGER=".shelf.json"
shelf_managed() {   # 货架管的文件：账本、技能与协议正本、AI 工作流脚本、技能登记表
  case "$1" in "$LEDGER"|"$AI/jaSkills/"*|"$AI/jaAgents/"*|"$AI/scripts/"*|"$AI/JASKILL.md") return 0 ;; esac
  return 1
}
dirty=()   # 已跟踪、有未提交改动的文件（没有暂存，所以就是工作区 vs HEAD）
while IFS= read -r -d '' p; do dirty+=("$p"); done < <(g diff --name-only -z)

say_list() {   # say_list <标题> <路径...>：最多列 10 个，标出哪些是货架管的
  local title="$1" p i=0; shift
  echo "$title"
  for p in "$@"; do
    i=$((i + 1)); (( i > 10 )) && { echo "    …… 共 $# 个"; break; }
    if shelf_managed "$p"; then echo "    · $p（货架管的文件）"; else echo "    · $p"; fi
  done
}

if [[ "$local_sha" == "$remote_sha" ]]; then
  echo "= 主检出 $BRANCH 已是最新（${local_sha:0:7}）"
  if (( ${#dirty[@]} )); then
    say_list "  另有 ${#dirty[@]} 个未提交改动，远端没有（货架管的文件多半是开场钩子同步出来、上游还没有的；其余可能是别的会话的工作），不动：" "${dirty[@]}"
  fi
  mirror_copies; exit 0
fi
if ! g merge-base --is-ancestor "$local_sha" "$remote_sha"; then
  echo "⚠ 主检出 $BRANCH 有远端没有的本地提交（或已分叉），只快进不合并，不动"; exit 0
fi
n="$(g rev-list --count "$local_sha..$remote_sha")"

# 未提交的改动逐个和远端比
same=(); differ=(); ledger_differs=0
for p in "${dirty[@]+"${dirty[@]}"}"; do
  if g diff --quiet "$remote_ref" -- "$p"; then same+=("$p")
  elif [[ "$p" == "$LEDGER" ]]; then ledger_differs=1
  else differ+=("$p"); fi
done
# 快进要写进来的新文件、本地已有同名的未跟踪文件（被忽略的不算：git 会直接覆盖它们）
untracked_same=()
blob_of() {   # 本地文件按 git 的方式算的对象号与类型（普通 / 可执行 / 链接）
  if [[ -L "$MAIN_ROOT/$1" ]]; then printf '120000 %s' "$(readlink "$MAIN_ROOT/$1" | tr -d '\n' | git hash-object --stdin)"
  elif [[ -x "$MAIN_ROOT/$1" ]]; then printf '100755 %s' "$(g hash-object -- "$1")"
  else printf '100644 %s' "$(g hash-object -- "$1")"; fi
}
while IFS= read -r -d '' p; do
  [[ -e "$MAIN_ROOT/$p" || -L "$MAIN_ROOT/$p" ]] || continue
  g ls-files --error-unmatch -- "$p" >/dev/null 2>&1 && continue
  g check-ignore -q -- "$p" 2>/dev/null && continue
  if [[ -f "$MAIN_ROOT/$p" || -L "$MAIN_ROOT/$p" ]] && [[ "$(blob_of "$p")" == "$(g ls-tree "$remote_ref" -- "$p" | awk '{ print $1 " " $3 }')" ]]; then
    untracked_same+=("$p")
  else
    differ+=("$p（未跟踪，快进要写这个路径）")
  fi
done < <(g diff --name-only -z --diff-filter=A "$local_sha" "$remote_sha")

if (( ${#differ[@]} )); then
  say_list "⚠ 主检出有 ${#differ[@]} 个未提交改动和远端 $BRANCH 不一致，不快进（主检出原样未动）：" "${differ[@]}"
  echo "  货架管的文件多半是开场钩子同步出来、上游还没有的（货架在两次合并之间又更新过）：在某个 worktree 会话里提交一次货架同步、合进 $BRANCH 后再跑本脚本；"
  echo "  其余的可能是别的会话在主检出里的工作，先问清楚，别替人丢"
  exit 0
fi

discard=$(( ${#same[@]} + ${#untracked_same[@]} + ledger_differs ))
if (( DRY )); then
  (( discard )) && echo "  [dry-run] 会先丢掉 $discard 个和远端一致的未提交改动$( (( ledger_differs )) && printf '（含账本 .shelf.json 的记账差异）')"
  echo "  [dry-run] 主检出 $BRANCH 会快进 $n 个提交（${local_sha:0:7} → ${remote_sha:0:7}）"; exit 0
fi
if (( ${#same[@]} || ledger_differs )); then
  restore=("${same[@]+"${same[@]}"}"); (( ledger_differs )) && restore+=("$LEDGER")
  g restore --source=HEAD --worktree -- "${restore[@]}"
fi
for p in "${untracked_same[@]+"${untracked_same[@]}"}"; do rm -f "$MAIN_ROOT/$p"; done
if g merge --ff-only --quiet "$remote_ref"; then
  echo "✓ 主检出 $BRANCH 快进 $n 个提交（${local_sha:0:7} → ${remote_sha:0:7}）"
  (( discard )) && echo "  先丢掉了 $discard 个和远端一致的未提交改动（上游已经带上同样内容）$( (( ledger_differs )) && printf '，账本 .shelf.json 的记账差异一并丢掉')"
  mirror_copies
else
  echo "⚠ 主检出快进失败，见上方 git 输出；丢掉的 $discard 个改动和远端一致，远端 $BRANCH 上都有"
fi
