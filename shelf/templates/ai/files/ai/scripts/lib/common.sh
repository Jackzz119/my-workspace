#!/usr/bin/env bash
#
# lib/common.sh —— AI 工作流脚本共用的小工具，只被 source，不单独跑。
# AI 工作流模板（货架 templates/ai）的一部分，由 shelf 装到 <ai>/scripts/lib/。
#
# 提供：认检出与主检出（ai_toplevel / ai_main_root / ai_same_repo / ai_resolve_root）、ai 区目录名（ai_dir_of）、
# 钩子输入（ai_read_hook_input / ai_hook_field）、锁（ai_take_lock / ai_lock_of，退出时自动释放）、
# 进行中的 merge / rebase（ai_busy）、通用参数里的 --root（ai_root_from_args）。
# 所有函数只 return、不 exit；不依赖 jq；bash 3.2 可用（macOS 自带的 bash）。

# 检出的顶层目录（真实路径）；不在 git 仓库里返回 1
ai_toplevel() {
  local d
  d="$(git -C "$1" rev-parse --show-toplevel 2>/dev/null)" && [[ -n "$d" ]] && (cd "$d" 2>/dev/null && pwd -P)
}

# 公共 git 目录（同一个仓库的所有检出相同）
ai_common_dir() {
  (cd "$1" 2>/dev/null && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)
}

ai_same_repo() { [[ -n "$1" && -n "$2" && "$(ai_common_dir "$1")" == "$(ai_common_dir "$2")" ]]; }

# 主检出 = git worktree list 的第一行（整行取：路径里有空格也不截断）
ai_main_root() {
  local m
  m="$(git -C "$1" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
  [[ -n "$m" ]] && (cd "$m" 2>/dev/null && pwd -P)
}

# ai 区目录名：账本 aiDir；没有账本就用第二个参数（调用方传脚本所在的那一层），再没有就是 ai
ai_dir_of() {
  local a
  a="$(sed -n 's/^[[:space:]]*"aiDir"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1/.shelf.json" 2>/dev/null | head -n 1 || true)"
  printf '%s' "${a:-${2:-ai}}"
}

# 钩子输入（JSON，标准输入）读进 AI_HOOK_INPUT：标准输入是终端（手动跑）就不读；管道迟迟不关也只等 2 秒
AI_HOOK_INPUT=""
ai_read_hook_input() {
  local line=""
  AI_HOOK_INPUT=""
  [[ -t 0 ]] && return 0
  while IFS= read -r -t 2 line || [[ -n "$line" ]]; do AI_HOOK_INPUT+="$line"$'\n'; line=""; done
  return 0
}

# 取钩子输入里的字符串字段；还原 JSON 转义的 \\ 与 \/
ai_hook_field() {
  printf '%s' "$AI_HOOK_INPUT" | tr -d '\r\n' | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1 \
    | sed -e 's#\\/#/#g' -e 's#\\\\#\\#g'
}

# 会话所在的检出：<cwd> 的顶层，且和 <fallback> 是同一个仓库；否则用 <fallback>
ai_resolve_root() {
  local top=""
  if [[ -n "$1" && -d "$1" ]]; then top="$(ai_toplevel "$1" || true)"; fi
  if [[ -n "$top" ]] && { [[ -z "$2" ]] || ai_same_repo "$top" "$2"; }; then printf '%s' "$top"; else printf '%s' "$2"; fi
}

# 进行中的 merge / rebase / cherry-pick / revert：打印标记名并返回 0；没有返回 1
ai_busy() {
  local g f
  g="$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null)" || return 1
  for f in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply; do
    [[ -e "$g/$f" ]] && { printf '%s' "$f"; return 0; }
  done
  return 1
}

# 锁：mkdir 是原子操作（macOS 默认没有 flock）。持有的进程已经不在、或锁放了 10 分钟以上，算残留，清掉重拿一次。
# 拿到的锁记进 AI_LOCKS，脚本退出时释放（ai_take_lock 第一次被调用时挂上 EXIT 陷阱）
AI_LOCKS=()
ai_release_locks() { local l; for l in "${AI_LOCKS[@]+"${AI_LOCKS[@]}"}"; do rm -rf "$l"; done; AI_LOCKS=(); }
ai_lock_of() { printf '%s/ai-shelf-sync.lock' "$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null)"; }
ai_take_lock() {   # ai_take_lock <锁目录>：拿到返回 0，别人正拿着返回 1
  local lock="$1" pid
  [[ "$lock" == /* ]] || return 1
  if (( ${#AI_LOCKS[@]} == 0 )); then trap ai_release_locks EXIT; fi
  if mkdir "$lock" 2>/dev/null; then echo $$ > "$lock/pid"; AI_LOCKS+=("$lock"); return 0; fi
  pid="$(cat "$lock/pid" 2>/dev/null || true)"
  if [[ -n "$(find "$lock" -maxdepth 0 -mmin +10 2>/dev/null)" ]] || { [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; }; then
    rm -rf "$lock"
    if mkdir "$lock" 2>/dev/null; then echo $$ > "$lock/pid"; AI_LOCKS+=("$lock"); return 0; fi
  fi
  return 1
}

# 模块的通用参数 --root <检出>：没给就用 <默认>（脚本所在的检出）。结果写进 AI_ROOT，不在仓库里返回 1
ai_root_from_args() {   # ai_root_from_args <默认> "$@"
  local def="$1" r=""; shift
  while [[ $# -gt 0 ]]; do
    case "$1" in --root) r="${2:-}"; shift 2 ;; --root=*) r="${1#*=}"; shift ;; *) shift ;; esac
  done
  AI_ROOT="$(ai_toplevel "${r:-$def}" || true)"
  [[ -n "$AI_ROOT" ]]
}
