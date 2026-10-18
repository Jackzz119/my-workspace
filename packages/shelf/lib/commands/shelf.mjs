import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { spawnSync } from "node:child_process";
import {
  resolveShelfContext,
  headCommit,
  remoteUrl,
  commitAndPush,
  refreshManagedHome,
  managedHomeDir,
  DEFAULT_REMOTE,
} from "../transport.mjs";
import { displayName, displayPath, resolveShelfPath, findByBasename } from "../shelfnames.mjs";
import { contentHash } from "../version.mjs";
import { loadManifest, saveManifest, updateShelfEntry } from "../manifest.mjs";
import { choose } from "../prompt.mjs";
import { run, fail, setExit, suggest, q, useColor, ShelfExit } from "../output.mjs";
import { COMMANDS, parseArgs } from "../spec.mjs";
import { diffTrees, statText, colorizePatch } from "../textdiff.mjs";
import {
  readTreeFs,
  readTreeAtCommit,
  mapHash,
  mergeTrees,
  writeTree,
  conflictMarkerFiles,
  MARK_OURS,
  MARK_THEIRS,
  getMergeState,
  setMergeState,
  clearMergeState,
} from "../threeway.mjs";
import { detectAiDir, planScaffold, applyScaffold, projectName } from "../scaffold.mjs";

const IGNORE_NAMES = new Set(["node_modules", ".git", ".DS_Store"]);
const SECRET_PATTERNS = [/^\.env(\..+)?$/i, /\.key$/i, /\.pem$/i, /^auth\.json$/i, /^credentials/i];
const BIG_FILE_BYTES = 50 * 1024 * 1024;
// init 植入一次、之后归项目自己维护的物品：账本标 planted，sync / push 不对账（SHELF 决策 #30）
const PLANTED_KEYS = new Set(["docs/JASKILL.md"]);

// 非 TTY（agent/脚本驱动）时不能挂在交互提问上：自动选安全项
async function safeAsk(question, choices) {
  if (run.interactive) return choose(question, choices);
  const fallback = choices.some((c) => c.key === "k") ? "k" : "s";
  console.log(`${question}→ 非交互环境，自动选 ${fallback}（安全项）`);
  return fallback;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function toPosix(p) {
  return p.replaceAll("\\", "/");
}

function sha7(sha) {
  return sha ? String(sha).slice(0, 7) : "?";
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---- 文件枚举与复制（统一忽略 IGNORE_NAMES）----

function listFilesRecursive(target, base = target) {
  const st = fs.statSync(target);
  if (st.isFile()) return [{ rel: path.basename(target), abs: target, size: st.size }];
  const out = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (IGNORE_NAMES.has(entry.name)) continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full, base));
    else if (entry.isFile()) {
      out.push({ rel: toPosix(path.relative(base, full)), abs: full, size: fs.statSync(full).size });
    }
  }
  return out;
}

function copyFiltered(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (source) => !IGNORE_NAMES.has(path.basename(source)),
  });
}

function fileHashMap(target) {
  const map = new Map();
  const st = fs.statSync(target);
  if (st.isFile()) {
    map.set(path.basename(target), contentHash(target));
    return map;
  }
  for (const f of listFilesRecursive(target)) map.set(f.rel, contentHash(f.abs));
  return map;
}

function diffSummary(fromTarget, toTarget) {
  const a = fs.existsSync(fromTarget) ? fileHashMap(fromTarget) : new Map();
  const b = fs.existsSync(toTarget) ? fileHashMap(toTarget) : new Map();
  const added = [...b.keys()].filter((k) => !a.has(k));
  const removed = [...a.keys()].filter((k) => !b.has(k));
  const changed = [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k));
  return { added, removed, changed };
}

// ---- 目录条目 ----

function listEntries(absDir) {
  const entries = fs.readdirSync(absDir, { withFileTypes: true })
    .filter((e) => !IGNORE_NAMES.has(e.name))
    .map((e) => {
      const full = path.join(absDir, e.name);
      if (e.isDirectory()) {
        const items = fs.readdirSync(full).filter((n) => !IGNORE_NAMES.has(n)).length;
        return { name: e.name, display: displayName(e.name), isDir: true, info: `${items} 项` };
      }
      return { name: e.name, display: displayName(e.name), isDir: false, info: fmtSize(fs.statSync(full).size) };
    });
  entries.sort((x, y) => (x.isDir === y.isDir ? x.display.localeCompare(y.display) : x.isDir ? -1 : 1));
  return entries;
}

// "1,3-5" → 0 基索引数组；非法输入返回 null
function parseIndices(spec, max) {
  const out = new Set();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    const single = part.match(/^(\d+)$/);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      if (a < 1 || b > max || a > b) return null;
      for (let i = a; i <= b; i++) out.add(i - 1);
    } else if (single) {
      const n = Number(single[1]);
      if (n < 1 || n > max) return null;
      out.add(n - 1);
    } else return null;
  }
  return [...out].sort((a, b) => a - b);
}

// ---- 账本与落点 ----

// ai 资料区目录名：账本记了就用记的，否则按项目判（.NET / C# 用 AI，其余用 ai，已有沿用）
function aiDirOf(manifest) {
  return manifest.aiDir ?? detectAiDir(process.cwd()).name;
}

// 项目里技能的唯一正本；所有 agent 技能目录都是指向它的链接（SHELF 决策 #26）
function skillsHomeOf(manifest) {
  return `${aiDirOf(manifest)}/jaSkills`;
}

const samePath = process.platform === "win32" || process.platform === "darwin"
  ? (a, b) => a.toLowerCase() === b.toLowerCase()
  : (a, b) => a === b;

function normRel(p) {
  return toPosix(String(p)).replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}

function shelfAbs(ctx, key) {
  return path.join(ctx.shelfDir, ...key.split("/"));
}

// 输入可以是本地路径（含入库副本、Windows 反斜杠）或货架路径（_ 前缀可省）→ 账本条目
function resolveEntry(manifest, input) {
  const cwd = process.cwd();
  const rel = normRel(path.relative(cwd, path.resolve(cwd, input)));
  for (const [key, entry] of Object.entries(manifest.shelf ?? {})) {
    if (entry.localPath && samePath(normRel(entry.localPath), rel)) return { key, entry, via: "local" };
    if (entry.mirror && samePath(normRel(entry.mirror), rel)) return { key, entry, via: "mirror" };
  }
  const raw = normRel(input);
  const shown = displayPath(raw);
  for (const [key, entry] of Object.entries(manifest.shelf ?? {})) {
    if (key === raw || displayPath(key) === shown) return { key, entry, via: "key" };
  }
  return null;
}

// 非交互要确认时给出的「原样重跑 + 某个开关」
function rerun(flag) {
  const args = process.argv.slice(2).filter((a) => a !== "--json" && a !== flag);
  return ["shelf", ...args.map(q), flag].join(" ");
}

function writeLocal(src, destAbs) {
  fs.rmSync(destAbs, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  copyFiltered(src, destAbs);
}

// 账本条目带入库副本（mirror）时两处一起写（SHELF 决策 #31）
function writeWithMirror(src, destAbs, mirrorRel) {
  writeLocal(src, destAbs);
  if (mirrorRel) writeLocal(src, path.resolve(process.cwd(), mirrorRel));
}

function entryFields(ctx, srcAbs, destAbs) {
  return {
    sourceCommit: headCommit(ctx.root),
    contentHash: contentHash(srcAbs),
    pulledAt: todayISO(),
    localPath: toPosix(path.relative(process.cwd(), destAbs)),
  };
}

// ---- pull ----

function newCounters() {
  return { pulled: 0, updated: 0, skipped: 0, upToDate: 0, blocked: 0, quit: false, items: [] };
}

function printSummary(c) {
  console.log("");
  console.log(
    `Summary: ${c.pulled} pulled, ${c.updated} updated, ${c.skipped} skipped, ${c.upToDate} up-to-date` +
    (c.blocked ? `, ${c.blocked} kept local` : "") +
    (c.quit ? " (quit early)" : ""),
  );
}

function countsOf(c) {
  return { pulled: c.pulled, updated: c.updated, skipped: c.skipped, upToDate: c.upToDate, keptLocal: c.blocked };
}

async function pullEntry(ctx, realRel, manifest, counters, ask, destAbs, opts = {}) {
  const cwd = process.cwd();
  const src = shelfAbs(ctx, realRel);
  const shown = displayPath(realRel);
  const recorded = manifest.shelf?.[realRel];
  const planted = !!(opts.planted || recorded?.planted || PLANTED_KEYS.has(realRel));
  const localPath = toPosix(path.relative(cwd, destAbs));
  const item = { key: realRel, shown, localPath };
  counters.items.push(item);

  const record = () => {
    updateShelfEntry(manifest, realRel, { ...entryFields(ctx, src, destAbs), ...(planted ? { planted: true } : {}) });
    clearMergeState(cwd, realRel);
  };
  const install = () => {
    writeWithMirror(src, destAbs, recorded?.mirror);
    record();
  };

  if (!fs.existsSync(destAbs)) {
    install();
    console.log(`✓ pulled ${shown}` + (planted ? `（植入 ${localPath}，之后归项目维护）` : ""));
    counters.pulled++;
    item.action = "pulled";
    return;
  }
  if (opts.force) {
    install();
    console.log(`✓ 已用货架版本覆盖 ${localPath}` + (planted ? "（重新植入）" : ""));
    counters.updated++;
    item.action = "overwritten";
    return;
  }
  if (planted) {
    if (!recorded) record();
    console.log(`= ${localPath} 已存在：植入物归项目维护，不覆盖（要重新植入: shelf pull ${realRel} --force）`);
    counters.upToDate++;
    item.action = "planted-kept";
    return;
  }

  const upstreamHash = contentHash(src);
  const localHash = contentHash(destAbs);
  if (upstreamHash === localHash) {
    if (!recorded || recorded.contentHash !== upstreamHash || recorded.localPath !== localPath) record();
    console.log(`= up to date ${shown}`);
    counters.upToDate++;
    item.action = "up-to-date";
    return;
  }
  const upstreamChanged = !recorded || recorded.contentHash !== upstreamHash;
  const localChanged = !recorded || recorded.contentHash !== localHash;

  // 只有货架变了：本地没动过，更新零损失（非交互直接更新）
  if (upstreamChanged && !localChanged) {
    if (run.interactive) {
      const act = await ask(`↑ ${shown} 货架有更新。[u]pdate / [s]kip / [q]uit? `, [{ key: "u" }, { key: "s" }, { key: "q" }]);
      if (act === "q") {
        counters.quit = true;
        return;
      }
      if (act === "s") {
        console.log(`- skipped ${shown}`);
        counters.skipped++;
        item.action = "skipped";
        return;
      }
    }
    install();
    console.log(`✓ updated ${shown}`);
    counters.updated++;
    item.action = "updated";
    return;
  }

  // 本地改过（本地领先 / 双改 / 没记过账的同名文件）：非交互保留本地并报告，交互由人选
  item.state = !recorded ? "untracked-differs" : upstreamChanged ? "both-changed" : "local-ahead";
  if (!run.interactive) {
    const why = { "untracked-differs": "本工作区没有它的账，内容和货架不同", "both-changed": "本地改过，货架也有更新", "local-ahead": "本地改过，货架没变" };
    console.log(`! ${shown}：${why[item.state]}——保留本地，没覆盖`);
    counters.blocked++;
    item.action = "kept-local";
    return;
  }
  const keepPrompt = item.state === "local-ahead";
  const act = await ask(
    keepPrompt
      ? `! ${shown} 本地有改动，货架无更新。[k]eep / [o]verwrite / [q]uit? `
      : `⚠ ${shown} 货架和本地都改过。[u]pdate(覆盖本地) / [s]kip / [q]uit? `,
    keepPrompt ? [{ key: "k" }, { key: "o" }, { key: "q" }] : [{ key: "u" }, { key: "s" }, { key: "q" }],
  );
  if (act === "u" || act === "o") {
    install();
    console.log(`✓ updated ${shown}`);
    counters.updated++;
    item.action = "overwritten";
  } else if (act === "s" || act === "k") {
    console.log(`- skipped ${shown}`);
    counters.skipped++;
    item.action = "kept-local";
  } else {
    counters.quit = true;
  }
}

// 没记过账的物品落哪：技能（带 SKILL.md）在已接入的项目里进技能正本，其余落当前目录
function defaultDest(manifest, hit) {
  const cwd = process.cwd();
  const name = path.basename(hit.realRel);
  const home = path.resolve(cwd, skillsHomeOf(manifest));
  const isSkill = fs.existsSync(path.join(hit.abs, "SKILL.md"));
  if (isSkill && ((manifest.agents?.length ?? 0) > 0 || fs.existsSync(home))) return path.join(home, name);
  return path.join(cwd, name);
}

// ---- 子命令：pull ----

export async function cmdShelfPull(argv) {
  const { flags, positionals } = parseArgs("pull", argv);
  if (positionals.length === 0) fail(1, "用法: " + COMMANDS.pull.usage);
  const destRoot = flags["--dest"] !== undefined ? path.resolve(process.cwd(), flags["--dest"]) : null;

  const ctx = resolveShelfContext();
  try {
    const manifest = loadManifest();
    manifest.source ??= remoteUrl(ctx.root) || toPosix(ctx.root);
    const counters = newCounters();
    const missing = [];
    for (const input of positionals) {
      if (counters.quit) break;
      const found = resolveEntry(manifest, input);
      let key;
      let destAbs;
      if (found) {
        key = found.key;
        if (!fs.existsSync(shelfAbs(ctx, key))) {
          console.error(`✗ ${displayPath(key)} 在货架上已不在原位（搬家或下架）——跑 shelf sync 处理`);
          missing.push(input);
          setExit(1);
          continue;
        }
        destAbs = destRoot
          ? path.join(destRoot, path.basename(key))
          : path.resolve(process.cwd(), found.entry.localPath ?? path.basename(key));
      } else {
        const hit = resolveShelfPath(ctx.shelfDir, input);
        if (!hit) {
          console.error(`✗ 货架上没有 '${input}'（本工作区账本里也没有）`);
          missing.push(input);
          setExit(1);
          continue;
        }
        key = hit.realRel;
        destAbs = destRoot ? path.join(destRoot, path.basename(key)) : defaultDest(manifest, hit);
      }
      await pullEntry(ctx, key, manifest, counters, safeAsk, destAbs, { force: !!flags["--force"] });
    }
    saveManifest(manifest);
    printSummary(counters);
    run.data = { items: counters.items, counts: countsOf(counters), notFound: missing };
    for (const it of counters.items.filter((i) => i.action === "kept-local")) {
      setExit(2);
      if (it.state === "both-changed") suggest(`shelf diff ${q(it.localPath)}`, `shelf merge ${q(it.localPath)}`);
      else if (it.state === "local-ahead") suggest(`shelf push ${q(it.localPath)}`, `shelf pull ${q(it.localPath)} --force`);
      else suggest(`shelf pull ${q(it.key)} --force`);
    }
  } finally {
    ctx.cleanup();
  }
}

// ---- 子命令：交互浏览器 ----

// readline 在管道输入下会丢弃"无人等待时"到达的行；自带队列保证脚本化驱动可用，EOF 返回 null
function makeLineReader() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const queue = [];
  const waiters = [];
  let closed = false;
  rl.on("line", (line) => {
    if (waiters.length) waiters.shift()(line);
    else queue.push(line);
  });
  rl.on("close", () => {
    closed = true;
    while (waiters.length) waiters.shift()(null);
  });
  return {
    async question(prompt) {
      if (queue.length) {
        const line = queue.shift();
        stdout.write(prompt + line + "\n");
        return line;
      }
      if (closed) return null;
      stdout.write(prompt);
      return new Promise((resolve) => waiters.push(resolve));
    },
    close() {
      rl.close();
    },
  };
}

export async function cmdShelfBrowse(argv = []) {
  parseArgs("browse", argv);
  if (run.json) fail(1, "✗ 交互浏览器不支持 --json；列货架用 shelf ls --json");
  const ctx = resolveShelfContext();
  const rl = makeLineReader();
  const askWithRl = async (question, choices) => {
    const keys = choices.map((c) => c.key.toLowerCase());
    while (true) {
      const raw = await rl.question(question);
      if (raw === null) return "q";
      const ans = raw.trim().toLowerCase();
      if (keys.includes(ans)) return ans;
      stdout.write(`  please type one of: ${keys.join(", ")}\n`);
    }
  };

  try {
    const manifest = loadManifest();
    manifest.source ??= remoteUrl(ctx.root) || toPosix(ctx.root);
    const segs = [];

    while (true) {
      const absDir = path.join(ctx.shelfDir, ...segs);
      const entries = listEntries(absDir);
      const here = segs.length ? displayPath(segs.join("/")) : "";

      console.log("");
      console.log(`shelf:/${here}`);
      if (entries.length === 0) console.log("  (空)");
      entries.forEach((e, i) => {
        console.log(`  ${String(i + 1).padStart(2)}. ${e.isDir ? e.display + "/" : e.display}  (${e.info})`);
      });
      console.log("  [数字]=进入目录 · p 1,3-5=拉取所选 · a=全部拉取 · ..=上级 · q=退出");

      const raw = await rl.question("> ");
      if (raw === null) break;
      const ans = raw.trim();
      if (ans === "q") break;
      if (ans === "..") {
        segs.pop();
        continue;
      }
      if (/^\d+$/.test(ans)) {
        const idx = Number(ans) - 1;
        if (idx < 0 || idx >= entries.length) {
          console.log("  无此编号");
          continue;
        }
        if (!entries[idx].isDir) {
          console.log(`  '${entries[idx].display}' 是文件，用 p ${ans} 拉取`);
          continue;
        }
        segs.push(entries[idx].name);
        continue;
      }
      const pullMatch = ans.match(/^(?:p\s+(.+)|a)$/);
      if (pullMatch) {
        const indices = ans === "a"
          ? entries.map((_, i) => i)
          : parseIndices(pullMatch[1], entries.length);
        if (!indices || indices.length === 0) {
          console.log("  选择无效，例如: p 1,3-5");
          continue;
        }
        const counters = newCounters();
        for (const i of indices) {
          if (counters.quit) break;
          const realRel = [...segs, entries[i].name].join("/");
          const rec = manifest.shelf?.[realRel];
          const destAbs = rec?.localPath
            ? path.resolve(process.cwd(), rec.localPath)
            : defaultDest(manifest, { realRel, abs: path.join(absDir, entries[i].name) });
          await pullEntry(ctx, realRel, manifest, counters, askWithRl, destAbs);
        }
        saveManifest(manifest);
        printSummary(counters);
        continue;
      }
      console.log("  没看懂。数字进入目录，p 加编号拉取，a 全部，.. 上级，q 退出");
    }
  } finally {
    rl.close();
    ctx.cleanup();
  }
}

// ---- 子命令：ls（非交互列货架）----

export async function cmdShelfLs(argv) {
  const { positionals } = parseArgs("ls", argv);
  if (positionals.length > 1) fail(1, "用法: " + COMMANDS.ls.usage);
  const ctx = resolveShelfContext();
  try {
    const manifest = loadManifest();
    let rel = "";
    let abs = ctx.shelfDir;
    if (positionals[0]) {
      const hit = resolveShelfPath(ctx.shelfDir, positionals[0]);
      if (!hit) fail(1, `✗ 货架上没有 '${positionals[0]}'`);
      rel = hit.realRel;
      abs = hit.abs;
    }
    let entries;
    if (fs.statSync(abs).isFile()) {
      entries = [{
        name: displayName(path.basename(rel)),
        path: displayPath(rel),
        type: "file",
        info: fmtSize(fs.statSync(abs).size),
        installed: manifest.shelf?.[rel]?.localPath ?? null,
      }];
    } else {
      entries = listEntries(abs).map((e) => {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        const type = e.isDir ? (fs.existsSync(path.join(abs, e.name, "SKILL.md")) ? "skill" : "dir") : "file";
        return { name: e.display, path: displayPath(childRel), type, info: e.info, installed: manifest.shelf?.[childRel]?.localPath ?? null };
      });
    }
    console.log(`shelf:/${displayPath(rel)}`);
    if (entries.length === 0) console.log("  (空)");
    for (const e of entries) {
      console.log(`  ${e.type === "file" ? e.name : e.name + "/"}  (${e.info}${e.type === "skill" ? " · 技能" : ""})`
        + (e.installed ? `  ✓ 已装 → ${e.installed}` : ""));
    }
    run.data = { path: displayPath(rel), entries };
  } finally {
    ctx.cleanup();
  }
}

// ---- 上架/更新共用 ----

function guardScan(localAbs) {
  const files = listFilesRecursive(localAbs);
  return {
    secrets: files.filter((f) => SECRET_PATTERNS.some((re) => re.test(path.basename(f.rel)))),
    bigs: files.filter((f) => f.size > BIG_FILE_BYTES),
  };
}

// 凭据/大文件安全阀；违规直接中止
function guardFiles(localAbs, forceSecret) {
  const { secrets, bigs } = guardScan(localAbs);
  if (secrets.length > 0 && !forceSecret) {
    for (const s of secrets) console.error(`    ${s.rel}`);
    run.data.secrets = secrets.map((s) => s.rel);
    fail(1, `✗ 疑似凭据文件（见上），已拒绝（--force-secret 可放行）`);
  }
  for (const b of bigs) {
    console.warn(`! 大文件 ${b.rel} (${fmtSize(b.size)})，GitHub 单文件上限 100MB`);
  }
}

function printChangeList(targetAbs, localAbs, shown) {
  const d = diffSummary(targetAbs, localAbs);
  console.log(`将写入 shelf/${shown}：新增 ${d.added.length} / 删除 ${d.removed.length} / 修改 ${d.changed.length}`);
  for (const f of d.added) console.log(`  + ${f}`);
  for (const f of d.removed) console.log(`  - ${f}`);
  for (const f of d.changed) console.log(`  ~ ${f}`);
  return d;
}

// 非交互没带 --yes：清单已打印，退出 2 并给出加 --yes 的原命令
async function confirm(promptText, yes) {
  if (yes) return true;
  if (!run.interactive) {
    console.error(`⏸ 需要确认：清单如上，确认无误后加 --yes 重跑（这次什么都没改）`);
    run.data.needsConfirmation = true;
    setExit(2);
    suggest(rerun("--yes"));
    return false;
  }
  const act = await choose(promptText, [{ key: "y" }, { key: "n" }]);
  if (act === "n") {
    console.log("已中止。");
    return false;
  }
  return true;
}

// 覆盖货架条目并提交；返回 { keepEphemeral, commit }
function applyAndCommit(ctx, key, localAbs, manifest, verb) {
  const targetAbs = shelfAbs(ctx, key);
  const shown = displayPath(key);

  fs.rmSync(targetAbs, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
  copyFiltered(localAbs, targetAbs);

  const message = `shelf: ${verb} ${shown} (from ${os.hostname()})`;
  const result = commitAndPush(ctx.root, [toPosix(path.join("shelf", key))], message);

  let keepEphemeral = false;
  if (result.failed) {
    fail(4, `✗ 提交失败，货架已回滚到改动前: ${result.pushError}`);
  } else if (!result.committed) {
    console.log("= 内容与货架一致，无需提交");
  } else if (result.pushed) {
    console.log(`✓ 已推送 ${shown} (${result.sha.slice(0, 7)})`);
  } else if (result.pushError === "no-remote") {
    console.log(`✓ 已提交 ${shown} (${result.sha.slice(0, 7)})，仓库还没配 remote，配好后 git push 即同步`);
  } else {
    console.warn(`! 已提交 (${result.sha.slice(0, 7)}) 但 push 失败: ${result.pushError}`);
    if (ctx.mode === "ephemeral") {
      keepEphemeral = true;
      ctx.keep?.();
      console.warn(`! 临时 clone 保留在 ${ctx.root}，手动处理后可删除`);
    }
  }

  updateShelfEntry(manifest, key, {
    sourceCommit: result.sha ?? headCommit(ctx.root),
    contentHash: contentHash(targetAbs),
    pulledAt: todayISO(),
    localPath: toPosix(path.relative(process.cwd(), localAbs)),
  });
  clearMergeState(process.cwd(), key);
  manifest.source ??= remoteUrl(ctx.root) || toPosix(ctx.root);
  saveManifest(manifest);
  const commit = { committed: !!result.committed, sha: result.sha ?? null, pushed: !!result.pushed, pushError: result.pushError ?? null };
  return { keepEphemeral, commit };
}

// 多个同名命中时让用户挑一个；非交互直接中止
async function pickAmong(hits, promptLabel) {
  console.log(promptLabel);
  hits.forEach((h, i) => console.log(`  ${i + 1}. ${displayPath(h)}`));
  if (!run.interactive) {
    run.data.candidates = hits.map(displayPath);
    fail(3, `✗ 非交互环境无法选择，已中止。`);
  }
  const act = await choose(
    `选择编号（或 [q]uit）? `,
    [...hits.map((_, i) => ({ key: String(i + 1) })), { key: "q" }],
  );
  if (act === "q") return null;
  return hits[Number(act) - 1];
}

// 正本与入库副本必须一致才往下走；不一致就列出差异停下，不替人选哪份（SHELF 决策 #31）
function assertMirrorInSync(entry) {
  const cwd = process.cwd();
  const localAbs = path.resolve(cwd, entry.localPath);
  const mirrorAbs = path.resolve(cwd, entry.mirror);
  if (!fs.existsSync(mirrorAbs)) {
    suggest(`shelf mirror ${q(entry.localPath)} ${q(entry.mirror)}`);
    fail(1, `✗ 入库副本 ${entry.mirror} 不存在，已停下（重新登记会按正本建出副本）`);
  }
  if (contentHash(mirrorAbs) === contentHash(localAbs)) return;
  const fk = path.basename(entry.localPath);
  const d = diffTrees(readTreeFs(mirrorAbs, fk), readTreeFs(localAbs, fk), { labelA: entry.mirror, labelB: entry.localPath });
  console.error(`✗ ${entry.localPath} 和入库副本 ${entry.mirror} 内容不一致（副本 → 正本）：`);
  console.error(statText(d));
  run.data.mirror = { path: entry.mirror, files: d.files };
  suggest(`git diff --no-index ${q(entry.mirror)} ${q(entry.localPath)}`);
  fail(1, `✗ 已停下，不替你选哪份为准——把两份改成同一内容后再来`);
}

// ---- 子命令：push（更新已有货，SHELF 决策 #15）----

export async function cmdShelfPush(argv) {
  if (argv.includes("--to")) {
    fail(1, "✗ push 不再接受 --to：更新已有条目会自动定位；新内容上架用 shelf create <路径> [--to <目录>]");
  }
  const { flags, positionals } = parseArgs("push", argv);
  const yes = !!flags["--yes"];
  const force = !!flags["--force"];
  const forceSecret = !!flags["--force-secret"];
  if (positionals.length !== 1) fail(1, "用法: " + COMMANDS.push.usage);

  const manifest = loadManifest();
  const found = resolveEntry(manifest, positionals[0]);
  const localAbs = path.resolve(process.cwd(), found?.entry.localPath ?? positionals[0]);
  if (!fs.existsSync(localAbs)) fail(1, `✗ 本地路径不存在: ${found?.entry.localPath ?? positionals[0]}`);
  const localPosix = toPosix(path.relative(process.cwd(), localAbs));
  run.data = { localPath: localPosix };
  if (found?.entry.planted) {
    fail(1, `✗ ${localPosix} 是 init 植入、之后归项目维护的文件（货架 ${displayPath(found.key)}），不推回货架——推上去会把模板变成本项目的内容。`
      + `要改货架上的模板，到货架 clone 里改（shelf home 看位置）`);
  }
  if (found?.entry.mirror) assertMirrorInSync(found.entry);

  const ctx = resolveShelfContext({ forWrite: true });
  let keepEphemeral = false;
  try {
    // 定位链：记账原位 → 原位失效按名字找回 → 无记账按名字匹配 → 指路 create
    let key;
    let record = null;
    let relocatedFrom = null;

    if (found) {
      record = found.entry;
      key = found.key;
      if (!fs.existsSync(shelfAbs(ctx, key))) {
        const name = path.basename(key);
        const hits = findByBasename(ctx.shelfDir, name);
        if (hits.length === 0) {
          fail(1, `✗ 原路径 ${displayPath(key)} 已不存在，货架上也没有同名 '${displayName(name)}'；如是新内容用 shelf create`);
        }
        const target = hits.length === 1
          ? hits[0]
          : await pickAmong(hits, `货架上有多个同名 '${displayName(name)}'：`);
        if (!target) {
          console.log("已中止。");
          return;
        }
        const sameContent = record.contentHash === contentHash(shelfAbs(ctx, target));
        console.log(`↪ ${displayPath(key)} 已被移动到 ${displayPath(target)}${sameContent ? "（内容一致，纯搬家）" : "（且货架侧内容有差异）"}`);
        if (run.interactive && !yes) {
          const act = await choose(`推到新位置并更新记账? [y]es / [n]o? `, [{ key: "y" }, { key: "n" }]);
          if (act === "n") {
            console.log("已中止。");
            return;
          }
        }
        relocatedFrom = key;
        key = target;
      }
    } else {
      const name = path.basename(localAbs);
      const hits = findByBasename(ctx.shelfDir, name);
      if (hits.length === 0) {
        suggest(`shelf create ${q(localPosix)} --to <货架目录>`);
        fail(1, `✗ 货架上没有名为 '${name}' 的条目；新内容上架用 shelf create`);
      }
      key = hits.length === 1
        ? hits[0]
        : await pickAmong(hits, `货架上有多个同名 '${name}'：`);
      if (!key) {
        console.log("已中止。");
        return;
      }
      console.log(`≈ 按名字匹配到货架条目 ${displayPath(key)}（本工作区无 pull 记录）`);
    }

    const targetAbs = shelfAbs(ctx, key);
    const shown = displayPath(key);
    Object.assign(run.data, { key, shown, relocatedFrom });

    guardFiles(localAbs, forceSecret);

    // 冲突保护：货架在我们上次 pull 之后被别的设备改过？merge 过且货架之后没再变的放行
    let merged = null;
    if (fs.existsSync(targetAbs) && record && record.contentHash !== contentHash(targetAbs) && !force) {
      const currentHash = contentHash(targetAbs);
      const ms = getMergeState(process.cwd(), key);
      if (ms && ms.headHash === currentHash) {
        const left = conflictMarkerFiles(readTreeFs(localAbs, path.basename(key)));
        if (left.length) {
          run.data.conflicts = left;
          fail(3, `✗ ${shown} 合并后还有冲突标记没解决：${left.join(", ")}——改好再 push`);
        }
        merged = ms;
        console.log(`↪ 本地已合并货架 ${sha7(ms.headCommit)} 的改动，按合并结果推送`);
      } else if (!run.interactive) {
        const d = diffSummary(localAbs, targetAbs);
        console.error(`  货架相对本地：新增 ${d.added.length} / 删除 ${d.removed.length} / 不同 ${d.changed.length}`);
        for (const f of [...d.added.map((x) => "+ " + x), ...d.removed.map((x) => "- " + x), ...d.changed.map((x) => "~ " + x)]) {
          console.error(`    ${f}`);
        }
        run.data.shelfChanged = d;
        suggest(`shelf diff ${q(localPosix)}`, `shelf merge ${q(localPosix)}`);
        fail(3, `✗ 货架上的 ${shown} 在你上次 pull 之后已被修改（可能来自其他设备），已中止。`
          + (ms ? "你 merge 之后货架又变了，再跑一次 shelf merge。" : "先 shelf diff 看两边各改了什么，再 shelf merge 合并；人工确认要整体覆盖才加 --force。"));
      } else {
        while (true) {
          const act = await choose(
            `⚠ 货架上的 ${shown} 在你上次 pull 之后已被修改（可能来自其他设备）。[d]iff / [f]orce / [a]bort? `,
            [{ key: "d" }, { key: "f" }, { key: "a" }],
          );
          if (act === "a") {
            console.log("已中止，什么都没改。（想保留两边的改动：shelf merge " + localPosix + "）");
            return;
          }
          if (act === "f") break;
          const d = diffSummary(localAbs, targetAbs);
          console.log(`  货架相对本地：新增 ${d.added.length} / 删除 ${d.removed.length} / 不同 ${d.changed.length}`);
          for (const f of d.added) console.log(`    + ${f}`);
          for (const f of d.removed) console.log(`    - ${f}`);
          for (const f of d.changed) console.log(`    ~ ${f}`);
        }
      }
    }

    // 变更清单；内容已一致就只把账本对齐货架当前版本
    const changes = printChangeList(targetAbs, localAbs, shown);
    run.data.changes = changes;
    const total = changes.added.length + changes.removed.length + changes.changed.length;
    if (total === 0 && fs.existsSync(targetAbs)) {
      console.log(`= ${shown} 与货架一致，无需 push（账本已对齐货架当前版本）`);
      if (relocatedFrom) delete manifest.shelf[relocatedFrom];
      updateShelfEntry(manifest, key, {
        sourceCommit: headCommit(ctx.root),
        contentHash: contentHash(targetAbs),
        pulledAt: todayISO(),
        localPath: localPosix,
      });
      clearMergeState(process.cwd(), key);
      saveManifest(manifest);
      return;
    }
    if (!record && fs.existsSync(targetAbs)) console.log(`（货架上已存在 ${shown}，本工作区没有它的 pull 记录：本次 push 会整体覆盖它）`);
    if (!(await confirm(`确认 push? [y]es / [n]o? `, yes))) return;

    if (relocatedFrom) delete manifest.shelf[relocatedFrom];
    const r = applyAndCommit(ctx, key, localAbs, manifest, "update");
    keepEphemeral = r.keepEphemeral;
    run.data.commit = r.commit;
    if (merged) run.data.merged = { headCommit: merged.headCommit };
  } finally {
    if (!keepEphemeral) ctx.cleanup();
  }
}

// ---- 子命令：create（上架新货，SHELF 决策 #14）----

// 选位浏览器：只逛目录，m <名> 新建目录并进入，d 放在当前位置；返回目录相对路径或 null（取消）
async function placementBrowse(ctx) {
  const rl = makeLineReader();
  try {
    const segs = [];
    while (true) {
      const absDir = path.join(ctx.shelfDir, ...segs);
      const exists = fs.existsSync(absDir);
      const entries = exists ? listEntries(absDir).filter((e) => e.isDir) : [];
      const here = segs.length ? displayPath(segs.join("/")) : "";

      console.log("");
      console.log(`放到: shelf:/${here}${exists ? "" : "（新目录，放下时创建）"}`);
      entries.forEach((e, i) => {
        console.log(`  ${String(i + 1).padStart(2)}. ${e.display}/  (${e.info})`);
      });
      console.log("  [数字]=进入 · m <名>=新建目录并进入 · d=放在这里 · ..=上级 · q=取消");

      const raw = await rl.question("> ");
      if (raw === null) return null;
      const ans = raw.trim();
      if (ans === "q") return null;
      if (ans === "d") return segs.join("/");
      if (ans === "..") {
        segs.pop();
        continue;
      }
      if (/^\d+$/.test(ans)) {
        const idx = Number(ans) - 1;
        if (idx < 0 || idx >= entries.length) {
          console.log("  无此编号");
          continue;
        }
        segs.push(entries[idx].name);
        continue;
      }
      const mk = ans.match(/^m\s+(\S+)$/);
      if (mk) {
        segs.push(mk[1]);
        continue;
      }
      console.log("  没看懂。数字进入，m <名> 新建目录，d 放这里，.. 上级，q 取消");
    }
  } finally {
    rl.close();
  }
}

export async function cmdShelfCreate(argv) {
  const { flags, positionals } = parseArgs("create", argv);
  const to = flags["--to"];
  const yes = !!flags["--yes"];
  const forceSecret = !!flags["--force-secret"];

  if (positionals.length !== 1) fail(1, "用法: " + COMMANDS.create.usage);
  const local = positionals[0];
  const localAbs = path.resolve(process.cwd(), local);
  if (!fs.existsSync(localAbs)) fail(1, `✗ 本地路径不存在: ${local}`);
  const name = path.basename(localAbs);
  run.data = { localPath: toPosix(path.relative(process.cwd(), localAbs)) };

  const ctx = resolveShelfContext({ forWrite: true });
  let keepEphemeral = false;
  try {
    // 名字即 ID：全架查重，重名拒绝
    const hits = findByBasename(ctx.shelfDir, name);
    if (hits.length > 0) {
      for (const h of hits) console.error(`    ${displayPath(h)}`);
      run.data.existing = hits.map(displayPath);
      suggest(`shelf push ${q(local)}`);
      fail(1, `✗ 货架上已有同名条目（见上）：想更新它 → shelf push ${local}；想另起一件 → 改个名字再 create。`);
    }

    // 选位：--to 直达（可新建目录），否则交互浏览
    let destDirRel;
    if (to !== undefined) {
      const hit = resolveShelfPath(ctx.shelfDir, to, { allowCreate: true });
      if (!hit) fail(1, `✗ --to 需要一个货架目录，如 --to skills/common`);
      if (!hit.created && fs.statSync(hit.abs).isFile()) {
        fail(1, `✗ --to 必须是货架目录，不能是文件: ${to}`);
      }
      if (hit.created) console.log(`（货架上将新建目录 ${displayPath(hit.realRel)}）`);
      destDirRel = hit.realRel;
    } else {
      if (!run.interactive) {
        suggest(`shelf create ${q(local)} --to <货架目录>`);
        fail(2, `✗ 非交互环境请用 --to <货架目录> 指定位置（如 --to templates）。已中止。`);
      }
      destDirRel = await placementBrowse(ctx);
      if (destDirRel === null) {
        console.log("已取消。");
        return;
      }
    }
    const key = destDirRel ? `${destDirRel}/${name}` : name;
    Object.assign(run.data, { key, shown: displayPath(key) });

    guardFiles(localAbs, forceSecret);
    run.data.changes = printChangeList(shelfAbs(ctx, key), localAbs, displayPath(key));
    if (!(await confirm(`确认上架? [y]es / [n]o? `, yes))) return;

    const manifest = loadManifest();
    const r = applyAndCommit(ctx, key, localAbs, manifest, "add");
    keepEphemeral = r.keepEphemeral;
    run.data.commit = r.commit;
  } finally {
    if (!keepEphemeral) ctx.cleanup();
  }
}

// ---- 三方对比 / 合并共用 ----

function itemContext(ctx, key, entry) {
  const cwd = process.cwd();
  const headAbs = shelfAbs(ctx, key);
  if (!fs.existsSync(headAbs)) {
    suggest("shelf sync");
    fail(1, `✗ ${displayPath(key)} 在货架上已不在原位（搬家或下架）——先跑 shelf sync`);
  }
  if (!entry.localPath) fail(1, `✗ 账本里 ${displayPath(key)} 没有 localPath`);
  const localAbs = path.resolve(cwd, entry.localPath);
  if (!fs.existsSync(localAbs)) {
    suggest(`shelf pull ${q(key)} --force`);
    fail(1, `✗ 本地没有 ${entry.localPath}（重新拉: shelf pull ${key} --force）`);
  }
  return {
    cwd,
    headAbs,
    localAbs,
    isFile: fs.statSync(headAbs).isFile(),
    fileKey: path.basename(key),
    localPath: toPosix(entry.localPath),
  };
}

function printSection(result, stat) {
  if (result.files.length === 0) {
    console.log("  （没有变化）");
    return;
  }
  if (stat) console.log(statText(result));
  else console.log(useColor() ? colorizePatch(result.patch) : result.patch);
}

const DIFF_STATE = {
  same: "一致",
  refreshable: "本地已和货架一致（账本落后，shelf sync 会刷新）",
  merged: "已合并，待推送",
  "both-changed": "双方都改过",
  "shelf-ahead": "货架有更新，本地没动",
  "local-ahead": "本地领先",
};

// ---- 子命令：diff（只读三方对比，SHELF 决策 #28）----

export async function cmdShelfDiff(argv) {
  const { flags, positionals } = parseArgs("diff", argv);
  if (positionals.length !== 1) fail(1, "用法: " + COMMANDS.diff.usage);
  const stat = !!flags["--stat"];
  const manifest = loadManifest();
  const found = resolveEntry(manifest, positionals[0]);
  if (!found) {
    fail(1, `✗ 本工作区账本里没有 '${positionals[0]}'——diff 对比的是「上次拉取的版本」，只对拉取过的物品有效`);
  }
  const { key, entry } = found;

  const ctx = resolveShelfContext({ forWrite: true });
  try {
    const it = itemContext(ctx, key, entry);
    const headSha = headCommit(ctx.root);
    const base = readTreeAtCommit(ctx.root, entry.sourceCommit, key, it.fileKey);
    const head = readTreeFs(it.headAbs, it.fileKey);
    const local = readTreeFs(it.localAbs, it.fileKey);
    const S = contentHash(it.headAbs);
    const L = contentHash(it.localAbs);
    const R = entry.contentHash;
    const upstreamChanged = S !== R;
    const baseMatches = base ? mapHash(base, it.isFile) === R : null;
    const up = base ? diffTrees(base, head, { labelA: `上次拉取 ${sha7(entry.sourceCommit)}`, labelB: `货架 ${sha7(headSha)}` }) : null;
    const out = diffTrees(head, local, { labelA: `货架 ${sha7(headSha)}`, labelB: "本地" });
    const outgoingChanged = out.files.length > 0;
    const ms = getMergeState(it.cwd, key);
    const state = !upstreamChanged && !outgoingChanged ? "same"
      : L === S ? "refreshable"
      : ms && ms.headHash === S ? "merged"
      : upstreamChanged && L !== R ? "both-changed"
      : upstreamChanged ? "shelf-ahead"
      : "local-ahead";

    console.log(`diff ${displayPath(key)} ↔ ${it.localPath}`);
    console.log(`  上次拉取 ${sha7(entry.sourceCommit)} · 货架 HEAD ${sha7(headSha)} · ${DIFF_STATE[state]}`);
    if (base && !baseMatches) console.warn("! 从货架历史重建出的「上次拉取版本」和账本指纹对不上（换行符设置变过？），① 仅供参考");
    console.log("");
    console.log(`① 货架在上次拉取之后改了什么（${sha7(entry.sourceCommit)} → ${sha7(headSha)}）`);
    if (up) printSection(up, stat);
    else if (upstreamChanged) console.log("  （上次拉取的版本在货架历史里取不到，只知道货架变过；② 能看到货架现在和本地的全部差别）");
    else console.log("  （没有变化）");
    console.log("");
    console.log(`② 推上去会改成什么（货架 ${sha7(headSha)} → 本地）`);
    printSection(out, stat);

    const lp = q(it.localPath);
    if (state === "both-changed") suggest(`shelf merge ${lp}`);
    else if (state === "local-ahead" || state === "merged") suggest(`shelf push ${lp}`);
    else if (state === "shelf-ahead" || state === "refreshable") suggest("shelf sync");
    if (state !== "same") setExit(2);

    run.data = {
      key,
      shown: displayPath(key),
      localPath: it.localPath,
      state,
      base: { commit: entry.sourceCommit ?? null, available: !!base, matchesLedger: baseMatches },
      head: { commit: headSha },
      upstream: { changed: upstreamChanged, files: up?.files ?? null, ...(stat ? {} : { patch: up?.patch ?? null }) },
      outgoing: { changed: outgoingChanged, files: out.files, ...(stat ? {} : { patch: out.patch }) },
    };
  } finally {
    ctx.cleanup();
  }
}

// ---- 子命令：merge（三方合并双改物品，SHELF 决策 #29）----

const MERGE_HOW = {
  theirs: "← 取货架",
  "theirs-added": "← 取货架（货架新增）",
  "theirs-deleted": "← 随货架删除",
  ours: "· 留本地",
  "ours-added": "· 留本地（本地新增）",
  "ours-deleted": "· 本地已删",
  merged: "✓ 自动合并",
};
const MERGE_REASON = {
  content: "两边改了同一处，已写入冲突标记",
  "both-added": "两边各自新增了同名文件，已写入冲突标记",
  binary: "二进制文件两边都改了，留的是本地版本",
  "theirs-deleted": "货架删了它、本地改过：留着本地版本，确实不要就删掉",
  "ours-deleted": "本地删了它、货架改过：已放回货架版本，确实不要就再删",
};

async function mergeCore(ctx, key, entry) {
  const it = itemContext(ctx, key, entry);
  const lp = q(it.localPath);
  run.data = { key, shown: displayPath(key), localPath: it.localPath };
  const local = readTreeFs(it.localAbs, it.fileKey);
  const left = conflictMarkerFiles(local);
  if (left.length) {
    run.data.conflicts = left.map((p) => ({ path: p, how: "conflict", reason: "unresolved" }));
    suggest(`shelf push ${lp}`);
    fail(3, `✗ 本地还有上次合并留下的冲突标记没解决：${left.join(", ")}——改好后直接 shelf push ${it.localPath}`);
  }
  const S = contentHash(it.headAbs);
  const L = contentHash(it.localAbs);
  const ms = getMergeState(it.cwd, key);
  if (ms && ms.headHash === S) {
    console.log(`= 已经合并过货架 ${sha7(ms.headCommit)} 的改动，货架之后没再变——直接 push`);
    run.data.state = "already-merged";
    suggest(`shelf push ${lp}`);
    return { conflicts: [] };
  }
  if (L === S) {
    console.log(`= ${it.localPath} 与货架一致，不需要合并（shelf sync 会刷新账本）`);
    run.data.state = "same-as-shelf";
    suggest("shelf sync");
    return { conflicts: [] };
  }
  // 再次合并时以上次合进来的那一版为基准（和 git 的 merge base 前移一样）
  const baseCommit = ms?.headCommit ?? entry.sourceCommit;
  const baseHash = ms?.headHash ?? entry.contentHash;
  if (S === baseHash) {
    console.log(`= 货架在${ms ? "上次合并" : "上次拉取"}之后没变，不需要合并——本地改动直接 push`);
    run.data.state = "shelf-unchanged";
    suggest(`shelf push ${lp}`);
    return { conflicts: [] };
  }
  const base = readTreeAtCommit(ctx.root, baseCommit, key, it.fileKey);
  if (!base) {
    suggest(`shelf diff ${lp}`);
    fail(1, `✗ 取不到合并基准（${ms ? "上次合并" : "上次拉取"}的版本 ${sha7(baseCommit)} 不在货架历史里，或账本没记 sourceCommit）——`
      + `用 shelf diff 看差异、手动合并后 shelf push --force`);
  }
  const headSha = headCommit(ctx.root);
  const res = mergeTrees(base, readTreeFs(it.headAbs, it.fileKey), local, {
    ours: MARK_OURS,
    base: `上次拉取 ${sha7(baseCommit)}`,
    theirs: `${MARK_THEIRS} ${sha7(headSha)}`,
  });
  writeTree(it.localAbs, res.result, { isFile: it.isFile, fileKey: it.fileKey, previous: local });
  if (entry.mirror) writeLocal(it.localAbs, path.resolve(it.cwd, entry.mirror));
  setMergeState(it.cwd, key, { headCommit: headSha, headHash: S, at: todayISO(), conflicts: res.conflicts.map((f) => f.path) });

  console.log(`三方合并 ${displayPath(key)}：基准 ${sha7(baseCommit)}（${ms ? "上次合并" : "上次拉取"}）· 货架 ${sha7(headSha)} · 本地`);
  for (const f of res.files) {
    if (f.how === "conflict") console.log(`  ⚠ 冲突       ${f.path}（${MERGE_REASON[f.reason]}）`);
    else if (MERGE_HOW[f.how]) console.log(`  ${MERGE_HOW[f.how]}  ${f.path}`);
  }
  console.log(`结果已写回 ${it.localPath}${entry.mirror ? ` 与入库副本 ${entry.mirror}` : ""}；账本没动，push 成功后才更新。`);
  const shownFiles = res.files.filter((f) => !["same", "both-same", "both-deleted"].includes(f.how));
  Object.assign(run.data, {
    state: res.conflicts.length ? "conflict" : "merged",
    base: baseCommit,
    head: headSha,
    files: shownFiles,
    conflicts: res.conflicts,
  });
  if (res.conflicts.length) {
    console.log(`✗ ${res.conflicts.length} 个文件要人处理：${res.conflicts.map((f) => f.path).join(", ")}——处理完（冲突标记删干净）再 push`);
    setExit(3);
  } else {
    console.log("✓ 合并干净，可以 push 了");
  }
  suggest(`shelf push ${lp}`);
  return { conflicts: res.conflicts };
}

export async function cmdShelfMerge(argv) {
  const { positionals } = parseArgs("merge", argv);
  if (positionals.length !== 1) fail(1, "用法: " + COMMANDS.merge.usage);
  const manifest = loadManifest();
  const found = resolveEntry(manifest, positionals[0]);
  if (!found) {
    fail(1, `✗ 本工作区账本里没有 '${positionals[0]}'——merge 以「上次拉取的版本」为基准，只对拉取过的物品有效`);
  }
  const { key, entry } = found;
  if (entry.planted || PLANTED_KEYS.has(key)) {
    fail(1, `✗ ${entry.localPath ?? key} 是 init 植入、之后归项目维护的文件，不和货架对账，也不合并（要重新植入: shelf pull ${key} --force）`);
  }
  if (entry.mirror) assertMirrorInSync(entry);
  const ctx = resolveShelfContext({ forWrite: true });
  try {
    await mergeCore(ctx, key, entry);
  } finally {
    ctx.cleanup();
  }
}

// ---- 子命令：forget（清记账，本地文件不动）----

export async function cmdShelfForget(argv) {
  const { positionals } = parseArgs("forget", argv);
  if (positionals.length === 0) fail(1, "用法: " + COMMANDS.forget.usage);
  const manifest = loadManifest();
  const removed = [];
  for (const input of positionals) {
    const found = resolveEntry(manifest, input);
    if (!found) {
      console.error(`✗ 账本里没有 '${input}'`);
      setExit(1);
      continue;
    }
    delete manifest.shelf[found.key];
    clearMergeState(process.cwd(), found.key);
    removed.push({ key: found.key, shown: displayPath(found.key), localPath: found.entry.localPath ?? null });
    console.log(`✓ 已从账本删掉 ${displayPath(found.key)}（本地 ${found.entry.localPath ?? "—"} 原样保留）`);
  }
  if (removed.length) saveManifest(manifest);
  run.data = { removed };
}

// ---- 子命令：mirror（入库副本登记，SHELF 决策 #31）----

function gitIgnores(cwd, rel) {
  return spawnSync("git", ["check-ignore", "-q", "--no-index", rel], { cwd, stdio: "ignore" }).status === 0;
}

export async function cmdShelfMirror(argv) {
  const { flags, positionals } = parseArgs("mirror", argv);
  if (positionals.length === 0 || positionals.length > 2 || (flags["--off"] && positionals.length !== 1)) {
    fail(1, "用法: " + COMMANDS.mirror.usage);
  }
  const cwd = process.cwd();
  const manifest = loadManifest();
  const found = resolveEntry(manifest, positionals[0]);
  if (!found) fail(1, `✗ 账本里没有 '${positionals[0]}'——先 shelf pull 它`);
  const { key, entry } = found;
  run.data = { key, shown: displayPath(key), localPath: entry.localPath ?? null };

  if (flags["--off"]) {
    const was = entry.mirror ?? null;
    delete entry.mirror;
    saveManifest(manifest);
    console.log(was ? `✓ 已取消入库副本登记（${was} 文件本身原样保留）` : "= 本来就没有登记入库副本");
    run.data.mirror = null;
    return;
  }
  if (positionals.length === 1) {
    console.log(entry.mirror ? `${entry.localPath} ↔ 入库副本 ${entry.mirror}` : `${entry.localPath} 没有登记入库副本`);
    run.data.mirror = entry.mirror ?? null;
    return;
  }

  const mirrorRel = normRel(path.relative(cwd, path.resolve(cwd, positionals[1])));
  if (!entry.localPath) fail(1, `✗ 账本里 ${displayPath(key)} 没有 localPath`);
  if (samePath(mirrorRel, normRel(entry.localPath))) fail(1, "✗ 副本不能和正本是同一个路径");
  const localAbs = path.resolve(cwd, entry.localPath);
  const mirrorAbs = path.resolve(cwd, mirrorRel);
  if (!fs.existsSync(localAbs)) fail(1, `✗ 本地没有 ${entry.localPath}`);
  if (fs.existsSync(mirrorAbs)) {
    if (contentHash(mirrorAbs) !== contentHash(localAbs)) {
      const fk = path.basename(entry.localPath);
      const d = diffTrees(readTreeFs(mirrorAbs, fk), readTreeFs(localAbs, fk));
      console.error(statText(d));
      run.data.files = d.files;
      suggest(`git diff --no-index ${q(mirrorRel)} ${q(entry.localPath)}`);
      fail(1, `✗ ${mirrorRel} 和 ${entry.localPath} 内容不同（见上）——先对齐（以哪份为准你定），再登记`);
    }
  } else {
    writeLocal(localAbs, mirrorAbs);
    console.log(`✓ 已按 ${entry.localPath} 建出副本 ${mirrorRel}`);
  }
  entry.mirror = mirrorRel;
  saveManifest(manifest);
  console.log(`✓ 已登记：${entry.localPath} ↔ 入库副本 ${mirrorRel}（pull 两处一起写，push 前核对两处一致）`);
  if (gitIgnores(cwd, mirrorRel)) {
    console.warn(`! ${mirrorRel} 被 .gitignore 忽略了，入库副本进不了 git——多半是写了裸的 ${path.basename(mirrorRel)}，改成 /${path.basename(mirrorRel)} 只忽略根目录那份`);
  }
  run.data.mirror = mirrorRel;
}

// ---- init：gitignore ----

// 规则已在（各种等价写法），或已被更宽的规则盖住（.claude/、.claude/* …）就不补。
// 项目是 git 仓库时直接问 git（check-ignore --no-index），否则按常见父目录写法判断
function ignoreCovered(cwd, line, have) {
  const bare = line.replace(/^\/+/, "").replace(/\/+$/, "");
  if ([line, bare, "/" + bare, bare + "/", "/" + bare + "/"].some((v) => have.has(v))) return true;
  if (gitIgnores(cwd, bare)) return true;
  const segs = bare.split("/");
  for (let i = 1; i < segs.length; i++) {
    const p = segs.slice(0, i).join("/");
    if ([p, p + "/", "/" + p, "/" + p + "/", p + "/*", "/" + p + "/*"].some((v) => have.has(v))) return true;
  }
  return false;
}

// 只忽略 shelf 自己放进来的东西：根协议（写成 /CLAUDE.md，不误伤 ai/jaAgents/CLAUDE.md 这类入库副本）
// 和 agent 技能目录链接（不带结尾 /：链接在 git 眼里不是目录）
function ensureGitignore(cwd, lines) {
  const p = path.join(cwd, ".gitignore");
  const content = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  const have = new Set(content.split("\n").map((l) => l.replace(/\r$/, "").trim()));
  const missing = [...new Set(lines)].filter((l) => !ignoreCovered(cwd, l, have));
  if (missing.length === 0) return [];
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const sep = content === "" || content.endsWith("\n") ? "" : eol;
  fs.writeFileSync(p, content + sep + "# shelf: agent 协议与技能链接不入项目库（真源在货架）" + eol + missing.join(eol) + eol, "utf8");
  return missing;
}

// ---- agent 目标与技能正本（SHELF 决策 #24/#26/#32）----

const AGENT_TARGETS = {
  claude: { skillsDir: ".claude/skills", doc: { input: "agents/claude/CLAUDE.md", dest: "CLAUDE.md" }, ignore: ["/CLAUDE.md", "/.claude/skills"] },
  // Codex 只从 .agents/skills 发现项目技能（cwd 到仓库根逐级扫描，支持链接）
  codex: { skillsDir: ".agents/skills", doc: { input: "agents/codex/AGENTS.md", dest: "AGENTS.md" }, ignore: ["/AGENTS.md", "/.agents/skills"] },
  kimi: { skillsDir: ".kimi/skills", doc: { input: "agents/codex/AGENTS.md", dest: "AGENTS.md" }, ignore: ["/AGENTS.md", "/.kimi/skills"] },
};
const TARGET_PRIORITY = ["claude", "codex", "kimi"];
const LEGACY_CODEX_DIR = ".codex/skills";

// "claude,codex" / "all" → 校验并按固定顺序去重
function parseTargetNames(spec) {
  const names = spec === "all"
    ? [...TARGET_PRIORITY]
    : String(spec).split(",").map((x) => x.trim()).filter(Boolean);
  const bad = names.filter((n) => !AGENT_TARGETS[n]);
  if (bad.length || names.length === 0) {
    fail(1, "✗ 未知 agent 目标: " + (bad.join(", ") || "（空）") + "（可选: " + TARGET_PRIORITY.join(" / ") + " / all）");
  }
  return TARGET_PRIORITY.filter((n) => names.includes(n));
}

async function askTargets(manifest) {
  const rl = makeLineReader();
  try {
    console.log("要接入哪些 agent？（各自的技能目录会链接到正本 " + skillsHomeOf(manifest) + "/）");
    TARGET_PRIORITY.forEach((n, i) => {
      const t = AGENT_TARGETS[n];
      console.log("  " + (i + 1) + ". " + n + "  （" + t.skillsDir + "/ · " + t.doc.dest + "）");
    });
    while (true) {
      const raw = await rl.question("选择编号，逗号分隔（如 1,2）；a=全部 > ");
      if (raw === null) return null;
      const ans = raw.trim().toLowerCase();
      if (ans === "a") return [...TARGET_PRIORITY];
      const idx = parseIndices(ans, TARGET_PRIORITY.length);
      if (idx && idx.length) return idx.map((i) => TARGET_PRIORITY[i]);
      console.log("  没看懂。例如: 1,2 或 a");
    }
  } finally {
    rl.close();
  }
}

// 只删链接本身，绝不递归进目标（junction 在 Windows 上要 rmdir 才删得掉的老版本 Node 也照顾到）
function removeLink(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    fs.rmdirSync(p);
  }
}

function makeLink(target, linkPath) {
  if (process.platform === "win32") fs.symlinkSync(target, linkPath, "junction");
  else fs.symlinkSync(path.relative(path.dirname(linkPath), target), linkPath, "dir");
}

// 实体目录（老式复制镜像 / 外部安装器重建的）并进正本：同名且内容不同就停下、什么都不删
function absorbIntoCanonical(dir, canonical, label) {
  const names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !IGNORE_NAMES.has(e.name)).map((e) => e.name);
  const clashes = names.filter((n) => fs.existsSync(path.join(canonical, n))
    && contentHash(path.join(dir, n)) !== contentHash(path.join(canonical, n)));
  if (clashes.length) {
    console.warn(`! ${label} 是实体目录，其中 ${clashes.join(", ")} 和正本里的同名技能内容不同——没动它。`
      + `先人工对比合并进 ${toPosix(path.relative(process.cwd(), canonical))}/，删掉 ${label} 后再跑 shelf adopt`);
    return "blocked";
  }
  let moved = 0;
  let same = 0;
  for (const n of names) {
    const to = path.join(canonical, n);
    if (fs.existsSync(to)) {
      same++;
      continue;
    }
    fs.cpSync(path.join(dir, n), to, { recursive: true });
    moved++;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  if (moved || same) {
    console.log(`↪ ${label} 原为实体目录：迁入正本 ${moved} 项${same ? `，与正本相同 ${same} 项` : ""}，已替换为链接`);
  }
  return "absorbed";
}

// 把 agent 的技能目录做成指向正本的链接（Windows junction 免管理员 / POSIX 相对 symlink）。
// 返回 "ok"（已正确）/ "created" / "fixed" / "blocked"（实体目录里有冲突内容，没动）
function ensureSkillsLink(cwd, targetName, manifest) {
  const rel = AGENT_TARGETS[targetName].skillsDir;
  const linkPath = path.join(cwd, ...rel.split("/"));
  const canonical = path.resolve(cwd, skillsHomeOf(manifest));
  fs.mkdirSync(canonical, { recursive: true });
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });

  let st = null;
  try { st = fs.lstatSync(linkPath); } catch { st = null; }

  if (st && st.isSymbolicLink()) {
    try {
      if (fs.realpathSync(linkPath) === fs.realpathSync(canonical)) return "ok";
    } catch { /* 断链 → 重建 */ }
    removeLink(linkPath);
  } else if (st && st.isDirectory()) {
    if (absorbIntoCanonical(linkPath, canonical, rel) === "blocked") return "blocked";
  } else if (st) {
    fs.rmSync(linkPath, { force: true });
  }
  makeLink(canonical, linkPath);
  return st ? "fixed" : "created";
}

// 老版 init 给 Codex 建的 .codex/skills（Codex 实际不从这里发现技能）：在不在、是不是我们的
function legacyCodexDir(cwd, manifest) {
  const p = path.join(cwd, ...LEGACY_CODEX_DIR.split("/"));
  let st;
  try { st = fs.lstatSync(p); } catch { return null; }
  const usesCodex = (manifest.agents ?? []).includes("codex");
  if (st.isSymbolicLink()) {
    let pointsHome = false;
    try { pointsHome = fs.realpathSync(p) === fs.realpathSync(path.resolve(cwd, skillsHomeOf(manifest))); } catch { /* 断链 */ }
    return pointsHome || usesCodex ? { p, link: true } : null;
  }
  return st.isDirectory() && usesCodex ? { p, link: false } : null;
}

// 迁到 .agents/skills：链接直接拆；实体目录先把内容并进正本；.codex 空了就一并删
function migrateLegacyCodexDir(cwd, manifest) {
  const legacy = legacyCodexDir(cwd, manifest);
  if (!legacy) return false;
  if (legacy.link) removeLink(legacy.p);
  else if (absorbIntoCanonical(legacy.p, path.resolve(cwd, skillsHomeOf(manifest)), LEGACY_CODEX_DIR) === "blocked") return false;
  const codexDir = path.dirname(legacy.p);
  try {
    if (fs.readdirSync(codexDir).length === 0) fs.rmdirSync(codexDir);
  } catch { /* 留着 */ }
  if ((manifest.agents ?? []).includes("codex")) ensureSkillsLink(cwd, "codex", manifest);
  console.log("↪ Codex 技能目录 .codex/skills → .agents/skills（Codex 只从 .agents/skills 发现项目技能）");
  return true;
}

// init / sync / adopt 的体检：植入物补标记、Codex 目录迁移、技能目录链接与 gitignore
function healthChecks(manifest, { fix = true, links = true } = {}) {
  const cwd = process.cwd();
  const report = { plantedMarked: [], codexMigrated: false, linksFixed: 0, linksBlocked: [], gitignoreAdded: [] };
  for (const [key, rec] of Object.entries(manifest.shelf ?? {})) {
    if (!PLANTED_KEYS.has(key) || rec.planted) continue;
    report.plantedMarked.push(key);
    if (fix) rec.planted = true;
    console.log(`${fix ? "✓" : "·"} ${rec.localPath ?? key} ${fix ? "已标记" : "将标记"}为植入物：之后归项目维护，sync / push 不再对账`);
  }
  if (!fix) {
    if (legacyCodexDir(cwd, manifest)) {
      report.codexMigrated = "pending";
      console.log("· 发现 .codex/skills：sync / init 会把它迁到 .agents/skills（Codex 只从这里发现项目技能）");
    }
    return report;
  }
  report.codexMigrated = migrateLegacyCodexDir(cwd, manifest);
  if (links) {
    const targets = (manifest.agents ?? []).filter((n) => AGENT_TARGETS[n]);
    for (const n of targets) {
      const r = ensureSkillsLink(cwd, n, manifest);
      if (r === "created" || r === "fixed") report.linksFixed++;
      if (r === "blocked") report.linksBlocked.push(AGENT_TARGETS[n].skillsDir);
    }
    report.gitignoreAdded = ensureGitignore(cwd, targets.map((n) => "/" + AGENT_TARGETS[n].skillsDir));
  }
  return report;
}

// 植入引擎（init 与 agents add 共用）：协议文档去重植入 + multica / JASKILL +
// common 技能拉进正本 + 各目标技能目录链接化 + gitignore
async function plantForTargets(ctx, manifest, targets) {
  const cwd = process.cwd();
  const home = skillsHomeOf(manifest);
  const plan = [];
  const seenDoc = new Set();
  for (const n of targets) {
    const doc = AGENT_TARGETS[n].doc;
    if (seenDoc.has(doc.dest)) continue; // codex/kimi 共用 AGENTS.md，只植一份
    seenDoc.add(doc.dest);
    plan.push({ input: doc.input, dest: doc.dest });
  }
  plan.push({ input: "multica", dest: "multica", optional: true });
  plan.push({ input: "docs/JASKILL.md", dest: `${aiDirOf(manifest)}/JASKILL.md`, planted: true });

  const common = resolveShelfPath(ctx.shelfDir, "skills/common");
  if (common) {
    for (const e of fs.readdirSync(common.abs, { withFileTypes: true })) {
      if (!e.isDirectory() || IGNORE_NAMES.has(e.name)) continue;
      plan.push({ input: common.realRel + "/" + e.name, dest: home + "/" + e.name });
    }
  }

  const counters = newCounters();
  for (const item of plan) {
    const hit = resolveShelfPath(ctx.shelfDir, item.input);
    if (!hit) {
      console.log(item.optional
        ? "- 货架上暂无 " + item.input + "，跳过"
        : "✗ 货架上找不到 " + item.input + "（检查货架是否最新）");
      continue;
    }
    // 记过账的物品沿用账上的位置（老项目可能不在标准落点）
    const recorded = manifest.shelf?.[hit.realRel]?.localPath;
    await pullEntry(ctx, hit.realRel, manifest, counters, safeAsk, path.resolve(cwd, recorded ?? item.dest), { planted: item.planted });
  }

  let linksMade = 0;
  const linksBlocked = [];
  for (const n of targets) {
    const r = ensureSkillsLink(cwd, n, manifest);
    if (r === "created" || r === "fixed") linksMade++;
    if (r === "blocked") linksBlocked.push(AGENT_TARGETS[n].skillsDir);
  }

  const added = ensureGitignore(cwd, targets.flatMap((n) => AGENT_TARGETS[n].ignore));
  return { counters, linksMade, linksBlocked, added };
}

function printPlantResult(targets, r, manifest, scaffold) {
  printSummary(r.counters);
  if (r.linksMade) console.log("⛓ 建立/修复链接 " + r.linksMade + " 个");
  for (const b of r.linksBlocked) console.log("⚠ " + b + " 没能换成链接（见上方提示）");
  if (r.added.length) console.log("✓ .gitignore 补行: " + r.added.join(", "));
  if (scaffold?.created.length) console.log("✓ ai 资料区脚手架: " + scaffold.created.join(", "));
  if (r.counters.blocked) console.log(`! ${r.counters.blocked} 件物品本地改过、没覆盖——shelf status 看待决与下一步`);
  console.log("");
  console.log("工作区已接入货架（agent 目标: " + targets.join(" + ") + "）:");
  const docs = [...new Set(targets.map((n) => AGENT_TARGETS[n].doc.dest))].join(" / ");
  console.log("  " + docs + "  工作协议（真源在货架，shelf sync 保持最新）");
  console.log("  " + aiDirOf(manifest) + "/JASKILL.md  项目专属技能登记（植入一次，之后归项目，不对账）");
  console.log("  " + skillsHomeOf(manifest) + "/  技能唯一正本（改技能、拉技能都在这）");
  console.log("  " + targets.map((n) => AGENT_TARGETS[n].skillsDir).join(" · ") + "  → 指向正本的链接");
  console.log("  .shelf.json  记账本（进项目 git，队友 clone 后 shelf init 即还原）");
}

// ---- 子命令：init（SHELF 决策 #21/#24/#33）----

export async function cmdShelfInit(argv = []) {
  const { flags, positionals } = parseArgs("init", argv);
  if (positionals.length) fail(1, "用法: " + COMMANDS.init.usage);

  const ctx = resolveShelfContext();
  try {
    if (path.resolve(process.cwd()) === path.resolve(ctx.root)) {
      fail(1, "✗ 这里就是货架 home 本体，不能对它 init（防止把忽略规则写进货架仓库）");
    }
    const manifest = loadManifest();
    manifest.source ??= remoteUrl(ctx.root) || toPosix(ctx.root);

    let targets;
    if (flags["--agents"] !== undefined) {
      targets = parseTargetNames(flags["--agents"]);
    } else if (manifest.agents?.length) {
      targets = TARGET_PRIORITY.filter((n) => manifest.agents.includes(n));
      console.log("（沿用已配置的 agent 目标: " + targets.join(", ") + "；调整用 shelf agents add 或 --agents）");
    } else if (run.interactive) {
      targets = await askTargets(manifest);
      if (!targets || !targets.length) {
        console.log("已取消。");
        return;
      }
    } else {
      suggest("shelf init --agents claude,codex");
      fail(2, "✗ 非交互环境首次 init 需指定 --agents claude,codex,kimi（或 all）。已中止。");
    }

    // ai 资料区目录名：账本记了就沿用；--ai-dir 指定；否则按项目命名规范判（.NET / C# 用 AI，其余用 ai）
    const aiFlag = flags["--ai-dir"];
    if (aiFlag !== undefined) {
      if (!/^[A-Za-z0-9._-]+$/.test(aiFlag)) fail(1, `✗ --ai-dir 只接受一层目录名（如 ai、AI），收到: ${aiFlag}`);
      if (manifest.aiDir && manifest.aiDir !== aiFlag) {
        fail(1, `✗ 账本记的 ai 资料区是 ${manifest.aiDir}/，换成 ${aiFlag}/ 需要先手动搬家（技能正本、JASKILL 与账本 localPath 一起改）`);
      }
      manifest.aiDir = aiFlag;
    } else if (!manifest.aiDir) {
      const d = detectAiDir(process.cwd());
      manifest.aiDir = d.name;
      console.log(`（ai 资料区: ${d.name}/ —— ${d.reason}；要换用 --ai-dir）`);
    }

    const health = healthChecks(manifest, { fix: true, links: false });
    const result = await plantForTargets(ctx, manifest, targets);
    manifest.agents = targets;

    // 账本还原（2026-08-30 用户确认）：标准植入清单之外、账上有而本地缺失的货架物品一并补拉，
    // 换设备后一条 init 全就位，无需再跑 sync
    let restored = 0;
    for (const [key, rec] of Object.entries(manifest.shelf ?? {})) {
      if (!rec.localPath) continue;
      const destAbs = path.resolve(process.cwd(), rec.localPath);
      if (fs.existsSync(destAbs)) continue;
      const hit = resolveShelfPath(ctx.shelfDir, key);
      if (!hit) {
        console.log("⚠ 账上物品 " + displayPath(key) + " 在货架上已不在原位——跑 shelf sync 处理搬家/下架");
        continue;
      }
      await pullEntry(ctx, hit.realRel, manifest, result.counters, safeAsk, destAbs);
      restored++;
    }

    // ai 资料区脚手架：协议要的 PROJECT / TODO 骨架 + 已装技能要用的目录
    const scaffold = applyScaffold(
      process.cwd(),
      planScaffold(process.cwd(), manifest.aiDir, path.resolve(process.cwd(), skillsHomeOf(manifest))),
      { date: todayISO(), name: projectName(process.cwd()) },
    );

    await reconcileLocalSkills(manifest);
    saveManifest(manifest);
    printPlantResult(targets, result, manifest, scaffold);
    if (restored) console.log("↺ 按账本补还原 " + restored + " 项（标准清单之外）");
    if (result.counters.blocked) suggest("shelf status");
    run.data = {
      aiDir: manifest.aiDir,
      skillsHome: skillsHomeOf(manifest),
      agents: targets,
      items: result.counters.items,
      counts: countsOf(result.counters),
      links: { made: result.linksMade, blocked: result.linksBlocked },
      gitignoreAdded: result.added,
      scaffold,
      restored,
      health,
    };
  } finally {
    ctx.cleanup();
  }
}

// ---- 子命令：agents（查看/添加 agent 目标，SHELF 决策 #24）----

export async function cmdShelfAgents(argv) {
  const { positionals } = parseArgs("agents", argv);
  const manifest = loadManifest();
  const current = TARGET_PRIORITY.filter((n) => (manifest.agents ?? []).includes(n));
  const sub = positionals[0];

  if (sub === undefined) {
    console.log("技能正本: " + skillsHomeOf(manifest) + "/（改技能、拉技能都在这）");
    console.log("已配置:   " + (current.length ? current.join(", ") : "（无——先跑 shelf init）"));
    for (const n of TARGET_PRIORITY) {
      const t = AGENT_TARGETS[n];
      console.log("  " + (current.includes(n) ? "●" : "○") + " " + n + "  " + t.skillsDir + "/ → 链接 · " + t.doc.dest);
    }
    console.log("添加: shelf agents add <名>");
    run.data = {
      skillsHome: skillsHomeOf(manifest),
      configured: current,
      targets: TARGET_PRIORITY.map((n) => ({ name: n, skillsDir: AGENT_TARGETS[n].skillsDir, doc: AGENT_TARGETS[n].doc.dest, configured: current.includes(n) })),
    };
    return;
  }
  if (sub !== "add" || positionals.length < 2) fail(1, "用法: " + COMMANDS.agents.usage);

  const adding = parseTargetNames(positionals.slice(1).join(","));
  const targets = TARGET_PRIORITY.filter((n) => current.includes(n) || adding.includes(n));
  run.data = { before: current, after: targets };
  if (targets.join() === current.join()) {
    console.log("= 目标已包含，无需变更（" + current.join(", ") + "）");
    return;
  }

  const ctx = resolveShelfContext();
  try {
    manifest.aiDir ??= detectAiDir(process.cwd()).name;
    manifest.agents = targets;
    healthChecks(manifest, { fix: true, links: false });
    const result = await plantForTargets(ctx, manifest, targets);
    saveManifest(manifest);
    printPlantResult(targets, result, manifest, null);
    console.log("✓ agent 目标: " + (current.join(", ") || "（无）") + " → " + targets.join(", "));
    run.data.items = result.counters.items;
  } finally {
    ctx.cleanup();
  }
}

// ---- 本地技能台账（SHELF 决策 #27 · 增量对账）----

// local 段维护：在场→刷指纹；升格→移除；缺失→告警但保留记录（仅 adopt 交互提供清账）；
// 新出现的未追踪目录→登记。init / sync / adopt 共用。
async function reconcileLocalSkills(manifest, { allowPrune = false } = {}) {
  const home = skillsHomeOf(manifest);
  const canonical = path.join(process.cwd(), ...home.split("/"));
  const tracked = new Set(
    Object.values(manifest.shelf ?? {}).map((e) => normRel(e.localPath ?? "")),
  );
  const isTracked = (name) => [...tracked].some((t) => samePath(t, home + "/" + name));
  const prev = manifest.local ?? {};
  const next = {};
  const c = { registered: 0, refreshed: 0, missing: 0, graduated: 0 };

  const dirs = fs.existsSync(canonical)
    ? fs.readdirSync(canonical, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !IGNORE_NAMES.has(e.name))
        .map((e) => e.name)
    : [];
  const present = new Set(dirs);

  for (const [name, entry] of Object.entries(prev)) {
    if (isTracked(name)) {
      c.graduated++;
      continue;
    }
    if (present.has(name)) {
      const hash = contentHash(path.join(canonical, name));
      if (hash !== entry.contentHash) c.refreshed++;
      next[name] = { ...entry, contentHash: hash };
      continue;
    }
    c.missing++;
    console.log("⚠ 登记过的本地技能缺失: " + name + "（登记于 " + (entry.addedAt ?? "?")
      + "，上次指纹 " + String(entry.contentHash ?? "").slice(7, 19) + "…）——重装后跑 shelf sync 即恢复入账");
    if (allowPrune && run.interactive) {
      const act = await choose("  [k]保留记录 / [r]清账? ", [{ key: "k" }, { key: "r" }]);
      if (act === "r") continue;
    }
    next[name] = entry;
  }

  for (const name of dirs) {
    if (next[name] || isTracked(name)) continue;
    next[name] = {
      contentHash: contentHash(path.join(canonical, name)),
      addedAt: todayISO(),
      origin: "adopted",
    };
    console.log("✚ 登记本地技能: " + name);
    c.registered++;
  }

  manifest.local = next;
  return c;
}

// JASKILL.md 模板承诺的核对：正本里的项目专属技能（local 段）是否都登记在 JASKILL 表里
function unregisteredLocalSkills(manifest, localNames) {
  const rec = manifest.shelf?.["docs/JASKILL.md"];
  const p = path.resolve(process.cwd(), rec?.localPath ?? `${aiDirOf(manifest)}/JASKILL.md`);
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, "utf8");
  return localNames.filter((name) => !new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(name)}([^A-Za-z0-9_-]|$)`, "m").test(text));
}

// ---- 子命令：adopt（收编外来技能，SHELF 决策 #27）----

export async function cmdShelfAdopt(argv = []) {
  parseArgs("adopt", argv);
  const manifest = loadManifest();
  manifest.aiDir ??= detectAiDir(process.cwd()).name;

  // agent 技能目录若被外部安装器换成了实体目录：内容迁入正本，恢复链接（含老版 .codex/skills 迁移）
  const health = healthChecks(manifest, { fix: true, links: true });
  const c = await reconcileLocalSkills(manifest, { allowPrune: true });
  saveManifest(manifest);

  console.log("");
  console.log(
    "Adopt: " + c.registered + " 新登记, " + c.refreshed + " 指纹更新, " + c.missing + " 缺失保留, "
    + c.graduated + " 已升格/移除, " + health.linksFixed + " 目录收编重链；"
    + "local 段共 " + Object.keys(manifest.local).length + " 个本地技能",
  );
  if (Object.keys(manifest.local).length) {
    console.log("（本地技能不参与货架对账；想跨项目复用: shelf create " + skillsHomeOf(manifest) + "/<名> --to skills/<包>）");
  }
  run.data = { ...c, linksFixed: health.linksFixed, linksBlocked: health.linksBlocked, local: Object.keys(manifest.local) };
}

// ---- 子命令：home（查看/更新档口）----

export async function cmdShelfHome(argv) {
  const { flags } = parseArgs("home", argv);
  if (flags["--update"]) {
    const ok = refreshManagedHome({ force: true });
    if (!ok && !fs.existsSync(managedHomeDir)) {
      console.log("（本机没有托管档口——你用的是自己的 clone 或 npx 快照，更新请用 git pull）");
    } else if (ok) {
      console.log("✓ 托管档口已更新到最新");
    }
  }
  const ctx = resolveShelfContext();
  try {
    const modeText = {
      home: "你自己的 clone",
      managed: "托管档口（shelf 自动维护）",
      snapshot: "npx 包内快照（只读，写操作会走临时 clone）",
      ephemeral: "一次性临时 clone",
    }[ctx.mode] ?? ctx.mode;
    const remote = remoteUrl(ctx.root) ?? DEFAULT_REMOTE;
    console.log(`货架位置: ${ctx.shelfDir}`);
    console.log(`模式:     ${modeText}`);
    console.log(`来源:     ${remote}`);
    const entries = fs.readdirSync(ctx.shelfDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !IGNORE_NAMES.has(e.name))
      .map((e) => displayName(e.name));
    console.log(`根分类:   ${entries.join(" · ") || "(空)"}`);
    run.data = { shelfDir: ctx.shelfDir, mode: ctx.mode, remote, head: headCommit(ctx.root), categories: entries };
  } finally {
    ctx.cleanup();
  }
}

// ---- 子命令：sync / status（按账本与货架对账，SHELF 决策 #19）----

// 逐行内容 diff 直通终端（git 自带着色），方向：库上 → 本地
function showLineDiff(shelfAbsPath, localAbs, shown) {
  console.log(`—— ${shown}  diff（库上 → 本地）——`);
  spawnSync("git", ["diff", "--no-index", "--color=always", "--", shelfAbsPath, localAbs], { stdio: "inherit" });
}

const SYNC_TAG = {
  "local-ahead": "本地领先",
  "both-changed": "双方都改过",
  merged: "已合并，待推送",
  "merge-conflict": "已合并，还有冲突标记没解决",
  removed: "已从货架移除",
  ambiguous: "同名多义",
  "local-missing": "本地文件不存在",
  "mirror-mismatch": "正本与入库副本不一致",
};

export async function cmdShelfSync(argv, { status = false } = {}) {
  const { flags } = parseArgs(status ? "status" : "sync", argv);
  const dryRun = status || !!flags["--dry-run"];
  const cwd = process.cwd();

  const ctx = resolveShelfContext({ forWrite: true }); // 对账必须对着真最新：等同写操作，强制刷新
  let keepEphemeral = false;
  try {
    const manifest = loadManifest();
    if (!dryRun) manifest.aiDir ??= detectAiDir(cwd).name;
    const health = healthChecks(manifest, { fix: !dryRun, links: true });
    const entries = Object.entries(manifest.shelf ?? {});
    if (entries.length === 0) {
      console.log("账本为空（.shelf.json 没有 shelf 段记录）——先 shelf init / pull / create。");
      run.data = { dryRun, items: [], counts: {}, pending: 0, health };
      if (!dryRun) saveManifest(manifest);
      return;
    }

    const c = { same: 0, updated: 0, refreshed: 0, pushed: 0, cleaned: 0, skipped: 0, planted: 0 };
    const items = [];
    const pending = [];
    const pend = (item, state, next) => {
      item.state = state;
      item.next = next;
      pending.push(item);
    };

    for (const [key, rec] of entries) {
      let effKey = key;
      let target = shelfAbs(ctx, effKey);
      const item = { key, shown: displayPath(key), localPath: rec.localPath ?? null };
      items.push(item);
      const lp = q(rec.localPath ?? "");

      // 植入物（JASKILL 这类）：植入后归项目，不对账
      if (rec.planted || PLANTED_KEYS.has(key)) {
        item.state = "planted";
        c.planted++;
        continue;
      }

      const localAbs = path.resolve(cwd, rec.localPath ?? "");
      const localExists = !!rec.localPath && fs.existsSync(localAbs);

      // 情形 5：库上路径没了 → 按名字找回（搬家）或报告下架
      if (!fs.existsSync(target)) {
        const hits = findByBasename(ctx.shelfDir, path.basename(effKey));
        if (hits.length === 1) {
          item.movedTo = hits[0];
          if (dryRun) {
            console.log(`↪ ${item.shown} 已被移动到 ${displayPath(hits[0])}（只读，暂不改账）`);
          } else {
            delete manifest.shelf[effKey];
            manifest.shelf[hits[0]] = rec;
            clearMergeState(cwd, effKey);
            console.log(`↪ ${item.shown} 已被移动到 ${displayPath(hits[0])}，记账已更新`);
          }
          effKey = hits[0];
          target = shelfAbs(ctx, effKey);
          item.key = effKey;
          item.shown = displayPath(effKey);
        } else {
          const state = hits.length === 0 ? "removed" : "ambiguous";
          if (hits.length) item.candidates = hits.map(displayPath);
          if (!run.interactive || dryRun) {
            console.log(`⚠ 待决 ${item.shown}：${SYNC_TAG[state]}${hits.length ? `（${hits.length} 处）` : ""}`);
            pend(item, state, [`shelf forget ${q(key)}`]);
            continue;
          }
          const act = await choose(`⚠ ${item.shown} ${SYNC_TAG[state]}。[r]清记账 / [s]跳过? `, [{ key: "r" }, { key: "s" }]);
          if (act === "r") {
            delete manifest.shelf[effKey];
            clearMergeState(cwd, effKey);
            console.log(`✓ 已清记账 ${item.shown}（本地文件未动；想重新上架用 shelf create）`);
            item.state = "cleaned";
            c.cleaned++;
          } else {
            item.state = "skipped";
            c.skipped++;
          }
          continue;
        }
      }
      const shown = item.shown;

      // 情形 6：本地文件没了 → 孤儿记账
      if (!localExists) {
        if (!run.interactive || dryRun) {
          console.log(`⚠ 待决 ${shown}：本地文件不存在（${rec.localPath ?? "无 localPath"}）`);
          pend(item, "local-missing", [`shelf pull ${q(effKey)} --force`, `shelf forget ${q(effKey)}`]);
          continue;
        }
        const act = await choose(
          `⚠ ${shown} 的本地文件不存在（${rec.localPath ?? "无 localPath"}）。[p]重新拉取 / [r]清记账 / [s]跳过? `,
          [{ key: "p" }, { key: "r" }, { key: "s" }],
        );
        if (act === "p") {
          writeWithMirror(target, localAbs, rec.mirror);
          manifest.shelf[effKey] = { ...rec, contentHash: contentHash(target), sourceCommit: headCommit(ctx.root), pulledAt: todayISO() };
          console.log(`↓ 已重新拉取 ${shown}`);
          item.state = "updated";
          c.updated++;
        } else if (act === "r") {
          delete manifest.shelf[effKey];
          console.log(`✓ 已清记账 ${shown}`);
          item.state = "cleaned";
          c.cleaned++;
        } else {
          item.state = "skipped";
          c.skipped++;
        }
        continue;
      }

      // 入库副本必须和正本一致，否则谁覆盖谁都会丢东西，交给人定
      if (rec.mirror) {
        const mirrorAbs = path.resolve(cwd, rec.mirror);
        item.mirror = rec.mirror;
        if (!fs.existsSync(mirrorAbs) || contentHash(mirrorAbs) !== contentHash(localAbs)) {
          console.log(`⚠ 待决 ${shown}：${rec.localPath} 与入库副本 ${rec.mirror} 不一致（以哪份为准由你定）`);
          pend(item, "mirror-mismatch", fs.existsSync(mirrorAbs)
            ? [`git diff --no-index ${q(rec.mirror)} ${lp}`]
            : [`shelf mirror ${lp} ${q(rec.mirror)}`]);
          continue;
        }
      }

      const S = contentHash(target);
      const L = contentHash(localAbs);
      const R = rec.contentHash;
      const ms = getMergeState(cwd, effKey);

      if (S === R && L === R) {
        item.state = "same";
        c.same++;
        continue;
      }

      // 内容已和货架一致，只是账本落后（别处推了同样的内容 / merge 后结果恰好等于货架）→ 只刷新账本
      if (L === S) {
        item.state = "refreshed";
        c.refreshed++;
        if (dryRun) {
          console.log(`= ${shown} 与货架一致（账本将刷新）`);
        } else {
          manifest.shelf[effKey] = { ...rec, contentHash: S, sourceCommit: headCommit(ctx.root), pulledAt: todayISO() };
          clearMergeState(cwd, effKey);
          console.log(`= ${shown} 与货架一致，账本已刷新`);
        }
        continue;
      }

      // 情形 2：库上有新版、本地没动 → 自动覆盖本地（零损失）
      if (S !== R && L === R) {
        c.updated++;
        if (dryRun) {
          item.state = "would-update";
          console.log(`↓ 将更新本地：${shown}`);
          continue;
        }
        writeWithMirror(target, localAbs, rec.mirror);
        manifest.shelf[effKey] = { ...rec, contentHash: S, sourceCommit: headCommit(ctx.root), pulledAt: todayISO() };
        clearMergeState(cwd, effKey);
        item.state = "updated";
        console.log(`↓ 已更新本地：${shown}`);
        continue;
      }

      // merge 过、货架之后没再变：等 push（冲突标记没删干净的先改）
      if (ms && ms.headHash === S) {
        const left = conflictMarkerFiles(readTreeFs(localAbs, path.basename(effKey)));
        if (left.length) item.conflicts = left;
        console.log(`⚠ 待决 ${shown}：${left.length ? `已合并，还有冲突标记没解决（${left.join(", ")}）` : `已合并货架 ${sha7(ms.headCommit)} 的改动，待推送`}`);
        pend(item, left.length ? "merge-conflict" : "merged", [`shelf push ${lp}`]);
        continue;
      }

      // 情形 3/4：本地有改动（本地领先，或双方都改）
      const both = S !== R;
      const state = both ? "both-changed" : "local-ahead";
      if (!run.interactive || dryRun) {
        const d = diffSummary(target, localAbs);
        item.files = d;
        console.log(`⚠ 待决 ${shown}（${SYNC_TAG[state]}）：本地相对库上 新增 ${d.added.length} / 删除 ${d.removed.length} / 修改 ${d.changed.length}`);
        pend(item, state, both ? [`shelf diff ${lp}`, `shelf merge ${lp}`] : [`shelf push ${lp}`]);
        continue;
      }

      showLineDiff(target, localAbs, shown);
      const keys = [{ key: "p" }, { key: "o" }, ...(both ? [{ key: "m" }] : []), { key: "s" }];
      const act = await choose(
        `${shown}（${SYNC_TAG[state]}）。[p]本地推上库 / [o]库覆盖本地 / ${both ? "[m]三方合并 / " : ""}[s]跳过? `,
        keys,
      );
      if (act === "s") {
        item.state = "skipped";
        c.skipped++;
        continue;
      }
      if (act === "o") {
        writeWithMirror(target, localAbs, rec.mirror);
        manifest.shelf[effKey] = { ...rec, contentHash: S, sourceCommit: headCommit(ctx.root), pulledAt: todayISO() };
        clearMergeState(cwd, effKey);
        console.log(`↓ 已用库上版本覆盖本地：${shown}`);
        item.state = "overwritten";
        c.updated++;
        continue;
      }
      if (act === "m") {
        const savedData = run.data;
        let r;
        try {
          r = await mergeCore(ctx, effKey, rec);
        } catch (err) {
          if (!(err instanceof ShelfExit)) throw err;
          console.log(err.message);
          run.data = savedData;
          item.state = "skipped";
          c.skipped++;
          continue;
        }
        run.data = savedData;
        item.state = r.conflicts.length ? "merge-conflict" : "merged";
        if (r.conflicts.length) {
          pend(item, "merge-conflict", [`shelf push ${lp}`]);
          continue;
        }
        const now = await choose(`合并干净。现在推上库? [p]推 / [s]稍后? `, [{ key: "p" }, { key: "s" }]);
        if (now === "s") {
          pend(item, "merged", [`shelf push ${lp}`]);
          continue;
        }
      } else if (both) {
        // p：本地推上库，覆盖库上的改动前二次确认
        const ok = await choose(`库上的改动将被你的本地版本覆盖，确认? [y]es / [n]o? `, [{ key: "y" }, { key: "n" }]);
        if (ok === "n") {
          item.state = "skipped";
          c.skipped++;
          continue;
        }
      }
      const { secrets } = guardScan(localAbs);
      if (secrets.length > 0) {
        console.log(`✗ ${shown} 含疑似凭据文件（${secrets.map((x) => x.rel).join(", ")}），sync 不代推，已跳过——确要推请单独 shelf push --force-secret`);
        item.state = "skipped";
        c.skipped++;
        continue;
      }
      const r = applyAndCommit(ctx, effKey, localAbs, manifest, "update");
      keepEphemeral = r.keepEphemeral || keepEphemeral;
      item.state = "pushed";
      item.commit = r.commit;
      c.pushed++;
    }

    let localStat = null;
    let unregistered = [];
    if (!dryRun) {
      localStat = await reconcileLocalSkills(manifest);
      unregistered = unregisteredLocalSkills(manifest, Object.keys(manifest.local ?? {}));
    } else {
      unregistered = unregisteredLocalSkills(manifest, Object.keys(manifest.local ?? {}));
    }

    // 像入库副本、却没登记的（ai/jaAgents/CLAUDE.md 这类）提示一句
    const mirrorHints = [];
    for (const [key, rec] of Object.entries(manifest.shelf ?? {})) {
      if (rec.mirror || rec.planted || !rec.localPath) continue;
      const cand = `${aiDirOf(manifest)}/jaAgents/${path.basename(rec.localPath)}`;
      const candAbs = path.resolve(cwd, cand);
      const localAbs = path.resolve(cwd, rec.localPath);
      if (!fs.existsSync(candAbs) || !fs.existsSync(localAbs) || samePath(normRel(cand), normRel(rec.localPath))) continue;
      if (fs.statSync(candAbs).isFile() !== fs.statSync(localAbs).isFile()) continue;
      mirrorHints.push({ key, localPath: rec.localPath, mirror: cand, command: `shelf mirror ${q(rec.localPath)} ${q(cand)}` });
    }

    if (!dryRun) saveManifest(manifest);

    const plantedItems = items.filter((i) => i.state === "planted");
    // 汇总行只列非零的类别（一致与待决总是列出）
    const parts = [
      [c.same, "一致", true],
      [c.updated, dryRun ? "待更新本地" : "更新本地"],
      [c.pushed, "推上库"],
      [c.refreshed, "账本刷新"],
      [c.cleaned, "清账"],
      [c.skipped, "跳过"],
      [c.planted, "植入不对账"],
      [health.linksFixed, "链接修复"],
      [pending.length, "待决", true],
    ].filter(([n, , always]) => always || n > 0).map(([n, label]) => `${n} ${label}`);
    console.log("");
    console.log(
      `${status ? "Status" : `Sync${dryRun ? "（dry-run）" : ""}`}: ${parts.join(" · ")}` +
      (localStat && (localStat.registered || localStat.refreshed || localStat.missing)
        ? `；本地技能: ${localStat.registered} 新登记 / ${localStat.refreshed} 指纹更新 / ${localStat.missing} 缺失`
        : ""),
    );
    for (const i of plantedItems) {
      console.log(`植入，不对账: ${i.localPath ?? i.shown}（货架 ${i.shown}；要重新植入: shelf pull ${q(i.key)} --force）`);
    }
    for (const x of pending) {
      console.log(`  · ${x.shown}（${SYNC_TAG[x.state]}）→ ${x.next.join("  或  ")}`);
    }
    for (const name of unregistered) {
      console.log(`· 本地技能 ${name} 还没登记在 JASKILL.md——补一行（何时读 / 上游），agent 才知道什么场景用它`);
    }
    for (const h of mirrorHints) {
      console.log(`· ${h.mirror} 像是 ${h.localPath} 的入库副本——登记后 pull 两处一起写、push 前核对两处一致：${h.command}`);
    }

    run.data = {
      dryRun,
      items: items.map(({ shown, ...rest }) => rest), // shown 只是给人看的展示名，--json 里省掉
      counts: { ...c, pending: pending.length },
      planted: plantedItems.map((i) => ({ key: i.key, localPath: i.localPath })),
      health,
      local: localStat,
      unregisteredLocalSkills: unregistered,
      mirrorHints,
    };
    // 文本模式里每条待决的下一步已经跟在清单后面，只有 --json 才汇总进 next
    if (run.json) for (const x of pending) suggest(...x.next);
    if (pending.length) setExit(2);
  } finally {
    if (!keepEphemeral) ctx.cleanup();
  }
}
