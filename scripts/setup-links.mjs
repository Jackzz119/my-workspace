#!/usr/bin/env node
// 本仓库（货架 home）自己的 AI 工作区：从 shelf/ 拷一份「启用清单」里的协议与技能来用，全部 gitignored。
//   根 CLAUDE.md / AGENTS.md  ← shelf/agents/claude/CLAUDE.md、shelf/agents/codex/AGENTS.md
//   ai/jaSkills/<名>/         ← ACTIVE 清单里的 shelf 技能（技能正本，和用 shelf init 接入的项目同一布局）
//   .claude/skills、.agents/skills → 指向 ai/jaSkills 的整目录链接（Windows junction 免管理员 / POSIX 相对 symlink）
// 拷贝而不是链接到 shelf/：在这里用技能、改技能都不会碰货架真源（货架内容由各项目经 shelf push 更新）。
// 货架 ≠ 启用：shelf/ 里不在 ACTIVE 的技能是库存，不拷、不用。
// 幂等：缺的补上；已有且与货架不同的不覆盖，只报告；--refresh 用货架版本覆盖。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// 启用清单：shelf/skills 下的相对路径
const ACTIVE = [
  "_common/intj",
  "_common/feature",
  "_common/vc",
  "_common/logman",
  "_common/custom-skill",
  "_common/shelf-ops",
  "_common/annotated-report",
];
const PROTOCOLS = [
  { from: "agents/claude/CLAUDE.md", to: "CLAUDE.md" },
  { from: "agents/codex/AGENTS.md", to: "AGENTS.md" },
];
const SKILLS_HOME = "ai/jaSkills";
const AGENT_DIRS = [".claude/skills", ".agents/skills"];

const refresh = process.argv.includes("--refresh");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shelf = path.join(root, "shelf");

function hashOf(target) {
  const h = crypto.createHash("sha256");
  const walk = (abs, rel) => {
    const st = fs.statSync(abs);
    if (st.isFile()) {
      h.update(rel + "\0");
      h.update(fs.readFileSync(abs));
      return;
    }
    for (const name of fs.readdirSync(abs).sort()) walk(path.join(abs, name), rel + "/" + name);
  };
  walk(target, "");
  return h.digest("hex");
}

function place(src, dest, label) {
  if (!fs.existsSync(src)) {
    console.warn(`! 货架上没有 ${path.relative(root, src)}，跳过 ${label}`);
    return;
  }
  if (fs.existsSync(dest)) {
    if (hashOf(src) === hashOf(dest)) {
      console.log(`= ${label}`);
      return;
    }
    if (!refresh) {
      console.log(`≠ ${label} 与货架不同（本地改过或货架更新了），未覆盖；--refresh 用货架版本覆盖`);
      return;
    }
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`✓ ${label}`);
}

function hasFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() || e.isSymbolicLink()) return true;
    if (e.isDirectory() && hasFiles(path.join(dir, e.name))) return true;
  }
  return false;
}

function link(rel) {
  const linkPath = path.join(root, ...rel.split("/"));
  const target = path.join(root, ...SKILLS_HOME.split("/"));
  let st = null;
  try { st = fs.lstatSync(linkPath); } catch { st = null; }
  if (st?.isSymbolicLink()) {
    try {
      if (fs.realpathSync(linkPath) === fs.realpathSync(target)) {
        console.log(`= ${rel} → ${SKILLS_HOME}`);
        return;
      }
    } catch { /* 断链：重建 */ }
    fs.unlinkSync(linkPath); // 只删链接本身，绝不递归进目标
  } else if (st?.isDirectory()) {
    // 只收拾空壳（Git Bash 的 ln -s 或拷贝仓库时把链接变成的空目录）；有内容就停下让人看
    if (hasFiles(linkPath)) {
      console.warn(`! ${rel} 是装着文件的实体目录，先人工确认没有独有内容、删掉后再跑`);
      process.exitCode = 1;
      return;
    }
    fs.rmSync(linkPath, { recursive: true, force: true });
  } else if (st) {
    console.warn(`! ${rel} 是个文件，先挪开再跑`);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  if (process.platform === "win32") fs.symlinkSync(target, linkPath, "junction");
  else fs.symlinkSync(path.relative(path.dirname(linkPath), target), linkPath, "dir");
  console.log(`✓ ${rel} → ${SKILLS_HOME}`);
}

for (const p of PROTOCOLS) place(path.join(shelf, ...p.from.split("/")), path.join(root, p.to), p.to);
for (const s of ACTIVE) {
  const name = path.basename(s);
  place(path.join(shelf, "skills", ...s.split("/")), path.join(root, ...SKILLS_HOME.split("/"), name), `${SKILLS_HOME}/${name}`);
}
for (const rel of AGENT_DIRS) link(rel);
console.log(`AI 工作区就绪：${ACTIVE.length} 个启用技能（ACTIVE 在本脚本顶部），协议与技能都是 gitignored 的拷贝`);
