import { stdin, stdout } from "node:process";

// 一次 CLI 调用的运行上下文：输出模式、能否交互、退出码、结构化结果。
// --json 时人读的叙述一律不输出，stdout 只有收尾时那一份 JSON（给 agent / 脚本解析）。
export const run = {
  command: null,
  json: false,
  interactive: stdin.isTTY === true && process.env.SHELF_NONINTERACTIVE !== "1",
  exitCode: 0,
  data: {},
  next: [],
  warnings: [],
  errors: [],
  error: null,
};

const realLog = console.log.bind(console);
const realError = console.error.bind(console);

// 退出码严重度：提交失败 > 一般错误 > 冲突 > 需确认/有待决 > 成功（一次调用里多件物品结果不同时取最重的）
const SEVERITY = { 0: 0, 2: 1, 3: 2, 1: 3, 4: 4 };

export function setExit(code) {
  if ((SEVERITY[code] ?? 3) > (SEVERITY[run.exitCode] ?? 0)) run.exitCode = code;
}

export class ShelfExit extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

// 中止当前命令：message 给人看，code 给脚本 / agent 判断（finally 照常执行，临时目录照常清理）
export function fail(code, message, extra) {
  throw new ShelfExit(code, message, extra);
}

// 记下建议的下一步命令（文本模式在末尾打印「→ 下一步」，--json 放进 next 数组）
export function suggest(...cmds) {
  for (const c of cmds) if (c && !run.next.includes(c)) run.next.push(c);
}

// 命令行里引用路径：含空格等特殊字符才加引号
export function q(p) {
  const s = String(p).replaceAll("\\", "/");
  return /^[\w./@:+=,-]+$/.test(s) ? s : JSON.stringify(s);
}

export function enableJson() {
  run.json = true;
  run.interactive = false;
  console.log = () => {};
  console.warn = (...a) => run.warnings.push(a.join(" "));
  console.error = (...a) => run.errors.push(a.join(" "));
}

// 彩色只给终端里的人：--json、管道、NO_COLOR 一律不上色
export function useColor() {
  return !run.json && stdout.isTTY === true && !process.env.NO_COLOR;
}

export function finish(cliVersion) {
  if (run.json) {
    const envelope = {
      ok: run.exitCode === 0,
      command: run.command,
      exitCode: run.exitCode,
      cliVersion,
      schemaVersion: 1,
      data: run.data,
      next: run.next,
    };
    if (run.warnings.length) envelope.warnings = run.warnings;
    if (run.errors.length) envelope.errors = run.errors;
    if (run.error) envelope.error = run.error;
    stdout.write(JSON.stringify(envelope) + "\n");
  } else {
    if (run.error) realError(run.error.message);
    if (run.next.length) {
      realLog("");
      for (const c of run.next) realLog("→ 下一步: " + c);
    }
  }
  process.exitCode = run.exitCode;
}
