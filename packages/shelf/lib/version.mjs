import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./paths.mjs";

function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, base));
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return out;
}

export function contentHash(target) {
  const hash = crypto.createHash("sha256");
  if (fs.statSync(target).isFile()) {
    hash.update("file\0");
    hash.update(fs.readFileSync(target));
    return `sha256:${hash.digest("hex")}`;
  }
  const files = walkFiles(target).sort();
  for (const rel of files) {
    hash.update(rel);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(target, rel)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function lastCommitForPath(relPathInRepo, root = repoRoot) {
  if (!root) return null;
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%H", "--", relPathInRepo],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function remoteOriginUrl(root = repoRoot) {
  if (!root) return null;
  try {
    const out = execFileSync(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}