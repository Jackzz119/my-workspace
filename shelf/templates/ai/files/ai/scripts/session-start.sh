#!/usr/bin/env bash
#
# session-start.sh —— 会话开场钩子：会话一开就把 AI 工作流同步到货架最新，主检出、worktree 开的会话都同步。
# AI 工作流模板（货架 templates/ai）的一部分，由 shelf init 装到 <ai>/scripts/；模板的 .claude/settings.json（Claude Code）
# 与 .codex/hooks.json（Codex）在 SessionStart 上调它，项目里已有这两份配置时 shelf init 只补上缺的钩子。
#
# 会话在哪个检出：读钩子输入 JSON 的 cwd。桌面版 worktree 会话的钩子在主检出里启动（$CLAUDE_PROJECT_DIR 指向主检出），
# 只有 cwd 是那个 worktree；cwd 读不到（终端里手动跑、旧版客户端）或不在同一个仓库，就按本脚本所在的检出算。
# 两遍同步（用户 2026-11-18 定：主检出、worktree 开会话都要同步），都可重复执行，失败只报告、不挡开场：
#   · worktree 那一遍（会话开在 linked worktree 时），用那个 worktree 自己 <ai>/scripts/ 下的脚本：
#       a. protocol-mirror.sh --sync：根目录协议副本是从主检出复制来的，可能是旧的；没人改过就先换成本分支正本，免得 shelf init 停在「副本领先」
#       b. shelf init（按账本补齐链接、副本、缺的货，给已有的钩子配置补上缺的钩子）→ shelf sync（装模板新增的货，货架新版且本地没动的更新到本地）
#       c. sync-worktree.sh：补技能链接、对齐协议副本、补环境配置，再跑项目的 worktree.local.sh（没装 shelf 时只有这一步）
#       改到的已跟踪文件算本会话的改动：随本轮任务一起提交、推送，提交信息写明来自货架同步。
#   · 主检出那一遍（每次都跑）：protocol-mirror.sh --sync → shelf init → shelf sync。桌面版 worktree 会话的技能、设置、钩子都从
#       主检出读，主检出不同步，新会话读到的就是旧技能。改到的文件留在主检出、本会话不提交：上游带上同样内容后由
#       sync-main-checkout.sh 丢掉再快进；上游一直没有的，在某个 worktree 会话里专门提交一次。只有账本 .shelf.json 的记账字段变了
#       （文件一个没变）就把账本还原，主检出不白白变脏。主检出有进行中的 merge / rebase / cherry-pick 时不动；
#       几个会话同时开场时只有一个真正跑（锁在主检出的 git 目录，快进脚本也用这把锁），其余跳过。
#   shelf sync 都不带 --merge / --push：双改和冲突留给人，推货架等任务做完再说。
# 开头先查一次 npm 上的 shelf 最新版，本机旧了就升级（没网 / 超时就用现有版本；同时开场的会话只有拿到锁的那个升级）。
# 最后请 Claude Code 重扫技能（reloadSkills），本会话当场用上同步后的技能。
#
# 输出：Claude 侧是一段 JSON（reloadSkills + 给 agent 看的摘要）；Codex 侧是纯文本摘要。
# 环境变量：SESSION_START_SKIP_SHELF=1 跳过升级与 shelf 两步；SHELF_NPM_PKG 指定 shelf 的 npm 包名。
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
    -h|--help) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) shift ;;
  esac
done

# 钩子输入：标准输入是终端（手动跑）就不读；管道迟迟不关也只等 2 秒，不卡开场
INPUT=""; line=""
if [[ ! -t 0 ]]; then
  while IFS= read -r -t 2 line || [[ -n "$line" ]]; do INPUT+="$line"$'\n'; line=""; done
fi
field() {   # 取钩子输入里的字符串字段（不依赖 jq）；还原 JSON 转义的 \\ 与 \/
  printf '%s' "$INPUT" | tr -d '\r\n' | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1 \
    | sed -e 's#\\/#/#g' -e 's#\\\\#\\#g'
}

notes=()
keep_lines() {   # 只留结论行（✓ ⚠ ✗ ↻ ＋ →），最多 12 行，免得把整段日志塞进上下文
  grep -E '^[[:space:]]*(✓|⚠|✗|↻|＋|→|!)' | grep -v '下一步：从头读一遍' | head -n 12
}
add_lines() { while IFS= read -r l; do [[ -n "$l" ]] && notes+=("$l"); done < <(printf '%s\n' "$1" | keep_lines); }
shelf_items() {  # shelf 把待决逐件列成「  · 物品（状态）→ 下一步命令」，最多带 6 件
  while IFS= read -r l; do [[ -n "$l" ]] && notes+=("  $l"); done < <(printf '%s\n' "$1" | grep -E '^[[:space:]]+·.*→' | sed 's/^[[:space:]]*//' | head -n 6)
}
run_t() { local s="$1"; shift; if command -v timeout >/dev/null 2>&1; then timeout "$s" "$@"; else "$@"; fi; }
toplevel() { local d; d="$(git -C "$1" rev-parse --show-toplevel 2>/dev/null)" && [[ -n "$d" ]] && (cd "$d" 2>/dev/null && pwd -P); }
common_dir() { (cd "$1" 2>/dev/null && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P); }
changes_of() { git -C "$1" status --porcelain --untracked-files=all 2>/dev/null | sort; }
ai_dir_of() {    # ai 资料区目录名：账本 aiDir，没有就取本脚本所在的那一层（脚本装在 <ai>/scripts/ 下）
  local a; a="$(sed -n 's/^[[:space:]]*"aiDir"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1/.shelf.json" 2>/dev/null | head -n 1 || true)"
  printf '%s' "${a:-$(basename "$(dirname "$SCRIPTS")")}"
}

# 锁：mkdir 是原子操作（macOS 默认没有 flock）。持有的进程已经不在、或锁放了 10 分钟以上，算残留，清掉重拿一次
LOCKS=()
release_locks() { local l; for l in "${LOCKS[@]+"${LOCKS[@]}"}"; do rm -rf "$l"; done; }
trap release_locks EXIT
take_lock() {    # take_lock <锁目录>：拿到返回 0，别人正拿着返回 1
  local lock="$1" pid
  if mkdir "$lock" 2>/dev/null; then echo $$ > "$lock/pid"; LOCKS+=("$lock"); return 0; fi
  pid="$(cat "$lock/pid" 2>/dev/null || true)"
  if [[ -n "$(find "$lock" -maxdepth 0 -mmin +10 2>/dev/null)" ]] || { [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; }; then
    rm -rf "$lock"
    if mkdir "$lock" 2>/dev/null; then echo $$ > "$lock/pid"; LOCKS+=("$lock"); return 0; fi
  fi
  return 1
}
lock_of() { printf '%s/ai-shelf-sync.lock' "$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null)"; }

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SELF_ROOT="$(toplevel "$SCRIPTS")"
SESSION_ROOT=""
cwd_in="$(field cwd)"
if [[ -n "$cwd_in" && -d "$cwd_in" ]]; then
  SESSION_ROOT="$(toplevel "$cwd_in")"
  # 只认同一个仓库里的检出（公共 git 目录相同）：钩子挂在别处、cwd 落在别的仓库时，按脚本所在的检出算
  if [[ -n "$SESSION_ROOT" && -n "$SELF_ROOT" && "$(common_dir "$SESSION_ROOT")" != "$(common_dir "$SELF_ROOT")" ]]; then SESSION_ROOT=""; fi
fi
[[ -n "$SESSION_ROOT" ]] || SESSION_ROOT="$SELF_ROOT"
MAIN_ROOT=""
if [[ -n "$SESSION_ROOT" ]]; then
  MAIN_ROOT="$(git -C "$SESSION_ROOT" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
  [[ -n "$MAIN_ROOT" ]] && MAIN_ROOT="$(cd "$MAIN_ROOT" 2>/dev/null && pwd -P)"
fi

has_shelf=0; command -v shelf >/dev/null 2>&1 && has_shelf=1
use_shelf=$has_shelf; [[ "${SESSION_START_SKIP_SHELF:-0}" == "1" ]] && use_shelf=0

# 一遍同步：sync_pass <检出> <worktree|main>，结论追加进 notes
sync_pass() {
  local root="$1" kind="$2" ai scripts before after changed n list out rc
  ai="$(ai_dir_of "$root")"; scripts="$root/$ai/scripts"
  if (( use_shelf )) && [[ -f "$root/.shelf.json" ]]; then
    # a. 先把旧协议副本换掉（只换没人改过的）
    [[ -f "$scripts/protocol-mirror.sh" ]] && bash "$scripts/protocol-mirror.sh" --sync --agent all >/dev/null 2>&1 </dev/null
    # b. 按账本补齐，再同步到货架最新
    before="$(changes_of "$root")"
    out="$(cd "$root" && shelf init --text 2>&1 </dev/null)"; rc=$?
    (( rc == 0 || rc == 2 )) || { notes+=("⚠ shelf init 退出码 $rc，没补齐"); add_lines "$out"; }   # 2 = 有待决，下面 sync 会逐件列出
    # shelf 2.2 起 init 会给已有的钩子配置补上模板里缺的钩子：补了什么、哪份读不懂，都报出来
    while IFS= read -r l; do [[ -n "$l" ]] && notes+=("$l（新钩子从下一个会话起生效）"); done < <(printf '%s\n' "$out" | grep -E '^[[:space:]]*✓.*模板里缺的钩子' | sed 's/^[[:space:]]*//' | head -n 4)
    while IFS= read -r l; do [[ -n "$l" ]] && notes+=("$l"); done < <(printf '%s\n' "$out" | grep -E '^[[:space:]]*!.*没补模板里的钩子' | sed 's/^[[:space:]]*//' | head -n 4)
    out="$(cd "$root" && shelf sync --text 2>&1 </dev/null)"; rc=$?
    case $rc in
      0) ;;
      2) notes+=("⚠ shelf sync 有待决（退出码 2）：没自动处理的物品逐件列在下面，按 shelf-ops 处理"); shelf_items "$out" ;;
      3) notes+=("✗ shelf sync 有冲突（退出码 3）：冲突的物品没动，按 shelf-ops 处理"); shelf_items "$out" ;;
      *) notes+=("⚠ shelf sync 退出码 $rc，没同步成"); add_lines "$out" ;;
    esac
    after="$(changes_of "$root")"
    changed="$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$after") | sed 's/^...//' | grep -v '^$' || true)"
    # 主检出：只有账本的记账字段（模板提交号、拉取时间）变了、文件一个没变，就还原账本，主检出不白白带着改动
    if [[ "$kind" == main && "$changed" == ".shelf.json" ]] && ! printf '%s\n' "$before" | grep -q ' \.shelf\.json$'; then
      if git -C "$root" restore --worktree -- .shelf.json 2>/dev/null; then changed=""; fi
    fi
    if [[ -n "$changed" ]]; then
      n="$(printf '%s\n' "$changed" | wc -l | tr -d ' ')"
      list="$(printf '%s\n' "$changed" | head -n 8 | awk 'NR > 1 { printf " · " } { printf "%s", $0 }')"
      (( n > 8 )) && list+=" 等"
      if [[ "$kind" == worktree ]]; then
        notes+=("→ 货架同步改了 $n 个文件，算本会话的改动：随本轮任务一起提交、推送，提交信息写明来自 shelf sync：$list")
      else
        notes+=("→ 货架同步改了主检出的 $n 个文件：留在主检出，本会话不提交、不还原；上游带上同样内容后 sync-main-checkout.sh 会丢掉它们再快进（上游一直没有的，在某个 worktree 会话里专门提交一次）：$list")
      fi
    else
      notes+=("✓ 货架同步没有改到文件")
    fi
  elif (( ! has_shelf )); then
    if [[ "$kind" == worktree ]]; then notes+=("⚠ 没装 shelf，只跑保底脚本；AI 工作流停在本分支的版本")
    else notes+=("⚠ 没装 shelf，主检出没同步"); fi
  elif [[ ! -f "$root/.shelf.json" ]]; then
    notes+=("= 没有账本 .shelf.json（这个检出还没接 AI 工作流），不跑 shelf")
  fi
  # c. 保底脚本：链接、协议副本、环境配置、项目补充步骤（只在 worktree 里跑；主检出的这些 shelf init 已经补过）
  if [[ "$kind" == worktree && -f "$scripts/sync-worktree.sh" ]]; then
    out="$(bash "$scripts/sync-worktree.sh" --agent "$AGENT" 2>&1 </dev/null)" || notes+=("⚠ sync-worktree.sh 退出码 $?，见下")
    add_lines "$out"
  fi
}

if [[ -n "$SESSION_ROOT" && -n "$MAIN_ROOT" ]]; then
  in_worktree=0; [[ "$SESSION_ROOT" != "$MAIN_ROOT" ]] && in_worktree=1
  main_lock="$(lock_of "$MAIN_ROOT")"
  got_main=0; take_lock "$main_lock" && got_main=1

  # 1. shelf 自己先升到最新（拿到主检出锁的那个会话才升，免得几个会话同时 npm install -g）
  if (( use_shelf && got_main )); then
    pkg="${SHELF_NPM_PKG:-@jackss119/shelf}"
    cur="$(shelf version --text 2>/dev/null | tr -d '[:space:]')"
    latest=""
    command -v npm >/dev/null 2>&1 && latest="$(run_t 15 npm view "$pkg" version 2>/dev/null </dev/null | tr -d '[:space:]')"
    if [[ -z "$latest" ]]; then
      notes+=("⚠ 查不到 shelf 的最新版（没网或超时），用本机的 ${cur:-未知版本}")
    elif [[ "$cur" != "$latest" && "$(printf '%s\n%s\n' "$cur" "$latest" | sort -V | tail -n 1)" == "$latest" ]]; then
      if run_t 120 npm install -g "$pkg@$latest" --silent >/dev/null 2>&1 </dev/null; then
        notes+=("✓ shelf 升级 $cur → $latest")
      else
        notes+=("⚠ shelf 升级到 $latest 失败，用本机的 $cur")
      fi
    fi
  fi

  # 2. 会话开在 worktree：先同步这个 worktree（同一个 worktree 里同时开场的会话只跑一个）
  if (( in_worktree )); then
    notes+=("【本会话的 worktree：$SESSION_ROOT】")
    if take_lock "$(lock_of "$SESSION_ROOT")"; then sync_pass "$SESSION_ROOT" worktree
    else notes+=("= 另一个会话正在同步这个 worktree，这次跳过"); fi
  fi

  # 3. 主检出：每次都同步（桌面版的技能、设置、钩子从这里读）
  notes+=("【主检出：$MAIN_ROOT$( (( in_worktree )) || printf '（本会话就开在这里）')】")
  main_git="$(git -C "$MAIN_ROOT" rev-parse --absolute-git-dir 2>/dev/null)"
  busy=""
  for f in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply; do [[ -e "$main_git/$f" ]] && busy="$f"; done
  if (( ! got_main )); then
    notes+=("= 另一个会话正在同步主检出，这次跳过")
  elif [[ -n "$busy" ]]; then
    notes+=("⚠ 主检出有进行中的 merge / rebase / cherry-pick（$busy），这次不同步主检出")
  else
    sync_pass "$MAIN_ROOT" main
  fi
fi

ctx=""
if (( ${#notes[@]} )); then
  ctx="会话开场钩子 session-start.sh 已把 AI 工作流同步到货架最新："
  for l in "${notes[@]}"; do ctx+=$'\n'"$l"; done
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
