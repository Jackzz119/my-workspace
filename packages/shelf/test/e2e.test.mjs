// 验收全流程（两台设备、两个项目，都用托管档口 ~/.shelf/home，和全局安装的真实用法一致）：
// init → 改一个技能 → 在另一处改同一个技能并推 → sync 报双改 → diff → merge → push → sync 全一致
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRoot, makeRemote, readRemoteFile, machine, project, read, SKILL_MD } from "./helpers.mjs";

const SKILL = "ai/jaSkills/intj";
const swap = (text, from, to) => text.replace(from + "\n", to + "\n");

test("验收：init → 改技能 → 另一处改同一技能并推 → sync 报双改 → diff → merge → push → sync 全一致", (t) => {
  const root = tmpRoot(t, "e2e");
  const remote = makeRemote(root);
  const laptop = machine(root, "laptop", remote);
  const desktop = machine(root, "desktop", remote);
  const pa = project(root, "app-on-laptop", { "package.json": '{"name":"app"}' });
  const pb = project(root, "app-on-desktop", { "package.json": '{"name":"app"}' });

  // 1. 两处各自 init
  assert.equal(laptop.run(pa, "init", "--agents", "claude,codex").code, 0);
  assert.equal(desktop.run(pb, "init", "--agents", "claude").code, 0);

  // 2. 笔记本上改 intj（第 11 行）
  fs.writeFileSync(path.join(pa, SKILL, "SKILL.md"), swap(SKILL_MD("intj"), "line 11", "line 11 — laptop"));

  // 3. 台式机上改同一个技能的另一处（第 2 行），先看清单再推
  fs.writeFileSync(path.join(pb, SKILL, "SKILL.md"), swap(SKILL_MD("intj"), "line 2", "line 2 — desktop"));
  const preview = desktop.json(pb, "push", SKILL);
  assert.equal(preview.code, 2, preview.out);
  assert.equal(desktop.run(pb, "push", SKILL, "--yes").code, 0);

  // 4. 笔记本 sync：报双改，退出 2，下一步指向 diff / merge
  const sync1 = laptop.json(pa, "sync");
  assert.equal(sync1.code, 2, sync1.out);
  const item = sync1.json.data.items.find((i) => i.localPath === SKILL);
  assert.equal(item.state, "both-changed");
  assert.deepEqual(item.next, [`shelf diff ${SKILL}`, `shelf merge ${SKILL}`]);

  // 5. diff：① 是台式机那处改动，② 是推上去会造成的变化
  const diff = laptop.json(pa, "diff", SKILL);
  assert.equal(diff.code, 2, diff.out);
  assert.match(diff.json.data.upstream.patch, /^\+line 2 — desktop$/m);
  assert.match(diff.json.data.outgoing.patch, /^\+line 11 — laptop$/m);

  // 6. merge：两处改动都保留
  const merge = laptop.json(pa, "merge", SKILL);
  assert.equal(merge.code, 0, merge.out);
  const merged = read(pa, `${SKILL}/SKILL.md`);
  assert.match(merged, /line 2 — desktop/);
  assert.match(merged, /line 11 — laptop/);

  // 7. push：merge 过的不需要 --force
  const push = laptop.json(pa, "push", SKILL, "--yes");
  assert.equal(push.code, 0, push.out);
  assert.equal(readRemoteFile(root, remote, "skills/_common/intj/SKILL.md"), merged);

  // 8. 两处 sync 全一致（台式机自动拿到合并结果）
  const sync2 = laptop.json(pa, "sync");
  assert.equal(sync2.code, 0, sync2.out);
  assert.ok(sync2.json.data.items.every((i) => ["same", "planted"].includes(i.state)), JSON.stringify(sync2.json.data.items));
  const sync3 = desktop.json(pb, "sync");
  assert.equal(sync3.code, 0, sync3.out);
  assert.equal(sync3.json.data.items.find((i) => i.localPath === SKILL).state, "updated");
  assert.equal(read(pb, `${SKILL}/SKILL.md`), merged);
  assert.equal(desktop.json(pb, "status").code, 0);
});
