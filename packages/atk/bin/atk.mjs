#!/usr/bin/env node
import { cmdList } from "../lib/commands/list.mjs";
import { cmdPull } from "../lib/commands/pull.mjs";
import { cmdShelf } from "../lib/commands/shelf.mjs";

function usage() {
  console.log(`atk — agent-toolkit CLI

Usage:
  atk list              List skills in the common pack
  atk pull              Pull common pack into ./.claude/skills/
                        (interactive on existing skills)

  atk shelf             Browse the shelf interactively
                        (enter dirs by number, p 1,3-5 to pull, a = all)
  atk shelf pull <p...> Pull shelf entries by path, e.g.
                        atk shelf pull skills/common/intj agents/claude
  atk shelf push <path> Push a local file/folder back to the shelf
                        [--to <shelf path>] [--yes] [--force] [--force-secret]
  atk shelf init        Prepare this workspace: manifest + shelf-ops skill

Shelf location: ATK_HOME env > this clone > ~/.atkrc {"home"|"remote"}

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
    case "shelf":
      await cmdShelf(process.argv.slice(3));
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
