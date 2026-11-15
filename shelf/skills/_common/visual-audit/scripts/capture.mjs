// capture.mjs — the screenshot matrix and the open timings of a visual audit run (visual-audit skill).
// Drives a running web app through a list of scenarios and writes one PNG per shot plus manifest.json
// (shots, viewport, url, timings) into --out. Nothing here knows the project: urls, selectors and
// variables come from the scenarios file the project keeps beside its audit runs, so the same engine
// takes the "before" and the "after" of every round and the two can be laid side by side.
//
// usage: node capture.mjs --scenarios <file.json> --out <dir> [--base http://localhost:5173]
//          [--only name,name] [--set key=value ...] [--format png|jpeg] [--quality 85]
//          [--viewport 1920x1080] [--dpr 2] [--repeat 5] [--browser chrome|chromium|msedge] [--headed]
// --viewport and --dpr replace the table's default size and density (a scenario that names its own keeps
// it), so one table takes the whole viewport matrix. --repeat runs every scenario that times something
// that many times: manifest.timings then holds the middle value of each number, the range and every run
// (one run of an opening says little; a busy machine moves it by tens of ms).
// --format jpeg keeps a full matrix small enough to keep around (a painted scene is ~2 MB a shot as PNG,
// ~250 KB as JPEG); crops meant for measuring stay PNG by naming the step's own "format".
// Playwright is not a project dependency: VISUAL_AUDIT_NODE_MODULES=<a node_modules that holds it>, else
// the project's own node_modules, else the global npm root.
// Requests that leave --base's origin are aborted: an audit never reaches a real account or a third party.
//
// scenarios file:
//   { "defaults": { "viewport": [1440, 900], "dpr": 1, "vars": { "theme": "dark" }, "ready": "js" },
//     "scenarios": [ { "name", "url", "viewport"?, "dpr"?, "vars"?, "ready"?: js that must turn truthy,
//       "steps": [
//         { "click" | "rclick" | "dblclick" | "hover" | "focus": selector, "nth"?, "last"?, "at"?: [x, y] },
//         { "key": "Escape" }, { "type": text, "into"?: selector }, { "wait": ms | selector },
//         { "eval": js }, { "style": css },
//         { "shot": name, "clip"?: selector | [x, y, w, h], "pad"?: px, "full"?: true, "format"?: "png" | "jpeg" },
//         { "time": label, "click": selector, "appear": selector },
//         { "measure": label, "of": selector, "props"?: [css property, ...] },
//         { "contrast": label, "of": selector }
//       ] } ] }
// ${name} in a url, a selector or js is replaced from defaults.vars, the scenario's vars and --set.
// A shot waits for the page to settle first (no finite animation running for two frames).
// "time" measures one opening as its user sees it, from the pointer going down: `shown` (first frame the
// target is on screen and more than faintly visible), `settled` (the first frame its animations are over
// and its box is still, confirmed by the two frames after it), `worstFrame` (the longest gap between two
// frames on the way, the frame that handled the press included) with `worstAt` (when that gap ended) and
// `frames` (every frame's time since the press, to see where the long one sits), all in ms.
// A "measure" or "contrast" whose element is not there is listed under manifest.failed and skipped.
// "measure" writes an element's box and computed style into manifest.metrics, so a size, a radius or a
// shadow is a number in the report and not an impression. "contrast" measures text against what is really
// behind it, from the rendered pixels of the element (glass, pictures and gradients included): the most
// common luminance is the ground, the far 1% the ink; small anti-aliased type reads a little under its
// nominal ratio, which is what the eye gets too.
import { execSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// Read `--flag value` pairs; a flag given twice keeps every value.
function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const key = argv[i].slice(2);
        const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
        (args[key] ||= []).push(value);
    }
    return args;
}

// Playwright from wherever this machine keeps it.
function loadPlaywright() {
    const roots = [process.env.VISUAL_AUDIT_NODE_MODULES, path.join(process.cwd(), 'node_modules')];
    try {
        roots.push(execSync('npm root -g', { encoding: 'utf8' }).trim());
    } catch {
        // no npm on the path: the first two are all there is
    }
    const require = createRequire(import.meta.url);
    for (const root of roots.filter(Boolean)) {
        try {
            return require(path.join(root, 'playwright'));
        } catch {
            // not here; try the next
        }
    }
    throw new Error('playwright not found: set VISUAL_AUDIT_NODE_MODULES to a node_modules that holds it');
}

// ${name} from `vars`; a variable may name another (a snippet that takes a parameter), so it goes round
// until nothing changes.
function fill(text, vars) {
    let out = String(text);
    for (let pass = 0; pass < 5; pass++) {
        const next = out.replace(/\$\{(\w+)\}/g, (all, key) => (key in vars ? vars[key] : all));
        if (next === out) break;
        out = next;
    }
    return out;
}

// Wait until nothing finite is animating for two frames in a row (loops such as a spinner do not count).
const settle = (page, timeout = 4000) =>
    page
        .evaluate(
            (limit) =>
                new Promise((resolve) => {
                    const start = performance.now();
                    let calm = 0;
                    const tick = () => {
                        const busy = document.getAnimations().some((a) => {
                            const timing = a.effect?.getComputedTiming?.();
                            return a.playState === 'running' && timing && timing.iterations !== Infinity;
                        });
                        calm = busy ? 0 : calm + 1;
                        if (calm >= 2 || performance.now() - start > limit) resolve();
                        else requestAnimationFrame(tick);
                    };
                    requestAnimationFrame(tick);
                }),
            timeout
        )
        .catch(() => {});

// One opening, timed in the page: from the pointer going down to the target shown and then still.
async function timeOpening(page, click, appear) {
    await page.evaluate((selector) => {
        const run = { t0: 0, shown: 0, settled: 0, worst: 0, worstAt: 0, frames: [], done: false };
        window.__visualAuditTime = run;
        let last = 0;
        let still = 0;
        let restAt = 0;
        let box = '';
        const tick = (now) => {
            // the frame the press itself was handled in counts: its gap starts at the frame before the press
            if (run.t0 && last && now - last > run.worst) {
                run.worst = now - last;
                run.worstAt = now - run.t0;
            }
            last = now;
            if (run.t0) {
                run.frames.push(Math.round(now - run.t0));
                const el = document.querySelector(selector);
                const rect = el?.getBoundingClientRect();
                if (el && rect.width && rect.height) {
                    if (!run.shown && Number(getComputedStyle(el).opacity) > 0.2) run.shown = now - run.t0;
                    const moving = el
                        .getAnimations({ subtree: true })
                        .some((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity);
                    const next = [rect.x, rect.y, rect.width, rect.height].map(Math.round).join();
                    const resting = !moving && next === box;
                    if (resting && !still) restAt = now - run.t0;
                    still = resting ? still + 1 : 0;
                    box = next;
                    // three still frames confirm it; the time reported is the first of them
                    if (run.shown && still >= 3) {
                        run.settled = restAt;
                        run.done = true;
                        return;
                    }
                }
                if (now - run.t0 > 6000) {
                    run.done = true;
                    return;
                }
            }
            requestAnimationFrame(tick);
        };
        addEventListener('pointerdown', () => (run.t0 = performance.now()), { capture: true, once: true });
        requestAnimationFrame(tick);
    }, appear);
    await page.locator(click).first().click();
    await page.waitForFunction(() => window.__visualAuditTime?.done, null, { timeout: 8000 }).catch(() => {});
    const run = await page.evaluate(() => window.__visualAuditTime);
    const round = (value) => Math.round(value * 10) / 10;
    return {
        shown: round(run.shown),
        settled: round(run.settled),
        worstFrame: round(run.worst),
        worstAt: round(run.worstAt),
        frames: run.frames
    };
}

// The middle of several runs of one timing, with how far the runs spread.
const TIMED = ['shown', 'settled', 'worstFrame', 'worstAt'];
function summarize(runs) {
    const middle = (key) => {
        const values = runs.map((run) => run[key]).sort((a, b) => a - b);
        const half = values.length >> 1;
        return values.length % 2 ? values[half] : Math.round((values[half - 1] + values[half]) * 5) / 10;
    };
    const timing = Object.fromEntries(TIMED.map((key) => [key, middle(key)]));
    if (runs.length === 1) return { ...timing, frames: runs[0].frames };
    const spread = (key) => [Math.min(...runs.map((run) => run[key])), Math.max(...runs.map((run) => run[key]))];
    return {
        ...timing,
        runs: runs.length,
        range: Object.fromEntries(TIMED.slice(0, 3).map((key) => [key, spread(key)])),
        samples: runs.map(({ frames, ...run }) => run)
    };
}

const MEASURED = [
    'font-size',
    'line-height',
    'font-weight',
    'color',
    'background-color',
    'border-radius',
    'box-shadow',
    'backdrop-filter',
    'opacity'
];

// An element's box and the computed values of `props`.
const measure = (locator, props) =>
    locator.evaluate((el, names) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
            box: [box.x, box.y, box.width, box.height].map((value) => Math.round(value * 10) / 10),
            ...Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]))
        };
    }, props);

// Text against its real ground, from the element's rendered pixels (WCAG relative luminance).
async function contrastOf(page, locator) {
    const png = await locator.screenshot();
    return page.evaluate(async (data) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const linear = (channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        };
        const lums = new Float32Array(pixels.length / 4);
        const buckets = new Uint32Array(101);
        for (let i = 0; i < lums.length; i++) {
            const at = i * 4;
            const lum = 0.2126 * linear(pixels[at]) + 0.7152 * linear(pixels[at + 1]) + 0.0722 * linear(pixels[at + 2]);
            lums[i] = lum;
            buckets[Math.round(lum * 100)]++;
        }
        // the ground: the most common luminance, read over a small window so a gradient still has one peak
        let ground = 0;
        let most = -1;
        for (let b = 0; b <= 100; b++) {
            const count = (buckets[b - 1] ?? 0) + buckets[b] + (buckets[b + 1] ?? 0);
            if (count > most) {
                most = count;
                ground = b / 100;
            }
        }
        const sorted = Array.from(lums).sort((a, b) => a - b);
        const dark = sorted[Math.floor(sorted.length * 0.01)];
        const light = sorted[Math.floor(sorted.length * 0.99)];
        const ink = Math.abs(dark - ground) >= Math.abs(light - ground) ? dark : light;
        const ratio = (Math.max(ink, ground) + 0.05) / (Math.min(ink, ground) + 0.05);
        return { ratio: Math.round(ratio * 100) / 100, ground: Math.round(ground * 1000) / 1000, ink: Math.round(ink * 1000) / 1000 };
    }, png.toString('base64'));
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.scenarios || !args.out) {
        console.error('usage: node capture.mjs --scenarios <file.json> --out <dir> [--base url] [--only a,b] [--set k=v]');
        process.exit(1);
    }
    const file = JSON.parse(await readFile(args.scenarios[0], 'utf8'));
    const defaults = file.defaults ?? {};
    const base = (args.base?.[0] ?? file.base ?? 'http://localhost:5173').replace(/\/$/, '');
    const only = args.only ? new Set(args.only.flatMap((value) => value.split(','))) : null;
    const cli = Object.fromEntries((args.set ?? []).map((pair) => pair.split(/=(.*)/s).slice(0, 2)));
    const format = args.format?.[0] === 'jpeg' ? 'jpeg' : 'png';
    const quality = Number(args.quality?.[0] ?? 85);
    const out = path.resolve(args.out[0]);
    // --viewport replaces the table's default size (a scenario that names its own keeps it), so one table
    // makes the whole viewport matrix; --repeat runs each scenario that many times for its timings
    const size = args.viewport?.[0].split(/[x,]/).map(Number);
    const density = args.dpr ? Number(args.dpr[0]) : null;
    const repeat = Math.max(1, Number(args.repeat?.[0] ?? 1));
    const samples = {};
    await mkdir(out, { recursive: true });

    const { chromium } = loadPlaywright();
    const browser = await chromium.launch({
        channel: args.browser?.[0] ?? 'chrome',
        headless: !args.headed
    });
    const manifest = {
        base,
        takenAt: new Date().toISOString(),
        vars: { ...defaults.vars, ...cli },
        shots: [],
        timings: {},
        metrics: {},
        contrast: {},
        failed: []
    };

    const passes = file.scenarios
        .filter((scenario) => !only || only.has(scenario.name))
        // only a scenario that times something is worth running again
        .flatMap((scenario) => {
            const timed = (scenario.steps ?? []).some((step) => step.time);
            return Array.from({ length: timed ? repeat : 1 }, (_, pass) => ({ scenario, pass }));
        });
    for (const { scenario, pass } of passes) {
        const vars = { ...defaults.vars, ...scenario.vars, ...cli };
        const [width, height] = scenario.viewport ?? size ?? defaults.viewport ?? [1440, 900];
        const context = await browser.newContext({
            viewport: { width, height },
            deviceScaleFactor: scenario.dpr ?? density ?? defaults.dpr ?? 1,
            colorScheme: scenario.colorScheme ?? defaults.colorScheme ?? 'light'
        });
        const page = await context.newPage();
        await page.route('**/*', (route) => {
            const url = route.request().url();
            return url.startsWith(base) || /^(data|blob|about):/.test(url) ? route.continue() : route.abort();
        });
        const url = base + fill(scenario.url, vars);
        try {
            await page.goto(url, { waitUntil: 'load' });
            const ready = scenario.ready ?? defaults.ready;
            if (ready) await page.waitForFunction(fill(ready, vars), null, { timeout: 30000 });
            for (const step of scenario.steps ?? []) {
                const target = (selector) => {
                    const found = page.locator(fill(selector, vars));
                    return step.last ? found.last() : found.nth(step.nth ?? 0);
                };
                const position = step.at ? { position: { x: step.at[0], y: step.at[1] } } : {};
                // a timed opening carries a `click` of its own, so it is told apart first
                if (step.time) {
                    (samples[`${scenario.name}/${step.time}`] ||= []).push(
                        await timeOpening(page, fill(step.click, vars), fill(step.appear, vars))
                    );
                } else if (pass > 0 && (step.shot || step.measure || step.contrast)) {
                    // a repeated pass is there for its timings: the pictures and numbers of the first stand
                } else if (step.measure || step.contrast) {
                    // a number that cannot be taken (the selector is gone after a redesign) is reported and
                    // the scenario goes on: one stale selector must not cost every measurement after it
                    const label = `${scenario.name}/${step.measure ?? step.contrast}`;
                    const found = target(step.of);
                    try {
                        await found.waitFor({ state: 'visible', timeout: 4000 });
                        if (step.measure) manifest.metrics[label] = await measure(found, step.props ?? MEASURED);
                        else {
                            await settle(page);
                            manifest.contrast[label] = await contrastOf(page, found);
                        }
                    } catch (error) {
                        const why = String(error.message ?? error).split('\n')[0];
                        manifest.failed.push({ scenario: scenario.name, step: label, selector: step.of, error: why });
                        console.error(`MISSED ${label} (${step.of}): ${why}`);
                    }
                } else if (step.click) await target(step.click).click(position);
                else if (step.rclick) await target(step.rclick).click({ button: 'right', ...position });
                else if (step.dblclick) await target(step.dblclick).dblclick(position);
                else if (step.hover) await target(step.hover).hover(position);
                else if (step.focus) await target(step.focus).focus();
                else if (step.key) await page.keyboard.press(step.key);
                else if (step.type !== undefined) {
                    if (step.into) await target(step.into).click();
                    await page.keyboard.type(step.type);
                } else if (step.wait !== undefined) {
                    if (typeof step.wait === 'number') await page.waitForTimeout(step.wait);
                    else await page.locator(fill(step.wait, vars)).first().waitFor({ timeout: 15000 });
                } else if (step.eval) await page.evaluate(fill(step.eval, vars));
                else if (step.style) await page.addStyleTag({ content: step.style });
                else if (step.shot) {
                    await settle(page);
                    const type = step.format ?? format;
                    const name = `${scenario.name}${step.shot === true ? '' : `--${step.shot}`}.${type === 'jpeg' ? 'jpg' : 'png'}`;
                    let clip;
                    if (Array.isArray(step.clip)) {
                        const [x, y, w, h] = step.clip;
                        clip = { x, y, width: w, height: h };
                    } else if (step.clip) {
                        const box = await page.locator(fill(step.clip, vars)).first().boundingBox();
                        const pad = step.pad ?? 24;
                        if (box) {
                            const x = Math.max(0, box.x - pad);
                            const y = Math.max(0, box.y - pad);
                            clip = {
                                x,
                                y,
                                width: Math.min(width - x, box.width + pad * 2),
                                height: Math.min(height - y, box.height + pad * 2)
                            };
                        }
                    }
                    await page.screenshot({
                        path: path.join(out, name),
                        clip,
                        fullPage: !!step.full,
                        type,
                        ...(type === 'jpeg' ? { quality } : {})
                    });
                    manifest.shots.push({ file: name, scenario: scenario.name, viewport: [width, height], url });
                    console.log(`shot ${name}`);
                }
            }
        } catch (error) {
            manifest.failed.push({ scenario: scenario.name, error: String(error.message ?? error).split('\n')[0] });
            console.error(`FAILED ${scenario.name}: ${String(error.message ?? error).split('\n')[0]}`);
            await page.screenshot({ path: path.join(out, `${scenario.name}--FAILED.png`) }).catch(() => {});
        }
        await context.close();
    }
    await browser.close();
    for (const [label, runs] of Object.entries(samples)) manifest.timings[label] = summarize(runs);
    await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log(`${manifest.shots.length} shots, ${Object.keys(manifest.timings).length} timings, ${manifest.failed.length} failed → ${out}`);
    for (const [label, t] of Object.entries(manifest.timings)) {
        const spread = t.range ? ` (${t.runs} runs: settled ${t.range.settled.join('–')}, worst ${t.range.worstFrame.join('–')})` : '';
        console.log(
            `time ${label}: shown ${t.shown} ms, settled ${t.settled} ms, worst frame ${t.worstFrame} ms at ${t.worstAt} ms${spread}`
        );
    }
    for (const [label, c] of Object.entries(manifest.contrast)) console.log(`contrast ${label}: ${c.ratio}:1`);
    if (manifest.failed.length) process.exitCode = 2;
}

main();
