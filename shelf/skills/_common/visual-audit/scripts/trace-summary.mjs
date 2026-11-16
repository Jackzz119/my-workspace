#!/usr/bin/env node
// trace-summary.mjs — 汇总一份 Chrome DevTools trace（play.mjs 的 traceStop 产物或 Performance 面板导出的 JSON）：
// 帧呈现状态（PipelineReporter 的 chrome_frame_reporter.state）、帧时长分布、渲染主线程长任务、rAF 回调耗时、GC、GPU 任务。
// 不依赖第三方包。用法：node trace-summary.mjs <trace.json> [--json <输出.json>] [--from <毫秒> --to <毫秒>]
//   --from/--to 只统计 trace 起点之后这段时间（毫秒），用来只看某一段动效。
// 事件名与字段会随 Chrome 版本变化：统计为 0 时先在 Performance 面板里对一眼，再按当场调研的资料调整本脚本。
import fs from 'node:fs';

const argv = process.argv.slice(2);
const file = argv.find((a, i) => !a.startsWith('--') && !['--json', '--from', '--to'].includes(argv[i - 1]));
if (!file) {
    console.error('用法：node trace-summary.mjs <trace.json> [--json <输出.json>] [--from <ms> --to <ms>]');
    process.exit(1);
}
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const events = Array.isArray(raw) ? raw : raw.traceEvents;

// 线程名
const threadName = new Map();
for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threadName.set(`${e.pid}:${e.tid}`, e.args?.name);
// 大 trace 有上百万事件：不用 Math.min(...展开)（会爆栈），一遍循环求首尾
let t0 = Infinity;
let tEnd = -Infinity;
for (const e of events) {
    if (!(e.ts > 0) || e.ph === 'M') continue;
    if (e.ts < t0) t0 = e.ts;
    const end = e.ts + (e.dur ?? 0);
    if (end > tEnd) tEnd = end;
}
const from = opt('--from') !== undefined ? t0 + Number(opt('--from')) * 1000 : -Infinity;
const to = opt('--to') !== undefined ? t0 + Number(opt('--to')) * 1000 : Infinity;
const inWindow = (e) => e.ts >= from && e.ts <= to;

// 渲染主线程：事件最多的 CrRendererMain
const mainCounts = new Map();
for (const e of events) {
    const k = `${e.pid}:${e.tid}`;
    if (threadName.get(k) === 'CrRendererMain') mainCounts.set(k, (mainCounts.get(k) ?? 0) + 1);
}
const mainKey = [...mainCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
const onMain = (e) => `${e.pid}:${e.tid}` === mainKey;

const ms = (us) => Math.round(us / 100) / 10;
const dist = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
    return { n: s.length, p50: q(0.5), p90: q(0.9), p99: s.length >= 200 ? q(0.99) : null, max: s.at(-1) ?? 0 };
};

// 长任务（主线程 RunTask ≥ 50ms）
const tasks = events.filter((e) => onMain(e) && e.ph === 'X' && /RunTask$/.test(e.name) && inWindow(e));
const long = tasks
    .filter((e) => e.dur >= 50000)
    .map((e) => ({ atMs: ms(e.ts - t0), durMs: ms(e.dur) }))
    .sort((a, b) => b.durMs - a.durMs);

// 最长几个长任务里各类子事件的耗时（粗归因：同线程、落在任务时间窗内的 X 事件按名字合计）
const breakdown = long.slice(0, 3).map((lt) => {
    const a = t0 + lt.atMs * 1000;
    const b = a + lt.durMs * 1000;
    const sum = new Map();
    for (const e of events) {
        if (!onMain(e) || e.ph !== 'X' || e.ts < a || e.ts + (e.dur ?? 0) > b || /RunTask$/.test(e.name)) continue;
        sum.set(e.name, (sum.get(e.name) ?? 0) + e.dur);
    }
    return { atMs: lt.atMs, durMs: lt.durMs, top: [...sum.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([n, d]) => [n, ms(d)]) };
});

// rAF 回调
const raf = events.filter((e) => onMain(e) && e.ph === 'X' && /FireAnimationFrame|AnimationFrameFiredCallback/.test(e.name) && inWindow(e));

// 帧呈现：PipelineReporter（异步 b/e 或 X），按 state 计数；帧时长取 b→e
const frameState = {};
const frameDur = [];
const open = new Map();
for (const e of events) {
    if (e.name !== 'PipelineReporter' || !inWindow(e)) continue;
    const st = e.args?.chrome_frame_reporter?.state;
    if (e.ph === 'X') {
        if (st) frameState[st] = (frameState[st] ?? 0) + 1;
        frameDur.push(e.dur / 1000);
    } else if (e.ph === 'b') {
        open.set(`${e.pid}:${e.id ?? e.id2?.local}`, e);
        if (st) frameState[st] = (frameState[st] ?? 0) + 1;
    } else if (e.ph === 'e') {
        const k = `${e.pid}:${e.id ?? e.id2?.local}`;
        const b = open.get(k);
        if (b) {
            frameDur.push((e.ts - b.ts) / 1000);
            open.delete(k);
        }
    }
}
// 旧版事件兜底
const dropped = events.filter((e) => e.name === 'DroppedFrame' && inWindow(e)).length;
const drawFrames = events.filter((e) => e.name === 'DrawFrame' && inWindow(e)).length;

// GC 与 GPU
const gc = events.filter((e) => e.ph === 'X' && /^(MajorGC|MinorGC|V8\.GC_MARK_COMPACTOR|V8\.GC_SCAVENGER|V8\.GCScavenger|V8\.GCFinalizeMC)$/.test(e.name) && inWindow(e));
const gpu = events.filter((e) => e.ph === 'X' && e.name === 'GPUTask' && inWindow(e));

const spanMs = ms(Math.min(to, tEnd) - Math.max(from, t0));
const summary = {
    file,
    spanMs,
    mainThread: mainKey ?? null,
    frames: { byState: frameState, durMs: dist(frameDur.map((d) => Math.round(d * 10) / 10)), legacyDropped: dropped, drawFrame: drawFrames },
    longTasks: { count: long.length, top: long.slice(0, 10), breakdown },
    mainTaskMs: dist(tasks.map((e) => ms(e.dur))),
    rafCallbackMs: dist(raf.map((e) => ms(e.dur))),
    gc: { count: gc.length, totalMs: ms(gc.reduce((s, e) => s + e.dur, 0)), maxMs: ms(gc.reduce((m, e) => Math.max(m, e.dur), 0)) },
    gpuTaskMs: dist(gpu.map((e) => ms(e.dur)))
};
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
