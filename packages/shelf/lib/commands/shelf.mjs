import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolveShelfContext, headCommit, remoteUrl, commitAndPush } from "../transport.mjs";
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

// 凭据/大文件安全阀；违规直接退出
function guardFiles(localAbs, forceSecret) {
  const files = listFilesRecursive(localAbs);
  const secrets = files.filter((f) => SECRET_PATTERNS.some((re) => re.test(path.basename(f.rel))));
  if (secrets.length > 0 && !forceSecret) {
    console.error(`✗ 疑似凭据文件，已拒绝（--force-secret 可放行）:`);
    for (const s of secrets) console.error(`    ${s.rel}`);
    process.exit(1);
  }
  for (const b of files.filter((f) => f.size > BIG_FILE_BYTES)) {
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
  if (!result.committed) {
    console.log("= 内容与货架一致，无需提交");
  } else if (result.pushed) {
    console.log(`✓ 已推送 ${shown} (${result.sha.slice(0, 7)})`);
  } else if (result.pushError === "no-remote") {
    console.log(`✓ 已提交 ${shown} (${result.sha.slice(0, 7)})，仓库还没配 remote，配好后 git push 即同步`);
  } else {
    console.warn(`! 已提交 (${result.sha.slice(0, 7)}) 但 push 失败: ${result.pushError}`);
    if (ctx.mode === "ephemeral") {
      keepEphemeral = true;
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

  const ctx = resolveShelfContext();
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

  const ctx = resolveShelfContext();
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

// ---- 子命令：init ----

export async function cmdShelfInit() {
  const ctx = resolveShelfContext();
  try {
    const manifest = loadManifest();
    manifest.source ??= remoteUrl(ctx.root) || toPosix(ctx.root);

    const hit = resolveShelfPath(ctx.shelfDir, "skills/common/shelf-ops");
    if (!hit) {
      console.error("✗ 货架上找不到 skills/common/shelf-ops（操作手册 skill），检查 shelf 是否最新");
      process.exit(1);
    }
    const counters = newCounters();
    const dest = path.join(process.cwd(), ".claude", "skills", "shelf-ops");
    await pullEntry(ctx, hit.realRel, manifest, counters, safeAsk, dest);
    saveManifest(manifest);

    console.log("");
    console.log("工作区已就绪:");
    console.log("  .shelf.json               版本追踪 manifest");
    console.log("  .claude/skills/shelf-ops  货架操作手册（agent 据此执行 pull/push）");
  } finally {
    ctx.cleanup();
  }
}
