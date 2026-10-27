import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  tmpRoot, makeRemote, pushToRemote, machine, project, ledger, read, exists, isLink, isJunction, git, cloneProject,
  DEFAULT_SHELF, BARE_SHELF, TEMPLATE_FILES, SKILL_MD,
} from "./helpers.mjs";

const WIN = process.platform === "win32";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function assertLinked(p, rel, home = "ai/jaSkills") {
  assert.ok(isLink(p, rel), `${rel} 应该是链接`);
  if (WIN) assert.ok(isJunction(p, rel), `${rel} 在 Windows 上应该是 junction`);
  assert.equal(fs.realpathSync(path.join(p, ...rel.split("/"))), fs.realpathSync(path.join(p, ...home.split("/"))));
}

test("init：新项目按 ai 模板一次接入（协议正本 + 根目录副本、通用技能、脚本、植入物、链接、gitignore、脚手架），重跑幂等", (t) => {
  const root = tmpRoot(t, "init");
  const m = machine(root, "a", makeRemote(root));
  const p = project(root, "web", { "package.json": '{"name":"web-app"}', ".gitignore": "node_modules\n" });
  git(root, p, ["init", "-q"]);

  const r = m.json(p, "init", "--agents", "claude,codex");
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.data.mode, "fresh");
  assert.deepEqual(r.json.data.template, { name: "ai", builtin: false });
  // 协议：正本在 ai/jaAgents（入库），根目录是副本
  for (const [doc, src] of [["CLAUDE.md", "agents/claude/CLAUDE.md"], ["AGENTS.md", "agents/codex/AGENTS.md"]]) {
    assert.equal(read(p, `ai/jaAgents/${doc}`), DEFAULT_SHELF[src]);
    assert.equal(read(p, doc), DEFAULT_SHELF[src]);
  }
  assert.equal(read(p, "ai/jaAgents/MULTICA.md"), DEFAULT_SHELF["agents/multica/MULTICA.md"]);
  // 技能、脚本
  for (const s of ["intj", "feature", "monet", "project-audit"]) assert.ok(exists(p, `ai/jaSkills/${s}/SKILL.md`), s);
  assert.ok(!exists(p, "note.md") && !exists(p, "ai/note.md"), "模板以外的货不自动装");
  assert.equal(read(p, "ai/scripts/sync-worktree.sh"), TEMPLATE_FILES["templates/ai/files/ai/scripts/sync-worktree.sh"]);
  assert.equal(read(p, "ai/scripts/bootstrap.sh"), TEMPLATE_FILES["templates/ai/files/ai/scripts/bootstrap.sh"]);
  // 植入物：渲染占位符
  assert.match(read(p, "ai/PROJECT.md"), /^# web-app\n\n> 最后更新：\d{4}-\d{2}-\d{2}\n/);
  assert.match(read(p, "ai/check-docs.json"), /"\^ai\/sessions\/"/);
  assert.doesNotMatch(read(p, "ai/check-docs.json"), /\{\{ai\}\}/);
  assert.equal(read(p, ".worktreeinclude"), TEMPLATE_FILES["templates/ai/files/.worktreeinclude"]);
  assert.equal(read(p, ".claude/settings.json"), TEMPLATE_FILES["templates/ai/files/.claude/settings.json"]);
  assert.equal(read(p, "ai/JASKILL.md"), DEFAULT_SHELF["docs/JASKILL.md"]);
  // 链接、gitignore
  assertLinked(p, ".claude/skills");
  assertLinked(p, ".agents/skills");
  assert.ok(!exists(p, ".codex/skills"), "Codex 技能走 .agents/skills");
  assert.equal(read(p, ".codex/hooks.json"), TEMPLATE_FILES["templates/ai/files/.codex/hooks.json"], "Codex 的协议提醒钩子");
  const gi = read(p, ".gitignore");
  for (const line of ["/CLAUDE.md", "/AGENTS.md", "/.claude/skills", "/.agents/skills"]) assert.match(gi, new RegExp(`^${esc(line)}$`, "m"), line);
  const status = git(root, p, ["status", "--porcelain", "--untracked-files=all"]);
  assert.doesNotMatch(status, /^\?\? (CLAUDE|AGENTS)\.md$/m, "根目录副本不入库");
  assert.doesNotMatch(status, /\.claude\/skills|\.agents\/skills/, "链接不入库");
  for (const tracked of ["ai/jaAgents/CLAUDE.md", "ai/jaSkills/intj/SKILL.md", "ai/scripts/sync-worktree.sh", ".claude/settings.json", ".shelf.json"]) {
    assert.match(status, new RegExp(esc(tracked)), `${tracked} 应该进项目 git`);
  }
  // 固定目录：各技能在 frontmatter 里声明，.gitkeep 只放在最深一层
  for (const rel of [
    "ai/features", "ai/sessions", "ai/design_system/concept", "ai/design_system/img", "ai/design_system/uiux",
    "ai/design_system/codex-visual", "ai/project-audit/runs", "ai/project-audit/scripts",
  ]) assert.ok(exists(p, `${rel}/.gitkeep`), rel);
  assert.ok(!exists(p, "ai/design_system/.gitkeep") && !exists(p, "ai/project-audit/.gitkeep"), "父目录不放 .gitkeep");
  // 账本
  const L = ledger(p);
  assert.equal(L.aiDir, "ai");
  assert.deepEqual(L.agents, ["claude", "codex"]);
  assert.equal(L.template.name, "ai");
  assert.deepEqual([L.shelf["agents/claude/CLAUDE.md"].localPath, L.shelf["agents/claude/CLAUDE.md"].mirror], ["ai/jaAgents/CLAUDE.md", "CLAUDE.md"]);
  assert.equal(L.shelf["docs/JASKILL.md"].planted, true);
  assert.equal(L.shelf["templates/ai/files/ai/PROJECT.md"].planted, true);
  assert.equal(L.shelf["skills/_common/intj"].fromTemplate, true);

  const giBefore = read(p, ".gitignore");
  const ledgerBefore = read(p, ".shelf.json");
  const again = m.json(p, "init");
  assert.equal(again.code, 0, again.out);
  assert.equal(again.json.data.mode, "restore");
  assert.deepEqual(again.json.data.scaffold.created, []);
  assert.deepEqual(again.json.data.gitignoreAdded, []);
  assert.ok(again.json.data.items.every((i) => ["same", "planted"].includes(i.state)), JSON.stringify(again.json.data.items));
  assert.equal(read(p, ".gitignore"), giBefore);
  assert.equal(read(p, ".shelf.json"), ledgerBefore);
});

test("init：.NET 项目的 ai 资料区叫 AI，协议正本、技能、链接、脚手架都跟着走", (t) => {
  const root = tmpRoot(t, "dotnet");
  const m = machine(root, "a", makeRemote(root));
  const p = project(root, "game", { "Game.sln": "", "src/Game/Game.csproj": "<Project />" });
  const r = m.json(p, "init", "--agents", "claude");
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.data.aiDir, "AI");
  assert.ok(fs.readdirSync(p).includes("AI"), "磁盘上就是大写 AI");
  for (const rel of ["AI/jaAgents/CLAUDE.md", "AI/jaSkills/intj/SKILL.md", "AI/JASKILL.md", "AI/PROJECT.md", "AI/scripts/sync-worktree.sh", "CLAUDE.md"]) {
    assert.ok(exists(p, rel), rel);
  }
  assert.ok(!exists(p, "AGENTS.md"), "只接 claude 时不植 AGENTS.md");
  assert.match(read(p, "AI/check-docs.json"), /"\^AI\/sessions\/"/);
  assertLinked(p, ".claude/skills", "AI/jaSkills");
  assert.equal(ledger(p).shelf["skills/_common/intj"].localPath, "AI/jaSkills/intj");
});

test("init：项目里已有模板技能的旧拷贝（没记过账、内容不同）→ 待决，不当成项目自己的技能登记", (t) => {
  const root = tmpRoot(t, "stale");
  const m = machine(root, "a", makeRemote(root));
  const p = project(root, "p", {
    "package.json": '{"name":"p"}',
    "ai/jaSkills/intj/SKILL.md": SKILL_MD("intj", "旧拷贝"),
    "ai/JASKILL.md": "# 本项目技能\n",
  });
  const r = m.json(p, "init", "--agents", "claude");
  assert.equal(r.code, 2, r.out);
  assert.equal(r.json.data.items.find((i) => i.key === "skills/_common/intj").state, "untracked-differs");
  assert.deepEqual(Object.keys(ledger(p).local ?? {}), [], "模板里的货不进 local 段");
  assert.deepEqual(r.json.data.jaskill.unregistered, [], "也就不会被当成没登记的项目技能");
  assert.equal(m.json(p, "pull", "skills/common/intj", "--force").code, 0);
  assert.equal(m.json(p, "sync").code, 0);
});

test("init：非交互首次不带 --agents 按模板默认接 claude + codex；参数不合法退出 1", (t) => {
  const root = tmpRoot(t, "noagents");
  const m = machine(root, "a", makeRemote(root));
  const p = project(root, "p");
  const r = m.json(p, "init");
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.data.agents, ["claude", "codex"]);
  assert.ok(exists(p, "AGENTS.md") && exists(p, "CLAUDE.md"));
  const q2 = project(root, "q");
  assert.equal(m.run(q2, "init", "--agents", "claude", "--ai-dir", "a/b").code, 1);
  assert.equal(m.run(q2, "init", "--agents", "nope").code, 1);
  assert.equal(m.run(q2, "init", "--template", "nope").code, 1);
});

test("换设备：只有入库文件的 clone，init 按账本还原（链接、根目录副本、补拉、更新、未登记技能入账、JASKILL 核对）", (t) => {
  const root = tmpRoot(t, "restore");
  const remote = makeRemote(root);
  const a = machine(root, "old-pc", remote);
  const p = project(root, "app", { "package.json": '{"name":"app"}' });
  assert.equal(a.run(p, "init", "--agents", "claude,codex").code, 0);
  // 项目自己的技能（没登记）、外加一件不在模板里的货；两件记过账的货没提交：新设备上缺
  fs.mkdirSync(path.join(p, "ai", "jaSkills", "my-local"));
  fs.writeFileSync(path.join(p, "ai", "jaSkills", "my-local", "SKILL.md"), "---\nname: my-local\n---\n");
  assert.equal(a.run(p, "pull", "docs/note.md").code, 0);
  fs.rmSync(path.join(p, "note.md"));
  fs.rmSync(path.join(p, "ai", "jaSkills", "project-audit"), { recursive: true });
  fs.writeFileSync(path.join(p, "ai", "JASKILL.md"), "# 本项目技能\n\n| 技能 | 何时读 | 上游 |\n| --- | --- | --- |\n| `gone-skill` | 早就删了 | 自建 |\n");
  const copy = cloneProject(root, p, "app-on-new-pc");
  assert.ok(!exists(copy, "CLAUDE.md") && !exists(copy, ".claude/skills"), "新 clone 里没有 gitignored 的东西");

  pushToRemote(root, remote, { "skills/_common/feature/SKILL.md": SKILL_MD("feature", "货架新版") });
  const b = machine(root, "new-pc", remote);
  const r = b.json(copy, "init");
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.data.mode, "restore");
  assertLinked(copy, ".claude/skills");
  assertLinked(copy, ".agents/skills");
  assert.equal(read(copy, "CLAUDE.md"), read(copy, "ai/jaAgents/CLAUDE.md"), "根目录副本按 ai/jaAgents 补回");
  const byKey = Object.fromEntries(r.json.data.items.map((i) => [i.key, i.state]));
  assert.equal(byKey["skills/project-audit"], "restored");
  assert.equal(byKey["docs/note.md"], "restored");
  assert.equal(read(copy, "note.md"), DEFAULT_SHELF["docs/note.md"]);
  assert.equal(byKey["skills/_common/feature"], "updated");
  assert.equal(read(copy, "ai/jaSkills/feature/SKILL.md"), SKILL_MD("feature", "货架新版"));
  assert.ok(ledger(copy).local["my-local"], "没记账的技能登记进 local 段");
  assert.deepEqual(r.json.data.jaskill.unregistered, ["my-local"]);
  assert.deepEqual(r.json.data.jaskill.stale, ["gone-skill"]);
});

test("1.x 账本迁移：协议正本从根目录挪到 ai/jaAgents（根目录变副本），JASKILL 补 planted，.codex/skills 迁走", (t) => {
  const root = tmpRoot(t, "migrate");
  const m = machine(root, "a", makeRemote(root));
  const p = project(root, "old", { ".codex/config.toml": "model = 'x'\n" });
  assert.equal(m.run(p, "init", "--agents", "claude,codex").code, 0);
  // 退回 1.x 的样子：正本在根目录、ai/jaAgents 没有、JASKILL 没标记、Codex 用 .codex/skills
  const L = ledger(p);
  L.shelf["agents/claude/CLAUDE.md"].localPath = "CLAUDE.md";
  delete L.shelf["agents/claude/CLAUDE.md"].mirror;
  delete L.shelf["docs/JASKILL.md"].planted;
  delete L.template;
  fs.writeFileSync(path.join(p, ".shelf.json"), JSON.stringify(L, null, 2) + "\n");
  fs.rmSync(path.join(p, "ai", "jaAgents", "CLAUDE.md"));
  fs.writeFileSync(path.join(p, "CLAUDE.md"), read(p, "CLAUDE.md") + "本项目加的一行\n");
  fs.unlinkSync(path.join(p, ".agents", "skills"));
  fs.symlinkSync(path.join(p, "ai", "jaSkills"), path.join(p, ".codex", "skills"), "junction");

  const r = m.json(p, "sync");
  assert.equal(r.code, 2, r.out); // 迁完后 CLAUDE.md 是「本地领先」待决
  const after = ledger(p);
  assert.deepEqual([after.shelf["agents/claude/CLAUDE.md"].localPath, after.shelf["agents/claude/CLAUDE.md"].mirror], ["ai/jaAgents/CLAUDE.md", "CLAUDE.md"]);
  assert.match(read(p, "ai/jaAgents/CLAUDE.md"), /本项目加的一行/, "根目录那份的改动搬进正本");
  assert.equal(after.shelf["docs/JASKILL.md"].planted, true);
  assert.equal(r.json.data.items.find((i) => i.key === "agents/claude/CLAUDE.md").state, "local-ahead");
  assert.ok(!exists(p, ".codex/skills") && exists(p, ".codex/config.toml"));
  assertLinked(p, ".agents/skills");
  assert.ok(exists(p, "ai/jaSkills/intj/SKILL.md"), "删链接不能删到正本");
});

test("货架上没有 templates/ai 时用内置配方，同样落 ai/jaAgents + 根目录副本", (t) => {
  const root = tmpRoot(t, "builtin");
  const m = machine(root, "a", makeRemote(root, BARE_SHELF));
  const p = project(root, "p", { "package.json": '{"name":"bare"}' });
  const r = m.json(p, "init", "--agents", "claude");
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.json.data.template, { name: "ai", builtin: true });
  assert.equal(read(p, "CLAUDE.md"), BARE_SHELF["agents/claude/CLAUDE.md"]);
  assert.ok(exists(p, "ai/jaAgents/CLAUDE.md") && exists(p, "ai/jaAgents/MULTICA.md"));
  assert.match(read(p, "ai/PROJECT.md"), /^# bare\n/);
  assert.ok(!exists(p, "ai/scripts"), "内置配方没有模板自带的文件");
});
