import fs from "node:fs";
import path from "node:path";

const MANIFEST_NAME = ".agent-toolkit.json";

export function manifestPath(cwd = process.cwd()) {
  return path.join(cwd, MANIFEST_NAME);
}

export function loadManifest(cwd = process.cwd()) {
  const file = manifestPath(cwd);
  if (!fs.existsSync(file)) {
    return {
      source: null,
      skillsDir: ".claude/skills",
      skills: {},
      shelf: {},
    };
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  data.skills ??= {};
  data.shelf ??= {};
  return data;
}

export function saveManifest(manifest, cwd = process.cwd()) {
  const file = manifestPath(cwd);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

export function setSkillEntry(manifest, name, entry) {
  manifest.skills[name] = entry;
}

export function removeSkillEntry(manifest, name) {
  delete manifest.skills[name];
}

// shelf 段以 shelf 相对路径（真实名）为键，见 SHELF 决策 #6
export function setShelfEntry(manifest, shelfPath, entry) {
  manifest.shelf ??= {};
  manifest.shelf[shelfPath] = entry;
}

export function findShelfEntryByLocalPath(manifest, localPath) {
  const normalized = localPath.replaceAll("\\", "/");
  for (const [shelfPath, entry] of Object.entries(manifest.shelf ?? {})) {
    if ((entry.localPath ?? "").replaceAll("\\", "/") === normalized) {
      return { shelfPath, entry };
    }
  }
  return null;
}