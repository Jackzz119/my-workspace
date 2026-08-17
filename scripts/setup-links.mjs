#!/usr/bin/env node
// 把「启用清单」里的 shelf 技能以链接形式挂到 .claude/skills/。
// Windows 用 junction（无需管理员权限），POSIX 用符号链接；幂等，重复运行即重建。
// 货架 ≠ 启用（CLAUDE.md 技能真源铁律）：shelf 里的其他技能是库存，不在清单里就不链接。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 启用清单：三种写法——"包名"（链接包内全部技能）、"包/技能"、顶层技能名
const ACTIVE = ["_common"];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsSrc = path.join(root, "shelf", "skills");
const dest = path.join(root, ".claude", "skills");

function isSkillDir(p) {
  return fs.existsSync(path.join(p, "SKILL.md"));
}

const links = new Map();
function addLink(name, target) {
  if (links.has(name)) {
    console.warn(`! skip ${path.relative(root, target)}: name '${name}' already linked from ${path.relative(root, links.get(name))}`);
    return;
  }
  links.set(name, target);
}

for (const entry of ACTIVE) {
  const full = path.join(skillsSrc, ...entry.split("/"));
  if (!fs.existsSync(full)) {
    console.warn(`! ACTIVE 条目不存在，跳过: ${entry}`);
    continue;
  }
  if (isSkillDir(full)) {
    addLink(path.basename(full), full);
    continue;
  }
  for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
    const subFull = path.join(full, sub.name);
    if (sub.isDirectory() && isSkillDir(subFull)) addLink(sub.name, subFull);
  }
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

const linkType = process.platform === "win32" ? "junction" : "dir";
for (const [name, target] of [...links.entries()].sort()) {
  fs.symlinkSync(target, path.join(dest, name), linkType);
  console.log(`→ ${name}  ⇒  ${path.relative(root, target)}`);
}
console.log(`${links.size} skill link(s) created at .claude/skills/ (ACTIVE: ${ACTIVE.join(", ")})`);
