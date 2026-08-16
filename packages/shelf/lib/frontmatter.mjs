import fs from "node:fs";
import path from "node:path";

export function readDescription(skillDir) {
  const skillMd = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(skillMd)) return "";
  const text = fs.readFileSync(skillMd, "utf8");
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return "";
  const descMatch = fmMatch[1].match(/^description:\s*(.+?)\s*$/m);
  return descMatch ? descMatch[1].trim() : "";
}