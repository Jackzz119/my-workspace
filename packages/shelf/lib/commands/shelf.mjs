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
import {
  loadManifest,
  saveManifest,
  setShelfEntry,
  findShelfEntryByLocalPath,
} from "../manifest.mjs";
import { choose } from "../prompt.mjs";

const IGNORE_NAMES = new Set(["node_modules", ".git", ".DS_Store"]);
const INTERACTIVE = stdin.isTTY === true;

// 非 TTY（agent/脚本驱动）时不能挂在交互提问上：pull 冲突自动选安全项
async function safeAsk(question, choices) {
  if (INTERACTIVE) return choose(question, choices);
  const fallback = choices.some((c) => c.key === "k") ? "k" : "s";
  console.log(`${question}→ 非交互环境，自动选 ${fallback}（安全项）`);
  return fallback;
}
const SECRET_PATTERNS = [/^\.env(\..+)?$/i, /\.key$/i, /\.pem$/i, /^auth\.json$/i, /^credentials/i];
const BIG_FILE_BYTES = 50 * 1024 * 1024;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function toPosix(p) {
  return p.replaceAll("\\", "/");
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
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
      out.push({ rel: toPosix(path.relative(base, full)), abs: full, size: entry.isFile() ? fs.statSync(full).size : 0 });
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

// ---- pull ----

function buildShelfEntry(ctx, srcAbs, destAbs) {
  return {
    sourceCommit: headCommit(ctx.root),
    contentHash: contentHash(srcAbs),
    pulledAt: todayISO(),
    localPath: toPosix(path.relative(process.cwd(), destAbs)),
  };
}

async function pullEntry(ctx, realRel, manifest, counters, ask, destOverride = null) {
  const src = path.join(ctx.shelfDir, ...realRel.split("/"));
  const dest = destOverride ?? path.join(process.cwd(), path.basename(realRel));
  const shown = displayPath(realRel);

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    copyFiltered(src, dest);
    setShelfEntry(manifest, realRel, buildShelfEntry(ctx, src, dest));
    console.log(`✓ pulled ${shown}`);
    counters.pulled++;
    return;
  }

  const recorded = manifest.shelf[realRel];
  const upstreamHash = contentHash(src);
  const localHash = contentHash(dest);
  const upstreamChanged = !recorded || recorded.contentHash !== upstreamHash;
  const localChanged = !recorded || recorded.contentHash !== localHash;

  if (!upstreamChanged && !localChanged) {
    console.log(`= up to date ${shown}`);
    counters.upToDate++;
    return;
  }

  let prompt;
  if (upstreamChanged && !localChanged) {
    prompt = `↑ ${shown} 货架有更新。[u]pdate / [s]kip / [q]uit? `;
  } else if (!upstreamChanged && localChanged) {
    prompt = `! ${shown} 本地有改动，货架无更新。[k]eep / [o]verwrite / [q]uit? `;
  } else {
    prompt = `⚠ ${shown} 货架和本地都改过。[u]pdate(覆盖本地) / [s]kip / [q]uit? `;
  }
  const keys = prompt.includes("[k]eep")
    ? [{ key: "k" }, { key: "o" }, { key: "q" }]
    : [{ key: "u" }, { key: "s" }, { key: "q" }];
  const action = await ask(prompt, keys);

  if (action === "u" || action === "o") {
    fs.rmSync(dest, { recursive: true, force: true });
    copyFiltered(src, dest);
    setShelfEntry(manifest, realRel, buildShelfEntry(ctx, src, dest));
    console.log(`✓ updated ${shown}`);
    counters.updated++;
  } else if (action === "s" || action === "k") {
    console.log(`- skipped ${shown}`);
    counters.skipped++;
  } else {
    counters.quit = true;
  }
}

function newCounters() {
  return { pulled: 0, updated: 0, skipped: 0, upToDate: 0, quit: false };
}

function printSummary(c) {
  console.log("");
  console.log(
    `Summary: ${c.pulled} pulled, ${c.updated} updated, ${c.skipped} skipped, ${c.upToDate} up-to-date` +
    (c.quit ? " (quit early)" : ""),
  );
}

// ---- 子命令：非交互 pull ----

export async function cmdShelfPull(args) {
  const destFlag = args.indexOf("--dest");
  let destRoot = null;
  if (destFlag !== -1) {
    destRoot = path.resolve(process.cwd(), args[destFlag + 1] ?? "");
    args = args.filter((_, i) => i !== destFlag && i !== destFlag + 1);
  }
  if (args.length === 0) {
    console.error("用法: shelf pull <shelf路径> [...] [--dest <目录>]");
    process.exit(1);
  }

  const ctx = resolveShelfContext();
  try {
    const manifest = loadManifest();
    manifest.source ??= remoteUrl(ctx.root) || toPosix(ctx.root);
    const counters = newCounters();
    for (const input of args) {
      if (counters.quit) break;
      const hit = resolveShelfPath(ctx.shelfDir, input);
      if (!hit) {
        console.error(`✗ 货架上没有 '${input}'`);
        continue;
      }
      const destOverride = destRoot ? path.join(destRoot, path.basename(hit.realRel)) : null;
      await pullEntry(ctx, hit.realRel, manifest, counters, safeAsk, destOverride);
    }
    saveManifest(manifest);
    printSummary(counters);
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

export async function cmdShelfBrowse() {
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
          await pullEntry(ctx, realRel, manifest, counters, askWithRl);
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

// ---- 上架/更新共用 ----

function takeFlag(args, name, hasValue = false) {
  const i = args.indexOf(name);
  if (i === -1) return { args, value: undefined };
  const value = hasValue ? args[i + 1] : true;
  return { args: args.filter((_, j) => j !== i && (!hasValue || j !== i + 1)), value };
}

function guardScan(localAbs) {
  const files = listFilesRecursive(localAbs);
  return {
    secrets: files.filter((f) => SECRET_PATTERNS.some((re) => re.test(path.basename(f.rel)))),
    bigs: files.filter((f) => f.size > BIG_FILE_BYTES),
  };
}

// 凭据/大文件安全阀；违规直接退出
function guardFiles(localAbs, forceSecret) {
  const { secrets, bigs } = guardScan(localAbs);
  if (secrets.length > 0 && !forceSecret) {
    console.error(`✗ 疑似凭据文件，已拒绝（--force-secret 可放行）:`);
    for (const s of secrets) console.error(`    ${s.rel}`);
    process.exit(1);
  }
  for (const b of bigs) {
    console.warn(`! 大文件 ${b.rel} (${fmtSize(b.size)})，GitHub 单文件上限 100MB`);
  }
}

function printChangeList(targetAbs, localAbs, shown) {
  const d = diffSummary(targetAbs, localAbs);
  const total = d.added.length + d.removed.length + d.changed.length;
  console.log(`将写入 shelf/${shown}：新增 ${d.added.length} / 删除 ${d.removed.length} / 修改 ${d.changed.length}`);
  for (const f of d.added) console.log(`  + ${f}`);
  for (const f of d.removed) console.log(`  - ${f}`);
  for (const f of d.changed) console.log(`  ~ ${f}`);
  return total;
}

async function confirmOrExit(promptText, yes) {
  if (yes) return true;
  if (!INTERACTIVE) {
    console.error(`✗ 非交互环境：清单如上，确认无误后加 --yes 重跑。已中止。`);
    process.exit(2);
  }
  const act = await choose(promptText, [{ key: "y" }, { key: "n" }]);
  if (act === "n") {
    console.log("已中止。");
    return false;
  }
  return true;
}

// 覆盖货架条目并提交；返回是否需要保留临时 clone
function applyAndCommit(ctx, key, localAbs, manifest, verb) {
  const targetAbs = path.join(ctx.shelfDir, ...key.split("/"));
  const shown = displayPath(key);

  fs.rmSync(targetAbs, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
  copyFiltered(localAbs, targetAbs);

  const message = `shelf: ${verb} ${shown} (from ${os.hostname()})`;
  const result = commitAndPush(ctx.root, [toPosix(path.join("shelf", key))], message);

  let keepEphemeral = false;
  if (result.failed) {
    console.error(`✗ 提交失败，货架已回滚到改动前: ${result.pushError}`);
    process.exit(4);
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

  setShelfEntry(manifest, key, {
    sourceCommit: result.sha ?? headCommit(ctx.root),
    contentHash: contentHash(targetAbs),
    pulledAt: todayISO(),
    localPath: toPosix(path.relative(process.cwd(), localAbs)),
  });
  manifest.source ??= remoteUrl(ctx.root) || toPosix(ctx.root);
  saveManifest(manifest);
  return keepEphemeral;
}

// 多个同名命中时让用户挑一个；非交互直接中止
async function pickAmong(hits, promptLabel) {
  console.log(promptLabel);
  hits.forEach((h, i) => console.log(`  ${i + 1}. ${displayPath(h)}`));
  if (!INTERACTIVE) {
    console.error(`✗ 非交互环境无法选择，已中止。`);
    process.exit(3);
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
    console.error("✗ push 不再接受 --to：更新已有条目会自动定位；新内容上架用 shelf create <路径> [--to <目录>]");
    process.exit(1);
  }
  let rest = argv;
  let yes, force, forceSecret;
  ({ args: rest, value: yes } = takeFlag(rest, "--yes"));
  ({ args: rest, value: force } = takeFlag(rest, "--force"));
  ({ args: rest, value: forceSecret } = takeFlag(rest, "--force-secret"));

  const local = rest[0];
  if (!local) {
    console.error("用法: shelf push <本地文件/文件夹> [--yes] [--force] [--force-secret]");
    process.exit(1);
  }
  const localAbs = path.resolve(process.cwd(), local);
  if (!fs.existsSync(localAbs)) {
    console.error(`✗ 本地路径不存在: ${local}`);
    process.exit(1);
  }

  const ctx = resolveShelfContext({ forWrite: true });
  let keepEphemeral = false;
  try {
    const manifest = loadManifest();

    // 定位链：记账原位 → 原位失效按名字找回 → 无记账按名字匹配 → 指路 create
    const found = findShelfEntryByLocalPath(manifest, toPosix(path.relative(process.cwd(), localAbs)));
    let key;
    let record = null;
    let relocatedFrom = null;

    if (found) {
      record = found.entry;
      key = found.shelfPath;
      if (!fs.existsSync(path.join(ctx.shelfDir, ...key.split("/")))) {
        const name = path.basename(key);
        const hits = findByBasename(ctx.shelfDir, name);
        if (hits.length === 0) {
          console.error(`✗ 原路径 ${displayPath(key)} 已不存在，货架上也没有同名 '${displayName(name)}'；如是新内容用 shelf create`);
          process.exit(1);
        }
        const target = hits.length === 1
          ? hits[0]
          : await pickAmong(hits, `货架上有多个同名 '${displayName(name)}'：`);
        if (!target) {
          console.log("已中止。");
          return;
        }
        const sameContent = record.contentHash === contentHash(path.join(ctx.shelfDir, ...target.split("/")));
        console.log(`↪ ${displayPath(key)} 已被移动到 ${displayPath(target)}${sameContent ? "（内容一致，纯搬家）" : "（且货架侧内容有差异）"}`);
        if (INTERACTIVE && !yes) {
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
        console.error(`✗ 货架上没有名为 '${name}' 的条目；新内容上架用 shelf create ${local}`);
        process.exit(1);
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

    const targetAbs = path.join(ctx.shelfDir, ...key.split("/"));
    const shown = displayPath(key);

    guardFiles(localAbs, forceSecret);

    // 冲突保护：货架在我们上次 pull 之后被别的设备改过？
    if (fs.existsSync(targetAbs)) {
      const currentHash = contentHash(targetAbs);
      if (record && record.contentHash !== currentHash && !force) {
        if (!INTERACTIVE) {
          const d = diffSummary(localAbs, targetAbs);
          console.error(`✗ 货架上的 ${shown} 在你上次 pull 之后已被修改（可能来自其他设备），已中止。`);
          console.error(`  货架相对本地：新增 ${d.added.length} / 删除 ${d.removed.length} / 不同 ${d.changed.length}`);
          for (const f of [...d.added.map((x) => "+ " + x), ...d.removed.map((x) => "- " + x), ...d.changed.map((x) => "~ " + x)]) {
            console.error(`    ${f}`);
          }
          console.error(`  人工确认要覆盖后，加 --force 重跑。`);
          process.exit(3);
        }
        while (true) {
          const act = await choose(
            `⚠ 货架上的 ${shown} 在你上次 pull 之后已被修改（可能来自其他设备）。[d]iff / [f]orce / [a]bort? `,
            [{ key: "d" }, { key: "f" }, { key: "a" }],
          );
          if (act === "a") {
            console.log("已中止，什么都没改。");
            return;
          }
          if (act === "f") break;
          const d = diffSummary(localAbs, targetAbs);
          console.log(`  货架相对本地：新增 ${d.added.length} / 删除 ${d.removed.length} / 不同 ${d.changed.length}`);
          for (const f of d.added) console.log(`    + ${f}`);
          for (const f of d.removed) console.log(`    - ${f}`);
          for (const f of d.changed) console.log(`    ~ ${f}`);
        }
      } else if (!record && !yes && !force) {
        if (!INTERACTIVE) {
          console.error(`✗ 货架上已存在 ${shown}（本工作区没有它的 pull 记录），覆盖需 --yes。已中止。`);
          process.exit(2);
        }
        const act = await choose(`货架上已存在 ${shown}，本次 push 会整体覆盖。[y]es / [n]o? `, [{ key: "y" }, { key: "n" }]);
        if (act === "n") {
          console.log("已中止。");
          return;
        }
      }
    }

    // 变更清单确认
    const total = printChangeList(targetAbs, localAbs, shown);
    if (total === 0 && fs.existsSync(targetAbs)) {
      console.log(`= ${shown} 与货架一致，无需 push`);
      if (relocatedFrom) {
        delete manifest.shelf[relocatedFrom];
        setShelfEntry(manifest, key, { ...record, localPath: toPosix(path.relative(process.cwd(), localAbs)) });
        saveManifest(manifest);
        console.log(`（记账已更新到新位置 ${shown}）`);
      }
      return;
    }
    if (!(await confirmOrExit(`确认 push? [y]es / [n]o? `, yes))) return;

    if (relocatedFrom) delete manifest.shelf[relocatedFrom];
    keepEphemeral = applyAndCommit(ctx, key, localAbs, manifest, "update");
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
  let rest = argv;
  let to, yes, forceSecret;
  ({ args: rest, value: to } = takeFlag(rest, "--to", true));
  ({ args: rest, value: yes } = takeFlag(rest, "--yes"));
  ({ args: rest, value: forceSecret } = takeFlag(rest, "--force-secret"));

  const local = rest[0];
  if (!local) {
    console.error("用法: shelf create <本地文件/文件夹> [--to <货架目录>] [--yes] [--force-secret]");
    process.exit(1);
  }
  const localAbs = path.resolve(process.cwd(), local);
  if (!fs.existsSync(localAbs)) {
    console.error(`✗ 本地路径不存在: ${local}`);
    process.exit(1);
  }
  const name = path.basename(localAbs);

  const ctx = resolveShelfContext({ forWrite: true });
  let keepEphemeral = false;
  try {
    // 名字即 ID：全架查重，重名拒绝
    const hits = findByBasename(ctx.shelfDir, name);
    if (hits.length > 0) {
      console.error(`✗ 货架上已有同名条目：`);
      for (const h of hits) console.error(`    ${displayPath(h)}`);
      console.error(`  想更新它 → shelf push ${local}；想另起一件 → 改个名字再 create。`);
      process.exit(1);
    }

    // 选位：--to 直达（可新建目录），否则交互浏览
    let destDirRel;
    if (to !== undefined) {
      const hit = resolveShelfPath(ctx.shelfDir, to, { allowCreate: true });
      if (!hit.created && fs.statSync(hit.abs).isFile()) {
        console.error(`✗ --to 必须是货架目录，不能是文件: ${to}`);
        process.exit(1);
      }
      if (hit.created) console.log(`（货架上将新建目录 ${displayPath(hit.realRel)}）`);
      destDirRel = hit.realRel;
    } else {
      if (!INTERACTIVE) {
        console.error(`✗ 非交互环境请用 --to <货架目录> 指定位置（如 --to templates）。已中止。`);
        process.exit(2);
      }
      destDirRel = await placementBrowse(ctx);
      if (destDirRel === null) {
        console.log("已取消。");
        return;
      }
    }
    const key = destDirRel ? `${destDirRel}/${name}` : name;

    guardFiles(localAbs, forceSecret);
    printChangeList(path.join(ctx.shelfDir, ...key.split("/")), localAbs, displayPath(key));
    if (!(await confirmOrExit(`确认上架? [y]es / [n]o? `, yes))) return;

    const manifest = loadManifest();
    keepEphemeral = applyAndCommit(ctx, key, localAbs, manifest, "add");
  } finally {
    if (!keepEphemeral) ctx.cleanup();
  }
}

// ---- init 植入协议（SHELF 决策 #21/#22/#23）----

// gitignore 补行：只补缺失的，其余不动；目录行同时认 ".claude" 与 ".claude/"
function ensureGitignore(cwd, lines) {
  const p = path.join(cwd, ".gitignore");
  const content = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  const NL = String.fromCharCode(10);
  const CR = String.fromCharCode(13);
  const have = new Set(content.split(NL).map((l) => l.replaceAll(CR, "").trim()));
  const missing = lines.filter((l) => {
    const bare = l.endsWith("/") ? l.slice(0, -1) : l;
    return !have.has(bare) && !have.has(bare + "/");
  });
  if (missing.length === 0) return [];
  const sep = content === "" || content.endsWith(NL) ? "" : NL;
  fs.writeFileSync(p, content + sep + "# shelf init: agent 资产不入项目库" + NL + missing.join(NL) + NL, "utf8");
  return missing;
}

// ---- agent 目标与技能正本（SHELF 决策 #24/#26）----

// 项目里技能的唯一正本；所有 agent 目录都是指向它的链接
const CANONICAL_SKILLS_DIR = "ai/jaSkills";

const AGENT_TARGETS = {
  claude: { skillsDir: ".claude/skills", doc: { input: "agents/claude/CLAUDE.md", dest: "CLAUDE.md" }, ignore: [".claude/", "CLAUDE.md"] },
  codex: { skillsDir: ".codex/skills", doc: { input: "agents/codex/AGENTS.md", dest: "AGENTS.md" }, ignore: [".codex/", "AGENTS.md"] },
  kimi: { skillsDir: ".kimi/skills", doc: { input: "agents/codex/AGENTS.md", dest: "AGENTS.md" }, ignore: [".kimi/", "AGENTS.md"] },
};
const TARGET_PRIORITY = ["claude", "codex", "kimi"];

// "claude,codex" / "all" → 校验并按固定顺序去重
function parseTargetNames(spec) {
  const names = spec === "all"
    ? [...TARGET_PRIORITY]
    : String(spec).split(",").map((x) => x.trim()).filter(Boolean);
  const bad = names.filter((n) => !AGENT_TARGETS[n]);
  if (bad.length) {
    console.error("✗ 未知 agent 目标: " + bad.join(", ") + "（可选: " + TARGET_PRIORITY.join(" / ") + " / all）");
    process.exit(1);
  }
  return TARGET_PRIORITY.filter((n) => names.includes(n));
}

async function askTargets() {
  const rl = makeLineReader();
  try {
    console.log("要接入哪些 agent？（各自的技能目录会链接到正本 " + CANONICAL_SKILLS_DIR + "/）");
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

// 把 agent 的技能目录做成指向正本的链接（Windows junction 免管理员 / POSIX 相对 symlink）。
// 遇到老式实体目录（复制镜像时代）自动迁移：内容并入正本（同名跳过），原地替换为链接。
// 返回 "ok"（已正确）/ "created" / "fixed"
function ensureSkillsLink(cwd, targetName) {
  const rel = AGENT_TARGETS[targetName].skillsDir;
  const linkPath = path.join(cwd, ...rel.split("/"));
  const canonical = path.join(cwd, ...CANONICAL_SKILLS_DIR.split("/"));
  fs.mkdirSync(canonical, { recursive: true });
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });

  let st = null;
  try { st = fs.lstatSync(linkPath); } catch { st = null; }

  if (st && st.isSymbolicLink()) {
    try {
      if (fs.realpathSync(linkPath) === fs.realpathSync(canonical)) return "ok";
    } catch { /* 断链 → 重建 */ }
    fs.rmSync(linkPath, { recursive: true, force: true });
  } else if (st && st.isDirectory()) {
    let moved = 0;
    let skipped = 0;
    for (const e of fs.readdirSync(linkPath, { withFileTypes: true })) {
      if (IGNORE_NAMES.has(e.name)) continue;
      const from = path.join(linkPath, e.name);
      const to = path.join(canonical, e.name);
      if (fs.existsSync(to)) {
        skipped++;
        continue;
      }
      fs.cpSync(from, to, { recursive: true });
      moved++;
    }
    fs.rmSync(linkPath, { recursive: true, force: true });
    if (moved || skipped) {
      console.log("↪ " + rel + " 原为实体目录：迁入正本 " + moved + " 项"
        + (skipped ? "，同名跳过 " + skipped + " 项" : "") + "，已替换为链接");
    }
  } else if (st) {
    fs.rmSync(linkPath, { force: true });
  }

  if (process.platform === "win32") {
    fs.symlinkSync(canonical, linkPath, "junction");
  } else {
    fs.symlinkSync(path.relative(path.dirname(linkPath), canonical), linkPath, "dir");
  }
  return st ? "fixed" : "created";
}

// 植入引擎（init 与 agents add 共用）：协议文档去重植入 + multica/JASKILL +
// common 技能拉进正本 ai/jaSkills + 各目标技能目录链接化 + gitignore
async function plantForTargets(ctx, manifest, targets) {
  const plan = [];
  const seenDoc = new Set();
  for (const n of targets) {
    const doc = AGENT_TARGETS[n].doc;
    if (seenDoc.has(doc.dest)) continue; // codex/kimi 共用 AGENTS.md，只植一份
    seenDoc.add(doc.dest);
    plan.push({ input: doc.input, dest: doc.dest });
  }
  plan.push({ input: "multica", dest: "multica", optional: true });
  plan.push({ input: "docs/JASKILL.md", dest: "ai/JASKILL.md" });

  const common = resolveShelfPath(ctx.shelfDir, "skills/common");
  if (common) {
    for (const e of fs.readdirSync(common.abs, { withFileTypes: true })) {
      if (!e.isDirectory() || IGNORE_NAMES.has(e.name)) continue;
      plan.push({
        input: common.realRel + "/" + e.name,
        dest: CANONICAL_SKILLS_DIR + "/" + e.name,
      });
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
    await pullEntry(ctx, hit.realRel, manifest, counters, safeAsk, path.resolve(process.cwd(), item.dest));
  }

  let linksMade = 0;
  for (const n of targets) {
    if (ensureSkillsLink(process.cwd(), n) !== "ok") linksMade++;
  }

  const ignoreLines = [...new Set(targets.flatMap((n) => AGENT_TARGETS[n].ignore))];
  const added = ensureGitignore(process.cwd(), ignoreLines);
  return { counters, linksMade, added };
}

function printPlantResult(targets, r) {
  printSummary(r.counters);
  if (r.linksMade) console.log("⛓ 建立/修复链接 " + r.linksMade + " 个");
  if (r.added.length) console.log("✓ .gitignore 补行: " + r.added.join(", "));
  console.log("");
  console.log("工作区已接入货架（agent 目标: " + targets.join(" + ") + "）:");
  const docs = [...new Set(targets.map((n) => AGENT_TARGETS[n].doc.dest))].join(" / ");
  console.log("  " + docs + "  工作协议（真源在货架，shelf sync 保持最新）");
  console.log("  ai/JASKILL.md  基础技能名册");
  console.log("  " + CANONICAL_SKILLS_DIR + "/  技能唯一正本（改技能、拉技能都在这）");
  console.log("  " + targets.map((n) => AGENT_TARGETS[n].skillsDir).join(" · ") + "  → 指向正本的链接");
  console.log("  .shelf.json  记账本（进项目 git，队友 clone 后 shelf init 即还原）");
}

export async function cmdShelfInit(argv = []) {
  let rest = argv;
  let agentsFlag;
  ({ args: rest, value: agentsFlag } = takeFlag(rest, "--agents", true));

  const ctx = resolveShelfContext();
  try {
    if (path.resolve(process.cwd()) === path.resolve(ctx.root)) {
      console.error("✗ 这里就是货架 home 本体，不能对它 init（防止把忽略规则写进货架仓库）");
      process.exit(1);
    }
    const manifest = loadManifest();
    manifest.source ??= remoteUrl(ctx.root) || toPosix(ctx.root);

    let targets;
    if (agentsFlag !== undefined) {
      targets = parseTargetNames(agentsFlag);
    } else if (manifest.agents?.length) {
      targets = TARGET_PRIORITY.filter((n) => manifest.agents.includes(n));
      console.log("（沿用已配置的 agent 目标: " + targets.join(", ") + "；调整用 shelf agents add 或 --agents）");
    } else if (INTERACTIVE) {
      targets = await askTargets();
      if (!targets || !targets.length) {
        console.log("已取消。");
        return;
      }
    } else {
      console.error("✗ 非交互环境首次 init 需指定 --agents claude,codex,kimi（或 all）。已中止。");
      process.exit(2);
    }

    const result = await plantForTargets(ctx, manifest, targets);
    manifest.agents = targets;
    saveManifest(manifest);
    printPlantResult(targets, result);
  } finally {
    ctx.cleanup();
  }
}

// ---- 子命令：agents（查看/添加 agent 目标，SHELF 决策 #24）----

export async function cmdShelfAgents(argv) {
  const manifest = loadManifest();
  const current = TARGET_PRIORITY.filter((n) => (manifest.agents ?? []).includes(n));
  const sub = argv[0];

  if (sub === undefined) {
    console.log("技能正本: " + CANONICAL_SKILLS_DIR + "/（改技能、拉技能都在这）");
    console.log("已配置:   " + (current.length ? current.join(", ") : "（无——先跑 shelf init）"));
    for (const n of TARGET_PRIORITY) {
      const t = AGENT_TARGETS[n];
      console.log("  " + (current.includes(n) ? "●" : "○") + " " + n + "  " + t.skillsDir + "/ → 链接 · " + t.doc.dest);
    }
    console.log("添加: shelf agents add <名>");
    return;
  }
  if (sub !== "add" || argv.length < 2) {
    console.error("用法: shelf agents             查看已配置/可用目标");
    console.error("      shelf agents add <名>   添加目标（claude / codex / kimi / all）");
    process.exit(1);
  }

  const adding = parseTargetNames(argv.slice(1).join(","));
  const targets = TARGET_PRIORITY.filter((n) => current.includes(n) || adding.includes(n));
  if (targets.join() === current.join()) {
    console.log("= 目标已包含，无需变更（" + current.join(", ") + "）");
    return;
  }

  const ctx = resolveShelfContext();
  try {
    const result = await plantForTargets(ctx, manifest, targets);
    manifest.agents = targets;
    saveManifest(manifest);
    printPlantResult(targets, result);
    console.log("✓ agent 目标: " + (current.join(", ") || "（无）") + " → " + targets.join(", "));
  } finally {
    ctx.cleanup();
  }
}

// ---- 子命令：adopt（收编外来技能，SHELF 决策 #27）----

export async function cmdShelfAdopt() {
  const manifest = loadManifest();
  const cwd = process.cwd();
  const canonical = path.join(cwd, ...CANONICAL_SKILLS_DIR.split("/"));

  // ① agent 技能目录若被外部安装器换成了实体目录：内容迁入正本，恢复链接
  let relinked = 0;
  for (const n of manifest.agents ?? []) {
    if (!AGENT_TARGETS[n]) continue;
    if (ensureSkillsLink(cwd, n) !== "ok") relinked++;
  }

  // ② 全量重算 local 段：正本里未被 shelf 段追踪的技能 = 本地/三方技能
  const tracked = new Set(
    Object.values(manifest.shelf ?? {}).map((e) => toPosix(e.localPath ?? "")),
  );
  const prevLocal = manifest.local ?? {};
  const local = {};
  let added = 0;
  let refreshed = 0;
  let graduated = 0;

  if (fs.existsSync(canonical)) {
    for (const e of fs.readdirSync(canonical, { withFileTypes: true })) {
      if (!e.isDirectory() || IGNORE_NAMES.has(e.name)) continue;
      const localPath = CANONICAL_SKILLS_DIR + "/" + e.name;
      if (tracked.has(localPath)) continue; // 货架商品，账在 shelf 段
      const hash = contentHash(path.join(canonical, e.name));
      const prev = prevLocal[e.name];
      if (!prev) {
        local[e.name] = { contentHash: hash, addedAt: todayISO(), origin: "adopted" };
        console.log("✚ 登记本地技能: " + e.name);
        added++;
      } else {
        if (prev.contentHash !== hash) refreshed++;
        local[e.name] = { ...prev, contentHash: hash };
      }
    }
  }
  graduated = Object.keys(prevLocal).filter((n) => !(n in local)).length;

  manifest.local = local;
  saveManifest(manifest);

  console.log("");
  console.log(
    "Adopt: " + added + " 新登记, " + refreshed + " 指纹更新, "
    + graduated + " 已升格/移除, " + relinked + " 目录收编重链；"
    + "local 段共 " + Object.keys(local).length + " 个本地技能",
  );
  if (Object.keys(local).length) {
    console.log("（本地技能不参与货架对账；想跨项目复用: shelf create " + CANONICAL_SKILLS_DIR + "/<名> --to skills/<包>）");
  }
}

// ---- 子命令：home（查看/更新档口）----

export async function cmdShelfHome(argv) {
  if (argv.includes("--update")) {
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
    console.log(`货架位置: ${ctx.shelfDir}`);
    console.log(`模式:     ${modeText}`);
    console.log(`来源:     ${remoteUrl(ctx.root) ?? DEFAULT_REMOTE}`);
    const entries = fs.readdirSync(ctx.shelfDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !IGNORE_NAMES.has(e.name))
      .map((e) => displayName(e.name));
    console.log(`根分类:   ${entries.join(" · ") || "(空)"}`);
  } finally {
    ctx.cleanup();
  }
}

// ---- 子命令：sync（按账本与货架对账，SHELF 决策 #19）----

// 逐行内容 diff 直通终端（git 自带着色），方向：库上 → 本地
function showLineDiff(shelfAbs, localAbs, shown) {
  console.log(`—— ${shown}  diff（库上 → 本地）——`);
  spawnSync("git", ["diff", "--no-index", "--color=always", "--", shelfAbs, localAbs], { stdio: "inherit" });
}

export async function cmdShelfSync(argv) {
  let rest = argv;
  let dryRun;
  ({ args: rest, value: dryRun } = takeFlag(rest, "--dry-run"));

  const ctx = resolveShelfContext({ forWrite: true }); // 对账必须对着真最新：等同写操作，强制刷新
  let keepEphemeral = false;
  try {
    const manifest = loadManifest();
    const entries = Object.entries(manifest.shelf ?? {});
    if (entries.length === 0) {
      console.log("账本为空（.shelf.json 没有 shelf 段记录）——先 shelf pull / create。");
      return;
    }

    const c = { same: 0, updated: 0, pushed: 0, skipped: 0, cleaned: 0 };
    const pending = [];

    for (const [key, rec] of entries) {
      let effKey = key;
      let target = path.join(ctx.shelfDir, ...effKey.split("/"));
      let shown = displayPath(effKey);
      const localAbs = path.resolve(process.cwd(), rec.localPath ?? "");
      const localExists = !!rec.localPath && fs.existsSync(localAbs);

      // 情形 5：库上路径没了 → 按名字找回（搬家）或报告下架
      if (!fs.existsSync(target)) {
        const name = path.basename(effKey);
        const hits = findByBasename(ctx.shelfDir, name);
        if (hits.length === 1) {
          if (dryRun) {
            console.log(`↪ ${shown} 已被移动到 ${displayPath(hits[0])}（--dry-run，暂不改账）`);
          } else {
            delete manifest.shelf[effKey];
            manifest.shelf[hits[0]] = rec;
            console.log(`↪ ${shown} 已被移动到 ${displayPath(hits[0])}，记账已更新`);
          }
          effKey = hits[0];
          target = path.join(ctx.shelfDir, ...effKey.split("/"));
          shown = displayPath(effKey);
        } else {
          const label = hits.length === 0 ? "已从货架移除" : `同名多义（${hits.length} 处）`;
          if (!INTERACTIVE || dryRun) {
            console.log(`⚠ 待决 ${shown}：${label}`);
            pending.push(`${shown}（${label}）`);
            continue;
          }
          const act = await choose(`⚠ ${shown} ${label}。[r]清记账 / [s]跳过? `, [{ key: "r" }, { key: "s" }]);
          if (act === "r") {
            delete manifest.shelf[effKey];
            console.log(`✓ 已清记账 ${shown}（本地文件未动；想重新上架用 shelf create）`);
            c.cleaned++;
          } else c.skipped++;
          continue;
        }
      }

      // 情形 6：本地文件没了 → 孤儿记账
      if (!localExists) {
        if (!INTERACTIVE || dryRun) {
          console.log(`⚠ 待决 ${shown}：本地文件不存在（${rec.localPath ?? "无 localPath"}）`);
          pending.push(`${shown}（本地文件不存在）`);
          continue;
        }
        const act = await choose(
          `⚠ ${shown} 的本地文件不存在（${rec.localPath ?? "无 localPath"}）。[p]重新拉取 / [r]清记账 / [s]跳过? `,
          [{ key: "p" }, { key: "r" }, { key: "s" }],
        );
        if (act === "p") {
          fs.mkdirSync(path.dirname(localAbs), { recursive: true });
          copyFiltered(target, localAbs);
          manifest.shelf[effKey] = { ...rec, contentHash: contentHash(target), sourceCommit: headCommit(ctx.root), pulledAt: todayISO() };
          console.log(`↓ 已重新拉取 ${shown}`);
          c.updated++;
        } else if (act === "r") {
          delete manifest.shelf[effKey];
          console.log(`✓ 已清记账 ${shown}`);
          c.cleaned++;
        } else c.skipped++;
        continue;
      }

      const S = contentHash(target);
      const L = contentHash(localAbs);
      const R = rec.contentHash;

      if (S === R && L === R) { c.same++; continue; }

      // 情形 2：库上有新版、本地没动 → 自动覆盖本地（零损失）
      if (S !== R && L === R) {
        if (dryRun) {
          console.log(`↓ 将更新本地：${shown}`);
          c.updated++;
          continue;
        }
        fs.rmSync(localAbs, { recursive: true, force: true });
        copyFiltered(target, localAbs);
        manifest.shelf[effKey] = { ...rec, contentHash: S, sourceCommit: headCommit(ctx.root), pulledAt: todayISO() };
        console.log(`↓ 已更新本地：${shown}`);
        c.updated++;
        continue;
      }

      // 情形 3/4：本地有改动（本地领先，或双方都改）
      const both = S !== R;
      const tag = both ? "双方都改过" : "本地领先";
      if (!INTERACTIVE || dryRun) {
        const d = diffSummary(target, localAbs);
        console.log(`⚠ 待决 ${shown}（${tag}）：本地相对库上 新增 ${d.added.length} / 删除 ${d.removed.length} / 修改 ${d.changed.length}`);
        pending.push(`${shown}（${tag}）`);
        continue;
      }

      showLineDiff(target, localAbs, shown);
      const act = await choose(`${shown}（${tag}）。[p]本地推上库 / [o]库覆盖本地 / [s]跳过? `, [{ key: "p" }, { key: "o" }, { key: "s" }]);
      if (act === "s") { c.skipped++; continue; }
      if (act === "o") {
        fs.rmSync(localAbs, { recursive: true, force: true });
        copyFiltered(target, localAbs);
        manifest.shelf[effKey] = { ...rec, contentHash: S, sourceCommit: headCommit(ctx.root), pulledAt: todayISO() };
        console.log(`↓ 已用库上版本覆盖本地：${shown}`);
        c.updated++;
        continue;
      }
      // p：本地推上库
      if (both) {
        const confirm = await choose(`库上的改动将被你的本地版本覆盖，确认? [y]es / [n]o? `, [{ key: "y" }, { key: "n" }]);
        if (confirm === "n") { c.skipped++; continue; }
      }
      const { secrets } = guardScan(localAbs);
      if (secrets.length > 0) {
        console.log(`✗ ${shown} 含疑似凭据文件（${secrets.map((x) => x.rel).join(", ")}），sync 不代推，已跳过——确要推请单独 shelf push --force-secret`);
        c.skipped++;
        continue;
      }
      keepEphemeral = applyAndCommit(ctx, effKey, localAbs, manifest, "update") || keepEphemeral;
      c.pushed++;
    }

    // 链接完整性（决策 #26）：已配置目标的技能目录必须是指向 ai/jaSkills 的链接
    let linksFixed = 0;
    if (!dryRun && manifest.agents?.length) {
      for (const n of manifest.agents) {
        if (!AGENT_TARGETS[n]) continue;
        if (ensureSkillsLink(process.cwd(), n) !== "ok") linksFixed++;
      }
    }

    if (!dryRun) saveManifest(manifest);
    console.log("");
    console.log(
      `Sync${dryRun ? "（dry-run）" : ""}: ${c.same} 一致, ${c.updated} 更新本地, ${c.pushed} 推上库, ` +
      `${c.cleaned} 清账, ${c.skipped} 跳过, ${linksFixed} 链接修复, ${pending.length} 待决`,
    );
    if (pending.length) {
      for (const x of pending) console.log(`  · ${x}`);
      if (!INTERACTIVE && !dryRun) process.exit(2);
    }
  } finally {
    if (!keepEphemeral) ctx.cleanup();
  }
}
