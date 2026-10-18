// 行级 diff（Myers）+ 统一 diff 格式 + 统计。零依赖，给 shelf diff 和副本核对用。
// 输入都是 Map(相对路径 → Buffer)；行保留行尾，CRLF 与 LF 的差别会如实显示成改动。

const MAX_EDIT_DISTANCE = 4000; // 超过就不逐行比了，整份算替换（防止病态大文件吃光内存）

export function isBinary(buf) {
  return !!buf && buf.subarray(0, 8000).includes(0);
}

// 切行并保留行尾："a\nb" → ["a\n", "b"]
export function splitLines(text) {
  return text === "" ? [] : text.split(/(?<=\n)/);
}

function myers(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((line) => ({ op: "+", line }));
  if (m === 0) return a.map((line) => ({ op: "-", line }));
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let done = false;
  for (let d = 0; d <= max && !done; d++) {
    if (d > MAX_EDIT_DISTANCE) return null;
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        done = true;
        break;
      }
    }
    trace.push(v.slice(off - d, off + d + 1)); // 第 d 步之后 k∈[-d,d] 的 x，trace[d][k + d]
  }
  const ops = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const prev = trace[d - 1];
    const at = (k) => prev[k + d - 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ op: " ", line: a[x - 1] });
      x--;
      y--;
    }
    if (x === prevX) {
      ops.push({ op: "+", line: b[y - 1] });
      y--;
    } else {
      ops.push({ op: "-", line: a[x - 1] });
      x--;
    }
  }
  while (x > 0 && y > 0) {
    ops.push({ op: " ", line: a[x - 1] });
    x--;
    y--;
  }
  return ops.reverse();
}

// 编辑脚本：[{ op: " " | "-" | "+", line }]
export function diffLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const mid = myers(midA, midB) ?? [...midA.map((line) => ({ op: "-", line })), ...midB.map((line) => ({ op: "+", line }))];
  return [
    ...a.slice(0, start).map((line) => ({ op: " ", line })),
    ...mid,
    ...a.slice(endA).map((line) => ({ op: " ", line })),
  ];
}

function range(start, len) {
  const first = len === 0 ? start : start + 1;
  return len === 1 ? `${first}` : `${first},${len}`;
}

// 把编辑脚本切成带上下文的 hunk 文本行
export function unifiedHunks(ops, context = 3) {
  const changes = [];
  ops.forEach((o, i) => {
    if (o.op !== " ") changes.push(i);
  });
  if (changes.length === 0) return [];
  const groups = [];
  let gs = changes[0];
  let ge = changes[0];
  for (const i of changes.slice(1)) {
    if (i - ge - 1 <= 2 * context) ge = i;
    else {
      groups.push([gs, ge]);
      gs = ge = i;
    }
  }
  groups.push([gs, ge]);

  const aAt = [];
  const bAt = [];
  let ai = 0;
  let bi = 0;
  for (const o of ops) {
    aAt.push(ai);
    bAt.push(bi);
    if (o.op !== "+") ai++;
    if (o.op !== "-") bi++;
  }

  const out = [];
  for (const [s, e] of groups) {
    const from = Math.max(0, s - context);
    const to = Math.min(ops.length - 1, e + context);
    const slice = ops.slice(from, to + 1);
    const aLen = slice.filter((o) => o.op !== "+").length;
    const bLen = slice.filter((o) => o.op !== "-").length;
    out.push(`@@ -${range(aAt[from], aLen)} +${range(bAt[from], bLen)} @@`);
    for (const o of slice) {
      const body = o.line.endsWith("\n") ? o.line.slice(0, -1) : o.line;
      out.push(o.op + body);
      if (!o.line.endsWith("\n")) out.push("\\ No newline at end of file");
    }
  }
  return out;
}

// 对比两份物品快照。labelA / labelB 写在 ---/+++ 行的制表符后面（标准统一 diff 允许）
export function diffTrees(fromMap, toMap, { labelA = "", labelB = "", context = 3 } = {}) {
  const paths = [...new Set([...fromMap.keys(), ...toMap.keys()])].sort();
  const files = [];
  const patch = [];
  let adds = 0;
  let dels = 0;
  const tag = (label) => (label ? "\t" + label : "");
  for (const p of paths) {
    const a = fromMap.get(p);
    const b = toMap.get(p);
    if (a && b && a.equals(b)) continue;
    const status = !a ? "added" : !b ? "removed" : "changed";
    const file = { path: p, status, binary: false, adds: 0, dels: 0 };
    const head = [`--- ${a ? "a/" + p : "/dev/null"}${tag(labelA)}`, `+++ ${b ? "b/" + p : "/dev/null"}${tag(labelB)}`];
    if (isBinary(a) || isBinary(b)) {
      file.binary = true;
      patch.push(`Binary files ${a ? "a/" + p : "/dev/null"} and ${b ? "b/" + p : "/dev/null"} differ`);
    } else {
      const ops = diffLines(splitLines(a ? a.toString("utf8") : ""), splitLines(b ? b.toString("utf8") : ""));
      for (const o of ops) {
        if (o.op === "+") file.adds++;
        else if (o.op === "-") file.dels++;
      }
      patch.push(...head, ...unifiedHunks(ops, context));
    }
    adds += file.adds;
    dels += file.dels;
    files.push(file);
  }
  return { files, adds, dels, patch: patch.join("\n") };
}

export function statText(result) {
  if (result.files.length === 0) return "";
  const width = Math.max(...result.files.map((f) => f.path.length));
  const mark = { added: "+", removed: "-", changed: "~" };
  const lines = result.files.map((f) =>
    ` ${mark[f.status]} ${f.path.padEnd(width)}  ${f.binary ? "（二进制）" : `+${f.adds} -${f.dels}`}`);
  lines.push(` ${result.files.length} 个文件，+${result.adds} -${result.dels}`);
  return lines.join("\n");
}

export function colorizePatch(text) {
  return text.split("\n").map((l) => {
    if (l.startsWith("+++") || l.startsWith("---")) return `\x1b[1m${l}\x1b[0m`;
    if (l.startsWith("@@")) return `\x1b[36m${l}\x1b[0m`;
    if (l.startsWith("+")) return `\x1b[32m${l}\x1b[0m`;
    if (l.startsWith("-")) return `\x1b[31m${l}\x1b[0m`;
    return l;
  }).join("\n");
}
