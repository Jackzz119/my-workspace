#!/usr/bin/env node
// play.mjs — 用无头（或有头）Chrome 经 CDP 试玩一段场景：真实触控输入、截图、逐帧胶片、实时帧率 / 内存采样、DevTools trace。
// 不依赖第三方包（Node ≥ 22 自带 WebSocket）。页面脚本之前注入 vt-shim.js（虚拟时钟）与 sampler.js（采样器）。
//
// 用法：node play.mjs <场景.json> <输出目录> [--url <地址>] [--chrome <chrome 可执行文件>] [--headful] [--keep]
//   --url 覆盖场景里的 url；--chrome 缺省取环境变量 CHROME_PATH，再试常见安装位置；--keep 结束后不关浏览器（调试用）
//
// 场景 JSON：{ url, viewport:{width,height,dpr,mobile}, input:'touch'|'mouse', cpu:倍数, inject:[文件或代码], steps:[…] }
// 步骤（按顺序执行，坐标一律是视口 CSS 像素）：
//   {goto:true|'地址'}  {reload:true}  {wait:ms}  {waitFor:'表达式', timeout:ms}  {eval:'表达式', as:'名'}
//   {tap:[x,y], hold:ms}  {tapAt:'返回 [x,y] 的表达式'}  {drag:[x1,y1,x2,y2], ms, steps}  {key:'Escape'}  {cpu:倍数}  {media:{特性:值}}
//   {shot:'名', clip:[x,y,w,h] 或 clipAt:'返回 [x,y,w,h] 的表达式'}  {log:'备注'}  {clearStorage:true}
//   {film:'名', frames:N, dt:ms, clip:[x,y,w,h], scale:0.5, cols:6, do:[{at:帧号, tap:[x,y]} | {at, down:[x,y]} | {at, up:true} | {at, eval:'…'}], saveFrames:false}
//       do 里的 tap / down / move 也可写成 tapAt / downAt / moveAt:'表达式'（坐标由页面算，排版变了不会点偏）
//       probe:'表达式' 每帧推进后求一次值，结果按帧记进 summary（动画曲线的精确数值，比看图准）；noShots:true 只记 probe 不截图
//       冻结虚拟时钟，在指定帧做动作，每推进 dt 截一帧，拼成带帧号 / 毫秒 / 变化量的胶片图（<名>.png）与逐帧变化表
//   {sampleStart:{counter:'表达式'}}  {sampleMark:'标签'}  {sampleStop:'名'}   实时帧间隔 / 长任务 / LoAF / 堆
//   {traceStart:true}  {traceStop:'名'}   DevTools trace（可拖进 Performance 面板；trace-summary.mjs 汇总）
//   {metrics:'名'}  {gc:true}  {heap:'名'}  {profileStart:true}  {profileStop:'名'}（JS CPU 采样：存 .cpuprofile，并汇总自耗时最高的函数）
// 结果：输出目录里的图片 / trace，加 summary.json（每步结果、控制台报错与未捕获异常）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const valued = ['--chrome', '--url'];
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const [scenarioFile, outDir] = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]));
if (!scenarioFile || !outDir) {
    console.error('用法：node play.mjs <场景.json> <输出目录> [--url <地址>] [--chrome <exe>] [--headful] [--keep]');
    process.exit(1);
}
const scenario = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
const pageUrl = opt('--url') ?? scenario.url;
fs.mkdirSync(outDir, { recursive: true });

const chromeCandidates = [
    opt('--chrome'),
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
].filter(Boolean);
const chrome = chromeCandidates.find((p) => fs.existsSync(p));
if (!chrome) throw new Error('找不到 Chrome：用 --chrome 或环境变量 CHROME_PATH 指定');

// ---------- 启动浏览器 ----------
const port = 9400 + Math.floor(Math.random() * 500);
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xaudit-chrome-'));
const flags = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
    'about:blank'
];
if (!argv.includes('--headful')) flags.unshift('--headless=new');
const proc = spawn(chrome, flags, { stdio: 'ignore' });
const cleanup = () => {
    if (argv.includes('--keep')) return;
    try {
        proc.kill();
    } catch {
        /* 已退出 */
    }
};
process.on('exit', cleanup);

/** 等 DevTools 端口就绪，取第一个页面目标的 WebSocket 地址 */
async function pageWs() {
    for (let i = 0; i < 150; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
            const page = list.find((t) => t.type === 'page');
            if (page) return page.webSocketDebuggerUrl;
        } catch {
            /* 还没起来 */
        }
        await sleep(100);
    }
    throw new Error('Chrome DevTools 端口没起来');
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

const ws = new WebSocket(await pageWs());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1;
const pending = new Map();
const listeners = new Set();
ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data ?? ''}`));
        else resolve(msg.result);
    } else for (const l of [...listeners]) l(msg);
});
/** 发一条 CDP 命令，超时报错（默认 60s） */
function send(method, params = {}, timeout = 60000) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`CDP 超时：${method}`));
        }, timeout);
        pending.set(id, {
            resolve: (v) => (clearTimeout(timer), resolve(v)),
            reject: (e) => (clearTimeout(timer), reject(e))
        });
        ws.send(JSON.stringify({ id, method, params }));
    });
}
function once(method, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => (listeners.delete(l), reject(new Error(`等事件超时：${method}`))), timeout);
        const l = (msg) => {
            if (msg.method !== method) return;
            listeners.delete(l);
            clearTimeout(timer);
            resolve(msg.params);
        };
        listeners.add(l);
    });
}
/** 在页面里求值；表达式可以返回 Promise */
async function evaluate(expression, timeout) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
    if (r.exceptionDetails) throw new Error(`页面求值出错：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
}

/** 坐标：直接给 [x,y]，或给一个在页面里求值、返回 [x,y] 的表达式 */
async function point(p) {
    if (Array.isArray(p)) return p;
    const v = await evaluate(p);
    if (!Array.isArray(v) || v.length < 2 || !v.every(Number.isFinite))
        throw new Error(`坐标表达式没有返回 [x,y]：${p} → ${JSON.stringify(v)}`);
    return v;
}

// ---------- 控制台与异常 ----------
const consoleLog = [];
listeners.add((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(msg.params.type)) {
        consoleLog.push({
            type: msg.params.type,
            text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400)
        });
    } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        consoleLog.push({ type: 'exception', text: (d.exception?.description ?? d.text ?? '').slice(0, 400) });
    }
});

await send('Page.enable');
await send('Runtime.enable');
await send('Performance.enable');

// ---------- 视口、输入方式、CPU ----------
const vp = { width: 390, height: 844, dpr: 3, mobile: true, ...(scenario.viewport ?? {}) };
await send('Emulation.setDeviceMetricsOverride', {
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: vp.dpr,
    mobile: vp.mobile
});
const inputMode = scenario.input ?? (vp.mobile ? 'touch' : 'mouse');
if (inputMode === 'touch') await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
if (scenario.cpu) await send('Emulation.setCPUThrottlingRate', { rate: scenario.cpu });

// ---------- 注入：虚拟时钟、采样器、项目适配脚本 ----------
const injects = [path.join(here, 'vt-shim.js'), path.join(here, 'sampler.js'), ...(scenario.inject ?? [])];
for (const src of injects) {
    const file = path.isAbsolute(src) ? src : path.resolve(path.dirname(scenarioFile), src);
    const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : src; // 不是文件就当代码
    await send('Page.addScriptToEvaluateOnNewDocument', { source });
}

// ---------- 输入 ----------
let touchDown = null;
async function pointer(type, x, y) {
    if (inputMode === 'touch') {
        const map = { down: 'touchStart', move: 'touchMove', up: 'touchEnd' };
        const points = type === 'up' ? [] : [{ x, y, radiusX: 6, radiusY: 6, force: 0.6, id: 1 }];
        await send('Input.dispatchTouchEvent', { type: map[type], touchPoints: points });
    } else {
        const map = { down: 'mousePressed', move: 'mouseMoved', up: 'mouseReleased' };
        await send('Input.dispatchMouseEvent', {
            type: map[type],
            x,
            y,
            button: type === 'move' && !touchDown ? 'none' : 'left',
            buttons: type === 'up' ? 0 : 1,
            clickCount: 1
        });
    }
    touchDown = type === 'up' ? null : [x, y];
}
/** 真人点按：按下停 hold 毫秒（缺省 70–120ms 随机）再抬起，落点有 ±1.5px 抖动 */
async function tap([x, y], hold) {
    const jx = x + (Math.random() - 0.5) * 3;
    const jy = y + (Math.random() - 0.5) * 3;
    await pointer('down', jx, jy);
    await sleep(hold ?? 70 + Math.random() * 50);
    await pointer('up', jx, jy);
}
async function drag([x1, y1, x2, y2], ms = 300, steps = 20) {
    await pointer('down', x1, y1);
    for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const e = 1 - (1 - k) * (1 - k); // 手指先快后慢
        await pointer('move', x1 + (x2 - x1) * e, y1 + (y2 - y1) * e);
        await sleep(ms / steps);
    }
    await pointer('up', x2, y2);
}

// ---------- 截图与胶片 ----------
async function screenshot(clip, scale = 1) {
    const params = { format: 'png', fromSurface: true, captureBeyondViewport: false };
    if (clip) params.clip = { x: clip[0], y: clip[1], width: clip[2], height: clip[3], scale };
    else if (scale !== 1) params.clip = { x: 0, y: 0, width: vp.width, height: vp.height, scale };
    return (await send('Page.captureScreenshot', params)).data;
}

// 在页面里把一组帧拼成胶片：每格标帧号、虚拟毫秒、动作，并算与上一帧的变化量（变化像素占比、平均差）
const SHEET_FN = `async (frames, cols, labels) => {
    const imgs = await Promise.all(frames.map((b64) => new Promise((ok, bad) => {
        const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = 'data:image/png;base64,' + b64;
    })));
    const w = imgs[0].width, h = imgs[0].height, pad = 4, head = 22;
    const rows = Math.ceil(imgs.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = cols * (w + pad) + pad; sheet.height = rows * (h + head + pad) + pad;
    const g = sheet.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, sheet.width, sheet.height);
    const probe = document.createElement('canvas'); probe.width = w; probe.height = h;
    const pg = probe.getContext('2d', { willReadFrequently: true });
    let prev = null; const change = [];
    imgs.forEach((im, i) => {
        pg.clearRect(0, 0, w, h); pg.drawImage(im, 0, 0);
        const cur = pg.getImageData(0, 0, w, h).data;
        let changed = 0, sum = 0;
        if (prev) for (let p = 0; p < cur.length; p += 4) {
            const d = Math.abs(cur[p] - prev[p]) + Math.abs(cur[p + 1] - prev[p + 1]) + Math.abs(cur[p + 2] - prev[p + 2]);
            if (d > 24) changed++; sum += d;
        }
        const px = cur.length / 4;
        change.push({ changedPct: prev ? Math.round((changed / px) * 1000) / 10 : 0, meanDiff: prev ? Math.round((sum / px / 3) * 10) / 10 : 0 });
        prev = cur;
        const x = pad + (i % cols) * (w + pad), y = pad + Math.floor(i / cols) * (h + head + pad);
        g.fillStyle = '#eee'; g.font = '13px monospace';
        g.fillText(labels[i] + '  Δ' + change[i].changedPct + '%', x + 2, y + 15);
        g.drawImage(im, x, y + head);
    });
    return { png: sheet.toDataURL('image/png').split(',')[1], change, tile: [w, h] };
}`;

/** 截图区域：clip:[x,y,w,h]，或 clipAt:'返回 [x,y,w,h] 的表达式'（开拍前求一次）；会裁到视口以内 */
async function region(step) {
    let c = step.clip;
    if (step.clipAt) c = await evaluate(step.clipAt);
    if (!c) return undefined;
    const x = Math.max(0, c[0]);
    const y = Math.max(0, c[1]);
    return [x, y, Math.min(vp.width - x, c[2] - (x - c[0])), Math.min(vp.height - y, c[3] - (y - c[1]))];
}

async function film(step) {
    const clip = await region(step);
    const frames = step.frames ?? 24;
    const dt = step.dt ?? 1000 / 60;
    const acts = new Map();
    for (const a of step.do ?? []) acts.set(a.at ?? 0, [...(acts.get(a.at ?? 0) ?? []), a]);
    await evaluate('__vt.freeze()');
    const shots = [];
    const labels = [];
    const probes = [];
    try {
        for (let i = 0; i < frames; i++) {
            const tags = [];
            for (const a of acts.get(i) ?? []) {
                if (a.tap || a.tapAt) {
                    const p = await point(a.tap ?? a.tapAt);
                    await pointer('down', ...p);
                    await evaluate(`__vt.step(${a.hold ?? 80})`);
                    await pointer('up', ...p);
                    tags.push('tap');
                }
                if (a.down || a.downAt) (await pointer('down', ...(await point(a.down ?? a.downAt))), tags.push('↓'));
                if (a.move || a.moveAt) (await pointer('move', ...(await point(a.move ?? a.moveAt))), tags.push('→'));
                if (a.up) (await pointer('up', ...(touchDown ?? [0, 0])), tags.push('↑'));
                if (a.eval) (await evaluate(a.eval), tags.push(a.tag ?? 'eval'));
            }
            const r = await evaluate(`__vt.step(${dt})`);
            if (step.probe) probes.push(await evaluate(step.probe).catch((e) => `ERR ${e.message}`));
            if (step.noShots) {
                labels.push('');
                continue;
            }
            shots.push(await screenshot(clip, step.scale ?? 0.5));
            labels.push(`#${i} ${Math.round((i + 1) * dt)}ms${tags.length ? ' ' + tags.join(',') : ''}${r.frames ? '' : ' (no rAF)'}`);
        }
    } finally {
        await evaluate('__vt.thaw()');
    }
    if (step.noShots) return { frames, dtMs: Math.round(dt * 100) / 100, probe: probes };
    const sheet = await evaluate(`(${SHEET_FN})(${JSON.stringify(shots)}, ${step.cols ?? 6}, ${JSON.stringify(labels)})`, 120000);
    fs.writeFileSync(path.join(outDir, `${step.film}.png`), Buffer.from(sheet.png, 'base64'));
    if (step.saveFrames) {
        const dir = path.join(outDir, step.film);
        fs.mkdirSync(dir, { recursive: true });
        shots.forEach((b, i) => fs.writeFileSync(path.join(dir, `${String(i).padStart(3, '0')}.png`), Buffer.from(b, 'base64')));
    }
    return {
        file: `${step.film}.png`,
        frames,
        dtMs: Math.round(dt * 100) / 100,
        tile: sheet.tile,
        change: sheet.change.map((c) => c.changedPct),
        ...(step.probe ? { probe: probes } : {})
    };
}

// ---------- CPU profile：按函数汇总自耗时（ms），带源文件与行号 ----------
function topSelfTime(profile, n) {
    const byId = new Map(profile.nodes.map((nd) => [nd.id, nd]));
    const self = new Map();
    const dts = profile.timeDeltas ?? [];
    profile.samples.forEach((id, i) => {
        const nd = byId.get(id);
        const f = nd.callFrame;
        const key = `${f.functionName || '(匿名)'} ${(f.url || '').split('/').pop().split('?')[0]}:${f.lineNumber + 1}`;
        self.set(key, (self.get(key) ?? 0) + (dts[i] ?? 0) / 1000);
    });
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    return {
        totalMs: Math.round(total),
        top: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, Math.round(v * 10) / 10])
    };
}

// ---------- trace ----------
const TRACE_CATS = [
    'devtools.timeline',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-devtools.timeline.frame',
    'toplevel',
    'blink.user_timing',
    'v8.execute',
    'disabled-by-default-v8.gc',
    'gpu',
    'viz',
    'benchmark',
    'input',
    'latencyInfo'
].join(',');
async function traceStop(name) {
    const done = once('Tracing.tracingComplete', 120000);
    await send('Tracing.end');
    const { stream } = await done;
    const file = path.join(outDir, `${name}.trace.json`);
    const fd = fs.openSync(file, 'w');
    for (;;) {
        const chunk = await send('IO.read', { handle: stream, size: 1 << 20 });
        fs.writeSync(fd, chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data);
        if (chunk.eof) break;
    }
    fs.closeSync(fd);
    await send('IO.close', { handle: stream });
    return { file: path.basename(file), bytes: fs.statSync(file).size };
}

// ---------- 跑步骤 ----------
const results = [];
const t0 = Date.now();
let failed = null;
for (const [i, step] of (scenario.steps ?? []).entries()) {
    const kind = Object.keys(step)[0];
    const started = Date.now();
    let out = null;
    try {
        if ('goto' in step) {
            const loaded = once('Page.loadEventFired', 60000);
            await send('Page.navigate', { url: step.goto === true ? pageUrl : step.goto });
            await loaded;
        } else if ('reload' in step) {
            const loaded = once('Page.loadEventFired', 60000);
            await send('Page.reload', { ignoreCache: false });
            await loaded;
        } else if ('clearStorage' in step) {
            const origin = new URL(pageUrl).origin;
            await send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
        } else if ('wait' in step) await sleep(step.wait);
        else if ('waitFor' in step) {
            const until = Date.now() + (step.timeout ?? 15000);
            for (;;) {
                if (await evaluate(`!!(${step.waitFor})`).catch(() => false)) break;
                if (Date.now() > until) throw new Error(`等不到：${step.waitFor}`);
                await sleep(100);
            }
        } else if ('eval' in step) out = await evaluate(step.eval, step.timeout);
        else if ('tap' in step) await tap(step.tap, step.hold);
        else if ('tapAt' in step) {
            const p = await point(step.tapAt);
            await tap(p, step.hold);
            out = p;
        }
        else if ('drag' in step) await drag(step.drag, step.ms, step.steps);
        else if ('key' in step) {
            for (const type of ['keyDown', 'keyUp'])
                await send('Input.dispatchKeyEvent', { type, key: step.key, code: step.key, windowsVirtualKeyCode: step.keyCode ?? 0 });
        } else if ('cpu' in step) await send('Emulation.setCPUThrottlingRate', { rate: step.cpu });
        else if ('media' in step) {
            const features = Object.entries(step.media).map(([name, value]) => ({ name, value }));
            await send('Emulation.setEmulatedMedia', { features });
        } else if ('shot' in step) {
            const b64 = await screenshot(await region(step), step.scale ?? 1);
            fs.writeFileSync(path.join(outDir, `${step.shot}.png`), Buffer.from(b64, 'base64'));
            out = `${step.shot}.png`;
        } else if ('film' in step) out = await film(step);
        else if ('sampleStart' in step) out = await evaluate(`__sampler.start(${JSON.stringify(step.sampleStart === true ? {} : step.sampleStart)})`);
        else if ('sampleMark' in step) await evaluate(`__sampler.mark(${JSON.stringify(step.sampleMark)})`);
        else if ('sampleStop' in step) {
            out = await evaluate('__sampler.stop()');
            fs.writeFileSync(path.join(outDir, `${step.sampleStop}.sample.json`), JSON.stringify(out, null, 2));
        } else if ('traceStart' in step) await send('Tracing.start', { categories: TRACE_CATS, transferMode: 'ReturnAsStream' });
        else if ('traceStop' in step) out = await traceStop(step.traceStop);
        else if ('metrics' in step) out = Object.fromEntries((await send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
        else if ('profileStart' in step) {
            await send('Profiler.enable');
            await send('Profiler.setSamplingInterval', { interval: step.intervalUs ?? 200 });
            await send('Profiler.start');
        } else if ('profileStop' in step) {
            const { profile } = await send('Profiler.stop', {}, 120000);
            fs.writeFileSync(path.join(outDir, `${step.profileStop}.cpuprofile`), JSON.stringify(profile));
            out = topSelfTime(profile, step.top ?? 25);
        } else if ('gc' in step) await send('HeapProfiler.collectGarbage');
        else if ('heap' in step) out = await send('Runtime.getHeapUsage');
        else if ('log' in step) out = step.log;
        else throw new Error(`不认识的步骤：${JSON.stringify(step)}`);
        results.push({ i, kind, as: step.as ?? step.shot ?? step.film ?? step.sampleStop ?? step.traceStop ?? step.metrics, ms: Date.now() - started, out });
    } catch (e) {
        failed = { i, kind, error: String(e.message ?? e) };
        results.push({ i, kind, ms: Date.now() - started, error: failed.error });
        if (!step.optional) break;
        failed = null;
    }
}

const summary = { scenario: path.basename(scenarioFile), url: pageUrl, viewport: vp, input: inputMode, cpu: scenario.cpu ?? 1, chrome, totalMs: Date.now() - t0, failed, console: consoleLog, results };
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ok: !failed, failed, steps: results.length, console: consoleLog.length, out: outDir }));
ws.close();
cleanup();
process.exit(failed ? 2 : 0);
