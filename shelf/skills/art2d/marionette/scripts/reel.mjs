// reel.mjs — render a page's animation frame by frame on a virtual clock and save every frame, for a
// GIF whose timing is the runtime's own: a comparison of candidates, a demo of a character's motions.
// capture.mjs shoots a real-time burst (good for catching a 60 ms flicker); this one steps the clock,
// so the frames are exactly 1000 / fps ms apart however long each screenshot takes.
//
// The page drives its runtime from an outside clock and exposes
//
//   window.reel = { duration: <ms>, at: (ms) => void | Promise<void> }
//
// where at(ms) puts every animation at that moment and renders once (rig-core only reads `nowMs`, so a
// lab's adapter hands it the virtual time instead of performance.now()). Resolve the promise after the
// render is on screen (a requestAnimationFrame) if the page renders asynchronously.
//
//   node reel.mjs --url http://localhost:5173/lab/stage.html?v=a --out reels/a-near --fps 20 --scale 2 \
//        --clip 0,0,480,400
//   python sheet.py reels/a-near --gif --fps 20
//
// Options:
//   --url       page to open (required)
//   --out       folder for f0000.png, f0001.png, ... (required; emptied first)
//   --fps       frames per virtual second (default 20; a GIF times in 10 ms steps, so 20 or 25 keep it exact)
//   --from      first virtual ms (default 0)
//   --to        virtual ms to stop before (default window.reel.duration): a looping reel's end is its start
//   --clip      x,y,w,h in CSS px (default: whole viewport)
//   --viewport  WxH in CSS px (default 1280x800)
//   --scale     device pixel ratio (default 1); a close-up wants 2
//   --ready     JS expression to wait for (default "window.reel")
//   --before    JS run once before the first frame (pick a variant, hide the controls)
//
// Playwright: resolved normally, or from the folder in $PLAYWRIGHT_NODE_MODULES; $PLAYWRIGHT_CHANNEL picks an
// installed browser (e.g. chrome) when Playwright's own Chromium is not installed.
// Writes reel.json (fps, range, frame count) next to the frames; exit 1 on page errors.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = Object.fromEntries(
    process.argv
        .slice(2)
        .reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
if (!args.url || !args.out) {
    console.error('usage: node reel.mjs --url <page> --out <dir> [--fps 20] [--scale 2] [--clip x,y,w,h]');
    process.exit(2);
}
const pw = process.env.PLAYWRIGHT_NODE_MODULES
    ? require(path.join(process.env.PLAYWRIGHT_NODE_MODULES, 'playwright'))
    : require('playwright');

const [vw, vh] = (args.viewport ?? '1280x800').split('x').map(Number);
const clip = args.clip
    ? Object.fromEntries(['x', 'y', 'width', 'height'].map((k, i) => [k, Number(args.clip.split(',')[i])]))
    : undefined;
const fps = Number(args.fps ?? 20);
fs.rmSync(args.out, { recursive: true, force: true });
fs.mkdirSync(args.out, { recursive: true });

const browser = await pw.chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true });
const page = await browser.newPage({
    viewport: { width: vw, height: vh },
    deviceScaleFactor: Number(args.scale ?? 1)
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on(
    'console',
    (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text())
);
page.on(
    'response',
    (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errors.push(`HTTP ${r.status()} ${r.url()}`)
);
page.on('requestfailed', (r) => errors.push(`request failed ${r.url()}: ${r.failure()?.errorText}`));
const fail = async (what, e) => {
    console.error(`${what}: ${e.message.split('\n')[0]}`);
    console.error(errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors were reported');
    await browser.close();
    process.exit(1);
};

let duration;
try {
    await page.goto(args.url);
    await page.waitForFunction(args.ready ?? 'window.reel', null, { timeout: 60000 });
    if (args.before) await page.evaluate(args.before);
    duration = await page.evaluate(() => window.reel.duration);
} catch (e) {
    await fail('page never got ready', e);
}
const from = Number(args.from ?? 0);
const to = Number(args.to ?? duration);
const count = Math.max(1, Math.round(((to - from) * fps) / 1000));
const started = Date.now();
try {
    for (let i = 0; i < count; i++) {
        await page.evaluate((ms) => window.reel.at(ms), from + (i * 1000) / fps);
        await page.screenshot({ path: path.join(args.out, `f${String(i).padStart(4, '0')}.png`), clip });
    }
} catch (e) {
    await fail('a frame failed', e);
}
await browser.close();
fs.writeFileSync(path.join(args.out, 'reel.json'), JSON.stringify({ fps, from, to, count }, null, 4) + '\n');
console.log(`${count} frames at ${fps} fps (${from}–${to} ms) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors');
process.exit(errors.length ? 1 : 0);
