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
import { loadManifest, saveManifest, updateShelfEntry, manifestPath } from "../manifest.mjs";
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
import { DEFAULT_TEMPLATE, listTemplates, loadTemplate, expandTemplate, renderText } from "../template.mjs";

const IGNORE_NAMES = new Set(["node_modules", ".git", ".DS_Store"]);
const SECRET_PATTERNS = [/^\.env(\..+)?$/i, /\.key$/i, /\.pem$/i, /^auth\.json$/i, /^credentials/i];
const BIG_FILE_BYTES = 50 * 1024 * 1024;
// 1.x 账本里没带 planted 标记的植入物（SHELF 决策 #30）；2.0 起植入与否由模板条目决定并记进账本
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

// 输入可以是本地路径（含根目录副本、Windows 反斜杠）或货架路径（_ 前缀可省）→ 账本条目。
// within：路径落在某件已记账的目录里面（agent 常传它刚改的那个文件）时归到那一件，最深的优先
function resolveEntry(manifest, input, { within = false } = {}) {
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
  if (!within) return null;
  const inside = (p, dir) => p.length > dir.length && samePath(p.slice(0, dir.length + 1), dir + "/");
  let best = null;
  for (const [key, entry] of Object.entries(manifest.shelf ?? {})) {
    const lp = entry.localPath ? normRel(entry.localPath) : null;
    const base = lp && inside(rel, lp) ? lp : inside(shown, displayPath(key)) ? displayPath(key) : null;
    if (base && (!best || base.length > best.depth)) best = { key, entry, via: "within", depth: base.length };
  }
  return best;
}

// push / diff / merge 收到物品里面的路径：说一声按整件处理
function noteWithin(found, input) {
  if (found?.via !== "within") return;
  console.log(`↪ ${input} 在已记账的 ${found.entry.localPath ?? displayPath(found.key)} 里面，按整件处理（货架 ${displayPath(found.key)}）`);
}

// 非交互要确认时给出的「原样重跑 + 某个开关」
function rerun(flag) {
  const args = process.argv.slice(2).filter((a) => a !== "--json" && a !== "--text" && a !== flag);
  return ["shelf", ...args.map(q), flag].join(" ");
}

function writeLocal(src, destAbs) {
  fs.rmSync(destAbs, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  copyFiltered(src, destAbs);
}

// 账本条目带根目录副本（mirror）时两处一起写（SHELF 决策 #31 / #38）
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

// ---- 正本与根目录副本（SHELF 决策 #38）----

// 正本（localPath，进项目 git）与副本（mirror，比如给 agent 读的根目录 CLAUDE.md，gitignore）：
// 缺哪份补哪份；只有一份相对账本记的内容改过，就把它同步给另一份；两份各改各的才算不一致，交给人定。
// dryRun 只判断不动手；返回 { state: none | ok | synced | mismatch | both-missing, note?, hash? }
function reconcileMirror(entry, { dryRun = false } = {}) {
  if (!entry.mirror || !entry.localPath) return { state: "none" };
  const cwd = process.cwd();
  const p = path.resolve(cwd, entry.localPath);
  const m = path.resolve(cwd, entry.mirror);
  const pe = fs.existsSync(p);
  const me = fs.existsSync(m);
  if (!pe && !me) return { state: "both-missing" };
  const sync = (from, to, note) => {
    const hash = contentHash(from);
    if (!dryRun) writeLocal(from, to);
    return { state: "synced", note, hash };
  };
  if (!me) return sync(p, m, `按正本补上副本 ${entry.mirror}`);
  if (!pe) return sync(m, p, `按副本补回正本 ${entry.localPath}`);
  const hp = contentHash(p);
  const hm = contentHash(m);
  if (hp === hm) return { state: "ok", hash: hp };
  if (hp === entry.contentHash) return sync(m, p, `${entry.mirror} 改过，同步回正本 ${entry.localPath}`);
  if (hm === entry.contentHash) return sync(p, m, `${entry.localPath} 改过，同步到副本 ${entry.mirror}`);
  return { state: "mismatch" };
}

// push / merge 之前：副本先对齐；两份各改各的就列出差异停下，不替人选
function requireMirrorInSync(entry) {
  const r = reconcileMirror(entry);
  if (r.state === "synced") console.log(`↪ ${r.note}`);
  if (r.state === "both-missing") fail(1, `✗ 本地没有 ${entry.localPath}，也没有副本 ${entry.mirror}`);
  if (r.state !== "mismatch") return;
  const cwd = process.cwd();
  const fk = path.basename(entry.localPath);
  const d = diffTrees(
    readTreeFs(path.resolve(cwd, entry.mirror), fk),
    readTreeFs(path.resolve(cwd, entry.localPath), fk),
    { labelA: entry.mirror, labelB: entry.localPath },
  );
  console.error(`✗ ${entry.localPath} 和副本 ${entry.mirror} 都改过、改得不一样（副本 → 正本）：`);
  console.error(statText(d));
  run.data.mirror = { path: entry.mirror, files: d.files };
  suggest(`git diff --no-index ${q(entry.mirror)} ${q(entry.localPath)}`);
  fail(1, `✗ 已停下，不替你选哪份为准——把两份改成同一内容后再来`);
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

// 植入物渲染用的变量
function renderVars(manifest) {
  return { project: projectName(process.cwd()), date: todayISO(), ai: aiDirOf(manifest) };
}

// opts：force 覆盖本地改动 · planted 植入物 · mirror 根目录副本 · render 植入时代入占位符 · fromTemplate 来自模板
async function pullEntry(ctx, realRel, manifest, counters, ask, destAbs, opts = {}) {
  const cwd = process.cwd();
  const src = shelfAbs(ctx, realRel);
  const shown = displayPath(realRel);
  const recorded = manifest.shelf?.[realRel];
  const planted = !!(opts.planted || recorded?.planted || PLANTED_KEYS.has(realRel));
  const mirror = recorded?.mirror ?? opts.mirror ?? null;
  const localPath = toPosix(path.relative(cwd, destAbs));
  const item = { key: realRel, shown, localPath };
  counters.items.push(item);

  const record = () => {
    updateShelfEntry(manifest, realRel, {
      ...entryFields(ctx, src, destAbs),
      ...(planted ? { planted: true } : {}),
      ...(mirror ? { mirror } : {}),
      ...(opts.fromTemplate ? { fromTemplate: true } : {}),
    });
    clearMergeState(cwd, realRel);
  };
  const install = () => {
    writeWithMirror(src, destAbs, mirror);
    if (planted && opts.render && fs.statSync(destAbs).isFile()) {
      fs.writeFileSync(destAbs, renderText(fs.readFileSync(destAbs, "utf8"), opts.render));
    }
    record();
  };

  // 正本不在、根目录副本在（项目原来只有根目录那份）：先拿副本当本地内容，绝不拿货架版本覆盖它
  const mirrorAbs = mirror ? path.resolve(cwd, mirror) : null;
  if (!fs.existsSync(destAbs) && mirrorAbs && fs.existsSync(mirrorAbs) && !opts.force) writeLocal(mirrorAbs, destAbs);
  // 记过账的：副本被单边改过就先同步进正本，再按正本判断；两份各改各的不碰
  if (recorded?.mirror && !opts.force && fs.existsSync(destAbs)) {
    const r = reconcileMirror(recorded);
    if (r.state === "synced") console.log(`↪ ${r.note}`);
    if (r.state === "mismatch") {
      console.log(`! ${shown}：正本和副本 ${recorded.mirror} 各改各的——没动，先对齐两份`);
      Object.assign(item, { state: "mirror-mismatch", action: "kept-local" });
      counters.blocked++;
      return;
    }
  }

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
    if (!recorded || recorded.contentHash !== upstreamHash || recorded.localPath !== localPath || (mirror && !recorded.mirror)) record();
    if (mirror && !fs.existsSync(mirrorAbs)) writeLocal(destAbs, mirrorAbs);
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
    // 项目接了模板时，模板里的货没记过账也按模板的落点与属性装（sync 对「本地已有同名、内容不同」给的就是这条命令）
    const tplName = manifest.template?.name ?? (manifest.agents?.length ? DEFAULT_TEMPLATE : null);
    const tpl = tplName ? loadTemplate(ctx.shelfDir, tplName) : null;
    const plan = tpl ? planOf(ctx, manifest, tpl) : null;
    const counters = newCounters();
    const missing = [];
    for (const input of positionals) {
      if (counters.quit) break;
      const found = resolveEntry(manifest, input);
      let key;
      let destAbs;
      let opts = { force: !!flags["--force"], render: renderVars(manifest) };
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
        const it = destRoot ? null : plan?.items.find((i) => i.key === key);
        if (it) {
          destAbs = path.resolve(process.cwd(), it.dest);
          opts = { ...opts, planted: it.planted, mirror: it.copy, render: it.render ? opts.render : null, fromTemplate: true };
        } else {
          destAbs = destRoot ? path.join(destRoot, path.basename(key)) : defaultDest(manifest, hit);
        }
      }
      await pullEntry(ctx, key, manifest, counters, safeAsk, destAbs, opts);
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
  if (run.json) fail(1, "✗ 交互浏览器不支持 JSON 输出；列货架用 shelf ls（在终端里直接跑 shelf 才进浏览器）");
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
        const childAbs = path.join(abs, e.name);
        const type = !e.isDir ? "file"
          : fs.existsSync(path.join(childAbs, "SKILL.md")) ? "skill"
          : fs.existsSync(path.join(childAbs, "template.json")) ? "template"
          : "dir";
        return { name: e.display, path: displayPath(childRel), type, info: e.info, installed: manifest.shelf?.[childRel]?.localPath ?? null };
      });
    }
    const label = { skill: " · 技能", template: " · 模板" };
    console.log(`shelf:/${displayPath(rel)}`);
    if (entries.length === 0) console.log("  (空)");
    for (const e of entries) {
      console.log(`  ${e.type === "file" ? e.name : e.name + "/"}  (${e.info}${label[e.type] ?? ""})`
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
  const found = resolveEntry(manifest, positionals[0], { within: true });
  noteWithin(found, positionals[0]);
  if (found?.entry.planted) {
    fail(1, `✗ ${found.entry.localPath ?? positionals[0]} 是模板植入、之后归项目维护的文件（货架 ${displayPath(found.key)}），不推回货架——推上去会把模板变成本项目的内容。`
      + `要改货架上的模板，到货架 clone 里改（shelf home 看位置）`);
  }
  if (found?.entry.mirror) requireMirrorInSync(found.entry);
  const localAbs = path.resolve(process.cwd(), found?.entry.localPath ?? positionals[0]);
  if (!fs.existsSync(localAbs)) fail(1, `✗ 本地路径不存在: ${found?.entry.localPath ?? positionals[0]}`);
  const localPosix = toPosix(path.relative(process.cwd(), localAbs));
  run.data = { localPath: localPosix };

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
      // 没记过账：先看是不是模板里某件货的落点（模板自带的文件不参与按名字匹配），再按名字找
      const tplName = manifest.template?.name ?? (manifest.agents?.length ? DEFAULT_TEMPLATE : null);
      const tpl = tplName ? loadTemplate(ctx.shelfDir, tplName) : null;
      const tplItem = tpl ? planOf(ctx, manifest, tpl).items.find((i) => samePath(normRel(i.dest), localPosix)) : null;
      if (tplItem?.planted) {
        fail(1, `✗ ${localPosix} 是模板植入、之后归项目维护的文件（货架 ${displayPath(tplItem.key)}），不推回货架`);
      }
      if (tplItem) {
        key = tplItem.key;
        console.log(`≈ ${localPosix} 是模板 ${tpl.name} 里的货：货架 ${displayPath(key)}（本工作区无 pull 记录）`);
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
  const found = resolveEntry(manifest, positionals[0], { within: true });
  noteWithin(found, positionals[0]);
  if (!found) {
    fail(1, `✗ 本工作区账本里没有 '${positionals[0]}'——diff 对比的是「上次拉取的版本」，只对拉取过的物品有效`);
  }
  const { key, entry } = found;

  const ctx = resolveShelfContext({ forWrite: true });
  try {
    const it = itemContext(ctx, key, entry);
    if (entry.mirror) {
      const r = reconcileMirror(entry, { dryRun: true });
      if (r.state === "synced") console.warn(`! ${r.note.replace("同步", "要同步")}（diff 只读，没动；sync / push 时会做）`);
      if (r.state === "mismatch") console.warn(`! ${entry.localPath} 和副本 ${entry.mirror} 各改各的——下面比的是正本`);
    }
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

// 三方合并的核心：写回本地（带副本时两处一起写）、记合并标记，返回结果；出错抛 ShelfExit，由调用方报告
function mergeItem(ctx, key, entry) {
  const it = itemContext(ctx, key, entry);
  const local = readTreeFs(it.localAbs, it.fileKey);
  const left = conflictMarkerFiles(local);
  if (left.length) {
    throw new ShelfExit(3, `✗ 本地还有上次合并留下的冲突标记没解决：${left.join(", ")}——改好后直接 shelf push ${it.localPath}`, { conflicts: left });
  }
  const S = contentHash(it.headAbs);
  const L = contentHash(it.localAbs);
  const ms = getMergeState(it.cwd, key);
  if (ms && ms.headHash === S) return { state: "already-merged", it, headSha: ms.headCommit };
  if (L === S) return { state: "same-as-shelf", it };
  // 再次合并时以上次合进来的那一版为基准（和 git 的 merge base 前移一样）
  const baseCommit = ms?.headCommit ?? entry.sourceCommit;
  const baseHash = ms?.headHash ?? entry.contentHash;
  if (S === baseHash) return { state: "shelf-unchanged", it, again: !!ms };
  const base = readTreeAtCommit(ctx.root, baseCommit, key, it.fileKey);
  if (!base) {
    throw new ShelfExit(1, `✗ 取不到合并基准（${ms ? "上次合并" : "上次拉取"}的版本 ${sha7(baseCommit)} 不在货架历史里，或账本没记 sourceCommit）——`
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
  return {
    state: res.conflicts.length ? "conflict" : "merged",
    it,
    again: !!ms,
    baseCommit,
    headSha,
    files: res.files.filter((f) => !["same", "both-same", "both-deleted"].includes(f.how)),
    conflicts: res.conflicts,
  };
}

function printMergeResult(key, entry, r) {
  if (r.state === "already-merged") return console.log(`= 已经合并过货架 ${sha7(r.headSha)} 的改动，货架之后没再变——直接 push`);
  if (r.state === "same-as-shelf") return console.log(`= ${r.it.localPath} 与货架一致，不需要合并（shelf sync 会刷新账本）`);
  if (r.state === "shelf-unchanged") return console.log(`= 货架在${r.again ? "上次合并" : "上次拉取"}之后没变，不需要合并——本地改动直接 push`);
  console.log(`三方合并 ${displayPath(key)}：基准 ${sha7(r.baseCommit)}（${r.again ? "上次合并" : "上次拉取"}）· 货架 ${sha7(r.headSha)} · 本地`);
  for (const f of r.files) {
    if (f.how === "conflict") console.log(`  ⚠ 冲突       ${f.path}（${MERGE_REASON[f.reason]}）`);
    else if (MERGE_HOW[f.how]) console.log(`  ${MERGE_HOW[f.how]}  ${f.path}`);
  }
  console.log(`结果已写回 ${r.it.localPath}${entry.mirror ? ` 与副本 ${entry.mirror}` : ""}；账本没动，push 成功后才更新。`);
  if (r.conflicts.length) console.log(`✗ ${r.conflicts.length} 个文件要人处理：${r.conflicts.map((f) => f.path).join(", ")}——处理完（冲突标记删干净）再 push`);
  else console.log("✓ 合并干净，可以 push 了");
}

export async function cmdShelfMerge(argv) {
  const { positionals } = parseArgs("merge", argv);
  if (positionals.length !== 1) fail(1, "用法: " + COMMANDS.merge.usage);
  const manifest = loadManifest();
  const found = resolveEntry(manifest, positionals[0], { within: true });
  noteWithin(found, positionals[0]);
  if (!found) {
    fail(1, `✗ 本工作区账本里没有 '${positionals[0]}'——merge 以「上次拉取的版本」为基准，只对拉取过的物品有效`);
  }
  const { key, entry } = found;
  if (entry.planted || PLANTED_KEYS.has(key)) {
    fail(1, `✗ ${entry.localPath ?? key} 是模板植入、之后归项目维护的文件，不和货架对账，也不合并（要重新植入: shelf pull ${key} --force）`);
  }
  if (entry.mirror) requireMirrorInSync(entry);
  const ctx = resolveShelfContext({ forWrite: true });
  try {
    run.data = { key, shown: displayPath(key), localPath: entry.localPath ?? null };
    let r;
    try {
      r = mergeItem(ctx, key, entry);
    } catch (err) {
      if (err instanceof ShelfExit && err.extra?.conflicts) {
        run.data.conflicts = err.extra.conflicts.map((p) => ({ path: p, how: "conflict", reason: "unresolved" }));
        suggest(`shelf push ${q(entry.localPath)}`);
      }
      if (err instanceof ShelfExit && err.code === 1) suggest(`shelf diff ${q(entry.localPath)}`);
      throw err;
    }
    printMergeResult(key, entry, r);
    const lp = q(r.it.localPath);
    Object.assign(run.data, {
      state: r.state === "conflict" ? "conflict" : r.state,
      base: r.baseCommit ?? null,
      head: r.headSha ?? null,
      files: r.files ?? [],
      conflicts: r.conflicts ?? [],
    });
    if (r.state === "same-as-shelf") suggest("shelf sync");
    else suggest(`shelf push ${lp}`);
    if (r.state === "conflict") setExit(3);
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

// ---- gitignore ----

function gitIgnores(cwd, rel) {
  return spawnSync("git", ["check-ignore", "-q", "--no-index", rel], { cwd, stdio: "ignore" }).status === 0;
}

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

// 只忽略 shelf 自己生成的东西：根目录副本（写成 /CLAUDE.md，不误伤 ai/jaAgents/CLAUDE.md 这类正本）
// 和 agent 技能目录链接（不带结尾 /：链接在 git 眼里不是目录）
function ensureGitignore(cwd, lines) {
  const p = path.join(cwd, ".gitignore");
  const content = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  const have = new Set(content.split("\n").map((l) => l.replace(/\r$/, "").trim()));
  const missing = [...new Set(lines)].filter((l) => !ignoreCovered(cwd, l, have));
  if (missing.length === 0) return [];
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const sep = content === "" || content.endsWith("\n") ? "" : eol;
  fs.writeFileSync(p, content + sep + "# shelf: agent 读的根目录协议副本与技能链接不入项目库（正本在 ai/ 里）" + eol + missing.join(eol) + eol, "utf8");
  return missing;
}

// ---- agent 目标与技能链接（SHELF 决策 #24 / #26 / #32）----

const AGENT_TARGETS = {
  claude: { skillsDir: ".claude/skills" },
  // Codex 只从 .agents/skills 发现项目技能（cwd 到仓库根逐级扫描，支持链接）
  codex: { skillsDir: ".agents/skills" },
  kimi: { skillsDir: ".kimi/skills" },
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

async function askTargets(manifest, defaults) {
  const rl = makeLineReader();
  try {
    console.log("要接入哪些 agent？（各自的技能目录会链接到正本 " + skillsHomeOf(manifest) + "/）");
    TARGET_PRIORITY.forEach((n, i) => console.log("  " + (i + 1) + ". " + n + "  （" + AGENT_TARGETS[n].skillsDir + "/）"));
    while (true) {
      const raw = await rl.question(`选择编号，逗号分隔（如 1,2）；a=全部；直接回车=${defaults.join(" + ")} > `);
      if (raw === null) return null;
      const ans = raw.trim().toLowerCase();
      if (ans === "") return [...defaults];
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

function ensureLinks(cwd, manifest, targets) {
  const out = { made: 0, blocked: [] };
  for (const n of targets) {
    const r = ensureSkillsLink(cwd, n, manifest);
    if (r === "created" || r === "fixed") out.made++;
    if (r === "blocked") out.blocked.push(AGENT_TARGETS[n].skillsDir);
  }
  return out;
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

// ---- 模板（SHELF 决策 #37）----

// 项目用的模板：账本记了就用记的；1.x 接入过的项目（有 agents、没记模板）按默认模板走；都没有返回 null
function templateOf(ctx, manifest, override) {
  const name = override ?? manifest.template?.name ?? (manifest.agents?.length ? DEFAULT_TEMPLATE : null);
  if (!name) return null;
  const tpl = loadTemplate(ctx.shelfDir, name);
  if (!tpl) fail(1, `✗ 货架上没有模板 '${name}'（shelf template 看有哪些）`);
  return tpl;
}

function planOf(ctx, manifest, tpl, agents = manifest.agents ?? []) {
  return expandTemplate(tpl, { shelfDir: ctx.shelfDir, agents, aiDir: aiDirOf(manifest) });
}

// 1.x 的协议正本在根目录（CLAUDE.md 进账本、gitignore）；2.0 起正本在 ai/jaAgents（入库），根目录那份是副本。
// 两份都在且不同时按账本基准判断谁改过；都改过就不迁，报出来让人定
function migrateProtocolLayout(manifest, plan, { fix }) {
  const cwd = process.cwd();
  const out = [];
  for (const it of plan.items.filter((i) => i.copy)) {
    const rec = manifest.shelf?.[it.key];
    if (!rec?.localPath) continue;
    if (!samePath(normRel(rec.localPath), normRel(it.copy))) {
      if (samePath(normRel(rec.localPath), normRel(it.dest)) && rec.mirror !== it.copy && !rec.mirror) {
        if (fix) rec.mirror = it.copy;
        out.push({ key: it.key, mirror: it.copy });
      }
      continue;
    }
    const oldAbs = path.resolve(cwd, rec.localPath);
    const newAbs = path.resolve(cwd, it.dest);
    if (fs.existsSync(oldAbs) && fs.existsSync(newAbs)) {
      const hOld = contentHash(oldAbs);
      const hNew = contentHash(newAbs);
      if (hOld !== hNew) {
        if (hNew === rec.contentHash) {
          if (fix) writeLocal(oldAbs, newAbs);
        } else if (hOld === rec.contentHash) {
          if (fix) writeLocal(newAbs, oldAbs);
        } else {
          console.warn(`! ${rec.localPath} 和 ${it.dest} 都改过、改得不一样，协议正本没迁——两份改成同一内容后再跑一次`);
          out.push({ key: it.key, blocked: true });
          continue;
        }
      }
    } else if (fs.existsSync(oldAbs) && fix) {
      writeLocal(oldAbs, newAbs);
    }
    if (fix) {
      rec.localPath = it.dest;
      rec.mirror = it.copy;
    }
    out.push({ key: it.key, from: it.copy, to: it.dest });
    console.log(`${fix ? "↪" : "·"} 协议正本${fix ? "改到" : "将改到"} ${it.dest}（入库）；根目录 ${it.copy} 是给 agent 读的副本（gitignore）`);
  }
  return out;
}

// 要忽略的行：已接入 agent 的技能目录链接 + 模板里根目录副本
function gitignoreLinesFor(targets, plan) {
  return [
    ...(plan ? plan.items.filter((i) => i.copy).map((i) => "/" + i.copy) : []),
    ...targets.filter((n) => AGENT_TARGETS[n]).map((n) => "/" + AGENT_TARGETS[n].skillsDir),
  ];
}

// init / sync / adopt 的体检：植入物补标记、Codex 目录迁移、协议正本迁移、技能链接与 gitignore、账本没被忽略
function healthChecks(manifest, plan, { fix = true, links = true } = {}) {
  const cwd = process.cwd();
  const report = { plantedMarked: [], codexMigrated: false, protocolMoved: [], linksFixed: 0, linksBlocked: [], gitignoreAdded: [], ledgerIgnored: false };
  for (const [key, rec] of Object.entries(manifest.shelf ?? {})) {
    if (!PLANTED_KEYS.has(key) || rec.planted) continue;
    report.plantedMarked.push(key);
    if (fix) rec.planted = true;
    console.log(`${fix ? "✓" : "·"} ${rec.localPath ?? key} ${fix ? "已标记" : "将标记"}为植入物：之后归项目维护，sync / push 不再对账`);
  }
  if (plan) report.protocolMoved = migrateProtocolLayout(manifest, plan, { fix });
  if (fs.existsSync(manifestPath(cwd)) && gitIgnores(cwd, ".shelf.json")) {
    report.ledgerIgnored = true;
    console.warn("! 账本 .shelf.json 被 .gitignore 忽略了——换设备时 init 没法按账本还原，删掉那条忽略规则");
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
    const l = ensureLinks(cwd, manifest, targets);
    report.linksFixed = l.made;
    report.linksBlocked = l.blocked;
    report.gitignoreAdded = ensureGitignore(cwd, gitignoreLinesFor(targets, plan));
  }
  return report;
}

// ---- 对账（init / sync 共用，SHELF 决策 #19 / #39）----

const SYNC_TAG = {
  "local-ahead": "本地领先",
  "both-changed": "双方都改过",
  merged: "已合并，待推送",
  "merge-conflict": "合并后还有冲突",
  removed: "已从货架移除",
  ambiguous: "同名多义",
  "local-missing": "本地文件不存在",
  "mirror-mismatch": "正本与副本各改各的",
  "untracked-differs": "本地已有同名文件、内容和货架不同（没记过账）",
};

// 模板里有、账本里还没有的货：装上（模板新增的、或第一次接入）
async function installMissing(ctx, manifest, plan, { dryRun }) {
  const cwd = process.cwd();
  const items = [];
  const counters = newCounters();
  const vars = renderVars(manifest);
  for (const it of plan.items) {
    const rec = manifest.shelf?.[it.key];
    if (rec) {
      if (!dryRun && !rec.fromTemplate) rec.fromTemplate = true;
      continue;
    }
    // 只读时也按真跑的结果报：本地已有同名的，植入物算保留、内容一样算一致、不一样就是待决
    if (dryRun) {
      const item = { key: it.key, shown: displayPath(it.key), localPath: it.dest };
      const destAbs = path.resolve(cwd, it.dest);
      if (!fs.existsSync(destAbs)) item.state = "would-install";
      else if (it.planted) item.state = "planted";
      else if (!it.render && contentHash(destAbs) === contentHash(shelfAbs(ctx, it.key))) item.state = "same";
      else {
        Object.assign(item, {
          state: "untracked-differs",
          pending: true,
          next: [`shelf pull ${q(it.key)} --force`, `shelf push ${q(it.dest)} --yes`],
        });
      }
      items.push(item);
      continue;
    }
    await pullEntry(ctx, it.key, manifest, counters, safeAsk, path.resolve(cwd, it.dest), {
      planted: it.planted,
      mirror: it.copy,
      render: it.render ? vars : null,
      fromTemplate: true,
    });
    const got = counters.items[counters.items.length - 1];
    const item = { key: it.key, shown: got.shown, localPath: got.localPath };
    if (got.action === "pulled") item.state = "installed";
    else if (got.action === "planted-kept") item.state = "planted";
    else if (got.action === "up-to-date") item.state = "same";
    else {
      Object.assign(item, {
        state: "untracked-differs",
        pending: true,
        next: [`shelf pull ${q(it.key)} --force`, `shelf push ${q(got.localPath)} --yes`],
      });
    }
    items.push(item);
  }
  return items;
}

// 一件已记账的货对账：能安全自动做的直接做掉（补副本、补本地缺失、货架新版且本地没动就更新、账本刷新），
// 其余标成待决并附下一步命令。restore = 本地缺失就补拉（init 用；sync 里缺失算待决，可能是有意删的）
async function reconcileEntry(ctx, manifest, key, { dryRun, restore, plan }) {
  const cwd = process.cwd();
  const rec = manifest.shelf[key];
  const item = { key, shown: displayPath(key), localPath: rec.localPath ?? null };
  if (rec.mirror) item.mirror = rec.mirror;
  const lp = q(rec.localPath ?? "");
  const pend = (state, next) => Object.assign(item, { state, next, pending: true });

  // 植入物：不对账；本地没了就补植入
  if (rec.planted || PLANTED_KEYS.has(key)) {
    const localAbs = rec.localPath ? path.resolve(cwd, rec.localPath) : null;
    if (restore && localAbs && !fs.existsSync(localAbs) && fs.existsSync(shelfAbs(ctx, key))) {
      if (!dryRun) {
        const tplItem = plan?.items.find((i) => i.key === key);
        await pullEntry(ctx, key, manifest, newCounters(), safeAsk, localAbs, { planted: true, render: tplItem?.render ? renderVars(manifest) : null });
      }
      item.state = "restored";
    } else item.state = "planted";
    return item;
  }

  let effKey = key;
  let target = shelfAbs(ctx, effKey);
  // 货架上的路径没了 → 按名字找回（搬家）或报告下架
  if (!fs.existsSync(target)) {
    const hits = findByBasename(ctx.shelfDir, path.basename(effKey));
    if (hits.length !== 1) {
      if (hits.length) item.candidates = hits.map(displayPath);
      return pend(hits.length === 0 ? "removed" : "ambiguous", [`shelf forget ${q(key)}`]);
    }
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
  }
  const shown = item.shown;

  // 正本与副本：缺的补、单边改的同步；各改各的交给人
  let mirrorHash = null;
  if (rec.mirror) {
    const r = reconcileMirror(rec, { dryRun });
    if (r.state === "mismatch") {
      return pend("mirror-mismatch", [`git diff --no-index ${q(rec.mirror)} ${lp}`]);
    }
    if (r.state === "synced") {
      item.mirrorSynced = r.note;
      mirrorHash = r.hash;
      console.log(`${dryRun ? "· 将：" : "↪ "}${r.note}`);
    }
  }

  // 本地没了：init 补拉；sync 里算待决
  const localAbs = path.resolve(cwd, rec.localPath ?? "");
  if (!rec.localPath || (!fs.existsSync(localAbs) && mirrorHash === null)) {
    if (restore && rec.localPath) {
      if (!dryRun) {
        writeWithMirror(target, localAbs, rec.mirror);
        manifest.shelf[effKey] = { ...rec, contentHash: contentHash(target), sourceCommit: headCommit(ctx.root), pulledAt: todayISO() };
        clearMergeState(cwd, effKey);
      }
      console.log(`${dryRun ? "· 将补拉" : "↓ 已补拉"} ${shown}`);
      item.state = "restored";
      return item;
    }
    return pend("local-missing", [`shelf pull ${q(effKey)} --force`, `shelf forget ${q(effKey)}`]);
  }

  const S = contentHash(target);
  const L = mirrorHash ?? contentHash(localAbs);
  const R = rec.contentHash;
  const ms = getMergeState(cwd, effKey);

  if (S === R && L === R) {
    item.state = "same";
    return item;
  }
  // 内容已和货架一致，只是账本落后 → 只刷新账本
  if (L === S) {
    item.state = "refreshed";
    if (!dryRun) {
      manifest.shelf[effKey] = { ...rec, contentHash: S, sourceCommit: headCommit(ctx.root), pulledAt: todayISO() };
      clearMergeState(cwd, effKey);
    }
    console.log(`= ${shown} 与货架一致，${dryRun ? "账本将刷新" : "账本已刷新"}`);
    return item;
  }
  // 货架有新版、本地没动 → 自动覆盖本地（零损失，副本一起写）
  if (S !== R && L === R) {
    if (dryRun) {
      item.state = "would-update";
      console.log(`↓ 将更新本地：${shown}`);
      return item;
    }
    writeWithMirror(target, localAbs, rec.mirror);
    manifest.shelf[effKey] = { ...rec, contentHash: S, sourceCommit: headCommit(ctx.root), pulledAt: todayISO() };
    clearMergeState(cwd, effKey);
    item.state = "updated";
    console.log(`↓ 已更新本地：${shown}`);
    return item;
  }
  // merge 过、货架之后没再变：等 push（冲突标记没删干净的先改）
  if (ms && ms.headHash === S) {
    const left = conflictMarkerFiles(readTreeFs(localAbs, path.basename(effKey)));
    if (left.length) item.conflicts = left;
    return pend(left.length ? "merge-conflict" : "merged", [`shelf push ${lp}`]);
  }
  // 本地有改动：本地领先，或双方都改
  const both = S !== R;
  item.files = diffSummary(target, localAbs);
  return pend(both ? "both-changed" : "local-ahead", both ? [`shelf diff ${lp}`, `shelf merge ${lp}`] : [`shelf push ${lp}`]);
}

// 人在终端跑 sync、没带 --merge / --push 时，逐条待决当场问
function showLineDiff(shelfAbsPath, localAbs, shown) {
  console.log(`—— ${shown}  diff（库上 → 本地）——`);
  spawnSync("git", ["diff", "--no-index", "--color=always", "--", shelfAbsPath, localAbs], { stdio: "inherit" });
}

async function promptPending(ctx, manifest, item) {
  const cwd = process.cwd();
  const rec = manifest.shelf[item.key];
  if (!rec) return;
  const target = shelfAbs(ctx, item.key);
  const localAbs = path.resolve(cwd, rec.localPath ?? "");
  const resolved = (state) => Object.assign(item, { state, pending: false, next: undefined });
  if (item.state === "removed" || item.state === "ambiguous") {
    const act = await choose(`⚠ ${item.shown} ${SYNC_TAG[item.state]}。[r]清记账 / [s]跳过? `, [{ key: "r" }, { key: "s" }]);
    if (act === "r") {
      delete manifest.shelf[item.key];
      clearMergeState(cwd, item.key);
      console.log(`✓ 已清记账 ${item.shown}（本地文件未动；想重新上架用 shelf create）`);
      resolved("cleaned");
    }
    return;
  }
  if (item.state === "local-missing") {
    const act = await choose(`⚠ ${item.shown} 的本地文件不存在（${rec.localPath ?? "无 localPath"}）。[p]重新拉取 / [r]清记账 / [s]跳过? `,
      [{ key: "p" }, { key: "r" }, { key: "s" }]);
    if (act === "p") {
      writeWithMirror(target, localAbs, rec.mirror);
      manifest.shelf[item.key] = { ...rec, contentHash: contentHash(target), sourceCommit: headCommit(ctx.root), pulledAt: todayISO() };
      console.log(`↓ 已重新拉取 ${item.shown}`);
      resolved("restored");
    } else if (act === "r") {
      delete manifest.shelf[item.key];
      console.log(`✓ 已清记账 ${item.shown}`);
      resolved("cleaned");
    }
    return;
  }
  if (item.state !== "local-ahead" && item.state !== "both-changed") return;
  const both = item.state === "both-changed";
  showLineDiff(target, localAbs, item.shown);
  const act = await choose(
    `${item.shown}（${SYNC_TAG[item.state]}）。[p]本地推上库 / [o]库覆盖本地 / ${both ? "[m]三方合并 / " : ""}[s]跳过? `,
    [{ key: "p" }, { key: "o" }, ...(both ? [{ key: "m" }] : []), { key: "s" }],
  );
  if (act === "s") return;
  if (act === "o") {
    writeWithMirror(target, localAbs, rec.mirror);
    manifest.shelf[item.key] = { ...rec, contentHash: contentHash(target), sourceCommit: headCommit(ctx.root), pulledAt: todayISO() };
    clearMergeState(cwd, item.key);
    console.log(`↓ 已用库上版本覆盖本地：${item.shown}`);
    resolved("updated");
    return;
  }
  if (act === "m") {
    let r;
    try {
      r = mergeItem(ctx, item.key, rec);
    } catch (err) {
      if (!(err instanceof ShelfExit)) throw err;
      console.log(err.message);
      return;
    }
    printMergeResult(item.key, rec, r);
    if (r.state === "conflict") return Object.assign(item, { state: "merge-conflict", next: [`shelf push ${q(rec.localPath)}`] });
    item.state = "merged";
    const now = await choose(`现在推上库? [p]推 / [s]稍后? `, [{ key: "p" }, { key: "s" }]);
    if (now === "s") return Object.assign(item, { next: [`shelf push ${q(rec.localPath)}`] });
  } else if (both) {
    const ok = await choose(`库上的改动将被你的本地版本覆盖，确认? [y]es / [n]o? `, [{ key: "y" }, { key: "n" }]);
    if (ok === "n") return;
  }
  const { secrets } = guardScan(localAbs);
  if (secrets.length > 0) {
    console.log(`✗ ${item.shown} 含疑似凭据文件（${secrets.map((x) => x.rel).join(", ")}），sync 不代推，已跳过——确要推请单独 shelf push --force-secret`);
    return;
  }
  const r = applyAndCommit(ctx, item.key, localAbs, manifest, "update");
  item.commit = r.commit;
  resolved("pushed");
  return r.keepEphemeral;
}

// ---- 本地技能台账与 JASKILL 核对（SHELF 决策 #27）----

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
  const c = { registered: 0, refreshed: 0, missing: 0, graduated: 0, registeredNames: [] };

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
    c.registeredNames.push(name);
  }

  manifest.local = next;
  return c;
}

// JASKILL.md 登记表核对：正本里的项目专属技能（local 段）有没有登记；登记表里写的技能正本里还在不在
function jaskillCheck(manifest) {
  const rec = manifest.shelf?.["docs/JASKILL.md"];
  const p = path.resolve(process.cwd(), rec?.localPath ?? `${aiDirOf(manifest)}/JASKILL.md`);
  if (!fs.existsSync(p)) return { file: null, unregistered: [], stale: [] };
  const text = fs.readFileSync(p, "utf8");
  const word = (name) => new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(name)}([^A-Za-z0-9_-]|$)`, "m");
  const unregistered = Object.keys(manifest.local ?? {}).filter((name) => !word(name).test(text));
  const home = path.resolve(process.cwd(), skillsHomeOf(manifest));
  const listed = new Set([
    ...[...text.matchAll(/^\|\s*`([a-z0-9][a-z0-9._-]*)`\s*\|/gm)].map((m) => m[1]),
    ...[...text.matchAll(/^##\s+([a-z0-9][a-z0-9._-]*)\s*$/gm)].map((m) => m[1]),
  ]);
  const stale = [...listed].filter((name) => !fs.existsSync(path.join(home, name)));
  return { file: toPosix(path.relative(process.cwd(), p)), unregistered, stale };
}

function printJaskill(j) {
  for (const name of j.unregistered) {
    console.log(`· 本地技能 ${name} 还没登记在 ${j.file}——补一行（何时读 / 上游），agent 才知道什么场景用它`);
  }
  for (const name of j.stale) {
    console.log(`· ${j.file} 登记了 ${name}，但技能正本里没有它——装回来，或删掉那一行`);
  }
}

// ---- 子命令：init（SHELF 决策 #21 / #33 / #39）----

// 按模板把项目接成「该有的样子」：装模板里的货、逐件对账（缺的补、旧的更新）、链接、gitignore、脚手架、本地技能登记
async function applyTemplate(ctx, manifest, tpl, targets) {
  const cwd = process.cwd();
  const plan = planOf(ctx, manifest, tpl, targets);
  for (const m of plan.missing) console.warn(`! 模板里的 ${m} 在货架上找不到，跳过`);
  const health = healthChecks(manifest, plan, { fix: true, links: false });
  const items = await installMissing(ctx, manifest, plan, { dryRun: false });
  const done = new Set(items.map((i) => i.key));
  for (const key of Object.keys(manifest.shelf ?? {})) {
    if (done.has(key)) continue;
    items.push(await reconcileEntry(ctx, manifest, key, { dryRun: false, restore: true, plan }));
  }
  const links = ensureLinks(cwd, manifest, targets);
  const gitignoreAdded = ensureGitignore(cwd, gitignoreLinesFor(targets, plan));
  const scaffold = applyScaffold(
    cwd,
    planScaffold(plan.scaffold, { aiDir: aiDirOf(manifest), skillsHomeAbs: path.resolve(cwd, skillsHomeOf(manifest)) }),
    { date: todayISO(), name: projectName(cwd) },
  );
  const local = await reconcileLocalSkills(manifest);
  const jaskill = jaskillCheck(manifest);
  return { plan, health, items, links, gitignoreAdded, scaffold, local, jaskill };
}

function countStates(items) {
  const c = {};
  for (const i of items) c[i.state] = (c[i.state] ?? 0) + 1;
  return c;
}

function printPending(pending) {
  for (const x of pending) console.log(`  · ${x.shown}（${SYNC_TAG[x.state] ?? x.state}）→ ${(x.next ?? []).join("  或  ")}`);
}

function printApplied(manifest, targets, r, tpl) {
  const c = countStates(r.items);
  const parts = [
    [c.installed, "装上"], [c.restored, "补拉"], [c.updated, "更新"], [c.refreshed, "账本刷新"],
    [c.same, "一致"], [c.planted, "植入物"],
  ].filter(([n]) => n).map(([n, l]) => `${n} ${l}`);
  console.log("");
  console.log(`模板 ${tpl.name}${tpl.builtin ? "（内置配方）" : ""}：${parts.join(" · ") || "无变化"}`);
  if (r.links.made) console.log(`⛓ 建立/修复技能链接 ${r.links.made} 个`);
  for (const b of r.links.blocked) console.log(`⚠ ${b} 没能换成链接（见上方提示）`);
  if (r.gitignoreAdded.length) console.log(`✓ .gitignore 补行: ${r.gitignoreAdded.join(", ")}`);
  if (r.scaffold.created.length) console.log(`✓ 补上固定目录: ${r.scaffold.created.join(" · ")}`);
  if (r.local.registered) console.log(`✚ 登记本地技能 ${r.local.registered} 个（账本 local 段）: ${r.local.registeredNames.join(", ")}`);
  printJaskill(r.jaskill);
  const pending = r.items.filter((i) => i.pending);
  if (pending.length) {
    console.log(`待决 ${pending.length}:`);
    printPending(pending);
  }
  console.log("");
  console.log(`已接入（agent: ${targets.join(" + ")} · ai 区: ${aiDirOf(manifest)}/）:`);
  const copies = r.plan.items.filter((i) => i.copy).map((i) => `${i.copy} ← ${i.dest}`);
  if (copies.length) console.log(`  ${copies.join(" · ")}  协议：正本入库，根目录是给 agent 读的副本`);
  console.log(`  ${skillsHomeOf(manifest)}/  技能唯一正本；${targets.map((n) => AGENT_TARGETS[n].skillsDir).join(" · ")} 是指向它的链接`);
  console.log("  .shelf.json  账本（进项目 git，换设备 / 新 worktree 跑 shelf init 即按它还原）");
}

export async function cmdShelfInit(argv = []) {
  const { flags, positionals } = parseArgs("init", argv);
  if (positionals.length) fail(1, "用法: " + COMMANDS.init.usage);
  const cwd = process.cwd();

  const ctx = resolveShelfContext({ forWrite: true }); // 要拿最新的模板与货
  try {
    if (path.resolve(cwd) === path.resolve(ctx.root)) {
      fail(1, "✗ 这里就是货架 home 本体，不能对它 init（防止把忽略规则写进货架仓库）");
    }
    const fresh = !fs.existsSync(manifestPath(cwd));
    const manifest = loadManifest();
    manifest.source ??= remoteUrl(ctx.root) || toPosix(ctx.root);
    const tpl = templateOf(ctx, manifest, flags["--template"] ?? manifest.template?.name ?? DEFAULT_TEMPLATE);
    const defaults = parseTargetNames((tpl.defaultAgents ?? ["claude", "codex"]).join(","));

    let targets;
    if (flags["--agents"] !== undefined) {
      targets = parseTargetNames(flags["--agents"]);
    } else if (manifest.agents?.length) {
      targets = TARGET_PRIORITY.filter((n) => manifest.agents.includes(n));
      console.log("（沿用账本里的 agent 目标: " + targets.join(", ") + "；调整用 shelf agents add 或 --agents）");
    } else if (run.interactive) {
      targets = await askTargets(manifest, defaults);
      if (!targets || !targets.length) {
        console.log("已取消。");
        return;
      }
    } else {
      targets = defaults;
      console.log(`（没指定 --agents，按模板默认接入 ${targets.join(" + ")}；要别的组合加 --agents）`);
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
      const d = detectAiDir(cwd);
      manifest.aiDir = d.name;
      console.log(`（ai 资料区: ${d.name}/ —— ${d.reason}；要换用 --ai-dir）`);
    }

    manifest.agents = targets;
    manifest.template = tpl.builtin ? { name: tpl.name, builtin: true } : { name: tpl.name, commit: headCommit(ctx.root) };
    console.log(fresh ? `新项目接入：按模板 ${tpl.name} 初始化` : `按账本还原 / 补齐（模板 ${tpl.name}）`);
    const r = await applyTemplate(ctx, manifest, tpl, targets);
    saveManifest(manifest);
    printApplied(manifest, targets, r, tpl);

    const pending = r.items.filter((i) => i.pending);
    if (run.json) for (const x of pending) suggest(...x.next);
    if (pending.length) setExit(2);
    run.data = {
      mode: fresh ? "fresh" : "restore",
      template: { name: tpl.name, builtin: !!tpl.builtin },
      aiDir: manifest.aiDir,
      skillsHome: skillsHomeOf(manifest),
      agents: targets,
      items: r.items.map(({ shown, ...rest }) => rest),
      counts: { ...countStates(r.items), pending: pending.length },
      links: r.links,
      gitignoreAdded: r.gitignoreAdded,
      scaffold: r.scaffold,
      local: r.local,
      jaskill: r.jaskill,
      health: r.health,
      missingFromShelf: r.plan.missing,
    };
  } finally {
    ctx.cleanup();
  }
}

// ---- 子命令：template（看模板里有哪些货，SHELF 决策 #37）----

export async function cmdShelfTemplate(argv) {
  const { positionals } = parseArgs("template", argv);
  const sub = positionals[0] ?? "ls";
  const ctx = resolveShelfContext();
  try {
    if (sub === "ls") {
      const list = listTemplates(ctx.shelfDir);
      if (!list.length) console.log(`货架上还没有模板（init 会用内置的 ${DEFAULT_TEMPLATE} 配方）`);
      for (const t of list) console.log(`  ${t.name}  ${displayPath(t.key)}  ${t.description}`);
      run.data = { templates: list };
      return;
    }
    if (sub !== "show" || positionals.length > 2) fail(1, "用法: " + COMMANDS.template.usage);
    const manifest = loadManifest();
    const name = positionals[1] ?? manifest.template?.name ?? DEFAULT_TEMPLATE;
    const tpl = loadTemplate(ctx.shelfDir, name);
    if (!tpl) fail(1, `✗ 货架上没有模板 '${name}'（shelf template 看有哪些）`);
    const agents = manifest.agents?.length ? manifest.agents : (tpl.defaultAgents ?? ["claude", "codex"]);
    const aiDir = aiDirOf(manifest);
    const plan = expandTemplate(tpl, { shelfDir: ctx.shelfDir, agents, aiDir });
    console.log(`模板 ${tpl.name}${tpl.key ? `（货架 ${displayPath(tpl.key)}）` : "（内置配方）"} · agent: ${agents.join(" + ")} · ai 区: ${aiDir}/`);
    if (tpl.description) console.log(`  ${tpl.description}`);
    console.log("");
    for (const it of plan.items) {
      const tags = [it.planted ? "植入一次，之后归项目" : "随货架同步", ...(it.copy ? [`根目录副本 ${it.copy}`] : [])];
      console.log(`  ${it.dest}  ← ${displayPath(it.key)}（${tags.join("；")}）`);
    }
    console.log("");
    console.log(`  技能链接: ${agents.filter((n) => AGENT_TARGETS[n]).map((n) => `${AGENT_TARGETS[n].skillsDir} → ${aiDir}/jaSkills`).join(" · ")}`);
    // 固定目录：模板会装的技能在 frontmatter 里自己声明的（读货架上的版本）+ 配方里写的（内置配方兜底用）
    const skills = plan.items
      .filter((it) => fs.existsSync(path.join(shelfAbs(ctx, it.key), "SKILL.md")))
      .map((it) => ({ name: path.basename(it.dest), skillMd: path.join(shelfAbs(ctx, it.key), "SKILL.md") }));
    const scaffold = planScaffold(plan.scaffold, { aiDir, skills });
    if (scaffold.length) {
      console.log("  固定目录（init / sync 建，目录里放 .gitkeep）:");
      for (const s of scaffold) console.log(`    ${s.rel}${s.kind === "dir" ? "/" : ""}  ← ${s.by.join(" / ")}`);
    }
    for (const m of plan.missing) console.warn(`! ${m} 在货架上找不到`);
    run.data = {
      name: tpl.name,
      key: tpl.key ?? null,
      builtin: !!tpl.builtin,
      description: tpl.description ?? "",
      agents,
      aiDir,
      items: plan.items,
      links: agents.filter((n) => AGENT_TARGETS[n]).map((n) => ({ path: AGENT_TARGETS[n].skillsDir, to: `${aiDir}/jaSkills` })),
      scaffold: scaffold.map((s) => ({ path: s.rel, kind: s.kind, by: s.by })),
      missing: plan.missing,
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
      console.log("  " + (current.includes(n) ? "●" : "○") + " " + n + "  " + AGENT_TARGETS[n].skillsDir + "/ → 链接");
    }
    console.log("添加: shelf agents add <名>");
    run.data = {
      skillsHome: skillsHomeOf(manifest),
      configured: current,
      targets: TARGET_PRIORITY.map((n) => ({ name: n, skillsDir: AGENT_TARGETS[n].skillsDir, configured: current.includes(n) })),
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

  const ctx = resolveShelfContext({ forWrite: true });
  try {
    manifest.aiDir ??= detectAiDir(process.cwd()).name;
    manifest.agents = targets;
    const tpl = templateOf(ctx, manifest, manifest.template?.name ?? DEFAULT_TEMPLATE);
    manifest.template ??= tpl.builtin ? { name: tpl.name, builtin: true } : { name: tpl.name, commit: headCommit(ctx.root) };
    const r = await applyTemplate(ctx, manifest, tpl, targets);
    saveManifest(manifest);
    printApplied(manifest, targets, r, tpl);
    console.log("✓ agent 目标: " + (current.join(", ") || "（无）") + " → " + targets.join(", "));
    run.data.items = r.items.map(({ shown, ...rest }) => rest);
  } finally {
    ctx.cleanup();
  }
}

// ---- 子命令：adopt（收编外来技能，SHELF 决策 #27）----

export async function cmdShelfAdopt(argv = []) {
  parseArgs("adopt", argv);
  const manifest = loadManifest();
  manifest.aiDir ??= detectAiDir(process.cwd()).name;

  // agent 技能目录若被外部安装器换成了实体目录：内容迁入正本，恢复链接（含老版 .codex/skills 迁移）
  const health = healthChecks(manifest, null, { fix: true, links: true });
  const c = await reconcileLocalSkills(manifest, { allowPrune: true });
  saveManifest(manifest);
  const j = jaskillCheck(manifest);

  console.log("");
  console.log(
    "Adopt: " + c.registered + " 新登记, " + c.refreshed + " 指纹更新, " + c.missing + " 缺失保留, "
    + c.graduated + " 已升格/移除, " + health.linksFixed + " 目录收编重链；"
    + "local 段共 " + Object.keys(manifest.local).length + " 个本地技能",
  );
  printJaskill(j);
  if (Object.keys(manifest.local).length) {
    console.log("（本地技能不参与货架对账；想跨项目复用: shelf create " + skillsHomeOf(manifest) + "/<名> --to skills/<包>）");
  }
  run.data = { ...c, linksFixed: health.linksFixed, linksBlocked: health.linksBlocked, local: Object.keys(manifest.local), jaskill: j };
}

// ---- 子命令：home（查看/更新档口）----

export async function cmdShelfHome(argv) {
  const { flags } = parseArgs("home", argv);
  if (flags["--update"]) {
    const ok = refreshManagedHome({ force: true });
    if (!ok && !fs.existsSync(managedHomeDir)) {
      console.log("（本机没有托管档口——你用的是 SHELF_HOME 指定的 clone 或 npx 快照，更新请用 git pull）");
    } else if (ok) {
      console.log("✓ 托管档口已更新到最新");
    }
  }
  const ctx = resolveShelfContext();
  try {
    const modeText = {
      home: "SHELF_HOME / ~/.shelfrc 指定的 clone",
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

// ---- 子命令：sync / status（按账本与货架对账，SHELF 决策 #19 / #39）----

export async function cmdShelfSync(argv, { status = false } = {}) {
  const { flags } = parseArgs(status ? "status" : "sync", argv);
  const dryRun = status || !!flags["--dry-run"];
  const doMerge = !!flags["--merge"];
  const doPush = !!flags["--push"];
  if (dryRun && (doMerge || doPush)) fail(1, "✗ status / --dry-run 只读，不能和 --merge / --push 一起用");
  const cwd = process.cwd();

  const ctx = resolveShelfContext({ forWrite: true }); // 对账必须对着真最新：等同写操作，强制刷新
  let keepEphemeral = false;
  try {
    const manifest = loadManifest();
    if (!dryRun && manifest.agents?.length) manifest.aiDir ??= detectAiDir(cwd).name;
    const tpl = templateOf(ctx, manifest);
    const plan = tpl ? planOf(ctx, manifest, tpl) : null;
    const health = healthChecks(manifest, plan, { fix: !dryRun, links: true });
    if (!Object.keys(manifest.shelf ?? {}).length && !plan) {
      console.log("账本为空（.shelf.json 没有记录）——先 shelf init。");
      run.data = { dryRun, items: [], counts: {}, health };
      return;
    }

    // 模板新增的货 + 已记账的逐件对账
    const items = plan ? await installMissing(ctx, manifest, plan, { dryRun }) : [];
    const done = new Set(items.map((i) => i.key));
    for (const key of Object.keys(manifest.shelf ?? {})) {
      if (done.has(key)) continue;
      items.push(await reconcileEntry(ctx, manifest, key, { dryRun, restore: false, plan }));
    }

    // --merge：双改的物品三方合并；--push：本地领先与合并干净的推上货架（冲突留给人）
    if (doMerge) {
      for (const it of items.filter((i) => i.state === "both-changed")) {
        const rec = manifest.shelf[it.key];
        if (rec.mirror) {
          const m = reconcileMirror(rec);
          if (m.state === "mismatch") {
            Object.assign(it, { state: "mirror-mismatch", next: [`git diff --no-index ${q(rec.mirror)} ${q(rec.localPath)}`] });
            continue;
          }
        }
        try {
          const r = mergeItem(ctx, it.key, rec);
          printMergeResult(it.key, rec, r);
          it.files = r.files;
          if (r.state === "conflict") {
            Object.assign(it, { state: "merge-conflict", conflicts: r.conflicts.map((f) => f.path), next: [`shelf push ${q(rec.localPath)}`] });
          } else if (r.state === "same-as-shelf") {
            Object.assign(it, { state: "refreshed", pending: false, next: undefined });
          } else {
            Object.assign(it, { state: "merged", next: [`shelf push ${q(rec.localPath)}`] });
          }
        } catch (err) {
          if (!(err instanceof ShelfExit)) throw err;
          console.log(err.message);
          it.error = err.message;
        }
      }
    }
    if (doPush) {
      for (const it of items.filter((i) => i.state === "local-ahead" || i.state === "merged")) {
        const rec = manifest.shelf[it.key];
        const localAbs = path.resolve(cwd, rec.localPath);
        const { secrets } = guardScan(localAbs);
        if (secrets.length) {
          console.log(`✗ ${it.shown} 含疑似凭据文件（${secrets.map((x) => x.rel).join(", ")}），sync 不代推——确要推请单独 shelf push --force-secret`);
          it.error = "secrets";
          continue;
        }
        const r = applyAndCommit(ctx, it.key, localAbs, manifest, "update");
        keepEphemeral = r.keepEphemeral || keepEphemeral;
        Object.assign(it, { state: "pushed", pending: false, next: undefined, commit: r.commit });
      }
    }
    // 人在终端、没带自动化参数：逐条待决当场问
    if (run.interactive && !dryRun && !doMerge && !doPush) {
      for (const it of items.filter((i) => i.pending)) {
        if (await promptPending(ctx, manifest, it)) keepEphemeral = true;
      }
    }

    // 已装技能声明的固定目录（frontmatter 的 metadata.shelf-scaffold）：缺的补上，只建目录、放 .gitkeep；只读时只报不建
    const scaffold = manifest.agents?.length
      ? applyScaffold(
        cwd,
        planScaffold(plan?.scaffold ?? [], { aiDir: aiDirOf(manifest), skillsHomeAbs: path.resolve(cwd, skillsHomeOf(manifest)) })
          .filter((i) => i.kind === "dir"),
        { date: todayISO(), name: projectName(cwd), dryRun },
      )
      : { created: [], existed: [] };

    let local = null;
    if (!dryRun) local = await reconcileLocalSkills(manifest);
    const jaskill = jaskillCheck(manifest);
    // 模板里已经没有、当初由模板装进来的货：本地保留，提示一句
    const dropped = plan
      ? Object.entries(manifest.shelf ?? {}).filter(([k, r]) => r.fromTemplate && !plan.items.some((i) => i.key === k)).map(([k]) => k)
      : [];
    if (!dryRun) saveManifest(manifest);

    const pending = items.filter((i) => i.pending);
    const c = countStates(items);
    const parts = [
      [c.same, "一致", true], [c["would-update"], "待更新本地"], [c.updated, "更新本地"], [c["would-install"], "模板待装"],
      [c.installed, "模板新装"], [c.refreshed, "账本刷新"], [c.pushed, "推上库"], [c.cleaned, "清账"], [c.restored, "补拉"],
      [c.planted, "植入不对账"], [health.linksFixed, "链接修复"], [scaffold.created.length, dryRun ? "目录待补" : "目录补上"],
      [pending.length, "待决", true],
    ].filter(([n, , always]) => always || n > 0).map(([n, label]) => `${n ?? 0} ${label}`);
    console.log("");
    console.log(`${status ? "Status" : `Sync${dryRun ? "（dry-run）" : ""}`}: ${parts.join(" · ")}`
      + (local && (local.registered || local.refreshed || local.missing)
        ? `；本地技能: ${local.registered} 新登记 / ${local.refreshed} 指纹更新 / ${local.missing} 缺失`
        : ""));
    const planted = items.filter((x) => x.state === "planted");
    if (planted.length) {
      console.log(`植入，不对账（之后归项目维护）: ${planted.map((i) => i.localPath ?? i.shown).join(" · ")}`
        + `——要重新植入某件: shelf pull <本地路径> --force`);
    }
    if (scaffold.created.length) {
      console.log(`${dryRun ? "· 技能声明的固定目录将补上" : "✓ 补上技能声明的固定目录"}: ${scaffold.created.join(" · ")}`);
    }
    printPending(pending);
    printJaskill(jaskill);
    for (const k of dropped) console.log(`· 模板已不再包含 ${displayPath(k)}（本地保留；不要了: shelf forget ${q(k)}）`);

    run.data = {
      dryRun,
      template: plan ? { name: plan.name, builtin: plan.builtin } : null,
      items: items.map(({ shown, ...rest }) => rest), // shown 只是给人看的展示名，--json 里省掉
      counts: { ...c, pending: pending.length },
      health,
      scaffold: dryRun ? { wouldCreate: scaffold.created } : { created: scaffold.created },
      local,
      jaskill,
      droppedFromTemplate: dropped,
    };
    // 文本模式里每条待决的下一步已经跟在清单后面，只有 --json 才汇总进 next
    if (run.json) for (const x of pending) suggest(...(x.next ?? []));
    if (items.some((i) => i.state === "merge-conflict")) setExit(3);
    if (pending.length) setExit(2);
  } finally {
    if (!keepEphemeral) ctx.cleanup();
  }
}
