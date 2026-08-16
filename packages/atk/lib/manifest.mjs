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
    };
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  data.skills ??= {};
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