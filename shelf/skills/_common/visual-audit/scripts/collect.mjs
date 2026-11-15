// collect.mjs — the numbers of several capture runs in one file that can be committed (visual-audit skill).
// The screenshot folders of a run stay out of the repository (they are big and can be taken again); what
// a report quotes is in each folder's manifest.json. This gathers them: one entry per folder, named after
// it, holding its viewport, variables, timings, metrics, contrast and what failed. The shots are counted,
// not listed.
//
// usage: node collect.mjs --out <file.json> <capture folder> [<capture folder> ...]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
if (at < 0 || !args[at + 1] || args.length < 3) {
    console.error('usage: node collect.mjs --out <file.json> <capture folder> [<capture folder> ...]');
    process.exit(1);
}
const out = args[at + 1];
const folders = args.filter((_, index) => index !== at && index !== at + 1);

const collected = {};
for (const folder of folders) {
    let manifest;
    try {
        manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'));
    } catch {
        console.error(`SKIPPED ${folder}: no manifest.json`);
        continue;
    }
    const { shots = [], vars, takenAt, timings = {}, metrics = {}, contrast = {}, failed = [] } = manifest;
    // a timing keeps its numbers; the per-frame list is only worth reading in the folder itself
    const brief = Object.fromEntries(Object.entries(timings).map(([label, { frames, samples, ...timing }]) => [label, timing]));
    collected[path.basename(path.resolve(folder))] = {
        takenAt,
        viewport: shots[0]?.viewport,
        vars: Object.fromEntries(Object.entries(vars ?? {}).filter(([, value]) => String(value).length < 40)),
        shots: shots.length,
        timings: brief,
        metrics,
        contrast,
        failed
    };
}
await writeFile(out, JSON.stringify(collected, null, 2) + '\n', 'utf8');
console.log(`${Object.keys(collected).length} runs → ${out}`);
