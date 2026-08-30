import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// 从 lib/ 向上找带 shelf/skills 的目录：
// - monorepo 开发态（packages/shelf/lib → 仓库根）命中
// - npx 快照（包内含 shelf/）命中
// - 全局安装的独立 CLI 包内没有内容，返回 null，由 transport 开档口
function findLocalRoot(start) {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "shelf", "skills"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export const repoRoot = findLocalRoot(here);
