#!/usr/bin/env node
// cpuprofile-callers.mjs — 把一份 .cpuprofile（play.mjs 的 profileStop 产物或 DevTools 导出）里某个函数的自耗时按调用链汇总：
// topSelfTime 只说「fillRect / texImage2D / measureText 这类原生调用最贵」，这里回答「是谁在调它」。
// 不依赖第三方包。用法：node cpuprofile-callers.mjs <profile.cpuprofile> <函数名> [向上层数=4] [--top 8]
//   压缩构建里函数名是混淆后的短名，配合 url:行:列 定位；要看源码名就对未压缩构建再录一次。
import fs from 'node:fs';

const argv = process.argv.slice(2);
const [file, fn, depthArg] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--top');
if (!file || !fn) {
    console.error('用法：node cpuprofile-callers.mjs <profile.cpuprofile> <函数名> [向上层数=4] [--top 8]');
    process.exit(1);
}
const depth = Number(depthArg ?? 4);
const top = argv.includes('--top') ? Number(argv[argv.indexOf('--top') + 1]) : 8;
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
// 自耗时：样本落在该节点上的时间（timeDeltas 是微秒）
const self = new Map();
p.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000));
const frame = (cf) => `${cf.functionName || '(匿名)'}@${(cf.url || '').split('/').pop()}:${cf.lineNumber + 1}:${cf.columnNumber + 1}`;
const agg = new Map();
let total = 0;
for (const n of p.nodes) {
    if (n.callFrame.functionName !== fn) continue;
    const ms = self.get(n.id) ?? 0;
    if (!ms) continue;
    total += ms;
    const chain = [];
    for (let cur = parent.get(n.id), k = 0; cur !== undefined && k < depth; cur = parent.get(cur), k++) chain.push(frame(byId.get(cur).callFrame));
    const key = chain.join(' < ') || '(无调用者)';
    agg.set(key, (agg.get(key) ?? 0) + ms);
}
console.log(`${fn} 自耗时合计 ${total.toFixed(1)}ms，按调用链：`);
[...agg.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .forEach(([k, v]) => console.log(`${v.toFixed(1).padStart(8)}  ${k}`));
