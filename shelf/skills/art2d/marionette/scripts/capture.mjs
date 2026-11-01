// capture.mjs — shoot a burst of frames from a web page while something animates, with headless
// Chromium (Playwright). Used by the verify stage: every transition gets looked at frame by frame,
// because a flicker or a ghost limb lasts 60 ms and no single screenshot catches it.
//
//   node capture.mjs --url http://localhost:5173/demo --out frames/pat --frames 14 \
//        --clip 520,20,460,400 --wait 4000 --trigger "window.rig.show('patted', true)"
//
// Options:
//   --url       page to open (required)
//   --out       folder for f00.png, f01.png, ... (required; emptied first)
//   --frames    how many frames (default 12); they are taken back to back, ~50-60 ms apart
//   --clip      x,y,w,h in CSS px (default: whole viewport)
//   --viewport  WxH (default 1440x900)
//   --wait      ms to wait after load before anything happens (default 3000)
//   --ready     JS expression to wait for instead of (after) the fixed wait, e.g. "window.ready"
//   --before    JS run once after the wait (hide dev panels, set a state)
//   --trigger   JS run right before the burst starts (the pose change under test)
//   --settle    ms to wait after --before, before the trigger (default 500)
//
// Playwright: resolved normally, or from the folder in $PLAYWRIGHT_NODE_MODULES.
// Prints the frame times (ms after the trigger) and any page errors; exit 1 on page errors.

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
    console.error('usage: node capture.mjs --url <page> --out <dir> [--frames 12] [--clip x,y,w,h] [--trigger js]');
    process.exit(2);
}
const pw = process.env.PLAYWRIGHT_NODE_MODULES
    ? require(path.join(process.env.PLAYWRIGHT_NODE_MODULES, 'playwright'))
    : require('playwright');

const [vw, vh] = (args.viewport ?? '1440x900').split('x').map(Number);
const clip = args.clip
    ? Object.fromEntries(['x', 'y', 'width', 'height'].map((k, i) => [k, Number(args.clip.split(',')[i])]))
    : undefined;
const frames = Number(args.frames ?? 12);
fs.rmSync(args.out, { recursive: true, force: true });
fs.mkdirSync(args.out, { recursive: true });

const browser = await pw.chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true });
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// the console's "Failed to load resource" names no URL; failed responses are logged below instead
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
try {
    await page.goto(args.url);
    await page.waitForTimeout(Number(args.wait ?? 3000));
    if (args.ready) await page.waitForFunction(args.ready, null, { timeout: 30000 });
} catch (e) {
    await fail('page never got ready', e);
}
try {
    if (args.before) {
        await page.evaluate(args.before);
        await page.waitForTimeout(Number(args.settle ?? 500));
    }
    if (args.trigger) await page.evaluate(args.trigger);
} catch (e) {
    await fail('--before / --trigger threw', e);
}
const t0 = Date.now();
const times = [];
for (let i = 0; i < frames; i++) {
    await page.screenshot({ path: path.join(args.out, `f${String(i).padStart(2, '0')}.png`), clip });
    times.push(Date.now() - t0);
}
await browser.close();
console.log('frame times (ms):', times.join(' '));
console.log(errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors');
process.exit(errors.length ? 1 : 0);
