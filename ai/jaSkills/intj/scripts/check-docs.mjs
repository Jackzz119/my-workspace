// Repo-wide documentation integrity check: Markdown links, #anchors and backticked repo paths in tracked docs,
// plus size budgets for the docs agents load every session.
// Living docs must be clean; frozen originals (research, archives, raw batches, audit evidence) are reported apart
// and never need rewriting. Reads only tracked files (git ls-files) of the repo the command runs in.
// Project settings live in ai/check-docs.json (see DEFAULTS for the fields); without it every doc is living.
// Exits 1 on a living-doc failure or a doc over its budget. Needs Node and git.
// node <skill>/scripts/check-docs.mjs [--json] [--all] [--config <file>]   (--all also lists frozen-doc failures)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const args = new Set(argv);
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

// Every field is optional. Patterns are regular-expression sources matched against repo-relative paths.
const DEFAULTS = {
    skipped: ['^ai/sessions/', '^node_modules/'], // never read (manual archives, dependencies)
    frozen: [], // originals kept as delivered: their old paths are provenance, not instructions
    ignoredTargets: [], // generated or ignored paths: naming them in prose is not a broken reference
    accepted: [], // `file:target` references that never resolve here, accepted on purpose
    pathHeads: null, // top-level folders whose backticked paths are checked; null = every tracked top-level folder
    rootFiles: null, // root files whose backticked names are checked; null = every tracked root file
    skillRoots: '^ai/jaSkills/[^/]+', // docs under these folders may name files relative to that folder
    budgets: {} // repo-relative doc -> maximum UTF-8 bytes
};
const configIndex = argv.indexOf('--config');
const configPath = configIndex >= 0 ? path.resolve(argv[configIndex + 1]) : path.join(root, 'ai/check-docs.json');
const config = { ...DEFAULTS, ...(fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {}) };
const regexes = (list) => list.map((source) => new RegExp(source));
const SKIPPED = regexes(config.skipped);
const FROZEN = regexes(config.frozen);
const IGNORED_TARGETS = regexes(config.ignoredTargets);
const ACCEPTED = new Set(config.accepted);
const SKILL_ROOT = config.skillRoots ? new RegExp(config.skillRoots) : null;
const PLACEHOLDER = /[<>*{}$…|]|\.\.\.|xxx|XXX/;
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A path with forward slashes on every platform.
const slash = (value) => value.split(path.sep).join('/');
// Whether a repo-relative doc is a frozen original (reported apart, never rewritten).
const isFrozen = (rel) => FROZEN.some((re) => re.test(rel));
// tracked files still on disk (a file deleted but not yet committed counts as gone)
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((rel) => rel && !SKIPPED.some((re) => re.test(rel)) && fs.existsSync(path.join(root, rel)));
const trackedSet = new Set(tracked);
const trackedDirs = new Set(
    tracked.flatMap((rel) =>
        rel
            .split('/')
            .slice(0, -1)
            .map((_, i, parts) => parts.slice(0, i + 1).join('/'))
    )
);
const heads = config.pathHeads ?? [...new Set(tracked.filter((rel) => rel.includes('/')).map((rel) => rel.split('/')[0]))];
const rootFiles = config.rootFiles ?? tracked.filter((rel) => !rel.includes('/'));
const PATH_HEADS = new RegExp(`^(${heads.map(escape).join('|')})/`);
const ROOT_FILES = new RegExp(`^(${rootFiles.map(escape).join('|')})$`);
// Whether a repo-relative path names a tracked file, a folder holding tracked files, or anything on disk.
const exists = (rel) =>
    trackedSet.has(rel) || trackedDirs.has(rel.replace(/\/$/, '')) || fs.existsSync(path.join(root, rel));

// GitHub-style heading anchors: lower-case, drop everything but letters, marks, numbers, spaces, '-' and '_'.
const slugger = () => {
    const seen = new Map();
    return (text) => {
        const base = text
            .toLowerCase()
            .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
            .replace(/ /g, '-');
        const count = seen.get(base) || 0;
        seen.set(base, count + 1);
        return count ? `${base}-${count}` : base;
    };
};
// A heading's text as GitHub slugs it: images dropped, links / tags / code / emphasis reduced to their text.
const plainHeading = (raw) =>
    raw
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/(\*\*|__|\*|_|~~)/g, '')
        .trim();

const anchorCache = new Map();
// Every anchor a doc offers (cached): explicit id / name attributes, plus heading slugs outside code fences
// in Markdown.
const anchorsOf = (rel) => {
    if (anchorCache.has(rel)) return anchorCache.get(rel);
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    const ids = new Set();
    for (const match of text.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/g)) ids.add(match[1]);
    if (rel.endsWith('.md')) {
        const slug = slugger();
        let fenced = false;
        for (const line of text.split(/\r?\n/)) {
            if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
            if (fenced) continue;
            const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
            if (heading) ids.add(slug(plainHeading(heading[1])));
        }
    }
    anchorCache.set(rel, ids);
    return ids;
};

// Strip fenced blocks, keep line numbers; return [{line, text}] without code fences.
const proseLines = (text) => {
    const out = [];
    let fenced = false;
    text.split(/\r?\n/).forEach((line, index) => {
        if (/^\s*(```|~~~)/.test(line)) {
            fenced = !fenced;
            return;
        }
        if (!fenced) out.push({ line: index + 1, text: line });
    });
    return out;
};

const failures = [];
let links = 0;
let anchors = 0;
let paths = 0;
const docs = tracked.filter((rel) => rel.endsWith('.md'));
for (const rel of docs) {
    const frozen = isFrozen(rel);
    const dir = path.posix.dirname(rel);
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    // record a failure in this doc, unless the config accepts it
    const report = (line, kind, target, detail = '') => {
        if (!ACCEPTED.has(`${rel}:${target}`)) failures.push({ file: rel, line, kind, target, detail, frozen });
    };
    for (const { line, text: content } of proseLines(text)) {
        const withoutCode = content.replace(/`[^`]*`/g, '');
        const refs = [
            ...[...withoutCode.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g)].map(
                (m) => m[1] || m[2]
            ),
            ...[...withoutCode.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/g)].map((m) => m[1]),
            ...[...withoutCode.matchAll(/<(?:a|img|video|source)\b[^>]*\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map(
                (m) => m[1]
            )
        ];
        for (const ref of refs) {
            if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || /[${}]/.test(ref)) continue;
            links++;
            const [targetPart, hash] = ref.split('#');
            let target = rel;
            if (targetPart) {
                const decoded = decodeURIComponent(targetPart.split('?')[0]);
                target = decoded.startsWith('/')
                    ? decoded.slice(1)
                    : path.posix.normalize(path.posix.join(dir, decoded));
                if (!exists(target) && decoded.startsWith('/') && exists(`public/${decoded.slice(1)}`))
                    target = `public/${decoded.slice(1)}`;
            }
            if (!exists(target)) {
                report(line, 'broken-link', ref);
                continue;
            }
            if (hash && /\.(md|html)$/.test(target) && fs.statSync(path.join(root, target)).isFile()) {
                anchors++;
                if (
                    !anchorsOf(target).has(decodeURIComponent(hash).toLowerCase()) &&
                    !anchorsOf(target).has(decodeURIComponent(hash))
                )
                    report(line, 'missing-anchor', ref, target);
            }
        }
        for (const match of content.matchAll(/`([^`\n]+)`/g)) {
            let candidate = match[1].trim().replace(/^\.\//, '');
            candidate = candidate
                .replace(/[，。、；：,;:）)]+$/, '')
                .replace(/:\d+(-\d+)?$/, '')
                .replace(/#.*$/, '')
                .replace(/\s+§.*$/, '');
            if (
                !(PATH_HEADS.test(candidate) || ROOT_FILES.test(candidate)) ||
                /\s/.test(candidate) ||
                PLACEHOLDER.test(candidate)
            )
                continue;
            if (IGNORED_TARGETS.some((re) => re.test(candidate))) continue;
            paths++;
            // Skill docs name files relative to their skill root (e.g. `scripts/rig.py` inside a skill).
            const skillRoot = SKILL_ROOT ? rel.match(SKILL_ROOT)?.[0] : undefined;
            const bases = ['', dir, skillRoot].filter((base) => base !== undefined);
            if (!bases.some((base) => exists(path.posix.normalize(path.posix.join(base, candidate)))))
                report(line, 'missing-path', candidate);
        }
    }
}

// A doc over its budget is regrowing: rewrite it to the current state instead of raising the number.
const overBudget = Object.entries(config.budgets)
    .filter(([rel]) => fs.existsSync(path.join(root, rel)))
    .map(([rel, budget]) => ({ rel, budget, bytes: fs.statSync(path.join(root, rel)).size }))
    .filter(({ bytes, budget }) => bytes > budget);

const living = failures.filter((f) => !f.frozen);
const frozen = failures.filter((f) => f.frozen);
const summary = {
    documents: docs.length,
    frozenDocuments: docs.filter(isFrozen).length,
    checkedLinks: links,
    checkedAnchors: anchors,
    checkedPaths: paths,
    livingFailures: living.length,
    frozenFailures: frozen.length,
    overBudget: overBudget.length,
    config: fs.existsSync(configPath) ? slash(path.relative(root, configPath)) : null
};
if (args.has('--json')) {
    process.stdout.write(
        `${JSON.stringify({ summary, living, overBudget, frozen: args.has('--all') ? frozen : undefined }, null, 2)}\n`
    );
} else {
    // one line per failure: file:line, kind, target and any detail
    const print = (list) =>
        list.forEach((f) =>
            process.stdout.write(`  ${f.file}:${f.line}  ${f.kind}  ${f.target}${f.detail ? `  (${f.detail})` : ''}\n`)
        );
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (living.length) {
        process.stdout.write('living docs:\n');
        print(living);
    }
    if (frozen.length && args.has('--all')) {
        process.stdout.write('frozen originals (provenance, not fixed):\n');
        print(frozen);
    }
    for (const { rel, bytes, budget } of overBudget)
        process.stdout.write(`over budget: ${rel} ${bytes} B > ${budget} B — rewrite to the current state\n`);
}
if (living.length || overBudget.length) process.exitCode = 1;
