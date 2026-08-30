#!/usr/bin/env node
import {
  cmdShelfBrowse,
  cmdShelfPull,
  cmdShelfPush,
  cmdShelfCreate,
  cmdShelfSync,
  cmdShelfInit,
  cmdShelfHome,
} from "../lib/commands/shelf.mjs";

function usage() {
  console.log(`shelf — 个人内容货架 CLI（别名 atk）

Usage:
  shelf                  交互浏览货架（数字进目录，p 1,3-5 拉取，a 全部）
  shelf pull <路径...>    按路径拉取，如 shelf pull skills/common/intj
                         [--dest <目录>]
  shelf create <本地路径> 上架新货：全架查重名，交互选位（m <名> 建目录，
                         d 放下）[--to <货架目录>] [--yes]
  shelf push <本地路径>   更新已有货：按记账/名字自动定位
                         [--yes] [--force] [--force-secret]
  shelf sync [--dry-run] 按账本对账：库上新版自动更新本地；本地有改动
                         则显示 diff 由你决定推上库还是覆盖本地
  shelf init             项目接入（幂等）：CLAUDE/AGENTS 协议、ai/JASKILL 名册、
                         .claude+.agents 双技能目录、gitignore、记账本
  shelf home [--update]  查看货架在哪、什么模式；--update 拉取最新

货架定位：SHELF_HOME 环境变量 > 本 clone > ~/.shelfrc > 托管档口 ~/.shelf/home
免 clone 直跑：npx -y -p github:Jackzz119/my-workspace shelf <命令>`);
}

const argv = process.argv.slice(2);
const sub = argv[0];
const rest = argv.slice(1);

try {
  switch (sub) {
    case undefined:
    case "browse":
      await cmdShelfBrowse();
      break;
    case "pull":
      await cmdShelfPull(rest);
      break;
    case "create":
      await cmdShelfCreate(rest);
      break;
    case "push":
      await cmdShelfPush(rest);
      break;
    case "sync":
      await cmdShelfSync(rest);
      break;
    case "init":
      await cmdShelfInit(rest);
      break;
    case "home":
      await cmdShelfHome(rest);
      break;
    case "-h":
    case "--help":
    case "help":
      usage();
      break;
    case "skills":
    case "list":
      console.error(`'shelf ${sub}' 已随老版技能命令清退：浏览用 shelf，按路径拉取用 shelf pull <路径> --dest .claude/skills，保持最新用 shelf sync`);
      process.exit(1);
      break;
    default:
      console.error(`Unknown command: ${sub}\n`);
      usage();
      process.exit(1);
  }
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
