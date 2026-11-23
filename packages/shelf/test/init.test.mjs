import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

test("init / sync / pull：已有的 .claude/settings.json / .codex/hooks.json 只补模板里缺的钩子（本地钩子与设置原样），重跑不变；status 只预告；坏 JSON 不动", (t) => {
  const root = tmpRoot(t, "hooks");
  const m = machine(root, "a", makeRemote(root));
  const tplClaude = JSON.parse(TEMPLATE_FILES["templates/ai/files/.claude/settings.json"]);
  const tplCodex = JSON.parse(TEMPLATE_FILES["templates/ai/files/.codex/hooks.json"]);
  const startClaude = tplClaude.hooks.SessionStart.find((g) => g.matcher === "startup");
  assert.ok(startClaude, "模板的 Claude 设置里有开场钩子");
  // 模板加开场钩子之前就装好的本地配置：少开场钩子，多一个自己的钩子，outputStyle 大小写和模板不同
  const own = { hooks: [{ type: "command", command: "echo mine", timeout: 5 }] };
  const oldClaude = {
    outputStyle: "concise",
    hooks: {
      SessionStart: tplClaude.hooks.SessionStart.filter((g) => g !== startClaude),
      UserPromptSubmit: [...tplClaude.hooks.UserPromptSubmit, own],
    },
  };
  const oldCodex = { hooks: { ...tplCodex.hooks, SessionStart: tplCodex.hooks.SessionStart.slice(1) } };
  const p = project(root, "app", {
    "package.json": '{"name":"app"}',
    ".claude/settings.json": JSON.stringify(oldClaude, null, 4) + "\n",
    ".codex/hooks.json": JSON.stringify(oldCodex, null, 2) + "\n",
  });

  const r = m.json(p, "init", "--agents", "claude,codex");
  assert.equal(r.code, 0, r.out);
  const byKey = Object.fromEntries(r.json.data.items.map((i) => [i.key, i]));
  assert.equal(byKey["templates/ai/files/.claude/settings.json"].state, "hooks-merged");
  assert.deepEqual(byKey["templates/ai/files/.claude/settings.json"].hooksAdded, [{ event: "SessionStart", hooks: 1 }]);
  assert.equal(byKey["templates/ai/files/.codex/hooks.json"].state, "hooks-merged");
  const claude = JSON.parse(read(p, ".claude/settings.json"));
  assert.deepEqual(claude.hooks.SessionStart, tplClaude.hooks.SessionStart, "开场钩子补在最前面，和模板顺序一致");
  assert.deepEqual(claude.hooks.UserPromptSubmit, oldClaude.hooks.UserPromptSubmit, "本地自己的钩子保留");
  assert.equal(claude.outputStyle, "concise", "其余设置不动");
  assert.equal(read(p, ".claude/settings.json"), JSON.stringify(claude, null, 4) + "\n", "缩进照原文件");
  assert.deepEqual(JSON.parse(read(p, ".codex/hooks.json")), tplCodex);
  assert.equal(read(p, ".codex/hooks.json"), JSON.stringify(tplCodex, null, 2) + "\n");
  const L = ledger(p);
  assert.equal(L.shelf["templates/ai/files/.claude/settings.json"].planted, true, "还是植入物");

  // 重跑：什么都不缺，文件与账本都不变
  const before = [read(p, ".claude/settings.json"), read(p, ".codex/hooks.json"), read(p, ".shelf.json")];
  const again = m.json(p, "init");
  assert.equal(again.code, 0, again.out);
  assert.equal(again.json.data.items.find((i) => i.key === "templates/ai/files/.claude/settings.json").state, "planted");
  assert.deepEqual([read(p, ".claude/settings.json"), read(p, ".codex/hooks.json"), read(p, ".shelf.json")], before);

  // 已记账的植入物又缺了钩子：status 只预告不写，sync 补（SHELF 决策 #48：修复归 sync，开场钩子只跑 sync）
  fs.writeFileSync(path.join(p, ".claude", "settings.json"), JSON.stringify(oldClaude, null, 4) + "\n");
  const st = m.json(p, "status");
  assert.equal(st.json.data.items.find((i) => i.key === "templates/ai/files/.claude/settings.json").state, "would-merge-hooks");
  assert.deepEqual(JSON.parse(read(p, ".claude/settings.json")), oldClaude, "status 只读");
  const s = m.json(p, "sync");
  assert.equal(s.code, 0, s.out);
  assert.equal(s.json.data.items.find((i) => i.key === "templates/ai/files/.claude/settings.json").state, "hooks-merged");
  assert.deepEqual(JSON.parse(read(p, ".claude/settings.json")).hooks.SessionStart, tplClaude.hooks.SessionStart);
  assert.equal(JSON.parse(read(p, ".claude/settings.json")).outputStyle, "concise");
  const again2 = m.json(p, "sync");
  assert.equal(again2.json.data.items.find((i) => i.key === "templates/ai/files/.claude/settings.json").state, "planted", "补过再跑不变");

  // pull 记过账的钩子配置（不带 --force）：同样只补缺的钩子
  fs.writeFileSync(path.join(p, ".claude", "settings.json"), JSON.stringify(oldClaude, null, 4) + "\n");
  const pulled = m.json(p, "pull", ".claude/settings.json");
  assert.equal(pulled.code, 0, pulled.out);
  assert.equal(pulled.json.data.items[0].action, "hooks-merged");
  assert.deepEqual(JSON.parse(read(p, ".claude/settings.json")).hooks.SessionStart, tplClaude.hooks.SessionStart);
  assert.equal(JSON.parse(read(p, ".claude/settings.json")).outputStyle, "concise");

  // 坏 JSON：一个字不改，报警告，不算待决
  fs.writeFileSync(path.join(p, ".codex", "hooks.json"), "{ broken");
  const bad = m.json(p, "init");
  assert.equal(bad.code, 0, bad.out);
  assert.equal(read(p, ".codex/hooks.json"), "{ broken");
  const badItem = bad.json.data.items.find((i) => i.key === "templates/ai/files/.codex/hooks.json");
  assert.equal(badItem.state, "planted");
  assert.match(badItem.mergeError, /JSON/);
  assert.ok(bad.json.warnings.some((w) => w.includes(".codex/hooks.json")), JSON.stringify(bad.json.warnings));
});

test("账本只在内容变了时才改：货架 HEAD 前进但相关的货没变，init / sync / push 重跑后账本逐字节不变；补植入、补拉不改账；货真的变了才跟到最新", (t) => {
  const root = tmpRoot(t, "ledger");
  const remote = makeRemote(root);
  const m = machine(root, "a", remote);
  // 两份钩子配置按真实项目的样子被 gitignore：换设备 / 新 worktree 里本来就没有
  const p = project(root, "app", { "package.json": '{"name":"app"}', ".gitignore": "/.claude/settings.json\n/.codex/\n" });
  git(root, p, ["init", "-q"]);
  assert.equal(m.run(p, "init", "--agents", "claude,codex").code, 0);
  const L0 = read(p, ".shelf.json");

  // 货架往前走了，改的是模板以外的货：init / sync / 没改动的 push 都不该动账本
  pushToRemote(root, remote, { "docs/note.md": "a newer note\n" });
  for (const args of [["init"], ["sync"], ["push", "ai/jaSkills/intj", "--yes"]]) {
    const r = m.json(p, ...args);
    assert.equal(r.code, 0, `${args.join(" ")}: ${r.out}`);
    assert.equal(read(p, ".shelf.json"), L0, `${args.join(" ")} 不该改账本`);
  }

  // 新 clone：gitignored 的两份钩子配置不在，模板里的 Claude 那份也已经改过；一件随货架同步的脚本本地也没了（内容和账本一致）
  const copy = cloneProject(root, p, "app-clone");
  assert.ok(!exists(copy, ".claude/settings.json") && !exists(copy, ".codex/hooks.json"));
  const tplSettings = JSON.parse(TEMPLATE_FILES["templates/ai/files/.claude/settings.json"]);
  pushToRemote(root, remote, { "templates/ai/files/.claude/settings.json": JSON.stringify({ ...tplSettings, model: "x" }, null, 4) + "\n" });
  fs.rmSync(path.join(copy, "ai", "scripts", "bootstrap.sh"));
  const before = read(copy, ".shelf.json");
  const r = m.json(copy, "init");
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(read(copy, ".claude/settings.json")).model, "x", "补植入的是模板当前版本");
  assert.ok(exists(copy, ".codex/hooks.json"));
  assert.equal(read(copy, "ai/scripts/bootstrap.sh"), TEMPLATE_FILES["templates/ai/files/ai/scripts/bootstrap.sh"], "补拉");
  assert.equal(read(copy, ".shelf.json"), before, "补植入、补拉都不改账");

  // 货真的变了：本地跟着更新，这件的记账和模板提交号才跟到货架最新
  const sha = pushToRemote(root, remote, { "skills/_common/feature/SKILL.md": SKILL_MD("feature", "货架新版") });
  const u = m.json(p, "init");
  assert.equal(u.code, 0, u.out);
  const L = ledger(p);
  assert.equal(L.shelf["skills/_common/feature"].sourceCommit, sha);
  assert.equal(L.template.commit, sha, "账本真的变了，模板提交号跟到货架最新");
  assert.equal(L.shelf["skills/_common/intj"].sourceCommit, JSON.parse(L0).shelf["skills/_common/intj"].sourceCommit, "没变的货记账不动");
});

test("sync 修复：被 git 忽略的植入物本地没了就补回（账本不动），进 git 的植入物没了不补；status 只预告", (t) => {
  const root = tmpRoot(t, "sync-restore");
  const m = machine(root, "a", makeRemote(root));
  const p = project(root, "app", { "package.json": '{"name":"app"}', ".gitignore": "/.claude/settings.json\n/.codex/\n" });
  git(root, p, ["init", "-q"]);
  assert.equal(m.run(p, "init", "--agents", "claude,codex").code, 0);
  const L0 = read(p, ".shelf.json");
  fs.rmSync(path.join(p, ".claude", "settings.json"));
  fs.rmSync(path.join(p, ".codex"), { recursive: true });
  fs.rmSync(path.join(p, "ai", "TODO.md"));   // 进 git 的植入物：可能是有意删的

  const st = m.json(p, "status");
  const stBy = Object.fromEntries(st.json.data.items.map((i) => [i.key, i.state]));
  assert.equal(stBy["templates/ai/files/.claude/settings.json"], "would-restore");
  assert.ok(!exists(p, ".claude/settings.json"), "status 只读");

  const r = m.json(p, "sync");
  assert.equal(r.code, 0, r.out);
  const by = Object.fromEntries(r.json.data.items.map((i) => [i.key, i.state]));
  assert.equal(by["templates/ai/files/.claude/settings.json"], "restored");
  assert.equal(by["templates/ai/files/.codex/hooks.json"], "restored");
  assert.equal(by["templates/ai/files/ai/TODO.md"], "planted", "进 git 的植入物不补");
  assert.equal(read(p, ".claude/settings.json"), TEMPLATE_FILES["templates/ai/files/.claude/settings.json"]);
  assert.equal(read(p, ".codex/hooks.json"), TEMPLATE_FILES["templates/ai/files/.codex/hooks.json"]);
  assert.ok(!exists(p, "ai/TODO.md"));
  assert.equal(read(p, ".shelf.json"), L0, "补回不改账");
});

test("sync：根目录副本领先、但副本就是货架当前版（新 worktree 从主检出复制来的）→ 正本跟上货架版，不报待决", (t) => {
  const root = tmpRoot(t, "mirror-shelf");
  const remote = makeRemote(root);
  const m = machine(root, "a", remote);
  const p = project(root, "app", { "package.json": '{"name":"app"}' });
  git(root, p, ["init", "-q"]);
  assert.equal(m.run(p, "init", "--agents", "claude,codex").code, 0);
  const v2 = "# Claude 协议\n\n规则一\n规则二\n规则三\n规则四（货架新版）\n";
  pushToRemote(root, remote, { "agents/claude/CLAUDE.md": v2 });
  fs.writeFileSync(path.join(p, "CLAUDE.md"), v2);   // 根副本已经是货架新版，正本还是旧的

  const r = m.json(p, "sync");
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.data.items.find((i) => i.key === "agents/claude/CLAUDE.md").state, "updated");
  assert.equal(read(p, "ai/jaAgents/CLAUDE.md"), v2);
  assert.equal(read(p, "CLAUDE.md"), v2);

  // 副本是别的内容（真有人改了）：照旧待决
  fs.writeFileSync(path.join(p, "CLAUDE.md"), v2 + "本机加的一行\n");
  const d = m.json(p, "sync");
  assert.equal(d.code, 2, d.out);
  assert.equal(d.json.data.items.find((i) => i.key === "agents/claude/CLAUDE.md").state, "mirror-ahead");
});

test("模板装出来的开场脚本能跑：新项目 init 后建 worktree，sync-worktree.sh 补齐链接与协议副本，开场钩子按 cwd 分两段报告（模块一件不缺）", (t) => {
  if (WIN) return;   // 脚本在 Windows 上由 Git Bash 跑，这里只在 POSIX 上验
  const root = tmpRoot(t, "scripts");
  const m = machine(root, "a", makeRemote(root));
  const p = project(root, "app", { "package.json": '{"name":"app"}', ".gitignore": ".claude/\n.codex/\n.env\n" });
  git(root, p, ["init", "-q"]);
  assert.equal(m.run(p, "init", "--agents", "claude,codex").code, 0);
  for (const f of ["lib/common.sh", "skills-link.sh", "local-config.sh", "shelf-step.sh", "session-start.sh", "sync-worktree.sh", "bootstrap.sh", "protocol-mirror.sh"]) {
    assert.ok(exists(p, `ai/scripts/${f}`), `模板应装上 ai/scripts/${f}`);
  }
  fs.writeFileSync(path.join(p, ".env"), "SECRET=1\n");
  git(root, p, ["add", "-A"]);
  git(root, p, ["commit", "-qm", "init"]);
  const wt = path.join(root, "app-wt");
  git(root, p, ["worktree", "add", "-q", "--detach", wt]);

  const env = { ...m.env, SESSION_START_SKIP_SHELF: "1" };
  const sw = spawnSync("bash", [path.join(wt, "ai/scripts/sync-worktree.sh")], { cwd: wt, env, encoding: "utf8" });
  assert.equal(sw.status, 0, sw.stdout + sw.stderr);
  assert.ok(isLink(wt, ".claude/skills") && isLink(wt, ".agents/skills"));
  assert.equal(read(wt, "CLAUDE.md"), read(wt, "ai/jaAgents/CLAUDE.md"));
  assert.equal(read(wt, ".env"), "SECRET=1\n");
  assert.equal(read(wt, ".claude/settings.json"), read(p, ".claude/settings.json"), "按 .worktreeinclude 从主检出补钩子配置");
  assert.doesNotMatch(sw.stdout, /SECRET/);

  const input = JSON.stringify({ session_id: "t", cwd: wt, hook_event_name: "SessionStart", source: "startup" });
  const ss = spawnSync("bash", [path.join(p, "ai/scripts/session-start.sh")], { cwd: p, env, input, encoding: "utf8" });
  assert.equal(ss.status, 0, ss.stderr);
  const out = JSON.parse(ss.stdout).hookSpecificOutput;
  assert.equal(out.reloadSkills, true);
  assert.match(out.additionalContext, /【主检出：/);
  assert.match(out.additionalContext, /【本会话的 worktree：/);
});
