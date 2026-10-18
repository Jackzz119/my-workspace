// 三方对比 / 合并的底层：把「上次拉取的版本」「货架 HEAD」「本地」读成同一种快照，
// 逐文件合并（双改文件交给 git merge-file），以及 merge 之后、push 之前的合并标记。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { isBinary } from "./textdiff.mjs";

const IGNORE_NAMES = new Set(["node_modules", ".git", ".DS_Store"]);
const ignored = (rel) => rel.split("/").some((s) => IGNORE_NAMES.has(s));

function git(root, args, opts = {}) {
  return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 30, ...opts });
}

// ---- 快照：Map(相对路径 → Buffer)；单文件物品只有一个键 fileKey ----

export function readTreeFs(abs, fileKey) {
  const map = new Map();
  if (!fs.existsSync(abs)) return map;
  if (fs.statSync(abs).isFile()) {
    map.set(fileKey, fs.readFileSync(abs));
    return map;
  }
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORE_NAMES.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) walk(full, r);
      else if (e.isFile()) map.set(r, fs.readFileSync(full));
    }
  };
  walk(abs, "");
  return map;
}

function hasCommit(root, sha) {
  return spawnSync("git", ["cat-file", "-e", sha + "^{commit}"], { cwd: root, stdio: "ignore" }).status === 0;
}

// 浅克隆 / 临时克隆里没有那个提交时按 sha 补取一次（GitHub 允许按 sha 取可达提交）；完整克隆不加 --depth，免得把它变浅
function fetchCommit(root, sha) {
  let shallow = false;
  try {
    shallow = git(root, ["rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).trim() === "true";
  } catch { /* 老 git：当作完整克隆 */ }
  const args = ["fetch", "--quiet", ...(shallow ? ["--depth=1"] : []), "origin", sha];
  spawnSync("git", args, { cwd: root, stdio: "ignore", timeout: 60_000 });
}

// 货架 git 历史里某个提交的物品；cat-file --filters 按工作区换行规则还原，
// 与当初 pull 从工作区拷到本地的字节一致。取不到（无 sha、不在历史、那时路径不存在）返回 null
export function readTreeAtCommit(root, commit, key, fileKey) {
  if (!commit) return null;
  if (!hasCommit(root, commit)) {
    fetchCommit(root, commit);
    if (!hasCommit(root, commit)) return null;
  }
  const spec = `${commit}:shelf/${key}`;
  let type;
  try {
    type = git(root, ["cat-file", "-t", spec], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
  const read = (s) => git(root, ["cat-file", "--filters", s]);
  if (type === "blob") return new Map([[fileKey, read(spec)]]);
  const prefix = `shelf/${key}/`;
  const listed = git(root, ["ls-tree", "-r", "-z", "--name-only", commit, "--", prefix], { encoding: "utf8" })
    .split("\0").filter(Boolean);
  const map = new Map();
  for (const p of listed) {
    const rel = p.slice(prefix.length);
    if (!rel || ignored(rel)) continue;
    map.set(rel, read(`${commit}:${p}`));
  }
  return map;
}

// 与 version.mjs 的 contentHash 同一算法（用来核对重建出的基准是不是账本记的那一版）
export function mapHash(map, isFile) {
  const hash = crypto.createHash("sha256");
  if (isFile) {
    hash.update("file\0");
    hash.update([...map.values()][0] ?? Buffer.alloc(0));
  } else {
    for (const rel of [...map.keys()].sort()) {
      hash.update(rel);
      hash.update("\0");
      hash.update(map.get(rel));
      hash.update("\0");
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

// ---- 合并 ----

const same = (x, y) => x === y || (!!x && !!y && x.equals(y));

function mergeFile(ours, base, theirs, labels) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-merge-"));
  try {
    const [o, b, t] = ["ours", "base", "theirs"].map((n) => path.join(tmp, n));
    fs.writeFileSync(o, ours);
    fs.writeFileSync(b, base);
    fs.writeFileSync(t, theirs);
    const r = spawnSync("git", ["merge-file", "-p", "-L", labels.ours, "-L", labels.base, "-L", labels.theirs, o, b, t], {
      encoding: "buffer",
      maxBuffer: 1 << 30,
    });
    if (r.status === null || r.status < 0 || r.status >= 255) return { binary: true };
    return { out: r.stdout, conflicts: r.status };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 逐文件三方合并：只有一边改的取改的那边（新增 / 删除同理），两边都改的文本交给 git merge-file。
// 冲突的处理与 git 一致：内容冲突留标准冲突标记；一边删一边改 → 工作区留改过的那份；二进制 → 留本地
export function mergeTrees(base, theirs, ours, labels) {
  const paths = [...new Set([...base.keys(), ...theirs.keys(), ...ours.keys()])].sort();
  const result = new Map();
  const files = [];
  for (const p of paths) {
    const b = base.get(p);
    const t = theirs.get(p);
    const o = ours.get(p);
    if (same(o, t)) {
      if (o) result.set(p, o);
      files.push({ path: p, how: o ? (same(o, b) ? "same" : "both-same") : "both-deleted" });
    } else if (same(o, b)) {
      if (t) result.set(p, t);
      files.push({ path: p, how: !t ? "theirs-deleted" : b ? "theirs" : "theirs-added" });
    } else if (same(t, b)) {
      if (o) result.set(p, o);
      files.push({ path: p, how: !o ? "ours-deleted" : b ? "ours" : "ours-added" });
    } else if (o && t) {
      if (isBinary(o) || isBinary(t) || isBinary(b)) {
        result.set(p, o);
        files.push({ path: p, how: "conflict", reason: "binary" });
        continue;
      }
      const m = mergeFile(o, b ?? Buffer.alloc(0), t, labels);
      if (m.binary) {
        result.set(p, o);
        files.push({ path: p, how: "conflict", reason: "binary" });
      } else {
        result.set(p, m.out);
        files.push(m.conflicts
          ? { path: p, how: "conflict", reason: b ? "content" : "both-added", hunks: m.conflicts }
          : { path: p, how: "merged" });
      }
    } else if (o) {
      result.set(p, o);
      files.push({ path: p, how: "conflict", reason: "theirs-deleted" });
    } else {
      result.set(p, t);
      files.push({ path: p, how: "conflict", reason: "ours-deleted" });
    }
  }
  return { result, files, conflicts: files.filter((f) => f.how === "conflict") };
}

// 把合并结果写回本地：只动内容变了的文件，删掉结果里没有的文件并清理空目录
export function writeTree(abs, result, { isFile, fileKey, previous }) {
  if (isFile) {
    const buf = result.get(fileKey);
    if (buf) fs.writeFileSync(abs, buf);
    return;
  }
  for (const [rel, buf] of result) {
    if (same(previous.get(rel), buf)) continue;
    const full = path.join(abs, ...rel.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buf);
  }
  for (const rel of previous.keys()) {
    if (result.has(rel)) continue;
    const full = path.join(abs, ...rel.split("/"));
    fs.rmSync(full, { force: true });
    let dir = path.dirname(full);
    while (dir.startsWith(abs) && dir !== abs) {
      try {
        if (fs.readdirSync(dir).length) break;
        fs.rmdirSync(dir);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
  }
}

// merge 写入的冲突标记还在的文件（只认 shelf merge 自己的标签，不误伤文档里举例的冲突块）
export const MARK_OURS = "本地";
export const MARK_THEIRS = "货架";
const OPEN = new RegExp(`^<{7} ${MARK_OURS}`, "m");
const CLOSE = new RegExp(`^>{7} ${MARK_THEIRS}`, "m");

export function conflictMarkerFiles(map) {
  const hits = [];
  for (const [rel, buf] of map) {
    if (isBinary(buf)) continue;
    const text = buf.toString("utf8");
    if (OPEN.test(text) && CLOSE.test(text)) hits.push(rel);
  }
  return hits;
}

// ---- 合并标记：merge 之后、push 之前，记住「本地已合进货架哪一版」 ----
// 存在本机 ~/.shelf/state/merges.json（不进项目、不动账本：账本只在 push 成功后更新）

function stateFile() {
  return path.join(os.homedir(), ".shelf", "state", "merges.json");
}

function stateKey(cwd, key) {
  let real = path.resolve(cwd);
  try {
    real = fs.realpathSync.native(cwd);
  } catch { /* 用解析后的路径 */ }
  if (process.platform === "win32" || process.platform === "darwin") real = real.toLowerCase();
  return real.replaceAll("\\", "/") + "::" + key;
}

function loadStates() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
}

function saveStates(states) {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(states, null, 2) + "\n", "utf8");
}

export function getMergeState(cwd, key) {
  return loadStates()[stateKey(cwd, key)] ?? null;
}

export function setMergeState(cwd, key, value) {
  const states = loadStates();
  states[stateKey(cwd, key)] = value;
  saveStates(states);
}

export function clearMergeState(cwd, key) {
  const states = loadStates();
  const k = stateKey(cwd, key);
  if (!(k in states)) return;
  delete states[k];
  saveStates(states);
}
