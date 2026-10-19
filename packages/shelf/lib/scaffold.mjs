// init 的 ai 资料区脚手架：按项目命名规范定 ai 目录名，按已装的通用技能建它们要用的文件夹与骨架文档。
import fs from "node:fs";
import path from "node:path";

const DOTNET_FILE = /\.(sln|slnx|csproj|fsproj|vbproj)$/i;

function readdirSafe(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// .NET / C#（含 Unity）项目：根目录或一层子目录里有解决方案 / 项目文件，或 Unity 工程标志
export function isDotnetProject(cwd) {
  const names = readdirSafe(cwd);
  if (names.some((n) => DOTNET_FILE.test(n) || n === "Directory.Build.props")) return true;
  if (fs.existsSync(path.join(cwd, "ProjectSettings", "ProjectVersion.txt"))) return true;
  if (names.includes("Assets") && fs.existsSync(path.join(cwd, "Packages", "manifest.json"))) return true;
  for (const n of names) {
    if (n.startsWith(".") || n === "node_modules") continue;
    const p = path.join(cwd, n);
    if (isDir(p) && readdirSafe(p).some((f) => DOTNET_FILE.test(f))) return true;
  }
  return false;
}

// ai 资料区目录名：已有就沿用它在磁盘上的大小写；否则 .NET / C# 项目用 AI，其余（JS / TS / Java …）用 ai
export function detectAiDir(cwd) {
  const existing = readdirSafe(cwd).find((n) => n.toLowerCase() === "ai" && isDir(path.join(cwd, n)));
  if (existing) return { name: existing, reason: "沿用项目里已有的目录" };
  if (isDotnetProject(cwd)) return { name: "AI", reason: ".NET / C# 项目用 AI" };
  return { name: "ai", reason: "JS / TS / Java 等项目用 ai" };
}

export function projectName(cwd) {
  try {
    const name = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")).name;
    if (name) return name;
  } catch { /* 不是 node 项目 */ }
  const sln = readdirSafe(cwd).find((n) => /\.slnx?$/i.test(n));
  if (sln) return sln.replace(/\.slnx?$/i, "");
  return path.basename(path.resolve(cwd));
}

function projectTemplate(name, date) {
  return [
    `# ${name}`,
    "",
    `> 最后更新：${date}`,
    "",
    "<一句话：这个项目是什么、给谁用>",
    "",
    "## 开工红线",
    "",
    "<每会话必读的强制前置动作与指向细则的链接；没有就写「暂无」>",
    "",
    "## 项目结构",
    "",
    "## 功能文档",
    "",
    "| 文档 | 状态 | 说明 |",
    "|---|---|---|",
    "",
    "## Brain Dump",
    "",
  ].join("\n");
}

function todoTemplate() {
  return ["# TODO", "", "## Epics & Milestones", "", "## Bugs", ""].join("\n");
}

// 技能自己声明的目录：SKILL.md frontmatter 的 metadata 里写 `shelf-scaffold: features, design_system/codex-visual`
// （逗号分隔，相对 ai 目录；只建目录）。这样新技能要文件夹不必改 CLI。
export function declaredScaffold(skillMd) {
  let text;
  try {
    text = fs.readFileSync(skillMd, "utf8");
  } catch {
    return [];
  }
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return [];
  const m = fm[1].match(/^\s+shelf-scaffold:\s*["']?([^"'\r\n]*)["']?\s*$/m);
  if (!m) return [];
  // 只认相对 ai 目录的路径：绝对路径（/x、C:\x）和带 .. 的一律丢掉
  return m[1].split(",")
    .map((s) => s.trim().replaceAll("\\", "/"))
    .filter((s) => s && !s.startsWith("/") && !/^[A-Za-z]:/.test(s) && !s.split("/").includes(".."))
    .map((s) => s.replace(/\/+$/, ""));
}

// 配方里的脚手架条目（{ dir, skills } 或内置配方的 { file, builtin }，路径已代入 ai 区目录名）
// + 已装技能在 frontmatter 里自己声明的固定目录。skills 非空的条目只在装了其中某个技能时才建。
// 技能清单默认读技能正本目录；skills 传 [{ name, skillMd }] 时按它算（template show 用货架上的技能预览）
export function planScaffold(entries, { aiDir, skillsHomeAbs, skills }) {
  const list = skills ?? readdirSafe(skillsHomeAbs)
    .filter((n) => isDir(path.join(skillsHomeAbs, n)))
    .map((name) => ({ name, skillMd: path.join(skillsHomeAbs, name, "SKILL.md") }));
  const installed = list.map((s) => s.name);
  const items = new Map();
  const add = (rel, item) => {
    const key = rel.toLowerCase();
    if (!items.has(key)) items.set(key, { rel, ...item });
    else items.get(key).by.push(...item.by.filter((b) => !items.get(key).by.includes(b)));
  };
  for (const s of entries) {
    const by = (s.skills ?? []).filter((n) => installed.includes(n));
    if (s.skills?.length && by.length === 0) continue;
    if (s.dir) add(s.dir, { kind: "dir", by: by.length ? by : ["模板"] });
    else if (s.file) add(s.file, { kind: "file", template: s.builtin, by: ["模板"] });
  }
  for (const s of list) {
    for (const rel of declaredScaffold(s.skillMd)) add(`${aiDir}/${rel}`, { kind: "dir", by: [s.name] });
  }
  // 父目录随子目录一起建出来：只留最深的一层，.gitkeep 只放在叶子目录里
  const all = [...items.values()];
  const dirs = all.filter((i) => i.kind === "dir").map((i) => i.rel.toLowerCase());
  return all
    .filter((i) => i.kind !== "dir" || !dirs.some((d) => d.startsWith(`${i.rel.toLowerCase()}/`)))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

// 只补缺的，已有的一律不碰；目录放 .gitkeep，让空目录也能进项目 git（队友 clone 即见结构）
export function applyScaffold(cwd, items, { date, name, dryRun = false }) {
  const created = [];
  const existed = [];
  for (const it of items) {
    const abs = path.join(cwd, ...it.rel.split("/"));
    if (fs.existsSync(abs)) {
      existed.push(it.rel);
      continue;
    }
    created.push(it.rel);
    if (dryRun) continue;
    if (it.kind === "file") {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, it.template === "project" ? projectTemplate(name, date) : todoTemplate(), "utf8");
    } else {
      fs.mkdirSync(abs, { recursive: true });
      fs.writeFileSync(path.join(abs, ".gitkeep"), "", "utf8");
    }
  }
  return { created, existed };
}
