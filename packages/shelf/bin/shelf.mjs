#!/usr/bin/env node
import { cmdList } from "../lib/commands/list.mjs";
import { cmdPull } from "../lib/commands/pull.mjs";
import {
  cmdShelfBrowse,
  cmdShelfPull,
  cmdShelfPush,
  cmdShelfCreate,
  cmdShelfInit,
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
  shelf init             初始化工作区（.shelf.json + shelf-ops 手册）

  shelf skills list      技能包清单（原 atk list）
  shelf skills sync      整包同步 common 技能到 ./.claude/skills/（原 atk pull）

货架定位：SHELF_HOME 环境变量 > 本 clone > ~/.shelfrc {"home"|"remote"}
免 clone 直跑：npx -y -p github:Jackzz119/my-workspace shelf <命令>
（读操作用包内快照；push/create 自动走临时 clone）`);
}

const argv = process.argv.slice(2);
const sub = argv[0];

async function dispatch(sub, rest) {
  switch (sub) {
    case undefined:
    case "browse":
      return cmdShelfBrowse();
    case "pull":
      if (rest.length === 0) {
        console.log("（无参数 pull = 老的整包技能同步，等价于 shelf skills sync；按路径拉取用 shelf pull <路径>）");
        return cmdPull();
      }
      return cmdShelfPull(rest);
    case "create":
      return cmdShelfCreate(rest);
    case "push":
      return cmdShelfPush(rest);
    case "init":
      return cmdShelfInit(rest);
    case "skills": {
      const action = rest[0];
      if (action === "list") return cmdList();
      if (action === "sync") return cmdPull();
      console.error(`用法: shelf skills list | shelf skills sync`);
      process.exit(1);
      break;
    }
    case "list":
      console.log("（shelf list = shelf skills list；浏览货架直接运行 shelf）");
      return cmdList();
    case "shelf":
      // 旧语法 atk shelf <cmd> 兼容：剥掉一层再派发
      return dispatch(rest[0], rest.slice(1));
    case "-h":
    case "--help":
    case "help":
      return usage();
    default:
      console.error(`Unknown command: ${sub}\n`);
      usage();
      process.exit(1);
  }
}

try {
  await dispatch(sub, argv.slice(1));
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
