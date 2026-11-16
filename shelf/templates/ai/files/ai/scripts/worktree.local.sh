#!/usr/bin/env bash
#
# <ai>/scripts/worktree.local.sh —— 项目自己的 worktree 补充步骤。
#
# 模板只植入这个空壳，之后归项目：写本项目特有、通用脚本不管的东西，shelf 不再对账。
# 谁调它：同目录的 sync-worktree.sh 与 bootstrap.sh 补完技能链接、协议副本、环境配置以后跑它，
# 调用方式 `MAIN_ROOT="$MAIN_ROOT" bash <ai>/scripts/worktree.local.sh`，当前目录是要补的那个检出；
# 主检出里也会跑（这时 MAIN_ROOT 为空）；调用方 --dry-run 时不跑它。
#
# 写进来的步骤要做到：重复执行安全（已有的不动）；主检出里什么都不改；缺东西时说清楚缺什么，不静默失败。
# 常见的补法：没有依赖目录就按锁文件安装、从主检出复制被 git 忽略的本地配置（预览服务定义等）、
# 给子目录建指向根 .env 的链接。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

echo "= worktree.local：本项目没有补充步骤"
