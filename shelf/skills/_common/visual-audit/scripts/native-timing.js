// native-timing.js — 给浏览器的原生量字与贴图上传接口挂计时，按「参数」汇总耗时。
// CPU 采样只能告诉你「量字花了 500ms」，看不出是哪几个字、哪张贴图；这个脚本把时间记到具体的字体 + 文字、具体的贴图尺寸上。
// 用法：场景里 "inject": ["<技能目录>/scripts/native-timing.js"]（play.mjs 在页面脚本之前注入），然后在步骤里
//   {eval: "__nativeTiming.start()"}  …做要测的那一下…  {eval: "__nativeTiming.dump(20)", as: "名"}
// dump(n) 返回并清空：
//   text:   { totalMs, distinct, top: [[毫秒, 次数, "字体 | 文字"], …] }      ← measureText
//   draw:   { totalMs, calls }                                                ← fillText / strokeText
//   upload: { totalMs, calls, megapixels, top: [[毫秒, 次数, "宽×高"], …] }   ← texImage2D / texSubImage2D
// 没 start() 时包装层只多一次判断，不记时间；stop() 停止记录。配合 play.mjs 的 {cpu: 倍数} 用，数字随降速放大。
(() => {
    'use strict';
    if (window.__nativeTiming) return;
    let on = false;
    let text = new Map();
    let upload = new Map();
    let draw = { ms: 0, n: 0 };
    let up = { ms: 0, n: 0, px: 0 };
    const now = () => performance.now();
    const bump = (map, key, ms) => {
        const e = map.get(key);
        if (e) {
            e[0] += ms;
            e[1]++;
        } else map.set(key, [ms, 1]);
    };
    const wrap = (proto, name, record) => {
        if (!proto || typeof proto[name] !== 'function') return;
        const orig = proto[name];
        proto[name] = function (...args) {
            if (!on) return orig.apply(this, args);
            const t0 = now();
            const r = orig.apply(this, args);
            record(this, args, now() - t0);
            return r;
        };
    };
    for (const C of [window.CanvasRenderingContext2D, window.OffscreenCanvasRenderingContext2D]) {
        const p = C && C.prototype;
        wrap(p, 'measureText', (ctx, a, ms) => bump(text, `${ctx.font} | ${a[0]}`, ms));
        for (const fn of ['fillText', 'strokeText'])
            wrap(p, fn, (_ctx, _a, ms) => {
                draw.ms += ms;
                draw.n++;
            });
    }
    for (const G of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
        const p = G && G.prototype;
        for (const fn of ['texImage2D', 'texSubImage2D'])
            wrap(p, fn, (_gl, a, ms) => {
                // 像素来源是最后一个参数（图 / 画布 / 位图）；按数值给宽高的重载里它是数组或 null
                const src = a[a.length - 1];
                const w = src && typeof src.width === 'number' ? src.width : 0;
                const h = src && typeof src.height === 'number' ? src.height : 0;
                up.ms += ms;
                up.n++;
                up.px += w * h;
                bump(upload, w && h ? `${w}×${h}` : '(数组或空)', ms);
            });
    }
    const top = (map, n) =>
        [...map]
            .map(([k, v]) => [Math.round(v[0] * 10) / 10, v[1], k])
            .sort((x, y) => y[0] - x[0])
            .slice(0, n);
    const sum = (map) => Math.round([...map.values()].reduce((s, v) => s + v[0], 0));
    const reset = () => {
        text = new Map();
        upload = new Map();
        draw = { ms: 0, n: 0 };
        up = { ms: 0, n: 0, px: 0 };
    };
    window.__nativeTiming = {
        start() {
            reset();
            on = true;
            return 'on';
        },
        stop() {
            on = false;
            return 'off';
        },
        dump(n = 20) {
            const out = {
                text: { totalMs: sum(text), distinct: text.size, top: top(text, n) },
                draw: { totalMs: Math.round(draw.ms), calls: draw.n },
                upload: {
                    totalMs: Math.round(up.ms),
                    calls: up.n,
                    megapixels: Math.round(up.px / 1e4) / 100,
                    top: top(upload, Math.min(n, 8))
                }
            };
            reset();
            return out;
        }
    };
})();
