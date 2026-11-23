// 植入物的「补钩子」合并（模板条目 "merge": "hooks"，SHELF 决策 #46）：.claude/settings.json、.codex/hooks.json 这类
// 植入物本地已经有了，就不整份覆盖，只把模板里有、本地没有的钩子补进去。
// 按事件（SessionStart 等）比，同一事件下 command 文本相同即算已有；本地自己的钩子、其余键原样保留，
// 缩进、换行风格与结尾换行照原文件。JSON 读不懂就一个字不改，交给调用方报告。
import fs from "node:fs";

export const MERGE_MODES = new Set(["hooks"]);

// 一个钩子的身份：command 钩子看命令文本，其余类型看 url / prompt，都没有就看整条定义
function hookKey(h) {
  if (!h || typeof h !== "object") return JSON.stringify(h);
  const id = h.command ?? h.url ?? h.prompt;
  return `${h.type ?? "command"}\u0000${typeof id === "string" ? id : JSON.stringify(h)}`;
}

const isPlainObject = (x) => !!x && typeof x === "object" && !Array.isArray(x);

function keysOfGroup(g) {
  return Array.isArray(g?.hooks) ? g.hooks.map(hookKey) : [];
}

// 纯函数：本地文本 + 模板文本 → { state: unchanged | merged | invalid, text?, added: [{ event, hooks }], error? }
export function mergeHooksText(localText, templateText) {
  let local;
  let tpl;
  const bom = localText.startsWith("﻿") ? "﻿" : "";
  try {
    local = JSON.parse(bom ? localText.slice(1) : localText);
  } catch (err) {
    return { state: "invalid", added: [], error: `不是合法的 JSON：${err.message}` };
  }
  try {
    tpl = JSON.parse(templateText.replace(/^﻿/, ""));
  } catch (err) {
    return { state: "invalid", added: [], error: `模板不是合法的 JSON：${err.message}` };
  }
  if (!isPlainObject(local)) return { state: "invalid", added: [], error: "顶层不是 JSON 对象" };
  if (!isPlainObject(tpl?.hooks)) return { state: "unchanged", added: [] };
  if (local.hooks !== undefined && !isPlainObject(local.hooks)) return { state: "invalid", added: [], error: "hooks 不是对象" };

  const hooks = local.hooks ?? {};
  const added = [];
  for (const [event, tGroups] of Object.entries(tpl.hooks)) {
    if (!Array.isArray(tGroups)) continue;
    if (hooks[event] !== undefined && !Array.isArray(hooks[event])) {
      return { state: "invalid", added: [], error: `hooks.${event} 不是数组` };
    }
    const groups = hooks[event] ? [...hooks[event]] : [];
    const have = new Set(groups.flatMap(keysOfGroup));
    let n = 0;
    tGroups.forEach((tg, i) => {
      const missing = (Array.isArray(tg?.hooks) ? tg.hooks : []).filter((h) => !have.has(hookKey(h)));
      if (!missing.length) return;
      // 插在本地「模板里排在它后面的那些组」的最前面，没有就放到最后：顺序跟模板一致，本地多出来的组不挪位置
      const later = new Set(tGroups.slice(i + 1).flatMap(keysOfGroup));
      const at = groups.findIndex((g) => keysOfGroup(g).some((k) => later.has(k)));
      const group = { ...tg, hooks: missing };
      if (at === -1) groups.push(group);
      else groups.splice(at, 0, group);
      for (const h of missing) have.add(hookKey(h));
      n += missing.length;
    });
    if (n) {
      hooks[event] = groups;
      added.push({ event, hooks: n });
    }
  }
  if (!added.length) return { state: "unchanged", added };
  if (local.hooks === undefined) local.hooks = hooks;

  const indentMatch = localText.match(/\n([ \t]+)\S/);
  const indent = indentMatch ? (indentMatch[1].startsWith("\t") ? "\t" : indentMatch[1].length) : 2;
  const eol = localText.includes("\r\n") ? "\r\n" : "\n";
  let text = JSON.stringify(local, null, indent);
  if (/\r?\n$/.test(localText)) text += "\n";
  if (eol === "\r\n") text = text.replace(/\n/g, "\r\n");
  return { state: "merged", text: bom + text, added };
}

// 落盘版：本地文件与模板文件；dryRun 只判断不写
export function mergeHooksFile(localAbs, templateAbs, { dryRun = false } = {}) {
  const r = mergeHooksText(fs.readFileSync(localAbs, "utf8"), fs.readFileSync(templateAbs, "utf8"));
  if (r.state === "merged" && !dryRun) fs.writeFileSync(localAbs, r.text);
  return r;
}

// 给人看的一句：SessionStart +1 · UserPromptSubmit +2
export function describeAdded(added) {
  return added.map((a) => `${a.event} +${a.hooks}`).join(" · ");
}
