// sampler.js — 页面内实时采样：rAF 帧间隔、长任务与长动画帧（LoAF）、JS 堆。不依赖任何库，ES2020。
// 由 play.mjs 在页面脚本之前注入（排在 vt-shim.js 之后，用它保存的原生时钟，冻结时不采）。
//
//   __sampler.start({ counter })   开始；counter 是可选表达式字符串，返回「项目自己的累计渲染帧数」（按需渲染的引擎用）
//   __sampler.mark('标签')          在时间线上打点（操作开始 / 结束），结果里按时间对齐
//   __sampler.stop()               停止并返回统计：帧间隔分布、估计的 vsync、超 1.5 / 2.5 个 vsync 的帧、长任务、LoAF、堆曲线
//
// rAF 间隔量的是「主线程每帧能不能按时回来」；按需渲染的游戏真正画了几帧要看 counter 或 trace 里的帧事件。
(() => {
    'use strict';
    if (window.__sampler) return;
    const real = window.__vt
        ? window.__vt.real
        : {
              now: performance.now.bind(performance),
              rAF: window.requestAnimationFrame.bind(window),
              setTimeout: window.setTimeout.bind(window),
              clearTimeout: window.clearTimeout.bind(window)
          };
    let on = false;
    let t0 = 0;
    let last = 0;
    let deltas = [];
    let stamps = [];
    let marks = [];
    let longtasks = [];
    let loafs = [];
    let mem = [];
    let memTimer = 0;
    let counter = null;
    let c0 = null;
    let lastC = null;
    let lastRenderTs = 0;
    let renderDeltas = [];

    const loop = (ts) => {
        if (!on) return;
        if (window.__vt && window.__vt.frozen) {
            last = 0; // 冻结期间不算帧间隔
        } else {
            if (last) {
                deltas.push(ts - last);
                stamps.push(ts - t0);
            }
            last = ts;
            // 按需渲染的引擎：counter 变了 = 这一帧真画了，记两次真渲染之间隔了多久
            if (counter) {
                const c = counter();
                if (lastC !== null && c !== lastC) {
                    if (lastRenderTs) renderDeltas.push(ts - lastRenderTs);
                    lastRenderTs = ts;
                }
                lastC = c;
            }
        }
        real.rAF(loop);
    };

    const observe = (type, sink) => {
        try {
            new PerformanceObserver((list) => {
                if (on) for (const e of list.getEntries()) sink(e);
            }).observe({ type, buffered: false });
        } catch {
            /* 浏览器不支持这种条目：结果里该项为空 */
        }
    };
    observe('longtask', (e) => longtasks.push({ t: Math.round(e.startTime - t0), d: Math.round(e.duration) }));
    observe('long-animation-frame', (e) =>
        loafs.push({
            t: Math.round(e.startTime - t0),
            d: Math.round(e.duration),
            blocking: Math.round(e.blockingDuration || 0),
            render: e.renderStart ? Math.round(e.startTime + e.duration - e.renderStart) : 0,
            scripts: (e.scripts || []).slice(0, 3).map((s) => ({
                where: `${(s.sourceURL || '').split('/').pop()}:${s.sourceFunctionName || '?'}`,
                d: Math.round(s.duration)
            }))
        })
    );

    const q = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
    const r1 = (x) => Math.round(x * 10) / 10;

    window.__sampler = {
        start(opts = {}) {
            on = true;
            t0 = real.now();
            last = 0;
            deltas = [];
            stamps = [];
            marks = [];
            longtasks = [];
            loafs = [];
            mem = [];
            counter = opts.counter ? new Function(`return (${opts.counter});`) : null;
            c0 = counter ? counter() : null;
            lastC = c0;
            lastRenderTs = 0;
            renderDeltas = [];
            real.rAF(loop);
            const sampleMem = () => {
                if (!on) return;
                const m = performance.memory;
                if (m) mem.push({ t: Math.round(real.now() - t0), mb: r1(m.usedJSHeapSize / 1048576) });
                memTimer = real.setTimeout(sampleMem, 500);
            };
            sampleMem();
            return true;
        },
        mark(label) {
            marks.push({ t: Math.round(real.now() - t0), label });
        },
        stop() {
            on = false;
            real.clearTimeout(memTimer);
            const dur = real.now() - t0;
            const sorted = [...deltas].sort((a, b) => a - b);
            const vsync = q(sorted, 0.5) || 16.7;
            const late = (k) => deltas.filter((d) => d > vsync * k).length;
            const hitches = deltas
                .map((d, i) => ({ t: Math.round(stamps[i]), ms: r1(d) }))
                .filter((h) => h.ms > vsync * 1.5)
                .sort((a, b) => b.ms - a.ms)
                .slice(0, 12);
            const rendered = counter ? counter() - c0 : null;
            return {
                durMs: Math.round(dur),
                rafFrames: deltas.length,
                rafFps: r1((deltas.length / dur) * 1000),
                vsyncMs: r1(vsync),
                deltaMs: {
                    p50: r1(q(sorted, 0.5)),
                    p90: r1(q(sorted, 0.9)),
                    p99: sorted.length >= 200 ? r1(q(sorted, 0.99)) : null,
                    max: r1(sorted[sorted.length - 1] || 0)
                },
                over1_5vsync: late(1.5),
                over2_5vsync: late(2.5),
                hitches,
                renderedFrames: rendered,
                renderFps: rendered === null ? null : r1((rendered / dur) * 1000),
                // 真渲染间隔：gapsByVsync 把每个间隔折成「隔了几个 vsync」计数，看得出是否均匀、有没有吞帧
                renderDeltaMs: renderDeltas.length
                    ? (() => {
                          const r = [...renderDeltas].sort((a, b) => a - b);
                          return { n: r.length, p50: r1(q(r, 0.5)), p90: r1(q(r, 0.9)), max: r1(r[r.length - 1]) };
                      })()
                    : null,
                gapsByVsync: renderDeltas.reduce((m, d) => {
                    const k = Math.max(1, Math.round(d / vsync));
                    m[k] = (m[k] || 0) + 1;
                    return m;
                }, {}),
                longtasks,
                loafs: loafs.sort((a, b) => b.d - a.d).slice(0, 15),
                loafCount: loafs.length,
                heapMb: mem.length
                    ? { first: mem[0].mb, last: mem[mem.length - 1].mb, max: Math.max(...mem.map((m) => m.mb)) }
                    : null,
                heapCurve: mem.filter((_, i) => i % 4 === 0),
                marks
            };
        }
    };
})();
