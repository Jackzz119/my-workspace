#!/usr/bin/env bash
#
# sync-worktree.sh —— worktree（或任何新检出）开工第一步：把技能链接、协议文档和 MCP 配置就地补齐。
# AI 工作流模板（货架 templates/ai）的一部分，由 shelf init 装到 <ai>/scripts/；
# 机器上装了 shelf 的，直接 `shelf init` 效果相同（还会按账本和货架对账）。本脚本不需要 shelf、不联网。
#
# 为什么需要它：`.claude/skills` `.agents/skills` 和根目录 CLAUDE.md / AGENTS.md 都是 gitignored，
# git worktree add 只材料化 tracked 文件，所以新 worktree 里既没有技能链接也没有协议文档。
# Claude Code / Codex 桌面版建的 worktree 会按仓库根 `.worktreeinclude` 把两份协议复制过来，
# 但技能链接谁都不带；Multica、Codex CLI `--worktree`、手动 `git worktree add` 则什么都不带。
# 本脚本是所有这些路径的保底，重复执行安全。
#
# ai 资料区目录名取账本 .shelf.json 的 aiDir（.NET / C# 项目是 AI），没有账本就取本脚本所在的那一层（脚本装在 <ai>/scripts/ 下）。
#
# 做什么：
#   1. 技能目录（Claude 读 .claude/skills，Codex 读 .agents/skills）
#      - 不存在 / 悬空链接 / 空真目录  → 建一条整目录 symlink → ../<ai>/jaSkills
#      - 已是指向 <ai>/jaSkills 的 symlink → 不动
#      - 非空真目录（项目没 ignore 这个目录时会这样）→ 追加：真源里每个技能补一条按件链接，
#        同名条目替换成链接（原内容删除并报告），不在真源里的条目原样保留
#   2. 协议文档（根目录 CLAUDE.md / AGENTS.md 是副本，正本在 <ai>/jaAgents/，入库）
#      源 = 主检出根目录的同名文件（本目录是 worktree 时）；没有则用 <ai>/jaAgents/ 的正本
#      - 根目录没有 → 原样创建
#      - 已有且已包含源内容（比如 .worktreeinclude 复制来的）→ 不动
#      - 已有但内容不同 → 把源内容 append 在原文下面，用 BEGIN/END 标记包住；再跑只替换标记块
#      - 本目录就是主检出且根目录已有 → 不动（正本与副本的一致由 shelf init / sync 维护）
#   3. MCP 配置 .mcp.json（gitignored，里面有令牌；只管 Claude 侧，Codex 不读它）
#      源 = 主检出根目录的 .mcp.json；本目录就是主检出、或主检出没有这个文件 → 跳过
#      - 本目录在主检出里面（桌面版的 .claude/worktrees/<名>）→ 不复制：Claude 会逐级往上读到主检出那份；
#        这里若另有一份会盖住它（令牌换过就过期），只报告不删
#      - 本目录在主检出外面：没有 → 复制；和主检出一致 → 不动；不一致（比如令牌换过）→ 换成主检出的
#   4. <ai>/jaSkills 不存在 → 退出码 1，把错误原文反馈给用户，不要自己猜着建
#
# 用法：
#   bash ai/scripts/sync-worktree.sh                # 两个 agent 都补
#   bash ai/scripts/sync-worktree.sh --agent claude # 只补 Claude 侧（.claude/skills + CLAUDE.md + .mcp.json）
#   bash ai/scripts/sync-worktree.sh --agent codex  # 只补 Codex 侧（.agents/skills + AGENTS.md）
#   bash ai/scripts/sync-worktree.sh --dry-run      # 只报告，不动手
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"   # <ai>/scripts → 仓库根
cd "$ROOT"

AI_DIR="$(sed -n 's/^[[:space:]]*"aiDir"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' .shelf.json 2>/dev/null | head -n 1 || true)"
if [[ -z "$AI_DIR" ]]; then
  AI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && basename "$(pwd -P)")"   # 本脚本就在 <ai>/scripts/ 下
fi
SRC_SKILLS="$AI_DIR/jaSkills"
SRC_DOCS_FALLBACK="$AI_DIR/jaAgents"
BEGIN_MARK="<!-- BEGIN sync-worktree"
END_MARK="<!-- END sync-worktree -->"

AGENT="all"; DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT="${2:-}"; shift 2 ;;
    --agent=*) AGENT="${1#*=}"; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,34p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "✗ 未知参数：$1（用 --help 看用法）"; exit 2 ;;
  esac
done
case "$AGENT" in
  claude) SIDES=("claude") ;; codex) SIDES=("codex") ;; all) SIDES=("claude" "codex") ;;
  *) echo "✗ --agent 只接受 claude / codex / all，收到：$AGENT"; exit 2 ;;
esac

if [[ ! -d "$SRC_SKILLS" ]]; then
  echo "✗ 找不到技能真源 $ROOT/$SRC_SKILLS —— 停下，把这句话反馈给用户：分支可能还没合入，或者目录被改名/删除了" >&2
  exit 1
fi

# 主检出 = git worktree list 的第一行；本目录就是主检出时为空
MAIN_ROOT="$(git worktree list --porcelain 2>/dev/null | awk 'NR==1 && $1=="worktree" {print $2}')"
if [[ -n "$MAIN_ROOT" && "$(cd "$MAIN_ROOT" 2>/dev/null && pwd -P)" == "$ROOT" ]]; then MAIN_ROOT=""; fi

run() { if (( DRY )); then echo "  [dry-run] $*"; else "$@"; fi; }

# Git Bash 的 ln -s 默认把目标整个复制一份，还报成功（PA-060）。nativestrict 让它只建原生链接，建不了就失败；
# 失败时（没开开发者模式、没有建符号链接的权限）退到 junction，junction 不要权限。两样都不成就报错，绝不留一份副本。
is_windows=0
case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) is_windows=1 ;; esac
if (( is_windows )); then export MSYS=winsymlinks:nativestrict CYGWIN=winsymlinks:nativestrict; fi
make_link() {   # make_link <相对目标> <链接路径>
  local target="$1" link="$2"
  if (( DRY )); then echo "  [dry-run] 链接 $link → $target"; return; fi
  if ln -s "$target" "$link" 2>/dev/null && [[ -L "$link" ]]; then return; fi
  if (( is_windows )); then
    local abs; abs="$(cygpath -w "$(cd "$(dirname "$link")" && cd "$target" && pwd)")"
    if cmd //c mklink /J "$(cygpath -w "$link")" "$abs" > /dev/null; then echo "  （没有符号链接权限，建的是 junction）"; return; fi
  fi
  echo "✗ 建不成链接 $link → ${target}；不会用复制代替，请开 Windows 开发者模式或手动建 junction" >&2
  exit 1
}

links_whole=0; links_item=0; replaced=0; kept=0
sync_skills_dir() {
  local dir="$1"                     # .claude/skills 或 .agents/skills（深度固定为 2）
  local whole_rel="../$SRC_SKILLS"   # 从 .claude/ 指向 <ai>/jaSkills
  local item_rel="../../$SRC_SKILLS" # 从 .claude/skills/ 指向 <ai>/jaSkills

  if [[ -L "$dir" ]]; then
    if [[ -e "$dir" && "$(cd "$dir" && pwd -P)" == "$ROOT/$SRC_SKILLS" ]]; then
      echo "= $dir 已是指向 $SRC_SKILLS 的链接"; kept=$((kept+1)); return
    fi
    echo "↻ $dir 是悬空/指错的链接（→ $(readlink "$dir")），重建"
    run rm "$dir"
  elif [[ -d "$dir" ]]; then
    if [[ -z "$(find "$dir" -mindepth 1 -maxdepth 1 ! -name .DS_Store -print -quit)" ]]; then
      echo "↻ $dir 是空真目录，换成整目录链接"
      run rm -rf "$dir"
    else
      echo "＋ $dir 是非空真目录，按件追加链接（不在真源里的条目保留）"
      local src name dest
      for src in "$SRC_SKILLS"/*/; do
        name="$(basename "$src")"; dest="$dir/$name"
        if [[ -L "$dest" ]]; then
          if [[ "$(readlink "$dest")" == "$item_rel/$name" ]]; then kept=$((kept+1)); continue; fi
          run rm "$dest"
        elif [[ -e "$dest" ]]; then
          echo "  ⚠ 同名条目 $dest 是真目录/文件，已替换成链接（原内容删除）"
          run rm -rf "$dest"; replaced=$((replaced+1))
        fi
        make_link "$item_rel/$name" "$dest"; links_item=$((links_item+1))
      done
      return
    fi
  elif [[ -e "$dir" ]]; then
    echo "↻ $dir 是文件，挪开为 $dir.bak 再建链接"; run mv "$dir" "$dir.bak"
  fi
  run mkdir -p "$(dirname "$dir")"
  make_link "$whole_rel" "$dir"; links_whole=$((links_whole+1))
  echo "✓ $dir → $whole_rel"
}

docs_created=0; docs_appended=0; docs_same=0; docs_missing=0
sync_doc() {
  local name="$1" src=""
  # 本目录就是主检出且根目录已有：不动（正本在 <ai>/jaAgents/，两份的一致由 shelf init / sync 维护）
  if [[ -z "$MAIN_ROOT" && -e "$name" ]]; then
    echo "= $name 已存在（本目录是主检出；正本在 $SRC_DOCS_FALLBACK/）"; docs_same=$((docs_same+1)); return
  fi
  if [[ -n "$MAIN_ROOT" && -f "$MAIN_ROOT/$name" ]]; then src="$MAIN_ROOT/$name"
  elif [[ -f "$SRC_DOCS_FALLBACK/$name" ]]; then src="$SRC_DOCS_FALLBACK/$name"
  else
    echo "⚠ ${name}：主检出根目录和 $SRC_DOCS_FALLBACK/ 都没有，跳过"; docs_missing=$((docs_missing+1)); return
  fi
  local shown_src="${src#$ROOT/}"
  if [[ ! -e "$name" ]]; then
    echo "✓ 创建 ${name}（来自 ${shown_src}）"
    run cp "$src" "$name"; docs_created=$((docs_created+1)); return
  fi
  # 已包含源内容（逐字节相同或作为整段出现）→ 不动
  if cmp -s "$src" "$name" || perl -0777 -e '
      open my $a, "<", $ARGV[0] or exit 1; local $/; my $needle = <$a>;
      open my $b, "<", $ARGV[1] or exit 1; my $hay = <$b>;
      exit(index($hay, $needle) >= 0 ? 0 : 1)' "$src" "$name"; then
    echo "= $name 已包含 $shown_src 的内容"; docs_same=$((docs_same+1)); return
  fi
  local block; block="$(printf '%s: from %s -->\n%s\n%s\n' "$BEGIN_MARK" "$shown_src" "$(cat "$src")" "$END_MARK")"
  if grep -qF "$BEGIN_MARK" "$name"; then
    echo "↻ $name 已有同步块，替换为最新 $shown_src"
    BLOCK="$block"; export BLOCK
    (( DRY )) || perl -0777 -i -pe '
      my $b = quotemeta($ENV{BEGIN_MARK}); my $e = quotemeta($ENV{END_MARK});
      s/$b.*?$e/$ENV{BLOCK}/s' "$name"
  else
    echo "＋ $name 已存在且内容不同，把 $shown_src 追加到原文下面"
    (( DRY )) || printf '\n\n%s\n' "$block" >> "$name"
  fi
  docs_appended=$((docs_appended+1))
}
export BEGIN_MARK END_MARK

mcp_state="跳过"
sync_mcp_json() {
  local name=".mcp.json" main_real=""
  if [[ -z "$MAIN_ROOT" ]]; then
    echo "= ${name}：本目录是主检出，它就是真源"; mcp_state="主检出"; return
  fi
  main_real="$(cd "$MAIN_ROOT" 2>/dev/null && pwd -P)" || true
  if [[ -z "$main_real" || ! -f "$main_real/$name" ]]; then
    echo "⚠ ${name}：主检出没有这个文件，跳过"; mcp_state="无源"; return
  fi
  # Claude Code looks for .mcp.json in the working directory and every parent, so a worktree nested
  # inside the main checkout already sees the main file; a copy here would shadow it and go stale.
  if [[ "$ROOT" == "$main_real"/* ]]; then
    if [[ -e "$name" ]]; then
      echo "⚠ ${name}：本目录在主检出里面，本来就读得到主检出那份；这里另有一份会盖住它（令牌换过就过期），不需要就删掉"
      mcp_state="嵌套·另有一份"
    else
      echo "= ${name}：本目录在主检出里面，Claude 会往上读到主检出那份，不复制"
      mcp_state="嵌套·不需要"
    fi
    return
  fi
  if [[ ! -e "$name" ]]; then
    echo "✓ 复制 ${name}（来自主检出；含令牌，.gitignore 已忽略它）"
    run cp "$main_real/$name" "$name"; mcp_state="已复制"; return
  fi
  if cmp -s "$main_real/$name" "$name"; then
    echo "= $name 已和主检出一致"; mcp_state="已一致"; return
  fi
  echo "↻ $name 和主检出不同（比如令牌换过），换成主检出的版本（原内容删除）"
  run cp "$main_real/$name" "$name"; mcp_state="已更新"
}

for side in "${SIDES[@]}"; do
  case "$side" in
    claude) sync_skills_dir ".claude/skills" ;;
    codex)  sync_skills_dir ".agents/skills" ;;
  esac
done
for side in "${SIDES[@]}"; do
  case "$side" in
    claude) sync_doc "CLAUDE.md" ;;
    codex)  sync_doc "AGENTS.md" ;;
  esac
done
for side in "${SIDES[@]}"; do
  case "$side" in
    claude) sync_mcp_json ;;
  esac
done

echo ""
echo "✓ sync-worktree（agent=$AGENT$( ((DRY)) && echo '，dry-run')）：整目录链接 $links_whole · 按件链接 $links_item · 替换同名 $replaced · 原样保留 $kept ·" \
     "协议 创建 $docs_created / 追加或更新 $docs_appended / 已一致 $docs_same / 无源 $docs_missing · .mcp.json $mcp_state"
for side in "${SIDES[@]}"; do
  case "$side" in
    claude) [[ -f CLAUDE.md ]] && echo "→ 下一步：从头读一遍 ./CLAUDE.md 再开工" || true ;;
    codex)  [[ -f AGENTS.md ]] && echo "→ 下一步：从头读一遍 ./AGENTS.md 再开工" || true ;;
  esac
done
