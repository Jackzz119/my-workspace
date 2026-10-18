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

test("sync：货架新版且本地没动 → 自动更新；status / --dry-run 有待决退出 2、没有退出 0", (t) => {
  const { root, remote, m, p } = setup(t, "sync");
  pushToRemote(root, remote, { "skills/_common/feature/SKILL.md": SKILL_MD("feature", "upstream addition") });

  const st = m.json(p, "status");
  assert.equal(st.code, 0, st.out);
  assert.equal(st.json.data.items.find((i) => i.key === "skills/_common/feature").state, "would-update");
  assert.equal(read(p, "ai/jaSkills/feature/SKILL.md"), SKILL_MD("feature"), "status 只读");

  const sy = m.json(p, "sync");
  assert.equal(sy.code, 0, sy.out);
  assert.equal(read(p, "ai/jaSkills/feature/SKILL.md"), SKILL_MD("feature", "upstream addition"));

  edit(p, "ai/jaSkills/intj/SKILL.md", (s) => s + "local note\n");
  const dry = m.json(p, "sync", "--dry-run");
  assert.equal(dry.code, 2, dry.out);
  const intj = dry.json.data.items.find((i) => i.key === "skills/_common/intj");
  assert.equal(intj.state, "local-ahead");
  assert.deepEqual(intj.next, ["shelf push ai/jaSkills/intj"]);
  assert.deepEqual(dry.json.next, ["shelf push ai/jaSkills/intj"]);
  const text = m.run(p, "status");
  assert.equal(text.code, 2);
  assert.match(text.out, /skills\/common\/intj（本地领先）→ shelf push ai\/jaSkills\/intj/);

  assert.equal(m.run(p, "push", "ai/jaSkills/intj", "--yes").code, 0);
  assert.match(readRemoteFile(root, remote, "skills/_common/intj/SKILL.md"), /local note/);
  assert.equal(m.run(p, "sync").code, 0);
});

test("sync：本地和货架内容一样、只是账本落后 → 只刷新账本", (t) => {
  const { root, remote, m, p } = setup(t, "refresh");
  const sha = pushToRemote(root, remote, { "skills/_common/feature/SKILL.md": SKILL_MD("feature", "same change") });
  fs.writeFileSync(path.join(p, "ai", "jaSkills", "feature", "SKILL.md"), SKILL_MD("feature", "same change"));
  const sy = m.json(p, "sync");
  assert.equal(sy.code, 0, sy.out);
  assert.equal(sy.json.data.items.find((i) => i.key === "skills/_common/feature").state, "refreshed");
  assert.equal(ledger(p).shelf["skills/_common/feature"].sourceCommit, sha);
});

test("sync：下架 / 本地丢失进待决，forget / pull --force 非交互就能处理", (t) => {
  const { root, remote, m, p } = setup(t, "orphans");
  assert.equal(m.run(p, "pull", "templates/note.md").code, 0);
  assert.ok(exists(p, "note.md"), "非技能物品落当前目录");
  pushToRemote(root, remote, { "templates/note.md": null });
  fs.rmSync(path.join(p, "ai", "jaSkills", "monet"), { recursive: true });

  const st = m.json(p, "status");
  assert.equal(st.code, 2);
  const byKey = Object.fromEntries(st.json.data.items.map((i) => [i.key, i]));
  assert.equal(byKey["templates/note.md"].state, "removed");
  assert.deepEqual(byKey["templates/note.md"].next, ["shelf forget templates/note.md"]);
  assert.equal(byKey["skills/_common/monet"].state, "local-missing");
  assert.deepEqual(byKey["skills/_common/monet"].next, ["shelf pull skills/_common/monet --force", "shelf forget skills/_common/monet"]);

  const fg = m.json(p, "forget", "templates/note.md");
  assert.equal(fg.code, 0);
  assert.equal(fg.json.data.removed[0].localPath, "note.md");
  assert.ok(exists(p, "note.md"), "forget 不动本地文件");
  assert.equal(m.run(p, "pull", "skills/common/monet", "--force").code, 0);
  assert.ok(exists(p, "ai/jaSkills/monet/SKILL.md"));
  assert.equal(m.run(p, "sync").code, 0);
  assert.equal(m.run(p, "forget", "nothing/here").code, 1);
});

test("push：不带 --yes 退出 2 并给出原命令加 --yes；货架被别处改过退出 3 并指向 diff / merge", (t) => {
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

test("mirror：登记入库副本；pull / sync 两处一起写；两处不一致时 push 停下列差异（退出 1），sync 报待决", (t) => {
  const { root, remote, m, p } = setup(t, "mirror");
  git(root, p, ["init", "-q"]);
  const reg = m.json(p, "mirror", "CLAUDE.md", "ai\\jaAgents\\CLAUDE.md");
  assert.equal(reg.code, 0, reg.out);
  assert.equal(ledger(p).shelf["agents/claude/CLAUDE.md"].mirror, "ai/jaAgents/CLAUDE.md");
  assert.equal(read(p, "ai/jaAgents/CLAUDE.md"), read(p, "CLAUDE.md"));
  const ignored = spawnSync("git", ["check-ignore", "--no-index", "-q", "ai/jaAgents/CLAUDE.md"], { cwd: p, env: gitEnv(root) }).status === 0;
  assert.equal(ignored, false, "init 写的是 /CLAUDE.md，入库副本不会被忽略");

  pushToRemote(root, remote, { "agents/claude/CLAUDE.md": "# Claude 协议\n\n规则一（新）\n规则二\n规则三\n" });
  assert.equal(m.run(p, "sync").code, 0);
  assert.match(read(p, "CLAUDE.md"), /规则一（新）/);
  assert.equal(read(p, "ai/jaAgents/CLAUDE.md"), read(p, "CLAUDE.md"), "副本跟着更新");

  edit(p, "ai/jaAgents/CLAUDE.md", (s) => s + "只改了副本\n");
  const push = m.json(p, "push", "CLAUDE.md", "--yes");
  assert.equal(push.code, 1, push.out);
  assert.equal(push.json.data.mirror.files[0].path, "CLAUDE.md");
  assert.deepEqual(push.json.next, ["git diff --no-index ai/jaAgents/CLAUDE.md CLAUDE.md"]);
  const st = m.json(p, "status");
  assert.equal(st.code, 2);
  assert.equal(st.json.data.items.find((i) => i.key === "agents/claude/CLAUDE.md").state, "mirror-mismatch");

  assert.equal(m.run(p, "mirror", "CLAUDE.md", "--off").code, 0);
  assert.equal(ledger(p).shelf["agents/claude/CLAUDE.md"].mirror, undefined);
});

test("mirror：副本被裸 CLAUDE.md 规则忽略时提醒；sync 提示像副本却没登记的文件", (t) => {
  const { root, m, p } = setup(t, "mirror-hint");
  git(root, p, ["init", "-q"]);
  fs.mkdirSync(path.join(p, "ai", "jaAgents"));
  fs.copyFileSync(path.join(p, "AGENTS.md"), path.join(p, "ai", "jaAgents", "AGENTS.md"));
  const st = m.json(p, "status");
  assert.equal(st.json.data.mirrorHints[0].command, "shelf mirror AGENTS.md ai/jaAgents/AGENTS.md");

  fs.appendFileSync(path.join(p, ".gitignore"), "CLAUDE.md\n");
  const reg = m.json(p, "mirror", "CLAUDE.md", "ai/jaAgents/CLAUDE.md");
  assert.equal(reg.code, 0);
  assert.match(reg.json.warnings.join("\n"), /被 \.gitignore 忽略/);
});

test("ls / home / help 都能 --json；browse 不接 --json", (t) => {
  const { m, p } = setup(t, "ls");
  const ls = m.json(p, "ls", "skills/common");
  assert.equal(ls.code, 0, ls.out);
  const intj = ls.json.data.entries.find((e) => e.name === "intj");
  assert.deepEqual([intj.type, intj.installed], ["skill", "ai/jaSkills/intj"]);
  assert.equal(m.json(p, "ls", "nope").code, 1);
  const home = m.json(p, "home");
  assert.equal(home.json.data.mode, "managed");
  const help = m.json(p, "help");
  assert.ok(help.json.data.commands.some((c) => c.name === "merge"));
  assert.equal(help.json.data.exitCodes.length, 5);
  assert.equal(m.json(p).code, 1);
});
