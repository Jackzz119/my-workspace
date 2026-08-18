import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./paths.mjs";

// shelf 的三层传输（SHELF 决策 #4）：
//   1. SHELF_HOME 环境变量指定的 workspace clone（兼容旧名 ATK_HOME）
//   2. CLI 自身所在的 clone（monorepo 内直跑 / npm link 都命中）
//   3. ~/.shelfrc 里记录的 home 路径（兼容旧文件 ~/.atkrc）
//   4. 兜底：按 rc 或 SHELF_REMOTE/ATK_REMOTE 的 remote 做临时 sparse clone（只取 shelf/）

function git(args, cwd, opts = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  }).trim();
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
  return url ? url.replace(/^git\+/, "") : null;
}

function readRc() {
  for (const name of [".shelfrc", ".atkrc"]) {
    const rcPath = path.join(os.homedir(), name);
    if (!fs.existsSync(rcPath)) continue;
    try {
      return JSON.parse(fs.readFileSync(rcPath, "utf8"));
    } catch {
      console.warn(`! ~/${name} 不是合法 JSON，已忽略`);
    }
  }
  return {};
}

function ephemeralClone(remote) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atk-shelf-"));
  // 本地路径 remote 会忽略 --filter（git 行为），sparse 仍生效，冒烟无碍
  git(
    ["clone", "--depth=1", "--filter=blob:none", "--sparse", "--quiet", remote, tmp],
    os.tmpdir(),
  );
  git(["sparse-checkout", "set", "shelf"], tmp);
  return tmp;
}

export function resolveShelfContext({ forWrite = false } = {}) {
  const rc = readRc();

  // home 模式必须是真 git 仓库（npm/npx 安装的副本被剥掉 .git，不能当 home）
  const home = [process.env.SHELF_HOME, process.env.ATK_HOME, repoRoot, rc.home]
    .find((r) => hasShelf(r) && isGitRepo(r));
  if (home) {
    return {
      mode: "home",
      root: home,
      shelfDir: path.join(home, "shelf"),
      cleanup() {},
    };
  }

  // npx/npm 安装的快照：有 shelf/ 没 .git。读操作直接用包内快照；写操作落到下面的临时 clone
  const snapshot = hasShelf(repoRoot) && !isGitRepo(repoRoot) ? repoRoot : null;
  if (snapshot && !forWrite) {
    return {
      mode: "snapshot",
      root: snapshot,
      shelfDir: path.join(snapshot, "shelf"),
      cleanup() {},
    };
  }

  const remote = process.env.SHELF_REMOTE || process.env.ATK_REMOTE || rc.remote
    || (snapshot ? repoUrlFromPkg(snapshot) : null);
  if (remote) {
    const tmp = ephemeralClone(remote);
    return {
      mode: "ephemeral",
      root: tmp,
      shelfDir: path.join(tmp, "shelf"),
      cleanup() {
        fs.rmSync(tmp, { recursive: true, force: true });
      },
    };
  }

  throw new Error(
    "找不到 shelf：设置 SHELF_HOME 指向 my-workspace clone，或在 ~/.shelfrc 写入 { \"home\": \"...\" } / { \"remote\": \"...\" }（npx 快照做写操作需要 package.json repository 或 SHELF_REMOTE）",
  );
}

export function headCommit(root) {
  try {
    return git(["rev-parse", "HEAD"], root) || null;
  } catch {
    // npx 快照没有 .git；npm 打包 git 依赖时会把源提交注入 package.json 的 gitHead
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

// 提交 shelf 下的指定路径；有 remote 则尝试 push。
// 返回 { committed, sha, pushed, pushError }
export function commitAndPush(root, relPaths, message) {
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
  const sha = headCommit(root);

  if (!remoteUrl(root)) {
    return { committed: true, sha, pushed: false, pushError: "no-remote" };
  }
  try {
    git(["push", "--quiet"], root);
    return { committed: true, sha, pushed: true, pushError: null };
  } catch (err) {
    const detail = (err.stderr || err.message || "").toString().split("\n")[0];
    return { committed: true, sha, pushed: false, pushError: detail };
  }
}
