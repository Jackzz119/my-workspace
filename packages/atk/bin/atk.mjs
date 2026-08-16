#!/usr/bin/env node
import { cmdList } from "../lib/commands/list.mjs";
import { cmdPull } from "../lib/commands/pull.mjs";

function usage() {
  console.log(`atk — agent-toolkit CLI

Usage:
  atk list              List skills in the common pack
  atk pull              Pull common pack into ./.claude/skills/
                        (interactive on existing skills)

(more commands coming: update, diff)`);
}

const sub = process.argv[2];

try {
  switch (sub) {
    case "list":
      await cmdList();
      break;
    case "pull":
      await cmdPull();
      break;
    case undefined:
    case "-h":
    case "--help":
    case "help":
      usage();
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