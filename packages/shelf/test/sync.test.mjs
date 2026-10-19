import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  tmpRoot, makeRemote, pushToRemote, readRemoteFile, machine, project, ledger, read, exists, git, gitEnv, SKILL_MD,
} from "./helpers.mjs";

function setup(t, name) {
  const root = tmpRoot(t, name);
  const remote = makeRemote(root);
  const m = machine(root, "a", remote);
  const p = project(root, "p", { "package.json": '{"name":"p"}' });
  const r = m.run(p, "init", "--agents", "claude,codex");
  assert.equal(r.code, 0, r.out);
  return { root, remote, m, p };
}

const edit = (p, rel, fn) => fs.writeFileSync(path.join(p, ...rel.split("/")), fn(read(p, rel)));
const stateOf = (r, key) => r.json.data.items.find((i) => i.key === key)?.state;

test("sync：货架新版且本地没动 → 自动更新；status / --dry-run 有待决退出 2、没有退出 0", (t) => {
  const { root, remote, m, p } = setup(t, "sync");
  pushToRemote(root, remote, { "skills/_common/feature/SKILL.md": SKILL_MD("feature", "upstream addition") });

  const st = m.json(p, "status");
  assert.equal(st.code, 0, st.out);
  assert.equal(stateOf(st, "skills/_common/feature"), "would-update");
  assert.equal(read(p, "ai/jaSkills/feature/SKILL.md"), SKILL_MD("feature"), "status 只读");

  const sy = m.json(p, "sync");
  assert.equal(sy.code, 0, sy.out);
  assert.equal(read(p, "ai/jaSkills/feature/SKILL.md"), SKILL_MD("feature", "upstream addition"));

  edit(p, "ai/jaSkills/intj/SKILL.md", (s) => s + "local note\n");
  const dry = m.json(p, "sync", "--dry-run");
  assert.equal(dry.code, 2, dry.out);
  const intj = dry.json.data.items.find((i) => i.key === "skills/_common/intj");
  assert.deepEqual([intj.state, intj.next], ["local-ahead", ["shelf push ai/jaSkills/intj"]]);
  assert.deepEqual(dry.json.next, ["shelf push ai/jaSkills/intj"]);
  const text = m.run(p, "status");
  assert.equal(text.code, 2);
  assert.match(text.out, /skills\/common\/intj（本地领先）→ shelf push ai\/jaSkills\/intj/);

  assert.equal(m.run(p, "push", "ai/jaSkills/intj", "--yes").code, 0);
  assert.match(readRemoteFile(root, remote, "skills/_common/intj/SKILL.md"), /local note/);
  assert.equal(m.run(p, "sync").code, 0);
});

test("sync --merge --push：双改的干净合并后自动推，本地领先的直接推；冲突退出 3 留给人", (t) => {
  const { root, remote, m, p } = setup(t, "auto");
  const swap = (s, a, b) => s.replace(a + "\n", b + "\n");
  pushToRemote(root, remote, {
    "skills/_common/intj/SKILL.md": swap(SKILL_MD("intj"), "line 2", "line 2 (shelf)"),
    "skills/_common/feature/SKILL.md": swap(SKILL_MD("feature"), "line 5", "line 5 SHELF"),
  });
  fs.writeFileSync(path.join(p, "ai/jaSkills/intj/SKILL.md"), swap(SKILL_MD("intj"), "line 11", "line 11 (local)"));
  fs.writeFileSync(path.join(p, "ai/jaSkills/feature/SKILL.md"), swap(SKILL_MD("feature"), "line 5", "line 5 LOCAL"));
  edit(p, "ai/jaSkills/monet/SKILL.md", (s) => s + "monet local\n");

  const r = m.json(p, "sync", "--merge", "--push");
  assert.equal(r.code, 3, r.out);
  assert.equal(stateOf(r, "skills/_common/intj"), "pushed");
  assert.equal(stateOf(r, "skills/_common/monet"), "pushed");
  assert.equal(stateOf(r, "skills/_common/feature"), "merge-conflict");
  const merged = readRemoteFile(root, remote, "skills/_common/intj/SKILL.md");
  assert.match(merged, /line 2 \(shelf\)/);
  assert.match(merged, /line 11 \(local\)/);
  assert.match(read(p, "ai/jaSkills/feature/SKILL.md"), /^<<<<<<< 本地$/m);

  fs.writeFileSync(path.join(p, "ai/jaSkills/feature/SKILL.md"), swap(SKILL_MD("feature"), "line 5", "line 5 BOTH"));
  assert.equal(m.run(p, "push", "ai/jaSkills/feature", "--yes").code, 0);
  const done = m.json(p, "sync", "--merge", "--push");
  assert.equal(done.code, 0, done.out);
  assert.equal(m.run(p, "status", "--dry-run").code, 1, "status 本身就只读，不接 --dry-run");
  assert.equal(m.run(p, "sync", "--dry-run", "--push").code, 1, "只读和推送不能一起用");
});

test("副本：只改根目录 CLAUDE.md → sync 同步回 ai/jaAgents 再推；两份各改各的 → 待决，push 退出 1 并列差异", (t) => {
  const { root, remote, m, p } = setup(t, "mirror");
  edit(p, "CLAUDE.md", (s) => s + "agent 在根目录加的一条\n");
  const r = m.json(p, "sync", "--push");
  assert.equal(r.code, 0, r.out);
  assert.match(read(p, "ai/jaAgents/CLAUDE.md"), /根目录加的一条/);
  assert.equal(stateOf(r, "agents/claude/CLAUDE.md"), "pushed");
  assert.match(readRemoteFile(root, remote, "agents/claude/CLAUDE.md"), /根目录加的一条/);

  pushToRemote(root, remote, { "agents/claude/CLAUDE.md": "# Claude 协议\n\n规则一（新）\n规则二\n规则三\n" });
  assert.equal(m.run(p, "sync").code, 0);
  assert.equal(read(p, "CLAUDE.md"), read(p, "ai/jaAgents/CLAUDE.md"), "货架更新两处一起写");
  assert.match(read(p, "CLAUDE.md"), /规则一（新）/);

  edit(p, "CLAUDE.md", (s) => s + "根目录这样改\n");
  edit(p, "ai/jaAgents/CLAUDE.md", (s) => s + "正本那样改\n");
  const st = m.json(p, "status");
  assert.equal(st.code, 2);
  assert.equal(stateOf(st, "agents/claude/CLAUDE.md"), "mirror-mismatch");
  const push = m.json(p, "push", "CLAUDE.md", "--yes");
  assert.equal(push.code, 1, push.out);
  assert.equal(push.json.data.mirror.files[0].path, "CLAUDE.md");
  assert.deepEqual(push.json.next, ["git diff --no-index CLAUDE.md ai/jaAgents/CLAUDE.md"]);
});

test("模板：货架给模板加了货 → 下次 sync 自动装上；模板去掉的货本地保留并提示；template show 列出货物", (t) => {
  const { root, remote, m, p } = setup(t, "tpl");
  const tpl = JSON.parse(readRemoteFile(root, remote, "templates/ai/template.json"));
  tpl.items.push({ from: "files/ai/scripts/new-tool.sh", to: "{ai}/scripts/new-tool.sh" });
  tpl.items = tpl.items.filter((i) => i.from !== "agents/multica/MULTICA.md");
  pushToRemote(root, remote, {
    "templates/ai/template.json": JSON.stringify(tpl, null, 2),
    "templates/ai/files/ai/scripts/new-tool.sh": "#!/usr/bin/env bash\necho new\n",
  });

  const st = m.json(p, "status");
  assert.equal(stateOf(st, "templates/ai/files/ai/scripts/new-tool.sh"), "would-install");
  assert.ok(!exists(p, "ai/scripts/new-tool.sh"));
  const r = m.json(p, "sync");
  assert.equal(r.code, 0, r.out);
  assert.equal(stateOf(r, "templates/ai/files/ai/scripts/new-tool.sh"), "installed");
  assert.equal(read(p, "ai/scripts/new-tool.sh"), "#!/usr/bin/env bash\necho new\n");
  assert.deepEqual(r.json.data.droppedFromTemplate, ["agents/multica/MULTICA.md"]);
  assert.ok(exists(p, "ai/jaAgents/MULTICA.md"), "模板去掉的货不删本地");

  const show = m.json(p, "template", "show", "ai");
  assert.equal(show.code, 0, show.out);
  const dests = show.json.data.items.map((i) => i.dest);
  for (const d of ["ai/jaAgents/CLAUDE.md", "ai/jaSkills/intj", "ai/scripts/new-tool.sh", ".worktreeinclude"]) assert.ok(dests.includes(d), d);
  assert.equal(show.json.data.items.find((i) => i.dest === "ai/jaAgents/CLAUDE.md").copy, "CLAUDE.md");
  const ls = m.json(p, "template");
  assert.deepEqual(ls.json.data.templates.map((x) => x.name), ["ai"]);

  // 模板新加的货本地已有同名、内容不同（没记过账）：status 和 sync 报的一样——待决、不覆盖；
  // 给的两条下一步都按模板落点认货：pull --force 装回模板的位置，push 推到模板里那件
  tpl.items.push({ from: "files/ai/scripts/clash.sh", to: "{ai}/scripts/clash.sh" });
  tpl.items.push({ from: "files/ai/scripts/mine.sh", to: "{ai}/scripts/mine.sh" });
  pushToRemote(root, remote, {
    "templates/ai/template.json": JSON.stringify(tpl, null, 2),
    "templates/ai/files/ai/scripts/clash.sh": "#!/usr/bin/env bash\necho shelf\n",
    "templates/ai/files/ai/scripts/mine.sh": "#!/usr/bin/env bash\necho shelf\n",
  });
  fs.writeFileSync(path.join(p, "ai", "scripts", "clash.sh"), "#!/usr/bin/env bash\necho mine\n");
  fs.writeFileSync(path.join(p, "ai", "scripts", "mine.sh"), "#!/usr/bin/env bash\necho mine\n");
  const st2 = m.json(p, "status");
  assert.equal(st2.code, 2, st2.out);
  assert.equal(stateOf(st2, "templates/ai/files/ai/scripts/clash.sh"), "untracked-differs");
  const r2 = m.json(p, "sync");
  assert.equal(r2.code, 2, r2.out);
  const clash = r2.json.data.items.find((i) => i.key === "templates/ai/files/ai/scripts/clash.sh");
  assert.deepEqual([clash.state, clash.next], ["untracked-differs",
    ["shelf pull templates/ai/files/ai/scripts/clash.sh --force", "shelf push ai/scripts/clash.sh --yes"]]);
  assert.equal(read(p, "ai/scripts/clash.sh"), "#!/usr/bin/env bash\necho mine\n");
  assert.equal(m.json(p, "pull", "templates/ai/files/ai/scripts/clash.sh", "--force").code, 0);
  assert.equal(read(p, "ai/scripts/clash.sh"), "#!/usr/bin/env bash\necho shelf\n");
  assert.ok(!exists(p, "clash.sh"), "不落到默认位置（项目根目录）");
  const pu = m.json(p, "push", "ai/scripts/mine.sh", "--yes");
  assert.equal(pu.code, 0, pu.out);
  assert.equal(readRemoteFile(root, remote, "templates/ai/files/ai/scripts/mine.sh"), "#!/usr/bin/env bash\necho mine\n");
  assert.equal(m.json(p, "sync").code, 0);
});

test("sync：本地和货架内容一样、只是账本落后 → 只刷新账本", (t) => {
  const { root, remote, m, p } = setup(t, "refresh");
  const sha = pushToRemote(root, remote, { "skills/_common/feature/SKILL.md": SKILL_MD("feature", "same change") });
  fs.writeFileSync(path.join(p, "ai", "jaSkills", "feature", "SKILL.md"), SKILL_MD("feature", "same change"));
  const sy = m.json(p, "sync");
  assert.equal(sy.code, 0, sy.out);
  assert.equal(stateOf(sy, "skills/_common/feature"), "refreshed");
  assert.equal(ledger(p).shelf["skills/_common/feature"].sourceCommit, sha);
});

test("sync：下架 / 本地丢失进待决，forget / pull --force 非交互就能处理", (t) => {
  const { root, remote, m, p } = setup(t, "orphans");
  assert.equal(m.run(p, "pull", "docs/note.md").code, 0);
  assert.ok(exists(p, "note.md"), "非技能物品落当前目录");
  pushToRemote(root, remote, { "docs/note.md": null });
  fs.rmSync(path.join(p, "ai", "jaSkills", "monet"), { recursive: true });

  const st = m.json(p, "status");
  assert.equal(st.code, 2);
  const byKey = Object.fromEntries(st.json.data.items.map((i) => [i.key, i]));
  assert.deepEqual([byKey["docs/note.md"].state, byKey["docs/note.md"].next], ["removed", ["shelf forget docs/note.md"]]);
  assert.equal(byKey["skills/_common/monet"].state, "local-missing");
  assert.deepEqual(byKey["skills/_common/monet"].next, ["shelf pull skills/_common/monet --force", "shelf forget skills/_common/monet"]);

  const fg = m.json(p, "forget", "docs/note.md");
  assert.equal(fg.code, 0);
  assert.equal(fg.json.data.removed[0].localPath, "note.md");
  assert.ok(exists(p, "note.md"), "forget 不动本地文件");
  assert.equal(m.run(p, "pull", "skills/common/monet", "--force").code, 0);
  assert.ok(exists(p, "ai/jaSkills/monet/SKILL.md"));
  assert.equal(m.run(p, "sync").code, 0);
  assert.equal(m.run(p, "forget", "nothing/here").code, 1);
});

test("push：不带 --yes 退出 2 并给出原命令加 --yes；货架被别处改过退出 3 并指向 diff / merge；模板文件不参与按名字匹配", (t) => {
  const { root, remote, m, p } = setup(t, "push");
  edit(p, "ai/jaSkills/intj/SKILL.md", (s) => s + "mine\n");
  const dry = m.json(p, "push", "ai/jaSkills/intj");
  assert.equal(dry.code, 2, dry.out);
  assert.deepEqual(dry.json.data.changes.changed, ["SKILL.md"]);
  assert.deepEqual(dry.json.next, ["shelf push ai/jaSkills/intj --yes"]);

  pushToRemote(root, remote, { "skills/_common/intj/reference.md": "changed elsewhere\n" });
  const clash = m.json(p, "push", "ai/jaSkills/intj", "--yes");
  assert.equal(clash.code, 3, clash.out);
  assert.deepEqual(clash.json.next, ["shelf diff ai/jaSkills/intj", "shelf merge ai/jaSkills/intj"]);
  assert.equal(readRemoteFile(root, remote, "skills/_common/intj/reference.md"), "changed elsewhere\n", "没被覆盖");

  assert.equal(m.run(p, "push", "ai/jaSkills/intj", "--yse").code, 1, "编造的参数直接拒绝");
  fs.writeFileSync(path.join(p, "settings.json"), "{}\n");
  const byName = m.json(p, "push", "settings.json", "--yes");
  assert.equal(byName.code, 1, "模板里的 settings.json 不会被按名字认成要更新的货");
  assert.equal(m.json(p, "push", "ai/PROJECT.md", "--yes").code, 1, "植入物不推");
});

test("pull：记过账的回原位；本地改过时非交互不覆盖、退出 2；--force 覆盖；新技能默认进正本；Windows 反斜杠路径", (t) => {
  const { m, p } = setup(t, "pull");
  const audit = m.json(p, "pull", "skills/project-audit");
  assert.equal(audit.code, 0, audit.out);
  assert.equal(audit.json.data.items[0].localPath, "ai/jaSkills/project-audit", "技能默认落技能正本");
  assert.ok(fs.lstatSync(path.join(p, ".claude", "skills", "project-audit")).isDirectory());

  edit(p, "ai/jaSkills/intj/SKILL.md", (s) => s + "local tweak\n");
  const kept = m.json(p, "pull", "ai\\jaSkills\\intj");
  assert.equal(kept.code, 2, kept.out);
  assert.equal(kept.json.data.items[0].action, "kept-local");
  assert.deepEqual(kept.json.next, ["shelf push ai/jaSkills/intj", "shelf pull ai/jaSkills/intj --force"]);
  assert.match(read(p, "ai/jaSkills/intj/SKILL.md"), /local tweak/);

  const forced = m.json(p, "pull", "skills/common/intj", "--force");
  assert.equal(forced.code, 0, forced.out);
  assert.equal(forced.json.data.items[0].localPath, "ai/jaSkills/intj", "按账本回原位，不落到当前目录");
  assert.equal(read(p, "ai/jaSkills/intj/SKILL.md"), SKILL_MD("intj"));
  assert.ok(!exists(p, "intj"));
  assert.equal(m.run(p, "pull", "no/such/thing").code, 1);
});

test("固定目录：技能新声明的目录 sync 时补上，status 只预告不建；mirror 命令已删除", (t) => {
  const { root, remote, m, p } = setup(t, "scaffold");
  fs.rmSync(path.join(p, "ai", "sessions"), { recursive: true });
  const st = m.json(p, "status");
  assert.equal(st.code, 0, st.out);
  assert.deepEqual(st.json.data.scaffold.wouldCreate, ["ai/sessions"]);
  assert.ok(!exists(p, "ai/sessions"), "status 只读");
  // 货架上的 feature 技能多声明了一个固定目录：sync 先更新技能，再按新声明补目录
  pushToRemote(root, remote, {
    "skills/_common/feature/SKILL.md": SKILL_MD("feature").replace("\"features\"", "\"features, features/menu\""),
  });
  const sy = m.json(p, "sync");
  assert.equal(sy.code, 0, sy.out);
  assert.equal(stateOf(sy, "skills/_common/feature"), "updated");
  assert.deepEqual(sy.json.data.scaffold.created.sort(), ["ai/features/menu", "ai/sessions"]);
  assert.ok(exists(p, "ai/features/menu/.gitkeep") && exists(p, "ai/sessions/.gitkeep"));
  assert.deepEqual(m.json(p, "sync").json.data.scaffold.created, [], "已有的不再建");
  const gone = m.json(p, "mirror", "CLAUDE.md");
  assert.equal(gone.code, 1, "mirror 命令已删除：根目录协议副本由模板自动维护");
});

test("输出：不是终端时默认 JSON，--text 出文字；ls / home / help 也一样", (t) => {
  const { m, p } = setup(t, "output");
  const plain = m.raw(p, "status");
  assert.equal(JSON.parse(plain.stdout).command, "status", "agent 什么参数都不带，拿到的就是 JSON");
  assert.match(m.run(p, "status").out, /^Status: /m);
  assert.equal(m.raw(p, "--version").stdout.trim().split(".").length, 3, "--version 还是纯文字");
  const ls = m.json(p, "ls", "skills/common");
  const intj = ls.json.data.entries.find((e) => e.name === "intj");
  assert.deepEqual([intj.type, intj.installed], ["skill", "ai/jaSkills/intj"]);
  assert.equal(m.json(p, "ls", "templates").json.data.entries[0].type, "template");
  assert.equal(m.json(p, "home").json.data.mode, "managed");
  const help = m.json(p, "help");
  assert.ok(help.json.data.commands.some((c) => c.name === "template"));
  assert.equal(help.json.data.exitCodes.length, 5);
  assert.equal(m.json(p).code, 1, "交互浏览器不出 JSON");
});

test("CLI 装在某个带 shelf/ 的 git 仓库里时，不再把那个仓库当货架（走托管档口）", (t) => {
  const root = tmpRoot(t, "decouple");
  const remote = makeRemote(root);
  const mono = path.join(root, "monorepo");
  fs.mkdirSync(path.join(mono, "shelf", "skills", "_common", "decoy"), { recursive: true });
  fs.writeFileSync(path.join(mono, "shelf", "skills", "_common", "decoy", "SKILL.md"), "decoy\n");
  git(root, mono, ["init", "-q"]);
  const m = machine(root, "dev", remote);
  fs.cpSync(path.dirname(path.dirname(m.cli)), path.join(mono, "packages", "shelf"), { recursive: true });
  const cli = path.join(mono, "packages", "shelf", "bin", "shelf.mjs");
  const p = project(root, "p");
  const r = spawnSync(process.execPath, [cli, "home", "--json"], { cwd: p, env: m.env, encoding: "utf8", input: "" });
  const home = JSON.parse(r.stdout);
  assert.equal(home.data.mode, "managed", r.stdout + r.stderr);
  assert.ok(path.resolve(home.data.shelfDir).startsWith(path.resolve(m.home)), "货架在这台机器的托管档口里，不是 CLI 所在的仓库");
});
