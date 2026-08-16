import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolveShelfContext, headCommit, remoteUrl, commitAndPush } from "../transport.mjs";
import { displayName, displayPath, resolveShelfPath } from "../shelfnames.mjs";
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

async function cmdShelfPull(args) {
  const destFlag = args.indexOf("--dest");
  let destRoot = null;
  if (destFlag !== -1) {
    destRoot = path.resolve(process.cwd(), args[destFlag + 1] ?? "");
    args = args.filter((_, i) => i !== destFlag && i !== destFlag + 1);
  }
  if (args.length === 0) {
    console.error("用法: atk shelf pull <shelf路径> [...] [--dest <目录>]");
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

async function cmdShelfBrowse() {
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

// ---- 子命令：push ----

function takeFlag(args, name, hasValue = false) {
  const i = args.indexOf(name);
  if (i === -1) return { args, value: undefined };
  const value = hasValue ? args[i + 1] : true;
  return { args: args.filter((_, j) => j !== i && (!hasValue || j !== i + 1)), value };
}

async function cmdShelfPush(argv) {
  let rest = argv;
  let to, yes, force, forceSecret;
  ({ args: rest, value: to } = takeFlag(rest, "--to", true));
  ({ args: rest, value: yes } = takeFlag(rest, "--yes"));
  ({ args: rest, value: force } = takeFlag(rest, "--force"));
  ({ args: rest, value: forceSecret } = takeFlag(rest, "--force-secret"));

  const local = rest[0];
  if (!local) {
    console.error("用法: atk shelf push <本地文件/文件夹> [--to <shelf路径>] [--yes] [--force-secret]");
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

    // 目标 shelf 路径：--to 全路径 > manifest 反查 > 货架根/<名字>
    let key;
    if (to) {
      const hit = resolveShelfPath(ctx.shelfDir, to, { allowCreate: true });
      key = hit.realRel;
      if (hit.created) console.log(`（货架上将新建路径 ${displayPath(key)}）`);
    } else {
      const found = findShelfEntryByLocalPath(manifest, toPosix(path.relative(process.cwd(), localAbs)));
      key = found ? found.shelfPath : path.basename(localAbs);
    }
    const targetAbs = path.join(ctx.shelfDir, ...key.split("/"));
    const shown = displayPath(key);

    // 安全阀：疑似凭据文件
    const files = listFilesRecursive(localAbs);
    const secrets = files.filter((f) => SECRET_PATTERNS.some((re) => re.test(path.basename(f.rel))));
    if (secrets.length > 0 && !forceSecret) {
      console.error(`✗ 疑似凭据文件，已拒绝（--force-secret 可放行）:`);
      for (const s of secrets) console.error(`    ${s.rel}`);
      process.exit(1);
    }
    const bigs = files.filter((f) => f.size > BIG_FILE_BYTES);
    for (const b of bigs) console.warn(`! 大文件 ${b.rel} (${fmtSize(b.size)})，GitHub 单文件上限 100MB`);

    // 冲突保护：货架在我们上次 pull 之后被别的设备改过？
    const recorded = manifest.shelf[key];
    if (fs.existsSync(targetAbs)) {
      const currentHash = contentHash(targetAbs);
      if (recorded && recorded.contentHash !== currentHash && !force) {
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
      } else if (!recorded && !yes && !force) {
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
    const d = diffSummary(targetAbs, localAbs);
    const total = d.added.length + d.removed.length + d.changed.length;
    if (total === 0 && fs.existsSync(targetAbs)) {
      console.log(`= ${shown} 与货架一致，无需 push`);
      return;
    }
    console.log(`将写入 shelf/${shown}：新增 ${d.added.length} / 删除 ${d.removed.length} / 修改 ${d.changed.length}`);
    for (const f of d.added) console.log(`  + ${f}`);
    for (const f of d.removed) console.log(`  - ${f}`);
    for (const f of d.changed) console.log(`  ~ ${f}`);
    if (!yes) {
      if (!INTERACTIVE) {
        console.error(`✗ 非交互环境：清单如上，确认无误后加 --yes 重跑。已中止。`);
        process.exit(2);
      }
      const act = await choose(`确认 push? [y]es / [n]o? `, [{ key: "y" }, { key: "n" }]);
      if (act === "n") {
        console.log("已中止。");
        return;
      }
    }

    // 应用 + 提交
    fs.rmSync(targetAbs, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
    copyFiltered(localAbs, targetAbs);

    const message = `shelf: update ${shown} (from ${os.hostname()})`;
    const result = commitAndPush(ctx.root, [toPosix(path.join("shelf", key))], message);

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
  } finally {
    if (!keepEphemeral) ctx.cleanup();
  }
}

// ---- 子命令：init ----

async function cmdShelfInit() {
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
    console.log("  .atk.json                 版本追踪 manifest");
    console.log("  .claude/skills/shelf-ops  货架操作手册（agent 据此执行 pull/push）");
  } finally {
    ctx.cleanup();
  }
}

// ---- 入口 ----

export async function cmdShelf(argv) {
  const sub = argv[0];
  if (sub === "pull") return cmdShelfPull(argv.slice(1));
  if (sub === "push") return cmdShelfPush(argv.slice(1));
  if (sub === "init") return cmdShelfInit(argv.slice(1));
  if (sub === undefined || sub === "list" || sub === "browse") return cmdShelfBrowse();
  console.error(`Unknown shelf command: ${sub}\n可用: atk shelf | pull | push | init`);
  process.exit(1);
}
