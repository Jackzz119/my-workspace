#!/usr/bin/env bash
#
# skills-link.sh —— 让 agent 的技能目录看得到技能真源 <ai>/jaSkills/（只做这一件事，重复执行安全）。
# AI 工作流模板（货架 templates/ai）的一部分，由 shelf 装到 <ai>/scripts/；sync-worktree.sh、bootstrap.sh、会话开场钩子都调它。
#
# 默认建链接（Claude 读 .claude/skills，Codex 读 .agents/skills）：
#   - 不存在 / 悬空链接 / 空真目录      → 建一条整目录链接 → ../<ai>/jaSkills
#   - 已是指向 <ai>/jaSkills 的链接     → 不动
#   - 非空真目录（项目没 ignore 这个目录时会这样）→ 追加：真源里每个技能补一条按件链接，
#     同名条目换成链接（原内容删除并报告），不在真源里的条目原样保留
#   Windows（Git Bash）只建原生链接，建不了就退到 junction，两样都不成就报错，绝不留一份副本。
# --copy（Multica 用：它的 runtime 不跟链接）：把每个技能复制进技能目录；已是指向真源的按件链接原样保留，
#   真源里已经没有的副本只报告不删。
# <ai>/jaSkills 不存在 → 退出码 1，把错误原文反馈给用户，不要自己猜着建。
#
# 用法：
#   bash <ai>/scripts/skills-link.sh [--root <检出>] [--agent claude|codex|all] [--copy] [--dry-run]
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
source "$SCRIPTS/lib/common.sh"

AGENT="all"; DRY=0; COPY=0
args=("$@")
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT="${2:-}"; shift 2 ;;
    --agent=*) AGENT="${1#*=}"; shift ;;
    --copy) COPY=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --root) shift 2 ;;
    --root=*) shift ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "✗ 未知参数：$1（用 --help 看用法）"; exit 2 ;;
  esac
done
ai_root_from_args "$SCRIPTS/../.." "${args[@]+"${args[@]}"}" || { echo "✗ 不在 git 仓库里"; exit 1; }
cd "$AI_ROOT"
AI_DIR="$(ai_dir_of "$AI_ROOT" "$(basename "$(dirname "$SCRIPTS")")")"
SRC="$AI_DIR/jaSkills"
case "$AGENT" in
  claude) DIRS=(".claude/skills") ;; codex) DIRS=(".agents/skills") ;; all) DIRS=(".claude/skills" ".agents/skills") ;;
  *) echo "✗ --agent 只接受 claude / codex / all，收到：$AGENT"; exit 2 ;;
esac
if [[ ! -d "$SRC" ]]; then
  echo "✗ 找不到技能真源 $AI_ROOT/$SRC —— 停下，把这句话反馈给用户：分支可能还没合入，或者目录被改名/删除了" >&2
  exit 1
fi

run() { if (( DRY )); then echo "  [dry-run] $*"; else "$@"; fi; }
is_windows=0
case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) is_windows=1 ;; esac
# Git Bash 的 ln -s 默认把目标整个复制一份还报成功（PA-060）：nativestrict 只建原生链接，建不了就失败，再退到 junction
if (( is_windows )); then export MSYS=winsymlinks:nativestrict CYGWIN=winsymlinks:nativestrict; fi
make_link() {   # make_link <相对目标> <链接路径>
  local target="$1" link="$2" abs
  if (( DRY )); then echo "  [dry-run] 链接 $link → $target"; return; fi
  if ln -s "$target" "$link" 2>/dev/null && [[ -L "$link" ]]; then return; fi
  if (( is_windows )); then
    abs="$(cygpath -w "$(cd "$(dirname "$link")" && cd "$target" && pwd)")"
    if cmd //c mklink /J "$(cygpath -w "$link")" "$abs" > /dev/null; then echo "  （没有符号链接权限，建的是 junction）"; return; fi
  fi
  echo "✗ 建不成链接 $link → ${target}；不会用复制代替，请开 Windows 开发者模式或手动建 junction" >&2
  exit 1
}

whole=0; item=0; replaced=0; kept=0; copied=0
link_dir() {   # 技能目录（深度固定为 2：.claude/skills）建成链接
  local dir="$1" whole_rel="../$SRC" item_rel="../../$SRC" src name dest
  if [[ -L "$dir" ]]; then
    if [[ -e "$dir" && "$(cd "$dir" && pwd -P)" == "$AI_ROOT/$SRC" ]]; then
      echo "= $dir 已是指向 $SRC 的链接"; kept=$((kept + 1)); return
    fi
    echo "↻ $dir 是悬空/指错的链接（→ $(readlink "$dir")），重建"; run rm "$dir"
  elif [[ -d "$dir" ]]; then
    if [[ -z "$(find "$dir" -mindepth 1 -maxdepth 1 ! -name .DS_Store -print -quit)" ]]; then
      echo "↻ $dir 是空真目录，换成整目录链接"; run rm -rf "$dir"
    else
      echo "＋ $dir 是非空真目录，按件追加链接（不在真源里的条目保留）"
      for src in "$SRC"/*/; do
        name="$(basename "$src")"; dest="$dir/$name"
        if [[ -L "$dest" ]]; then
          if [[ "$(readlink "$dest")" == "$item_rel/$name" ]]; then kept=$((kept + 1)); continue; fi
          run rm "$dest"
        elif [[ -e "$dest" ]]; then
          echo "  ⚠ 同名条目 $dest 是真目录/文件，已替换成链接（原内容删除）"; run rm -rf "$dest"; replaced=$((replaced + 1))
        fi
        make_link "$item_rel/$name" "$dest"; item=$((item + 1))
      done
      return
    fi
  elif [[ -e "$dir" ]]; then
    echo "↻ $dir 是文件，挪开为 $dir.bak 再建链接"; run mv "$dir" "$dir.bak"
  fi
  run mkdir -p "$(dirname "$dir")"
  make_link "$whole_rel" "$dir"; whole=$((whole + 1))
  echo "✓ $dir → $whole_rel"
}

copy_tree() {   # copy_tree <源目录（带尾斜杠）> <目标目录>
  if (( DRY )); then echo "  [dry-run] 复制 $1 → $2"; return; fi
  if command -v rsync >/dev/null 2>&1; then rsync -a --delete --exclude='.DS_Store' "$1" "$2/"
  else rm -rf "$2"; mkdir -p "$2"; cp -R "$1". "$2/"; fi
}
copy_dir() {   # 技能目录里放每个技能的副本（Multica）
  local dir="$1" src name dest rel leftover n
  [[ -L "$dir" ]] && { echo "= $dir 是整目录链接（本机建的），不换成副本"; kept=$((kept + 1)); return; }
  run mkdir -p "$dir"
  for src in "$SRC"/*/; do
    name="$(basename "$src")"; dest="$dir/$name"; rel="../../$SRC/$name"
    if [[ -L "$dest" ]]; then
      if [[ "$(readlink "$dest")" == "$rel" ]]; then kept=$((kept + 1)); continue; fi
      run rm "$dest"   # 指错地方的旧链接：删链接不碰内容
    fi
    copy_tree "$src" "$dest"; copied=$((copied + 1))
  done
  for leftover in "$dir"/*/; do
    [[ -d "$leftover" ]] || continue
    n="$(basename "$leftover")"
    [[ -d "$SRC/$n" ]] || echo "⚠ $leftover 在真源 $SRC/ 里不存在，已保留未动"
  done
}

for d in "${DIRS[@]}"; do
  if (( COPY )); then copy_dir "$d"; else link_dir "$d"; fi
done
if (( COPY )); then
  echo "✓ 技能（复制）：复制 $copied 个 · 保留链接 $kept 条$( ((DRY)) && echo '（dry-run）')"
else
  echo "✓ 技能（链接）：整目录链接 $whole · 按件链接 $item · 替换同名 $replaced · 原样保留 $kept$( ((DRY)) && echo '（dry-run）')"
fi
