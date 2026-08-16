import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

export async function choose(question, choices) {
  const keys = choices.map((c) => c.key.toLowerCase());
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const ans = (await rl.question(question)).trim().toLowerCase();
      const hit = choices.find((c) => c.key.toLowerCase() === ans);
      if (hit) return hit.key.toLowerCase();
      stdout.write(`  please type one of: ${keys.join(", ")}\n`);
    }
  } finally {
    rl.close();
  }
}