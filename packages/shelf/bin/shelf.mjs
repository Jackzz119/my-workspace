#!/usr/bin/env node
import fs from "node:fs";
import {
  cmdShelfBrowse,
  cmdShelfLs,
  cmdShelfPull,
  cmdShelfPush,
  cmdShelfCreate,
  cmdShelfSync,
  cmdShelfDiff,
  cmdShelfMerge,
  cmdShelfForget,
  cmdShelfInit,
  cmdShelfAgents,
  cmdShelfAdopt,
  cmdShelfHome,
  cmdShelfTemplate,
} from "../lib/commands/shelf.mjs";
import { run, enableJson, fail, finish, setExit, ShelfExit } from "../lib/output.mjs";
import { COMMANDS, ORDER, EXIT_CODES, parseArgs, usageText, commandHelp } from "../lib/spec.mjs";

const VERSION = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

function cmdVersion(argv) {
  parseArgs("version", argv);
  console.log(VERSION);
  run.data = { version: VERSION };
}

function cmdHelp(argv) {
  const name = argv.find((a) => !a.startsWith("-"));
  if (name && !COMMANDS[name]) fail(1, `✗ 没有 '${name}' 这个命令（shelf help 看全部）`);
  if (run.json) {
    run.data = {
      version: VERSION,
      commands: (name ? [name] : ORDER).map((n) => ({ name: n, ...COMMANDS[n], flags: Object.keys(COMMANDS[n].flags) })),
      globalFlags: ["--json", "--text", "--help"],
      output: "终端里是文字；输出不是终端时默认 JSON（--json / --text / SHELF_OUTPUT=json|text 强制）",
      exitCodes: EXIT_CODES,
    };
    return;
  }
  console.log(name ? commandHelp(name) : usageText());
}

const HANDLERS = {
  browse: cmdShelfBrowse,
  ls: cmdShelfLs,
  status: (a) => cmdShelfSync(a, { status: true }),
  sync: cmdShelfSync,
  diff: cmdShelfDiff,
  merge: cmdShelfMerge,
  pull: cmdShelfPull,
  push: cmdShelfPush,
  create: cmdShelfCreate,
  forget: cmdShelfForget,
  template: cmdShelfTemplate,
  init: cmdShelfInit,
  agents: cmdShelfAgents,
  adopt: cmdShelfAdopt,
  home: cmdShelfHome,
  version: cmdVersion,
  help: cmdHelp,
};
const ALIASES = { "--version": "version", "-v": "version", "--help": "help", "-h": "help" };

const raw = process.argv.slice(2);
const argv = raw.filter((a) => a !== "--json" && a !== "--text");

let sub = argv.length === 0 ? "browse" : (ALIASES[argv[0]] ?? argv[0]);
let rest = argv.slice(1);
// shelf <命令> --help / -h → 该命令的用法
if (HANDLERS[sub] && sub !== "help" && (rest.includes("--help") || rest.includes("-h"))) {
  rest = [sub];
  sub = "help";
}
run.command = sub;

// 输出：给人（终端）是文字，给 agent / 脚本（输出不是终端）默认 JSON；--json / --text / SHELF_OUTPUT 强制。
// version 与 help 天生是给人读的文字，除非显式 --json
const mode = process.env.SHELF_OUTPUT;
const json = raw.includes("--json")
  || (!raw.includes("--text") && sub !== "version" && sub !== "help"
    && (mode === "json" || (mode !== "text" && !process.stdout.isTTY)));
if (json) enableJson();

try {
  if (sub === "skills" || sub === "list") {
    fail(1, `'shelf ${sub}' 已随老版技能命令清退：列货架用 shelf ls，按路径拉取用 shelf pull <路径>，保持最新用 shelf sync`);
  }
  const handler = HANDLERS[sub];
  if (!handler) {
    if (!run.json) console.log(usageText() + "\n");
    fail(1, `Unknown command: ${sub}（shelf help 看全部命令）`);
  }
  await handler(rest);
} catch (err) {
  if (err instanceof ShelfExit) {
    run.error = { message: err.message, ...err.extra };
    setExit(err.code);
  } else {
    run.error = { message: err?.message ?? String(err) };
    setExit(1);
  }
}
finish(VERSION);
