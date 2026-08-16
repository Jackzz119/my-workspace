import fs from "node:fs";
import path from "node:path";
import {
  commonPackDir,
  commonPackName,
  relPackPath,
  targetSkillsDir,
} from "../paths.mjs";
import { choose } from "../prompt.mjs";
import { contentHash, lastCommitForPath, remoteOriginUrl } from "../version.mjs";
import { loadManifest, saveManifest, setSkillEntry } from "../manifest.mjs";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function buildEntry(packName, skillName) {
  const src = path.join(commonPackDir, skillName);
  return {
    sourceCommit: lastCommitForPath(relPackPath(packName, skillName)),
    contentHash: contentHash(src),
    pulledAt: todayISO(),
    pack: packName,
  };
}

export async function cmdPull() {
  if (!fs.existsSync(commonPackDir)) {
    console.error(`source pack '${commonPackName}' not found at ${commonPackDir}`);
    process.exit(1);
  }

  const names = fs.readdirSync(commonPackDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  if (names.length === 0) {
    console.log("(no skills to pull)");
    return;
  }

  const destRoot = targetSkillsDir();
  fs.mkdirSync(destRoot, { recursive: true });

  const manifest = loadManifest();
  manifest.source ??= remoteOriginUrl() || "github:unknown/agent-toolkit";

  let pulled = 0;
  let updated = 0;
  let skipped = 0;
  let upToDate = 0;
  let quit = false;

  for (const name of names) {
    if (quit) break;
    const src = path.join(commonPackDir, name);
    const dest = path.join(destRoot, name);

    if (!fs.existsSync(dest)) {
      fs.cpSync(src, dest, { recursive: true });
      setSkillEntry(manifest, name, buildEntry(commonPackName, name));
      console.log(`✓ pulled ${name}`);
      pulled++;
      continue;
    }

    const recorded = manifest.skills[name];
    const upstreamHash = contentHash(src);
    const localHash = contentHash(dest);

    const upstreamChanged = !recorded || recorded.contentHash !== upstreamHash;
    const localChanged = !recorded || recorded.contentHash !== localHash;

    if (!upstreamChanged && !localChanged) {
      console.log(`= up to date ${name}`);
      upToDate++;
      continue;
    }

    let prompt;
    let choices;
    if (upstreamChanged && !localChanged) {
      prompt = `↑ ${name} upstream updated. [u]pdate / [s]kip / [q]uit? `;
      choices = [{ key: "u" }, { key: "s" }, { key: "q" }];
    } else if (!upstreamChanged && localChanged) {
      prompt = `! ${name} has local edits, no upstream update. [k]eep / [o]verwrite / [q]uit? `;
      choices = [{ key: "k" }, { key: "o" }, { key: "q" }];
    } else {
      prompt = `⚠ ${name} upstream updated AND local has edits. [u]pdate(overwrite) / [s]kip / [q]uit? `;
      choices = [{ key: "u" }, { key: "s" }, { key: "q" }];
    }

    const action = await choose(prompt, choices);

    if (action === "u" || action === "o") {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(src, dest, { recursive: true });
      setSkillEntry(manifest, name, buildEntry(commonPackName, name));
      console.log(`✓ updated ${name}`);
      updated++;
    } else if (action === "s" || action === "k") {
      console.log(`- skipped ${name}`);
      skipped++;
    } else {
      console.log(`stopped at ${name}`);
      quit = true;
    }
  }

  saveManifest(manifest);

  console.log("");
  console.log(
    `Summary: ${pulled} pulled, ${updated} updated, ${skipped} skipped, ${upToDate} up-to-date` +
    (quit ? " (quit early)" : ""),
  );
}