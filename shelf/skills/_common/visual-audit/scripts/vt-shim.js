// vt-shim.js — 页面内的虚拟时钟：冻结后按固定步长一帧一帧推进，逐帧取证用。不依赖任何库，ES2020。
// 由 play.mjs 在页面脚本之前注入（CDP Page.addScriptToEvaluateOnNewDocument）；平时直通真实时钟，对页面零影响。
//
//   __vt.freeze()      从当前时刻起冻结：performance.now / Date.now 停住，rAF 与定时器只在 step 时触发
//   __vt.step(ms)      推进 ms：按到期顺序跑完到期的定时器，再跑一轮 rAF 回调（时间戳 = 推进后的时刻）
//   __vt.thaw()        解冻：时钟从冻结时的读数接着走（不回跳、不突跳），挂着的定时器与 rAF 交回浏览器
//   __vt.frozen        是否冻结中；__vt.real 是原生 now / rAF / setTimeout，测帧率的采样器用它
//
// 覆盖：performance.now、Date.now、requestAnimationFrame / cancel、setTimeout / setInterval / clear*。
// 不覆盖：CSS 动画、Web Audio 时钟、Worker 里的时间、事件对象的 timeStamp——用到它们的效果冻结时不受控，报告里注明。
(() => {
    'use strict';
    if (window.__vt) return;
    const real = {
        now: performance.now.bind(performance),
        dateNow: Date.now.bind(Date),
        rAF: window.requestAnimationFrame.bind(window),
        cAF: window.cancelAnimationFrame.bind(window),
        setTimeout: window.setTimeout.bind(window),
        clearTimeout: window.clearTimeout.bind(window)
    };
    const dateBase = real.dateNow() - real.now();
    let frozen = false;
    let vnow = 0; // 冻结中的读数
    let offset = 0; // 直通时：读数 = 真实 + offset（解冻后保持连续）
    const now = () => (frozen ? vnow : real.now() + offset);

    performance.now = now;
    Date.now = () => Math.floor(dateBase + now());

    // ---------- 定时器：统一登记，直通时挂真实定时器，冻结时只由 step 触发 ----------
    let seq = 0;
    const timers = new Map(); // id → { id, due, fn, args, every, realId }
    const arm = (t) => {
        if (t.realId) real.clearTimeout(t.realId);
        t.realId = real.setTimeout(() => {
            t.realId = 0;
            if (!frozen && timers.has(t.id)) fire(t);
        }, Math.max(0, t.due - now()));
    };
    const fire = (t) => {
        if (t.every === null) timers.delete(t.id);
        else {
            t.due += t.every;
            if (!frozen) arm(t);
        }
        try {
            if (typeof t.fn === 'function') t.fn(...t.args);
            else (0, eval)(String(t.fn));
        } catch (e) {
            real.setTimeout(() => {
                throw e; // 异步抛出：控制台照常看到，且不打断这一步里其余定时器
            });
        }
    };
    const add = (fn, ms, args, repeat) => {
        const delay = Math.max(0, Number(ms) || 0);
        const t = { id: ++seq, due: now() + delay, fn, args, every: repeat ? Math.max(1, delay) : null, realId: 0 };
        timers.set(t.id, t);
        if (!frozen) arm(t);
        return t.id;
    };
    const clear = (id) => {
        const t = timers.get(id);
        if (!t) return;
        timers.delete(id);
        if (t.realId) real.clearTimeout(t.realId);
    };
    window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
    window.setInterval = (fn, ms, ...args) => add(fn, ms, args, true);
    window.clearTimeout = clear;
    window.clearInterval = clear;

    // ---------- rAF：直通时转给浏览器（时间戳换成本时钟），冻结时攒着等 step ----------
    let rseq = 0;
    const frames = new Map(); // id → { cb, realId }
    const armFrame = (id, f) => {
        f.realId = real.rAF(() => {
            f.realId = 0;
            if (frozen || !frames.has(id)) return;
            frames.delete(id);
            f.cb(now());
        });
    };
    window.requestAnimationFrame = (cb) => {
        const id = ++rseq;
        const f = { cb, realId: 0 };
        frames.set(id, f);
        if (!frozen) armFrame(id, f);
        return id;
    };
    window.cancelAnimationFrame = (id) => {
        const f = frames.get(id);
        if (!f) return;
        frames.delete(id);
        if (f.realId) real.cAF(f.realId);
    };

    const runFrames = () => {
        const batch = [...frames.entries()]; // 回调里新请求的 rAF 进下一帧
        frames.clear();
        for (const [, f] of batch) {
            if (f.realId) real.cAF(f.realId);
            try {
                f.cb(vnow);
            } catch (e) {
                console.error('[vt] rAF 回调出错', e);
            }
        }
        return batch.length;
    };

    window.__vt = {
        real,
        get frozen() {
            return frozen;
        },
        get now() {
            return now();
        },
        freeze() {
            if (frozen) return vnow;
            vnow = now();
            frozen = true;
            for (const t of timers.values()) if (t.realId) (real.clearTimeout(t.realId), (t.realId = 0));
            for (const f of frames.values()) if (f.realId) (real.cAF(f.realId), (f.realId = 0));
            return vnow;
        },
        /** 推进 ms 毫秒：到期定时器按到期先后跑（同时到期按登记先后），最后跑一轮 rAF；返回 { t, timers, frames } */
        step(ms = 1000 / 60) {
            if (!frozen) throw new Error('先 __vt.freeze()');
            const target = vnow + Math.max(0, ms);
            let ran = 0;
            for (let guard = 0; guard < 10000; guard++) {
                let next = null;
                for (const t of timers.values())
                    if (t.due <= target && (!next || t.due < next.due || (t.due === next.due && t.id < next.id)))
                        next = t;
                if (!next) break;
                vnow = Math.max(vnow, next.due);
                fire(next);
                ran++;
            }
            vnow = target;
            return { t: vnow, timers: ran, frames: runFrames() };
        },
        thaw() {
            if (!frozen) return now();
            offset = vnow - real.now();
            frozen = false;
            for (const t of timers.values()) arm(t);
            for (const [id, f] of frames) armFrame(id, f);
            return now();
        }
    };
})();
