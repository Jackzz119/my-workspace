import fs from "node:fs";
import path from "node:path";
import { commonPackDir, commonPackName } from "../paths.mjs";
import { readDescription } from "../frontmatter.mjs";
import { wrap, termWidth } from "../format.mjs";

export async function cmdList() {
  if (!fs.existsSync(commonPackDir)) {
    console.error(`pack '${commonPackName}' not found at ${commonPackDir}`);
    process.exit(1);
  }
  const names = fs.readdirSync(commonPackDir, { withFileTypes: true })
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
    const desc = readDescription(path.join(commonPackDir, name));
    console.log(name);
    if (desc) {
      for (const ln of wrap(desc, descWidth)) {
        console.log(indent + ln);
      }
    }
    console.log("");
  }
  console.log(`${names.length} skill(s) in '${commonPackName}' pack.`);
}