#!/usr/bin/env bash
#
# local-config.sh —— 从主检出补不进 git 的本地配置，只补缺的，最后跑项目自己的 worktree.local.sh（重复执行安全）。
# AI 工作流模板（货架 templates/ai）的一部分，由 shelf 装到 <ai>/scripts/；sync-worktree.sh、bootstrap.sh、会话开场钩子都调它。
#
# 补哪些：仓库根的 .worktreeinclude 是唯一清单（项目自己的植入物；gitignore 语法，语义和 Claude Code / Codex 桌面版一样：
# 匹配清单、而且被 git 忽略的文件）。本检出有 .worktreeinclude 就用它，没有就用主检出的，都没有就按 .env / .env.* 补。
#   - 根目录 CLAUDE.md / AGENTS.md 不归这里（那是协议副本，归 protocol-mirror.sh）
#   - 整个被 git 忽略的目录（node_modules/ 之类）不往里找；清单里写了这个目录本身，才补它里面的文件（最多 200 个）；
#     清单里不带通配符的具体路径（/.claude/settings.json 之类）照样找得到，不管它所在的目录是不是整个被忽略
#   - 入库样板（*.example / *.sample / *.template / *.dist）不补
# 怎么补（沿用原来 .env 的安全规矩）：
#   - 本检出已有（文件或链接）→ 不动，各检出的端口、库可能本来就不同；悬空链接只报告
#   - 目标在本检出没被 git 忽略 → 不补，只报告（免得混进提交）；所在目录不存在、目录本身也没被忽略 → 不补
#   - 主检出那份是指向仓库里的相对链接 → 建同样的链接，目标读不到就不建（不留悬空链接）
#   - 其余（普通文件、指向仓库外的链接）→ 复制成独立文件（权限 600）；内容不读不打印
# .mcp.json（里面有令牌，只管 Claude 侧）单独处理：本检出在主检出里面（桌面版的 .claude/worktrees/<名>）不复制——
#   Claude 会往上读到主检出那份，这里另有一份会盖住它；在主检出外面就缺了补、和主检出不同就换成主检出的。
# --multica（bootstrap.sh 用）：不补 .claude/settings.json、.codex/hooks.json 与 .mcp.json——
#   Multica runtime 不该挂上项目的会话钩子，也不该拿到本机的令牌。
# 本检出就是主检出：不补文件，只跑 worktree.local.sh。
#
# 用法：
#   bash <ai>/scripts/local-config.sh [--root <检出>] [--agent claude|codex|all] [--multica] [--no-local-hook] [--dry-run]
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
source "$SCRIPTS/lib/common.sh"

AGENT="all"; DRY=0; MULTICA=0; LOCAL_HOOK=1
args=("$@")
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT="${2:-}"; shift 2 ;;
    --agent=*) AGENT="${1#*=}"; shift ;;
    --multica) MULTICA=1; shift ;;
    --no-local-hook) LOCAL_HOOK=0; shift ;;
    --dry-run) DRY=1; shift ;;
    --root) shift 2 ;;
    --root=*) shift ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "✗ 未知参数：$1（用 --help 看用法）"; exit 2 ;;
  esac
done
case "$AGENT" in claude|codex|all) ;; *) echo "✗ --agent 只接受 claude / codex / all，收到：$AGENT"; exit 2 ;; esac
ai_root_from_args "$SCRIPTS/../.." "${args[@]+"${args[@]}"}" || { echo "✗ 不在 git 仓库里"; exit 1; }
ROOT="$AI_ROOT"; cd "$ROOT"
AI_DIR="$(ai_dir_of "$ROOT" "$(basename "$(dirname "$SCRIPTS")")")"
MAIN_ROOT="$(ai_main_root "$ROOT" || true)"
[[ "$MAIN_ROOT" == "$ROOT" ]] && MAIN_ROOT=""

copied=0; kept=0; skipped=0; found=0; mcp_state="跳过"

# 链接目标落在本检出里（相对路径、解析后仍在本检出之下）才照建同样的链接；指到外面的复制内容，免得两边共用一份
link_inside_repo() {   # link_inside_repo <链接在本检出里的路径> <链接目标>
  [[ "$2" != /* ]] || return 1
  local dir; dir="$(cd "$(dirname "$1")" && pwd -P)" || return 1
  case "$(cd "$dir" && cd "$(dirname "$2")" 2>/dev/null && pwd -P)/" in "$ROOT"/*) return 0 ;; *) return 1 ;; esac
}

# 补一个文件（相对路径，两边相同）
fill_one() {
  local rel="$1" src="$MAIN_ROOT/$1" parent target
  found=$((found + 1))
  if [[ -L "$rel" && ! -e "$rel" ]]; then
    echo "⚠ ${rel}：是悬空链接（→ $(readlink "$rel")），已保留，请自行检查"; kept=$((kept + 1)); return
  fi
  if [[ -e "$rel" ]]; then kept=$((kept + 1)); return; fi
  parent="$(dirname "$rel")"
  if [[ "$parent" != "." && ! -d "$parent" ]]; then
    # 所在目录本身被 git 忽略（.claude/、.codex/ 之类）才建；否则多半是本分支没有的目录
    if git check-ignore -q "$parent/"; then
      if (( DRY )); then echo "  [dry-run] 建目录 $parent"; else mkdir -p "$parent"; fi
    else
      echo "⚠ ${rel}：本检出没有它所在的目录，跳过"; skipped=$((skipped + 1)); return
    fi
  fi
  if ! git check-ignore -q "$rel"; then
    echo "⚠ ${rel}：在本检出没被 git 忽略，不补（免得混进提交）"; skipped=$((skipped + 1)); return
  fi
  if [[ -L "$src" ]] && target="$(readlink "$src")" && link_inside_repo "$rel" "$target"; then
    if (( DRY )); then echo "  [dry-run] 链接 $rel → $target"; copied=$((copied + 1)); return; fi
    ln -s "$target" "$rel"
    if [[ ! -e "$rel" ]]; then
      rm "$rel"; echo "⚠ ${rel}：链接目标 $target 在本检出读不到，不建悬空链接"; skipped=$((skipped + 1)); return
    fi
    echo "✓ $rel → ${target}（照主检出建同样的链接）"
  elif [[ -r "$src" && ! -d "$src" ]]; then
    if (( DRY )); then echo "  [dry-run] 复制 $rel"; else (umask 077; cp -L "$src" "$rel"); fi
    echo "✓ 复制 ${rel}（来自主检出，独立文件，内容不输出）"
  else
    echo "⚠ ${rel}：主检出那份读不了，跳过"; skipped=$((skipped + 1)); return
  fi
  copied=$((copied + 1))
}

# 清单里不带通配符的具体路径（主检出里有的）：整个目录被 git 忽略时 ls-files 只列目录名，这些文件要单独列出来
literal_paths() {   # literal_paths <清单文件>
  local line p
  [[ -n "$1" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    case "$line" in ''|'#'*|'!'*|*'*'*|*'?'*|*'['*|*/) continue ;; esac
    p="${line#/}"
    if [[ -f "$MAIN_ROOT/$p" || -L "$MAIN_ROOT/$p" ]]; then printf '%s\0' "$p"; fi
  done < "$1"
}

# 清单：本检出的 .worktreeinclude → 主检出的 → 默认 .env / .env.*
fill_from_list() {
  local list="" label matcher rel n
  if [[ -f "$ROOT/.worktreeinclude" ]]; then list="$ROOT/.worktreeinclude"; label=".worktreeinclude"
  elif [[ -f "$MAIN_ROOT/.worktreeinclude" ]]; then list="$MAIN_ROOT/.worktreeinclude"; label="主检出的 .worktreeinclude"
  else label="默认的 .env / .env.*"; fi
  # 用一个空的临时仓库当匹配器：它的忽略规则只有这份清单，git check-ignore 按 gitignore 语法判（含 ! 取反、目录尾斜杠）
  matcher="$(mktemp -d "${TMPDIR:-/tmp}/ai-local-config.XXXXXX")"
  git -C "$matcher" init -q 2>/dev/null
  if [[ -n "$list" ]]; then cp "$list" "$matcher/.git/info/exclude"; else printf '.env\n.env.*\n' > "$matcher/.git/info/exclude"; fi
  # 主检出里被 git 忽略的东西：--directory 把整个被忽略的目录收成一行（node_modules/ 之类），几十毫秒列完；按路径排序，根 .env 先于 app 下的链接
  while IFS= read -r -d '' rel; do
    case "$rel" in CLAUDE.md|AGENTS.md|.mcp.json) continue ;; esac
    if (( MULTICA )); then case "$rel" in .claude/settings.json|.codex/hooks.json) continue ;; esac; fi
    case "${rel##*/}" in *.example|*.sample|*.template|*.dist) continue ;; esac
    if [[ "$rel" == */ ]]; then
      n=0
      while IFS= read -r f; do
        n=$((n + 1)); (( n > 200 )) && { echo "⚠ ${rel} 里超过 200 个文件，只补了前 200 个；要整目录请写进 worktree.local.sh"; break; }
        fill_one "${f#./}"
      done < <(cd "$MAIN_ROOT" && find "${rel%/}" -type f ! -name .DS_Store 2>/dev/null | sort)
    else
      fill_one "$rel"
    fi
  done < <({ git -C "$MAIN_ROOT" ls-files -z --others --ignored --exclude-standard --directory 2>/dev/null; literal_paths "$list"; } \
             | sort -zu | git -C "$matcher" check-ignore -z --no-index --stdin 2>/dev/null || true)
  rm -rf "$matcher"
  if (( ! found )); then
    if [[ -n "$list" ]]; then echo "= 本地配置：主检出里没有 $label 列出、被 git 忽略的文件"
    else echo "= 环境配置：主检出里没有被 git 忽略的 .env 类文件"; fi
  fi
}

fill_mcp_json() {   # 只管 Claude 侧；令牌换过就以主检出为准
  local name=".mcp.json"
  if [[ ! -f "$MAIN_ROOT/$name" ]]; then mcp_state="无源"; return; fi
  if [[ "$ROOT" == "$MAIN_ROOT"/* ]]; then
    if [[ -e "$name" ]]; then
      echo "⚠ ${name}：本检出在主检出里面，本来就读得到主检出那份；这里另有一份会盖住它（令牌换过就过期），不需要就删掉"
      mcp_state="嵌套·另有一份"
    else
      mcp_state="嵌套·不需要"
    fi
    return
  fi
  if [[ ! -e "$name" ]]; then
    echo "✓ 复制 ${name}（来自主检出；含令牌，.gitignore 已忽略它）"
    (( DRY )) || (umask 077; cp "$MAIN_ROOT/$name" "$name"); mcp_state="已复制"; return
  fi
  if cmp -s "$MAIN_ROOT/$name" "$name"; then mcp_state="已一致"; return; fi
  echo "↻ $name 和主检出不同（比如令牌换过），换成主检出的版本（原内容删除）"
  (( DRY )) || cp "$MAIN_ROOT/$name" "$name"; mcp_state="已更新"
}

if [[ -z "$MAIN_ROOT" ]]; then
  echo "= 本地配置：本检出就是主检出，它就是真源"
else
  fill_from_list
  if (( ! MULTICA )) && [[ "$AGENT" != codex ]]; then fill_mcp_json; fi
  echo "✓ 本地配置：补 $copied / 已有 $kept / 跳过 $skipped · .mcp.json $mcp_state$( ((DRY)) && echo '（dry-run）')"
fi

# 项目自己的补充步骤（模板植入一个空壳，之后归项目、不对账）：比如给 app 建指向根 .env 的链接。主检出里同样会跑
hook="$ROOT/$AI_DIR/scripts/worktree.local.sh"
if (( LOCAL_HOOK )) && [[ -f "$hook" ]]; then
  if (( DRY )); then echo "  [dry-run] 会跑项目补充步骤 $AI_DIR/scripts/worktree.local.sh"
  else echo "→ 项目补充步骤：$AI_DIR/scripts/worktree.local.sh"; MAIN_ROOT="$MAIN_ROOT" bash "$hook"; fi
fi
