import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  tmpRoot, makeRemote, pushToRemote, readRemoteFile, machine, project, ledger, read, exists, git, gitEnv, SKILL_MD,
} from "./helpers.mjs";

function setup(t, name, agents = "claude") {
  const root = tmpRoot(t, name);
  const remote = makeRemote(root);
  const m = machine(root, "a", remote);
  const p = project(root, "p");
  const r = m.run(p, "init", "--agents", agents);
  assert.equal(r.code, 0, r.out);
  return { root, remote, m, p };
}

const skillPath = "ai/jaSkills/intj/SKILL.md";
const replaceLine = (text, from, to) => {
  assert.ok(text.includes(from + "\n"), `找不到 ${from}`);
  return text.replace(from + "\n", to + "\n");
};

test("diff：一致退出 0；有差异退出 2；① 货架改了什么 ② 推上去改什么；--stat；本地路径与货架路径都认", (t) => {
  const { root, remote, m, p } = setup(t, "diff");
  const same = m.json(p, "diff", "ai/jaSkills/intj");
  assert.equal(same.code, 0, same.out);
  assert.equal(same.json.data.state, "same");

  pushToRemote(root, remote, { "skills/_common/intj/SKILL.md": replaceLine(SKILL_MD("intj"), "line 2", "line 2 (shelf)") });
  fs.writeFileSync(path.join(p, ...skillPath.split("/")), replaceLine(SKILL_MD("intj"), "line 11", "line 11 (local)"));

  const d = m.json(p, "diff", "skills/common/intj");
  assert.equal(d.code, 2, d.out);
  assert.equal(d.json.data.state, "both-changed");
  assert.equal(d.json.data.base.available, true);
  assert.equal(d.json.data.base.matchesLedger, true);
  assert.match(d.json.data.upstream.patch, /^-line 2$/m);
  assert.match(d.json.data.upstream.patch, /^\+line 2 \(shelf\)$/m);
  assert.doesNotMatch(d.json.data.upstream.patch, /line 11 \(local\)/);
  assert.match(d.json.data.outgoing.patch, /^\+line 11 \(local\)$/m);
  assert.match(d.json.data.outgoing.patch, /^-line 2 \(shelf\)$/m, "推上去会把货架那处改回去——② 要让人看见");
  assert.deepEqual(d.json.next, ["shelf merge ai/jaSkills/intj"]);

  const text = m.run(p, "diff", "ai\\jaSkills\\intj");
  assert.equal(text.code, 2);
  assert.match(text.out, /① 货架在上次拉取之后改了什么/);
  assert.match(text.out, /② 推上去会改成什么/);
  assert.match(text.out, /^--- a\/SKILL\.md\t上次拉取 [0-9a-f]{7}$/m);

  const stat = m.run(p, "diff", "ai/jaSkills/intj", "--stat");
  assert.equal(stat.code, 2);
  assert.match(stat.out, /~ SKILL\.md\s+\+1 -1/);
  assert.doesNotMatch(stat.out, /^@@/m);
  assert.equal(m.run(p, "diff", "templates/note.md").code, 1, "没拉过的物品 diff 报错");
});

test("merge：两边改不同处 → 干净合并写回本地，账本不动；push 不用 --force；sync 全一致", (t) => {
  const { root, remote, m, p } = setup(t, "merge-clean");
  const upstream = replaceLine(SKILL_MD("intj"), "line 2", "line 2 (shelf)");
  pushToRemote(root, remote, { "skills/_common/intj/SKILL.md": upstream });
  fs.writeFileSync(path.join(p, ...skillPath.split("/")), replaceLine(SKILL_MD("intj"), "line 11", "line 11 (local)"));

  const st = m.json(p, "status");
  assert.equal(st.code, 2);
  assert.equal(st.json.data.items.find((i) => i.key === "skills/_common/intj").state, "both-changed");

  const ledgerBefore = read(p, ".shelf.json");
  const mg = m.json(p, "merge", "ai/jaSkills/intj");
  assert.equal(mg.code, 0, mg.out);
  assert.equal(mg.json.data.state, "merged");
  assert.deepEqual(mg.json.data.files.map((f) => [f.path, f.how]), [["SKILL.md", "merged"]]);
  const merged = read(p, skillPath);
  assert.match(merged, /line 2 \(shelf\)/);
  assert.match(merged, /line 11 \(local\)/);
  assert.equal(read(p, ".shelf.json"), ledgerBefore, "merge 不动账本");

  const st2 = m.json(p, "status");
  assert.equal(st2.json.data.items.find((i) => i.key === "skills/_common/intj").state, "merged");
  assert.equal(m.json(p, "merge", "ai/jaSkills/intj").json.data.state, "already-merged", "重跑 merge 是空操作");

  const push = m.json(p, "push", "ai/jaSkills/intj", "--yes");
  assert.equal(push.code, 0, push.out);
  assert.ok(push.json.data.merged);
  assert.equal(readRemoteFile(root, remote, "skills/_common/intj/SKILL.md"), merged);
  const sy = m.json(p, "sync");
  assert.equal(sy.code, 0, sy.out);
  assert.ok(sy.json.data.items.every((i) => ["same", "planted"].includes(i.state)), JSON.stringify(sy.json.data.items));
});

test("merge：改同一处 → 留标准冲突标记、列文件、退出 3；没解决就 push 退出 3；解决后 push 成功", (t) => {
  const { root, remote, m, p } = setup(t, "merge-conflict");
  pushToRemote(root, remote, { "skills/_common/intj/SKILL.md": replaceLine(SKILL_MD("intj"), "line 5", "line 5 SHELF") });
  fs.writeFileSync(path.join(p, ...skillPath.split("/")), replaceLine(SKILL_MD("intj"), "line 5", "line 5 LOCAL"));

  const mg = m.json(p, "merge", "skills/common/intj");
  assert.equal(mg.code, 3, mg.out);
  assert.deepEqual(mg.json.data.conflicts.map((c) => [c.path, c.reason]), [["SKILL.md", "content"]]);
  const text = read(p, skillPath);
  assert.match(text, /^<<<<<<< 本地\nline 5 LOCAL\n=======\nline 5 SHELF\n>>>>>>> 货架 [0-9a-f]{7}$/m);

  // agent 常传它刚改的那个文件：物品里面的路径归到整件（不会按文件名在全架里找同名 SKILL.md）
  const early = m.json(p, "push", skillPath, "--yes");
  assert.equal(early.code, 3, early.out);
  assert.equal(early.json.data.key, "skills/_common/intj");
  assert.deepEqual(early.json.data.conflicts, ["SKILL.md"]);
  assert.equal(m.json(p, "merge", "ai/jaSkills/intj").code, 3, "冲突没解决不能再 merge");
  assert.equal(m.json(p, "status").json.data.items.find((i) => i.key === "skills/_common/intj").state, "merge-conflict");

  fs.writeFileSync(path.join(p, ...skillPath.split("/")), replaceLine(SKILL_MD("intj"), "line 5", "line 5 BOTH"));
  const push = m.run(p, "push", skillPath.replace(/\//g, "\\"), "--yes");
  assert.equal(push.code, 0, push.out);
  assert.match(push.out, /在已记账的 ai\/jaSkills\/intj 里面，按整件处理/);
  assert.match(readRemoteFile(root, remote, "skills/_common/intj/SKILL.md"), /line 5 BOTH/);
  assert.equal(m.run(p, "sync").code, 0);
});

test("merge：新增 / 删除按同样逻辑——货架加的文件进来，本地删的文件不回来", (t) => {
  const { root, remote, m, p } = setup(t, "merge-files");
  pushToRemote(root, remote, {
    "skills/_common/intj/examples.md": "new upstream file\n",
    "skills/_common/intj/SKILL.md": replaceLine(SKILL_MD("intj"), "line 1", "line 1 (shelf)"),
  });
  fs.rmSync(path.join(p, "ai", "jaSkills", "intj", "reference.md"));
  fs.writeFileSync(path.join(p, "ai", "jaSkills", "intj", "notes.md"), "local only\n");

  const mg = m.json(p, "merge", "ai/jaSkills/intj");
  assert.equal(mg.code, 0, mg.out);
  const how = Object.fromEntries(mg.json.data.files.map((f) => [f.path, f.how]));
  assert.deepEqual(how, { "SKILL.md": "theirs", "examples.md": "theirs-added", "notes.md": "ours-added", "reference.md": "ours-deleted" });
  assert.ok(exists(p, "ai/jaSkills/intj/examples.md"));
  assert.ok(!exists(p, "ai/jaSkills/intj/reference.md"));
  assert.equal(m.run(p, "push", "ai/jaSkills/intj", "--yes").code, 0);
  assert.throws(() => readRemoteFile(root, remote, "skills/_common/intj/reference.md"));
  assert.equal(readRemoteFile(root, remote, "skills/_common/intj/notes.md"), "local only\n");
});

test("merge：单文件物品（协议）也能三方合并；只改了根目录副本也算本地改动，结果正本和副本一起写", (t) => {
  const { root, remote, m, p } = setup(t, "merge-file");
  pushToRemote(root, remote, { "agents/claude/CLAUDE.md": "# Claude 协议\n\n规则一（货架）\n规则二\n规则三\n" });
  fs.writeFileSync(path.join(p, "CLAUDE.md"), "# Claude 协议\n\n规则一\n规则二\n规则三（本地）\n");

  const mg = m.json(p, "merge", "CLAUDE.md");
  assert.equal(mg.code, 0, mg.out);
  const expected = "# Claude 协议\n\n规则一（货架）\n规则二\n规则三（本地）\n";
  assert.equal(read(p, "ai/jaAgents/CLAUDE.md"), expected);
  assert.equal(read(p, "CLAUDE.md"), expected);
  assert.equal(m.run(p, "push", "CLAUDE.md", "--yes").code, 0, "用根目录副本的路径也能定位到这件物品");
  assert.equal(readRemoteFile(root, remote, "agents/claude/CLAUDE.md"), expected);
  assert.equal(m.run(p, "sync").code, 0);
});

test("diff / merge：账本的 sourceCommit 不在货架历史里 → diff 退回两方对比，merge 报错不乱合", (t) => {
  const { m, p } = setup(t, "nobase");
  const L = ledger(p);
  L.shelf["skills/_common/intj"].sourceCommit = "0123456789abcdef0123456789abcdef01234567";
  L.shelf["skills/_common/intj"].contentHash = "sha256:stale";
  fs.writeFileSync(path.join(p, ".shelf.json"), JSON.stringify(L, null, 2));
  fs.appendFileSync(path.join(p, ...skillPath.split("/")), "local\n");

  const d = m.json(p, "diff", "ai/jaSkills/intj");
  assert.equal(d.code, 2, d.out);
  assert.equal(d.json.data.base.available, false);
  assert.match(d.json.data.outgoing.patch, /^\+local$/m);
  const mg = m.json(p, "merge", "ai/jaSkills/intj");
  assert.equal(mg.code, 1, mg.out);
  assert.match(mg.json.error.message, /取不到合并基准/);
});

test("Windows 换行：自己的 clone 开了 autocrlf，基准按工作区规则还原，diff 不会整篇飘红", (t) => {
  const root = tmpRoot(t, "crlf");
  const remote = makeRemote(root);
  const clone = path.join(root, "my-clone");
  git(root, root, ["clone", "-q", "-c", "core.autocrlf=true", remote, clone]);
  assert.match(fs.readFileSync(path.join(clone, "shelf", "skills", "_common", "intj", "SKILL.md"), "utf8"), /\r\n/, "工作区是 CRLF");
  const m = machine(root, "crlf", remote);
  m.env.SHELF_HOME = clone;
  const p = project(root, "p");
  assert.equal(m.run(p, "init", "--agents", "claude").code, 0);
  assert.match(read(p, skillPath), /\r\n/, "拉到本地的也是 CRLF");

  pushToRemote(root, remote, { "skills/_common/intj/SKILL.md": replaceLine(SKILL_MD("intj"), "line 3", "line 3 (shelf)") });
  spawnSync("git", ["pull", "-q"], { cwd: clone, env: gitEnv(root) });
  const d = m.json(p, "diff", "ai/jaSkills/intj", "--stat");
  assert.equal(d.code, 2, d.out);
  assert.equal(d.json.data.base.matchesLedger, true, "重建出的基准和账本指纹一致");
  assert.deepEqual(d.json.data.upstream.files.map((f) => [f.path, f.adds, f.dels]), [["SKILL.md", 1, 1]]);
});
