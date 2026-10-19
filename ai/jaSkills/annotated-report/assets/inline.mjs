// inline.mjs — inlines the annotation layer (annotate.js) into an HTML page as one <script data-annotate> tag, before
// </body> when the page has one, else at the end. Idempotent: a copy inlined earlier is replaced, not duplicated.
//   import { inlineAnnotate } from '<skill dir>/assets/inline.mjs';  html = inlineAnnotate(html, { source: 'docs/report.md' });
//   node <skill dir>/assets/inline.mjs <in.html> <out.html> [--source <text>] [--label <text>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// a script tag carrying the bare data-annotate attribute (not data-annotate-ui), through its closing tag
const INLINED = /<script\b[^>]*\sdata-annotate(?=[\s=>])[^>]*>[\s\S]*?<\/script\s*>\n?/gi;
const attribute = (value) =>
    String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The layer as it goes into pages: whole-line comments and indentation dropped (annotate.js keeps its multi-line
// strings free of both), and `</script` written as `<\/script`, which means the same to JavaScript but cannot end
// the tag early.
export function layerCode() {
    return fs
        .readFileSync(path.join(here, 'annotate.js'), 'utf8')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .map((line) => line.trim())
        .join('\n')
        .replace(/<\/(script)/gi, '<\\/$1');
}

// `source` is the page's source file in the repo (the copied list names it); `label` renames the 批注 button.
export function inlineAnnotate(html, { source, label } = {}) {
    const attrs = Object.entries({ 'data-source': source, 'data-label': label })
        .filter(([, value]) => value != null && value !== '')
        .map(([name, value]) => ` ${name}="${attribute(value)}"`)
        .join('');
    const tag = `<script data-annotate${attrs}>\n${layerCode().trim()}\n</script>\n`;
    const page = html.replace(INLINED, '');
    const end = page.toLowerCase().lastIndexOf('</body');
    return end < 0 ? `${page.trimEnd()}\n${tag}` : page.slice(0, end) + tag + page.slice(end);
}

// Run as a command, also through a symlinked skills folder: Node loads this module from its real path, while
// argv[1] keeps the link's path, so both sides are compared resolved.
const real = (file) => fs.realpathSync(path.resolve(file));
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
    const [files, options] = [[], {}];
    for (let i = 2; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (/^--(source|label)$/.test(arg) && i + 1 < process.argv.length) options[arg.slice(2)] = process.argv[++i];
        else files.push(arg);
    }
    if (files.length !== 2) {
        process.stderr.write('usage: node inline.mjs <in.html> <out.html> [--source <text>] [--label <text>]\n');
        process.exit(1);
    }
    fs.writeFileSync(files[1], inlineAnnotate(fs.readFileSync(files[0], 'utf8'), options));
    process.stdout.write(`${files[1]}\n`);
}
