#!/usr/bin/env node
// 把 shelf/skills 里的全部 skill 以链接形式挂到 .claude/skills/。
// Windows 用 junction（无需管理员权限），POSIX 用符号链接；幂等，重复运行即重建。
// .claude/skills 里不放真实文件——真源规则见 ai/PROJECT.md。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsSrc = path.join(root, "shelf", "skills");
const dest = path.join(root, ".claude", "skills");

function isSkillDir(p) {
  return fs.existsSync(path.join(p, "SKILL.md"));
}

// shelf/skills 下两种形态：直接的 skill 目录（含 SKILL.md），或包目录（子目录才是 skill）
const links = new Map();
for (const entry of fs.readdirSync(skillsSrc, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const full = path.join(skillsSrc, entry.name);
  if (isSkillDir(full)) {
    links.set(entry.name, full);
    continue;
  }
  for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
    const subFull = path.join(full, sub.name);
    if (!sub.isDirectory() || !isSkillDir(subFull)) continue;
    if (links.has(sub.name)) {
      console.warn(`! skip ${entry.name}/${sub.name}: name already linked from ${path.relative(root, links.get(sub.name))}`);
      continue;
    }
    links.set(sub.name, subFull);
  }
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

const linkType = process.platform === "win32" ? "junction" : "dir";
for (const [name, target] of [...links.entries()].sort()) {
  fs.symlinkSync(target, path.join(dest, name), linkType);
  console.log(`→ ${name}  ⇒  ${path.relative(root, target)}`);
}
console.log(`${links.size} skill link(s) created at .claude/skills/`);
