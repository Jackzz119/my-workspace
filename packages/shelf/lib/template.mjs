// 模板：货架 templates/<名>/template.json 描述「一个项目接入时该有哪些货、落在哪」（SHELF 决策 #37）。
// 模板只是配方：引用货架上已有的货（协议、技能、文档），模板独有的文件放在 templates/<名>/files/ 下。
// 每件货仍只有一份真源，init / sync 照账本逐件对账；改模板只改货架内容，不用发 CLI 新版。
import fs from "node:fs";
import path from "node:path";
import { resolveShelfPath } from "./shelfnames.mjs";

export const DEFAULT_TEMPLATE = "ai";
const IGNORE_NAMES = new Set(["node_modules", ".git", ".DS_Store"]);

// 货架上还没有 templates/ai 时的内置配方（老货架 / 自建货架），协议正本同样落 ai/jaAgents
export const BUILTIN_AI = {
  schemaVersion: 1,
  name: "ai",
  description: "内置 AI 工作流配方（货架上没有 templates/ai 时使用）",
  defaultAgents: ["claude", "codex"],
  items: [
    { from: "agents/claude/CLAUDE.md", to: "{ai}/jaAgents/CLAUDE.md", copy: "CLAUDE.md", agents: ["claude"] },
    { from: "agents/codex/AGENTS.md", to: "{ai}/jaAgents/AGENTS.md", copy: "AGENTS.md", agents: ["codex", "kimi"] },
    { from: "agents/multica/MULTICA.md", to: "{ai}/jaAgents/MULTICA.md", optional: true },
    { from: "skills/common/*", to: "{ai}/jaSkills/" },
    { from: "skills/project-audit", to: "{ai}/jaSkills/project-audit", optional: true },
    { from: "docs/JASKILL.md", to: "{ai}/JASKILL.md", planted: true },
  ],
  // 货架上的技能会在 frontmatter 里自己声明固定目录；这里兜底老货架上还没声明的技能，骨架与它们的声明一致
  scaffold: [
    { file: "{ai}/PROJECT.md", builtin: "project" },
    { file: "{ai}/TODO.md", builtin: "todo" },
    { dir: "{ai}/features", skills: ["feature", "intj"] },
    { dir: "{ai}/sessions", skills: ["intj"] },
    { dir: "{ai}/design_system/concept", skills: ["monet"] },
    { dir: "{ai}/design_system/img", skills: ["monet"] },
    { dir: "{ai}/design_system/uiux", skills: ["monet", "ui-tailor"] },
    { dir: "{ai}/design_system/codex-visual", skills: ["monet", "ui-tailor", "codex-visual"] },
    { dir: "{ai}/project-audit/runs", skills: ["project-audit"] },
    { dir: "{ai}/project-audit/scripts", skills: ["project-audit"] },
  ],
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${file} 不是合法的 JSON：${err.message}`);
  }
}

export function listTemplates(shelfDir) {
  const hit = resolveShelfPath(shelfDir, "templates");
  if (!hit || !fs.statSync(hit.abs).isDirectory()) return [];
  return fs.readdirSync(hit.abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(hit.abs, e.name, "template.json")))
    .map((e) => {
      const tpl = readJson(path.join(hit.abs, e.name, "template.json"));
      return { name: tpl.name ?? e.name, key: `${hit.realRel}/${e.name}`, description: tpl.description ?? "" };
    });
}

export function loadTemplate(shelfDir, name) {
  const hit = resolveShelfPath(shelfDir, `templates/${name}`);
  const file = hit && path.join(hit.abs, "template.json");
  if (file && fs.existsSync(file)) {
    const tpl = readJson(file);
    return { ...tpl, name: tpl.name ?? name, key: hit.realRel, builtin: false };
  }
  if (name === DEFAULT_TEMPLATE) return { ...BUILTIN_AI, key: null, builtin: true };
  return null;
}

// 按 agent 目标与 ai 区目录名把配方展开成具体的货：{ key, dest, copy, planted, render }。
// from 以 files/ 开头 = 模板自带的文件；以 /* 结尾 = 该目录下每个子目录各算一件（一个技能一件）
export function expandTemplate(tpl, { shelfDir, agents, aiDir }) {
  const sub = (s) => String(s).replaceAll("{ai}", aiDir);
  const on = (x) => !x.agents || x.agents.some((a) => agents.includes(a));
  const items = [];
  const missing = [];
  for (const it of (tpl.items ?? []).filter(on)) {
    const from = it.from.startsWith("files/") && tpl.key ? `${tpl.key}/${it.from}` : it.from;
    if (from.endsWith("/*")) {
      const dir = resolveShelfPath(shelfDir, from.slice(0, -2));
      if (!dir) {
        if (!it.optional) missing.push(it.from);
        continue;
      }
      const base = sub(it.to).replace(/\/+$/, "");
      for (const e of fs.readdirSync(dir.abs, { withFileTypes: true })) {
        if (!e.isDirectory() || IGNORE_NAMES.has(e.name)) continue;
        items.push({ key: `${dir.realRel}/${e.name}`, dest: `${base}/${e.name}`, copy: null, planted: !!it.planted, render: false });
      }
      continue;
    }
    const hit = resolveShelfPath(shelfDir, from);
    if (!hit) {
      if (!it.optional) missing.push(it.from);
      continue;
    }
    items.push({ key: hit.realRel, dest: sub(it.to), copy: it.copy ? sub(it.copy) : null, planted: !!it.planted, render: !!it.render });
  }
  const scaffold = (tpl.scaffold ?? []).map((s) => ({ ...s, dir: s.dir ? sub(s.dir) : undefined, file: s.file ? sub(s.file) : undefined }));
  return { name: tpl.name, key: tpl.key, builtin: !!tpl.builtin, description: tpl.description ?? "", items, scaffold, missing };
}

// 植入物的占位符：{{project}} 项目名、{{date}} 当天、{{ai}} ai 区目录名（只用于植入物，对账的货必须和货架逐字节一致）
export function renderText(text, vars) {
  return text.replace(/\{\{(project|date|ai)\}\}/g, (_, k) => vars[k] ?? "");
}
