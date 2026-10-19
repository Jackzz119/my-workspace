// 测试脚手架：临时 bare 仓库当货架，CLI 拷到临时目录当「已安装」的包（这样它不会把 monorepo 认成货架），
// 每台「机器」有自己的 HOME（托管档口 ~/.shelf/home 自动 clone），git 配置与本机隔离。
// 绝不碰真货架：所有写操作都推到临时 bare 仓库。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 本仓库货架里真实的 ai 模板：测试用它，测的就是要发布的配方
const REAL_TEMPLATE = path.resolve(PKG, "..", "..", "shelf", "templates", "ai");

function readTree(dir, prefix) {
  const out = {};
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out[`${prefix}/${r}`] = fs.readFileSync(path.join(d, e.name), "utf8");
    }
  };
  walk(dir, "");
  return out;
}

export const TEMPLATE_FILES = readTree(REAL_TEMPLATE, "templates/ai");

// 测试技能的固定目录声明，和货架上同名真技能的 metadata.shelf-scaffold 一致（unit 测试核对真技能）
export const TEST_SCAFFOLD = {
  intj: "sessions, features",
  feature: "features",
  monet: "design_system/concept, design_system/img, design_system/uiux, design_system/codex-visual",
  "project-audit": "project-audit/runs, project-audit/scripts",
};

export const SKILL_MD = (name, body = "") => [
  "---",
  `name: ${name}`,
  `description: test skill ${name}`,
  ...(TEST_SCAFFOLD[name] ? ["metadata:", `  shelf-scaffold: "${TEST_SCAFFOLD[name]}"`] : []),
  "---",
  "",
  `# ${name}`,
  "",
  ...Array.from({ length: 12 }, (_, i) => `line ${i + 1}`),
  body,
].join("\n") + "\n";

// 没有模板的货架（老货架 / 自建货架）：init 走内置配方
export const BARE_SHELF = {
  "agents/claude/CLAUDE.md": "# Claude 协议\n\n规则一\n规则二\n规则三\n",
  "agents/codex/AGENTS.md": "# Codex 协议\n\n规则一\n规则二\n规则三\n",
  "agents/multica/MULTICA.md": "# Multica 开工协议\n\n先跑 bash ai/scripts/bootstrap.sh\n",
  "docs/JASKILL.md": "# JASKILL 模板\n\n| 技能 | 何时读 | 上游 |\n| --- | --- | --- |\n",
  "skills/_common/intj/SKILL.md": SKILL_MD("intj"),
  "skills/_common/intj/reference.md": "intj reference\nsecond line\n",
  "skills/_common/feature/SKILL.md": SKILL_MD("feature"),
  "skills/_common/monet/SKILL.md": SKILL_MD("monet"),
  "skills/project-audit/SKILL.md": SKILL_MD("project-audit"),
  "docs/note.md": "a note\n",
};

export const DEFAULT_SHELF = { ...BARE_SHELF, ...TEMPLATE_FILES };

const STRIP_ENV = ["SHELF_HOME", "ATK_HOME", "SHELF_REMOTE", "ATK_REMOTE", "SHELF_EPHEMERAL", "SHELF_NONINTERACTIVE", "GIT_DIR", "GIT_WORK_TREE"];

export function tmpRoot(t, name) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `shelf-t-${name}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

function gitconfigFile(root) {
  const file = path.join(root, "test.gitconfig");
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, [
      "[user]", "\tname = shelf-test", "\temail = shelf-test@example.com",
      "[init]", "\tdefaultBranch = main",
      "[core]", "\tautocrlf = false",
      "[safe]", "\tdirectory = *",
      "",
    ].join("\n"));
  }
  return file;
}

export function gitEnv(root, extra = {}) {
  const env = { ...process.env };
  for (const k of STRIP_ENV) delete env[k];
  return { ...env, GIT_CONFIG_GLOBAL: gitconfigFile(root), GIT_CONFIG_NOSYSTEM: "1", NO_COLOR: "1", ...extra };
}

export function git(root, cwd, args) {
  return execFileSync("git", args, { cwd, env: gitEnv(root), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split("/"));
    if (content === null) {
      fs.rmSync(abs, { recursive: true, force: true });
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

// 临时货架：seed 工作区提交后 clone 成 bare 仓库
export function makeRemote(root, files = DEFAULT_SHELF) {
  const seed = path.join(root, "seed");
  fs.mkdirSync(seed);
  git(root, seed, ["init", "-q", "-b", "main"]);
  writeFiles(path.join(seed, "shelf"), files);
  fs.writeFileSync(path.join(seed, "README.md"), "test shelf\n");
  git(root, seed, ["add", "-A"]);
  git(root, seed, ["commit", "-qm", "seed"]);
  const remote = path.join(root, "remote.git");
  git(root, root, ["clone", "-q", "--bare", seed, remote]);
  return remote;
}

// 模拟「另一台设备」直接往货架推一次（shelf/ 下的相对路径 → 内容，null = 删除）
export function pushToRemote(root, remote, files, message = "other device") {
  const dir = fs.mkdtempSync(path.join(root, "other-"));
  git(root, root, ["clone", "-q", remote, dir]);
  writeFiles(path.join(dir, "shelf"), files);
  git(root, dir, ["add", "-A"]);
  git(root, dir, ["commit", "-qm", message]);
  git(root, dir, ["push", "-q"]);
  const sha = git(root, dir, ["rev-parse", "HEAD"]);
  fs.rmSync(dir, { recursive: true, force: true });
  return sha;
}

export function readRemoteFile(root, remote, rel) {
  return execFileSync("git", ["--git-dir", remote, "show", `HEAD:shelf/${rel}`], {
    env: gitEnv(root),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// 「已安装」的 CLI：bin + lib + package.json 拷到临时目录
export function installCli(root) {
  const dir = path.join(root, "cli");
  for (const d of ["bin", "lib"]) fs.cpSync(path.join(PKG, d), path.join(dir, d), { recursive: true });
  fs.copyFileSync(path.join(PKG, "package.json"), path.join(dir, "package.json"));
  return path.join(dir, "bin", "shelf.mjs");
}

export function machine(root, name, remote) {
  const home = path.join(root, `${name}-home`);
  fs.mkdirSync(home, { recursive: true });
  const cli = fs.existsSync(path.join(root, "cli")) ? path.join(root, "cli", "bin", "shelf.mjs") : installCli(root);
  const env = gitEnv(root, { HOME: home, USERPROFILE: home, SHELF_REMOTE: remote });
  const exec = (cwd, args) => {
    const r = spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8", input: "" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: r.stdout + r.stderr };
  };
  return {
    name,
    home,
    env,
    cli,
    shelfHome: path.join(home, ".shelf", "home"),
    run: (cwd, ...args) => exec(cwd, [...args, "--text"]),
    raw: (cwd, ...args) => exec(cwd, args),
    json(cwd, ...args) {
      const r = exec(cwd, [...args, "--json"]);
      try {
        r.json = JSON.parse(r.stdout);
      } catch {
        throw new Error(`--json 输出不是 JSON（exit ${r.code}）:\n${r.stdout}\n${r.stderr}`);
      }
      return r;
    },
  };
}

export function project(root, name, files = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  writeFiles(dir, files);
  return dir;
}

// 「换设备」：把项目提交进 git，再 clone 一份——新 clone 里只有入库的文件（链接、根目录协议副本都没有）
export function cloneProject(root, dir, name) {
  if (!fs.existsSync(path.join(dir, ".git"))) git(root, dir, ["init", "-q"]);
  git(root, dir, ["add", "-A"]);
  git(root, dir, ["commit", "-qm", "project"]);
  const dest = path.join(root, name);
  git(root, root, ["clone", "-q", dir, dest]);
  return dest;
}

export function ledger(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".shelf.json"), "utf8"));
}

export function read(dir, rel) {
  return fs.readFileSync(path.join(dir, ...rel.split("/")), "utf8");
}

export function exists(dir, rel) {
  return fs.existsSync(path.join(dir, ...rel.split("/")));
}

export function isLink(dir, rel) {
  try {
    return fs.lstatSync(path.join(dir, ...rel.split("/"))).isSymbolicLink();
  } catch {
    return false;
  }
}

// Windows 上确认是 junction（不是复制出来的目录，也不是要管理员的 symlink）
export function isJunction(dir, rel) {
  const abs = path.join(dir, ...rel.split("/"));
  const out = spawnSync("cmd", ["/c", "dir", "/AL", path.dirname(abs)], { encoding: "utf8" }).stdout ?? "";
  return out.split(/\r?\n/).some((l) => l.includes("<JUNCTION>") && l.includes(path.basename(abs)));
}
