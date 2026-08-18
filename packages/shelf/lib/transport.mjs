import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./paths.mjs";

// 内容货架的默认来源（CLI 发布为公开包，这里只暴露仓库地址，不含任何访问权）
export const DEFAULT_REMOTE = "https://github.com/Jackzz119/my-workspace.git";

// 托管档口：全局安装的 CLI 自己维护的一份 clone，用户不需要手动 clone
export const managedHomeDir = path.join(os.homedir(), ".shelf", "home");
const refreshStamp = path.join(os.homedir(), ".shelf", ".last-refresh");
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const NL = String.fromCharCode(10);

// shelf 传输层（SHELF 决策 #4 / #16 / #17）解析顺序：
//   1. SHELF_HOME / ATK_HOME 环境变量指定的 clone
//   2. CLI 自身所在的 clone（monorepo 内直跑 / npm link 都命中）
//   3. ~/.shelfrc 的 home
//   4. 托管档口 ~/.shelf/home（存在即用，按小时节流 git pull）
//   5. npx 快照（包内带 shelf/ 但无 .git）：读操作直接用
//   6. 都没有：自动 clone 出托管档口；快照场景或显式 ephemeral 时走一次性 clone

function git(args, cwd, opts = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  }).trim();
}

function firstLines(err, n = 3) {
  return (err.stderr || err.message || "").toString().trim().split(NL).slice(0, n).join(" / ");
}

function hasShelf(root) {
  return !!root && fs.existsSync(path.join(root, "shelf"));
}

function isGitRepo(root) {
  return !!root && fs.existsSync(path.join(root, ".git"));
}

function pkgField(root, field) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))[field] ?? null;
  } catch {
    return null;
  }
}

function repoUrlFromPkg(root) {
  const repo = pkgField(root, "repository");
  const url = typeof repo === "string" ? repo : repo?.url;
  if (!url) return null;
  return url.startsWith("git+") ? url.slice(4) : url;
}

function readRc() {
  for (const name of [".shelfrc", ".atkrc"]) {
    const rcPath = path.join(os.homedir(), name);
    if (!fs.existsSync(rcPath)) continue;
    try {
      return JSON.parse(fs.readFileSync(rcPath, "utf8"));
    } catch {
      console.warn("! ~/" + name + " 不是合法 JSON，已忽略");
    }
  }
  return {};
}

function resolveRemote(rc, snapshot) {
  return process.env.SHELF_REMOTE
    || process.env.ATK_REMOTE
    || rc.remote
    || (snapshot ? repoUrlFromPkg(snapshot) : null)
    || DEFAULT_REMOTE;
}

// 托管档口按小时节流拉取；离线或失败都不阻断命令
export function refreshManagedHome({ force = false } = {}) {
  if (!isGitRepo(managedHomeDir)) return false;
  if (!force) {
    try {
      const age = Date.now() - fs.statSync(refreshStamp).mtimeMs;
      if (age < REFRESH_INTERVAL_MS) return false;
    } catch { /* 没有戳记就拉一次 */ }
  }
  try {
    git(["pull", "--ff-only", "--quiet"], managedHomeDir);
    fs.mkdirSync(path.dirname(refreshStamp), { recursive: true });
    fs.writeFileSync(refreshStamp, new Date().toISOString(), "utf8");
    return true;
  } catch (err) {
    console.warn("! 托管档口更新失败（继续用本地副本）: " + firstLines(err, 1));
    return false;
  }
}

function createManagedHome(remote) {
  fs.mkdirSync(path.dirname(managedHomeDir), { recursive: true });
  console.log("⇣ 首次使用：正在把货架 clone 到 " + managedHomeDir + " …");
  // -c core.autocrlf=false 必须在 clone 当时生效：我们按字节复制文件，
  // 若 checkout 时做了换行符转换，工作区会永远显示"已修改"，进而卡住自动更新
  git(["clone", "-c", "core.autocrlf=false", "--quiet", remote, managedHomeDir], os.homedir());
  fs.writeFileSync(refreshStamp, new Date().toISOString(), "utf8");
  console.log("✓ 档口就绪，以后所有命令都在本地跑（更新用 shelf home --update）");
}

function ephemeralClone(remote) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-"));
  git(["clone", "--depth=1", "--filter=blob:none", "--sparse", "--quiet", remote, tmp], os.tmpdir());
  git(["sparse-checkout", "set", "shelf"], tmp);
  return tmp;
}

function homeContext(root, mode = "home") {
  return { mode, root, shelfDir: path.join(root, "shelf"), cleanup() {} };
}

export function resolveShelfContext({ forWrite = false } = {}) {
  const rc = readRc();

  const explicit = [process.env.SHELF_HOME, process.env.ATK_HOME, rc.home]
    .find((r) => hasShelf(r) && isGitRepo(r));
  if (explicit) return homeContext(explicit);

  if (hasShelf(repoRoot) && isGitRepo(repoRoot)) return homeContext(repoRoot);

  if (hasShelf(managedHomeDir) && isGitRepo(managedHomeDir)) {
    refreshManagedHome();
    return homeContext(managedHomeDir, "managed");
  }

  // npm/npx 安装的快照：有 shelf/ 没 .git
  const snapshot = hasShelf(repoRoot) && !isGitRepo(repoRoot) ? repoRoot : null;
  if (snapshot && !forWrite) {
    return { mode: "snapshot", root: snapshot, shelfDir: path.join(snapshot, "shelf"), cleanup() {} };
  }

  const remote = resolveRemote(rc, snapshot);
  const ephemeralOnly = process.env.SHELF_EPHEMERAL === "1" || rc.ephemeral === true || !!snapshot;

  if (!ephemeralOnly) {
    createManagedHome(remote);
    return homeContext(managedHomeDir, "managed");
  }

  const tmp = ephemeralClone(remote);
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 尽力而为 */ }
  };
  // process.exit 会跳过 finally，这里兜底，保证任何退出路径都不留临时目录
  process.on("exit", cleanup);
  return {
    mode: "ephemeral",
    root: tmp,
    shelfDir: path.join(tmp, "shelf"),
    cleanup,
    keep() { disposed = true; },   // push 失败要保留现场时解除自动清理
  };
}

export function headCommit(root) {
  try {
    return git(["rev-parse", "HEAD"], root) || null;
  } catch {
    // npx 快照没有 .git；npm 打包 git 依赖时可能注入 package.json 的 gitHead
    return pkgField(root, "gitHead");
  }
}

export function remoteUrl(root) {
  try {
    return git(["config", "--get", "remote.origin.url"], root) || null;
  } catch {
    return repoUrlFromPkg(root);
  }
}

function hasGitIdentity(root) {
  try {
    return !!git(["config", "user.email"], root);
  } catch {
    return false;
  }
}

// 全新机器可能还没配 git 身份，会导致档口提交失败。只给我们自己建的档口兜底，
// 绝不改用户自己的 clone。
function isToolOwnedClone(root) {
  const r = path.resolve(root);
  return r === path.resolve(managedHomeDir) || r.startsWith(path.resolve(os.tmpdir()));
}

function ensureManagedIdentity(root) {
  if (!isToolOwnedClone(root)) return;
  if (hasGitIdentity(root)) return;
  const email = "shelf@" + os.hostname();
  git(["config", "user.name", "shelf"], root);
  git(["config", "user.email", email], root);
  console.log("（本机未配置 git 身份，已给本次 clone 设 shelf <" + email + ">；想换成自己的：git -C " + root + " config user.name 你的名字）");
}

// 提交失败时把货架工作区恢复原状，避免半改状态被下次 push 误判成「异机修改」
function restoreWorktree(root, relPaths) {
  for (const args of [
    ["reset", "--quiet", "--", ...relPaths],
    ["checkout", "--", ...relPaths],
    ["clean", "-qfd", "--", ...relPaths],
  ]) {
    try { git(args, root); } catch { /* 尽力而为 */ }
  }
}

// 提交 shelf 下的指定路径；有 remote 则尝试 push。
// 返回 { committed, sha, pushed, pushError, failed }
export function commitAndPush(root, relPaths, message) {
  let sha;
  try {
    ensureManagedIdentity(root);
    git(["add", "--", ...relPaths], root);

    let staged = true;
    try {
      git(["diff", "--cached", "--quiet", "--", ...relPaths], root);
      staged = false; // exit 0 = 无差异
    } catch {
      staged = true;
    }
    if (!staged) return { committed: false, sha: null, pushed: false, pushError: null };

    git(["commit", "--quiet", "-m", message], root);
    sha = headCommit(root);
    // 消除换行符转换残留，保持工作区干净，避免下次 git pull 被本地改动挡住
    try { git(["checkout", "--", ...relPaths], root); } catch { /* 尽力而为 */ }
  } catch (err) {
    restoreWorktree(root, relPaths);
    return { committed: false, sha: null, pushed: false, pushError: firstLines(err), failed: true };
  }

  if (!remoteUrl(root)) {
    return { committed: true, sha, pushed: false, pushError: "no-remote" };
  }
  try {
    git(["push", "--quiet"], root);
    return { committed: true, sha, pushed: true, pushError: null };
  } catch (err) {
    return { committed: true, sha, pushed: false, pushError: firstLines(err, 1) };
  }
}
