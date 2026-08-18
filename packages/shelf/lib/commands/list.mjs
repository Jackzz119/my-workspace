import fs from "node:fs";
import path from "node:path";
import { commonPackDirOf, commonPackName } from "../paths.mjs";
import { resolveShelfContext } from "../transport.mjs";
import { displayName } from "../shelfnames.mjs";
import { readDescription } from "../frontmatter.mjs";
import { wrap, termWidth } from "../format.mjs";

export async function cmdList() {
  const ctx = resolveShelfContext();
  try {
    const packDir = commonPackDirOf(ctx.shelfDir);
    if (!fs.existsSync(packDir)) {
      console.error(`pack '${displayName(commonPackName)}' not found at ${packDir}`);
      process.exit(1);
    }
    const names = fs.readdirSync(packDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    if (names.length === 0) {
      console.log("(no skills found)");
      return;
    }

    const indent = "  ";
    const descWidth = termWidth() - indent.length;

    for (const name of names) {
      const desc = readDescription(path.join(packDir, name));
      console.log(name);
      if (desc) {
        for (const ln of wrap(desc, descWidth)) {
          console.log(indent + ln);
        }
      }
      console.log("");
    }
    console.log(`${names.length} skill(s) in '${displayName(commonPackName)}' pack.`);
  } finally {
    ctx.cleanup();
  }
}
