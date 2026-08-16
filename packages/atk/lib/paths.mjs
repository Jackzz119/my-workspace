import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// packages/atk/lib → monorepo 根
export const repoRoot = path.resolve(here, "..", "..", "..");
export const shelfRoot = path.join(repoRoot, "shelf");
export const packsRoot = path.join(shelfRoot, "skills");

export const commonPackName = "common";
export const commonPackDir = path.join(packsRoot, commonPackName);

export function packDir(name) {
  return path.join(packsRoot, name);
}

export function relPackPath(packName, skillName) {
  return `shelf/skills/${packName}/${skillName}`;
}

export function targetSkillsDir(cwd = process.cwd()) {
  return path.join(cwd, ".claude", "skills");
}
