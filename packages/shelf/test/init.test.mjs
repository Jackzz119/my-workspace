import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  tmpRoot, makeRemote, machine, project, ledger, read, exists, isLink, isJunction, git, DEFAULT_SHELF,
} from "./helpers.mjs";

const WIN = process.platform === "win32";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function assertLinked(p, rel) {
  assert.ok(isLink(p, rel), `${rel} 应该是链接`);
  if (WIN) assert.ok(isJunction(p, rel), `${rel} 在 Windows 上应该是 junction`);
  assert.ok(exists(p, `${rel}/intj/SKILL.md`), `${rel} 应该能读到正本里的技能`);
}

test("init：新项目一条命令接入（协议、通用技能、链接、gitignore、ai 脚手架），重跑幂等", (t) => {
  const root = tmpRoot(t, "init");
  const m = machine(root, "a", makeRemote(root));
  const p = project(root, "web", { "package.json": '{"name":"web-app"}', ".gitignore": "node_modules\n" });
  git(root, p, ["init", "-q"]);

  const r = m.json(p, "init", "--agents", "claude,codex");
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.data.aiDir, "ai");
  assert.equal(read(p, "CLAUDE.md"), DEFAULT_SHELF["agents/claude/CLAUDE.md"]);
  assert.equal(read(p, "AGENTS.md"), DEFAULT_SHELF["agents/codex/AGENTS.md"]);
  assert.equal(read(p, "ai/JASKILL.md"), DEFAULT_SHELF["docs/JASKILL.md"]);
  for (const s of ["intj", "feature", "monet"]) assert.ok(exists(p, `ai/jaSkills/${s}/SKILL.md`), s);
  assert.ok(!exists(p, "ai/jaSkills/project-audit"), "通用包之外的技能不自动装");

  assertLinked(p, ".claude/skills");
  assertLinked(p, ".agents/skills");
  assert.ok(!exists(p, ".codex"), "Codex 不再用 .codex/skills");

  const gi = read(p, ".gitignore");
  for (const line of ["/CLAUDE.md", "/AGENTS.md", "/.claude/skills", "/.agents/skills"]) {
    assert.match(gi, new RegExp(`^${esc(line)}$`, "m"), line);
  }
  assert.doesNotMatch(gi, /^CLAUDE\.md$/m, "不写裸 CLAUDE.md（会误伤入库副本）");
  const status = git(root, p, ["status", "--porcelain", "--untracked-files=all"]);
  assert.doesNotMatch(status, /\.claude\/skills|\.agents\/skills|CLAUDE\.md|AGENTS\.md/, status);
  assert.match(status, /ai\/jaSkills\/intj\/SKILL\.md/, "技能正本进项目 git");

  for (const rel of ["ai/PROJECT.md", "ai/TODO.md", "ai/features/.gitkeep", "ai/sessions/.gitkeep", "ai/design_system/.gitkeep"]) {
    assert.ok(exists(p, rel), rel);
  }
  assert.ok(!exists(p, "ai/project-audit"), "没装 project-audit 就不建它的目录");
  assert.match(read(p, "ai/PROJECT.md"), /^# web-app\n/);

  const L = ledger(p);
  assert.equal(L.aiDir, "ai");
  assert.deepEqual(L.agents, ["claude", "codex"]);
  assert.equal(L.shelf["docs/JASKILL.md"].planted, true);
  assert.equal(L.shelf["docs/JASKILL.md"].localPath, "ai/JASKILL.md");
  assert.equal(L.shelf["skills/_common/intj"].localPath, "ai/jaSkills/intj");

  const giBefore = read(p, ".gitignore");
  const ledgerBefore = read(p, ".shelf.json");
  const again = m.json(p, "init");
  assert.equal(again.code, 0, again.out);
  assert.deepEqual(again.json.data.scaffold.created, []);
  assert.deepEqual(again.json.data.gitignoreAdded, []);
  assert.ok(again.json.data.items.every((i) => ["up-to-date", "planted-kept"].includes(i.action)), JSON.stringify(again.json.data.items));
  assert.equal(read(p, ".gitignore"), giBefore);
  assert.equal(read(p, ".shelf.json"), ledgerBefore);
});

test("init：.NET 项目的 ai 资料区叫 AI，链接和账本都跟着走", (t) => {
  const root = tmpRoot(t, "dotnet");
  const m = machine(root, "a", makeRemote(root));
  const p = project(root, "game", { "Game.sln": "", "src/Game/Game.csproj": "<Project />" });
  const r = m.json(p, "init", "--agents", "claude");
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.data.aiDir, "AI");
  assert.ok(fs.readdirSync(p).includes("AI"), "磁盘上就是大写 AI");
  assert.ok(exists(p, "AI/jaSkills/intj/SKILL.md"));
  assert.ok(exists(p, "AI/JASKILL.md"));
  assert.ok(exists(p, "AI/PROJECT.md"));
  assertLinked(p, ".claude/skills");
  assert.equal(fs.realpathSync(path.join(p, ".claude", "skills")), fs.realpathSync(path.join(p, "AI", "jaSkills")));
  assert.equal(ledger(p).shelf["skills/_common/intj"].localPath, "AI/jaSkills/intj");
});

test("init：非交互首次不带 --agents 退出 2 并给出命令；--ai-dir 不合法退出 1", (t) => {
  const root = tmpRoot(t, "noagents");
  const m = machine(root, "a", makeRemote(root));
  const p = project(root, "p");
  const r = m.json(p, "init");
  assert.equal(r.code, 2);
  assert.deepEqual(r.json.next, ["shelf init --agents claude,codex"]);
  assert.equal(m.run(p, "init", "--agents", "claude", "--ai-dir", "a/b").code, 1);
  assert.equal(m.run(p, "init", "--agents", "nope").code, 1);
});

test("老项目的 .codex/skills（链接或实体目录）在 sync 时迁到 .agents/skills", (t) => {
  const root = tmpRoot(t, "codex");
  const m = machine(root, "a", makeRemote(root));

  // ① 老版 init 留下的链接
  const p = project(root, "old-link", { ".codex/config.toml": "model = 'x'\n" });
  assert.equal(m.run(p, "init", "--agents", "claude,codex").code, 0);
  fs.unlinkSync(path.join(p, ".agents", "skills"));
  fs.rmdirSync(path.join(p, ".agents"));
  fs.symlinkSync(path.join(p, "ai", "jaSkills"), path.join(p, ".codex", "skills"), "junction");
  const r = m.run(p, "sync");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /\.codex\/skills → \.agents\/skills/);
  assert.ok(!exists(p, ".codex/skills"));
  assert.ok(exists(p, ".codex/config.toml"), ".codex 里别的东西不动");
  assertLinked(p, ".agents/skills");
  assert.ok(exists(p, "ai/jaSkills/intj/SKILL.md"), "删链接不能删到正本");

  // ② 复制镜像时代的实体目录：独有技能并进正本，.codex 空了一并删
  const q = project(root, "old-copy");
  assert.equal(m.run(q, "init", "--agents", "claude,codex").code, 0);
  fs.unlinkSync(path.join(q, ".agents", "skills"));
  fs.cpSync(path.join(q, "ai", "jaSkills"), path.join(q, ".codex", "skills"), { recursive: true });
  fs.mkdirSync(path.join(q, ".codex", "skills", "extra-skill"));
  fs.writeFileSync(path.join(q, ".codex", "skills", "extra-skill", "SKILL.md"), "---\nname: extra-skill\n---\n");
  const r2 = m.json(q, "sync");
  assert.equal(r2.code, 0, r2.out);
  assert.equal(r2.json.data.health.codexMigrated, true);
  assert.ok(!exists(q, ".codex"));
  assert.ok(exists(q, "ai/jaSkills/extra-skill/SKILL.md"));
  assertLinked(q, ".agents/skills");
  assert.match(read(q, ".gitignore"), /^\/\.agents\/skills$/m);
  assert.ok(ledger(q).local["extra-skill"], "外来技能登记进 local 段");
});

test("已有账本里的 docs/JASKILL.md 自动补 planted；植入物不对账、不推，pull --force 重新植入", (t) => {
  const root = tmpRoot(t, "planted");
  const m = machine(root, "a", makeRemote(root));
  const p = project(root, "p");
  assert.equal(m.run(p, "init", "--agents", "claude").code, 0);
  const L = ledger(p);
  delete L.shelf["docs/JASKILL.md"].planted; // 老账本
  fs.writeFileSync(path.join(p, ".shelf.json"), JSON.stringify(L, null, 2) + "\n");
  fs.writeFileSync(path.join(p, "ai", "JASKILL.md"), "# 本项目自己的登记表\n");

  const st = m.json(p, "status");
  assert.equal(st.code, 0, st.out);
  assert.equal(st.json.data.items.find((i) => i.key === "docs/JASKILL.md").state, "planted");
  assert.equal(ledger(p).shelf["docs/JASKILL.md"].planted, undefined, "status 只读，不改账本");

  const sy = m.run(p, "sync");
  assert.equal(sy.code, 0, sy.out);
  assert.match(sy.out, /植入，不对账: ai\/JASKILL\.md/);
  assert.equal(ledger(p).shelf["docs/JASKILL.md"].planted, true);

  const push = m.run(p, "push", "ai/JASKILL.md", "--yes");
  assert.equal(push.code, 1);
  assert.match(push.out, /归项目维护/);
  assert.equal(m.run(p, "merge", "ai/JASKILL.md").code, 1);

  const re = m.run(p, "pull", "docs/JASKILL.md", "--force");
  assert.equal(re.code, 0, re.out);
  assert.equal(read(p, "ai/JASKILL.md"), DEFAULT_SHELF["docs/JASKILL.md"]);
  assert.equal(ledger(p).shelf["docs/JASKILL.md"].planted, true);
});
