import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRoot, writeFiles, TEST_SCAFFOLD } from "./helpers.mjs";
import { diffLines, splitLines, unifiedHunks, diffTrees, statText, isBinary } from "../lib/textdiff.mjs";
import { parseArgs } from "../lib/spec.mjs";
import { ShelfExit } from "../lib/output.mjs";
import { detectAiDir, planScaffold, applyScaffold, declaredScaffold, isDotnetProject } from "../lib/scaffold.mjs";
import { BUILTIN_AI, expandTemplate, renderText } from "../lib/template.mjs";
import { mergeTrees, conflictMarkerFiles, mapHash, readTreeFs, writeTree, MARK_OURS, MARK_THEIRS } from "../lib/threeway.mjs";
import { contentHash } from "../lib/version.mjs";

const B = (s) => Buffer.from(s);

test("diffLines：编辑脚本能同时还原出两边（随机性质测试）", () => {
  let seed = 7;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  for (let round = 0; round < 300; round++) {
    const a = Array.from({ length: rand(30) }, () => `l${rand(6)}\n`);
    const b = a.filter(() => rand(4) !== 0);
    for (let i = rand(5); i > 0; i--) b.splice(rand(b.length + 1), 0, `n${rand(6)}\n`);
    const ops = diffLines(a, b);
    assert.deepEqual(ops.filter((o) => o.op !== "+").map((o) => o.line), a);
    assert.deepEqual(ops.filter((o) => o.op !== "-").map((o) => o.line), b);
  }
});

test("unifiedHunks：标准 @@ 头、上下文 3 行、无结尾换行标记", () => {
  const a = splitLines("1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n");
  const b = splitLines("1\n2\n3\n4\nfive\n6\n7\n8\n9\n10\n");
  assert.deepEqual(unifiedHunks(diffLines(a, b)), ["@@ -2,7 +2,7 @@", " 2", " 3", " 4", "-5", "+five", " 6", " 7", " 8"]);
  const tail = unifiedHunks(diffLines(splitLines("x\ny"), splitLines("x\nz\n")));
  assert.deepEqual(tail, ["@@ -1,2 +1,2 @@", " x", "-y", "\\ No newline at end of file", "+z"]);
  assert.deepEqual(unifiedHunks(diffLines([], splitLines("new\n"))), ["@@ -0,0 +1 @@", "+new"]);
});

test("diffTrees：新增 / 删除 / 修改 / 二进制，统计正确", () => {
  const from = new Map([["a.md", B("1\n2\n")], ["gone.md", B("x\n")], ["img.bin", B("\x00\x01")]]);
  const to = new Map([["a.md", B("1\nzwei\n")], ["new.md", B("hi\n")], ["img.bin", B("\x00\x02")]]);
  const r = diffTrees(from, to, { labelA: "货架", labelB: "本地" });
  assert.deepEqual(r.files.map((f) => [f.path, f.status]), [["a.md", "changed"], ["gone.md", "removed"], ["img.bin", "changed"], ["new.md", "added"]]);
  assert.equal(r.adds, 2);
  assert.equal(r.dels, 2);
  assert.match(r.patch, /^--- a\/a\.md\t货架$/m);
  assert.match(r.patch, /^\+\+\+ \/dev\/null\t本地$/m);
  assert.match(r.patch, /^Binary files a\/img\.bin and b\/img\.bin differ$/m);
  assert.match(statText(r), /4 个文件，\+2 -2/);
  assert.equal(diffTrees(from, from).files.length, 0);
  assert.ok(isBinary(B("\x00abc")) && !isBinary(B("abc")));
});

test("parseArgs：未知参数直接报错，值参数与 --a=b 写法", () => {
  assert.deepEqual(parseArgs("pull", ["x", "--dest", "d", "--force"]), { flags: { "--dest": "d", "--force": true }, positionals: ["x"] });
  assert.deepEqual(parseArgs("pull", ["--dest=d", "--", "--weird-name"]).positionals, ["--weird-name"]);
  assert.throws(() => parseArgs("push", ["--yse", "a"]), (e) => e instanceof ShelfExit && e.code === 1 && /--yse/.test(e.message));
  assert.throws(() => parseArgs("pull", ["--dest"]), (e) => e instanceof ShelfExit && e.code === 1);
  assert.throws(() => parseArgs("sync", ["--dry-run=yes"]), (e) => e instanceof ShelfExit && e.code === 1);
});

test("detectAiDir：.NET / Unity 用 AI，JS / Java 用 ai，已有目录沿用磁盘上的大小写", (t) => {
  const root = tmpRoot(t, "aidir");
  const mk = (name, files) => {
    const d = path.join(root, name);
    fs.mkdirSync(d);
    writeFiles(d, files);
    return d;
  };
  assert.equal(detectAiDir(mk("dotnet", { "App.sln": "", "src/App/App.csproj": "" })).name, "AI");
  assert.equal(detectAiDir(mk("nested", { "src/App.csproj": "" })).name, "AI");
  assert.equal(detectAiDir(mk("unity", { "ProjectSettings/ProjectVersion.txt": "m_EditorVersion: 6000.0" })).name, "AI");
  assert.equal(detectAiDir(mk("js", { "package.json": "{}", "tsconfig.json": "{}" })).name, "ai");
  assert.equal(detectAiDir(mk("java", { "pom.xml": "<project/>" })).name, "ai");
  assert.equal(detectAiDir(mk("legacy", { "Ai/PROJECT.md": "x", "App.sln": "" })).name, "Ai");
  assert.equal(detectAiDir(mk("webassets", { "package.json": "{}", "Assets/logo.png": "x" })).name, "ai");
  assert.ok(!isDotnetProject(mk("empty", {})));
});

test("planScaffold：按已装技能决定目录，技能可在 frontmatter 自己声明", (t) => {
  const root = tmpRoot(t, "scaffold");
  writeFiles(root, {
    "ai/jaSkills/intj/SKILL.md": "---\nname: intj\n---\n",
    "ai/jaSkills/feature/SKILL.md": "---\nname: feature\n---\n",
    "ai/jaSkills/painter/SKILL.md": "---\nname: painter\nmetadata:\n  shelf-scaffold: \"art/refs, ../escape, /abs\"\n---\n",
  });
  const plan = expandTemplate(BUILTIN_AI, { shelfDir: root, agents: ["claude"], aiDir: "ai" });
  const items = planScaffold(plan.scaffold, { aiDir: "ai", skillsHomeAbs: path.join(root, "ai", "jaSkills") });
  assert.deepEqual(items.map((i) => i.rel).sort(), ["ai/PROJECT.md", "ai/TODO.md", "ai/art/refs", "ai/features", "ai/sessions"]);
  assert.deepEqual(items.find((i) => i.rel === "ai/features").by.sort(), ["feature", "intj"]);
  assert.deepEqual(declaredScaffold(path.join(root, "ai/jaSkills/painter/SKILL.md")), ["art/refs"]);

  fs.mkdirSync(path.join(root, "ai", "features"), { recursive: true });
  const r = applyScaffold(root, items, { date: "2026-10-18", name: "demo" });
  assert.ok(r.existed.includes("ai/features"));
  assert.ok(r.created.includes("ai/sessions"));
  assert.ok(fs.existsSync(path.join(root, "ai", "sessions", ".gitkeep")));
  assert.match(fs.readFileSync(path.join(root, "ai", "PROJECT.md"), "utf8"), /^# demo\n\n> 最后更新：2026-10-18/);
  assert.match(fs.readFileSync(path.join(root, "ai", "TODO.md"), "utf8"), /## Epics & Milestones/);
  const again = applyScaffold(root, items, { date: "2026-10-18", name: "demo" });
  assert.equal(again.created.length, 0);
});

test("真技能的固定目录声明拼起来就是 ai 区骨架；测试货架的同名技能与之一致；父目录不单列", (t) => {
  const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "shelf", "skills");
  const skills = ["_common/intj", "_common/feature", "_common/monet", "_common/ui-tailor", "_common/codex-visual", "project-audit"]
    .map((rel) => ({ name: path.basename(rel), skillMd: path.join(SKILLS, ...rel.split("/"), "SKILL.md") }));
  assert.deepEqual(planScaffold([], { aiDir: "ai", skills }).map((i) => i.rel).sort(), [
    "ai/design_system/codex-visual", "ai/design_system/concept", "ai/design_system/img", "ai/design_system/uiux",
    "ai/features", "ai/project-audit/runs", "ai/project-audit/scripts", "ai/sessions",
  ]);
  for (const s of skills.filter((x) => TEST_SCAFFOLD[x.name])) {
    assert.equal(declaredScaffold(s.skillMd).join(", "), TEST_SCAFFOLD[s.name], s.name);
  }
  // 内置配方兜底的骨架和真技能的声明一致（老货架上还没声明的技能也建同一副骨架）
  const builtin = expandTemplate(BUILTIN_AI, { shelfDir: SKILLS, agents: ["claude"], aiDir: "ai" }).scaffold
    .filter((x) => x.dir).map((x) => x.dir).sort();
  assert.deepEqual(builtin, planScaffold([], { aiDir: "ai", skills }).map((i) => i.rel).sort());

  const root = tmpRoot(t, "leaf");
  writeFiles(root, { "s/a/SKILL.md": "---\nname: a\nmetadata:\n  shelf-scaffold: \"x, x/y, z\"\n---\n" });
  const leaf = planScaffold([], { aiDir: "ai", skillsHomeAbs: path.join(root, "s") });
  assert.deepEqual(leaf.map((i) => i.rel).sort(), ["ai/x/y", "ai/z"]);
  applyScaffold(root, leaf, { date: "2026-10-19", name: "demo" });
  assert.ok(fs.existsSync(path.join(root, "ai", "x", "y", ".gitkeep")) && !fs.existsSync(path.join(root, "ai", "x", ".gitkeep")));
});

test("expandTemplate：按 agent 过滤、{ai} 代入、files/ 指向模板目录、/* 一个子目录一件；renderText 只换认得的占位符", (t) => {
  const root = tmpRoot(t, "tpl");
  writeFiles(root, {
    "agents/claude/CLAUDE.md": "c",
    "agents/codex/AGENTS.md": "a",
    "skills/_common/intj/SKILL.md": "i",
    "skills/_common/vc/SKILL.md": "v",
    "templates/ai/template.json": "{}",
    "templates/ai/files/ai/x.sh": "x",
  });
  const tpl = {
    name: "ai",
    key: "templates/ai",
    items: [
      { from: "agents/claude/CLAUDE.md", to: "{ai}/jaAgents/CLAUDE.md", copy: "CLAUDE.md", agents: ["claude"] },
      { from: "agents/codex/AGENTS.md", to: "{ai}/jaAgents/AGENTS.md", copy: "AGENTS.md", agents: ["codex"] },
      { from: "skills/common/*", to: "{ai}/jaSkills/" },
      { from: "files/ai/x.sh", to: "{ai}/scripts/x.sh" },
      { from: "agents/nope.md", to: "x", optional: true },
      { from: "agents/missing.md", to: "y" },
    ],
    scaffold: [{ dir: "{ai}/features" }],
  };
  const plan = expandTemplate(tpl, { shelfDir: root, agents: ["claude"], aiDir: "AI" });
  assert.deepEqual(plan.items.map((i) => [i.key, i.dest, i.copy]), [
    ["agents/claude/CLAUDE.md", "AI/jaAgents/CLAUDE.md", "CLAUDE.md"],
    ["skills/_common/intj", "AI/jaSkills/intj", null],
    ["skills/_common/vc", "AI/jaSkills/vc", null],
    ["templates/ai/files/ai/x.sh", "AI/scripts/x.sh", null],
  ]);
  assert.deepEqual(plan.missing, ["agents/missing.md"]);
  assert.equal(plan.scaffold[0].dir, "AI/features");
  assert.equal(renderText("# {{project}} {{date}} {{ai}} {{other}}", { project: "p", date: "d", ai: "AI" }), "# p d AI {{other}}");
});

test("mergeTrees：只一边改的直接取，两边改的交给 git merge-file，删改冲突按 git 的方式留文件", () => {
  const lines = (...xs) => B(xs.join("\n") + "\n");
  const base = new Map([
    ["both.md", lines("a", "b", "c", "d", "e", "f", "g")],
    ["clash.md", lines("x", "y", "z")],
    ["theirs-only.md", lines("t")],
    ["ours-only.md", lines("o")],
    ["del-theirs.md", lines("keep?")],
    ["del-ours.md", lines("keep?")],
  ]);
  const theirs = new Map([
    ["both.md", lines("A", "b", "c", "d", "e", "f", "g")],
    ["clash.md", lines("x", "THEIRS", "z")],
    ["theirs-only.md", lines("t2")],
    ["ours-only.md", lines("o")],
    ["del-ours.md", lines("changed upstream")],
    ["added-theirs.md", lines("new")],
  ]);
  const ours = new Map([
    ["both.md", lines("a", "b", "c", "d", "e", "f", "G")],
    ["clash.md", lines("x", "OURS", "z")],
    ["theirs-only.md", lines("t")],
    ["ours-only.md", lines("o2")],
    ["del-theirs.md", lines("edited locally")],
    ["added-ours.md", lines("mine")],
  ]);
  const r = mergeTrees(base, theirs, ours, { ours: MARK_OURS, base: "上次拉取", theirs: `${MARK_THEIRS} abc1234` });
  const how = Object.fromEntries(r.files.map((f) => [f.path, f.reason ? `${f.how}:${f.reason}` : f.how]));
  assert.deepEqual(how, {
    "added-ours.md": "ours-added",
    "added-theirs.md": "theirs-added",
    "both.md": "merged",
    "clash.md": "conflict:content",
    "del-ours.md": "conflict:ours-deleted",
    "del-theirs.md": "conflict:theirs-deleted",
    "ours-only.md": "ours",
    "theirs-only.md": "theirs",
  });
  assert.equal(r.result.get("both.md").toString(), "A\nb\nc\nd\ne\nf\nG\n");
  assert.match(r.result.get("clash.md").toString(), /^<<<<<<< 本地\nOURS\n=======\nTHEIRS\n>>>>>>> 货架 abc1234$/m);
  assert.equal(r.result.get("del-ours.md").toString(), "changed upstream\n");
  assert.equal(r.result.get("del-theirs.md").toString(), "edited locally\n");
  assert.deepEqual(conflictMarkerFiles(r.result), ["clash.md"]);
  // 文档里举例的冲突块（标签不是本地 / 货架）不算
  assert.deepEqual(conflictMarkerFiles(new Map([["doc.md", B("<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> branch\n")]])), []);
});

test("writeTree：只写变化的文件，删掉结果里没有的并清理空目录；mapHash 与 contentHash 同算法", (t) => {
  const root = tmpRoot(t, "write");
  const dir = path.join(root, "item");
  writeFiles(dir, { "a.md": "1\n", "sub/b.md": "2\n" });
  const prev = readTreeFs(dir, "item");
  writeTree(dir, new Map([["a.md", B("1\n")], ["c.md", B("3\n")]]), { isFile: false, fileKey: "item", previous: prev });
  assert.ok(!fs.existsSync(path.join(dir, "sub")));
  assert.equal(fs.readFileSync(path.join(dir, "c.md"), "utf8"), "3\n");
  assert.equal(mapHash(readTreeFs(dir, "item"), false), contentHash(dir));
  const file = path.join(root, "one.md");
  fs.writeFileSync(file, "solo\n");
  assert.equal(mapHash(readTreeFs(file, "one.md"), true), contentHash(file));
});
