import fs from "node:fs";
import path from "node:path";

// `_` 前缀只是文件系统里的置顶手段（SHELF 决策 #11）：
// 展示时隐藏，输入时两种写法都接受，落盘与 manifest 永远用真实名。

const SKIP_NAMES = new Set(["node_modules", ".git", ".DS_Store"]);

export function displayName(realName) {
  return realName.replace(/^_+/, "");
}

export function displayPath(realRelPath) {
  return realRelPath.split("/").map(displayName).join("/");
}

// 在 parentDir 下把一个展示名/真实名解析回真实目录项；不存在返回 null
export function resolveSegment(parentDir, segment) {
  if (fs.existsSync(path.join(parentDir, segment))) return segment;
  for (const prefix of ["_", "__"]) {
    const candidate = prefix + segment;
    if (fs.existsSync(path.join(parentDir, candidate))) return candidate;
  }
  return null;
}

// 把用户输入的 shelf 相对路径（展示名或真实名混用皆可）解析为真实相对路径。
// allowCreate 供 push 的目标路径使用：从第一个不存在的段起，按字面新建（created 标记返回）。
export function resolveShelfPath(shelfDir, inputPath, { allowCreate = false } = {}) {
  const segments = inputPath.replaceAll("\\", "/").split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const realSegments = [];
  let created = false;
  let current = shelfDir;
  for (let i = 0; i < segments.length; i++) {
    const real = resolveSegment(current, segments[i]);
    if (real === null) {
      if (!allowCreate) return null;
      realSegments.push(...segments.slice(i));
      created = true;
      break;
    }
    realSegments.push(real);
    current = path.join(current, real);
  }
  const realRel = realSegments.join("/");
  return { realRel, abs: path.join(shelfDir, ...realSegments), created };
}

// 全架按名字找条目（名字即 ID，SHELF 决策 #14/#15）：
// 目录或文件的真实名/展示名匹配即命中；命中的目录不再深入其内部（内部文件是货物的组成部分，不是货物）。
export function findByBasename(shelfDir, name) {
  const hits = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_NAMES.has(entry.name)) continue;
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      const matched = entry.name === name || displayName(entry.name) === name;
      if (matched) {
        hits.push(entryRel);
        continue;
      }
      if (entry.isDirectory()) walk(path.join(dir, entry.name), entryRel);
    }
  };
  walk(shelfDir, "");
  return hits;
}
