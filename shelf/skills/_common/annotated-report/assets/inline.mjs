// inline.mjs — inlines the annotation layer (annotate.js) into an HTML page as one <script data-annotate> tag, before
// </body> when the page has one, else at the end. Idempotent: a copy inlined earlier is replaced, not duplicated.
//   import { inlineAnnotate } from '<skill dir>/assets/inline.mjs';  html = inlineAnnotate(html, { source: 'docs/report.html' });
//   node <skill dir>/assets/inline.mjs <in.html> <out.html> [--source <text>] [--agent <name>] [--label <text>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// a script tag carrying the bare data-annotate attribute (not data-annotate-ui), through its closing tag
const INLINED = /<script\b[^>]*\sdata-annotate(?=[\s=>])[^>]*>[\s\S]*?<\/script\s*>\n?/gi;
const attribute = (value) =>
    String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function inlineAnnotate(html, { source, agent, label } = {}) {
    // `</script` inside the code would end the tag early; `<\/script` means the same to JavaScript
    const code = fs.readFileSync(path.join(here, 'annotate.js'), 'utf8').replace(/<\/(script)/gi, '<\\/$1');
    const attrs = Object.entries({ 'data-source': source, 'data-agent': agent, 'data-label': label })
        .filter(([, value]) => value != null && value !== '')
        .map(([name, value]) => ` ${name}="${attribute(value)}"`)
        .join('');
    const tag = `<script data-annotate${attrs}>\n${code.trimEnd()}\n</script>\n`;
    const page = html.replace(INLINED, '');
    const end = page.toLowerCase().lastIndexOf('</body');
    return end < 0 ? `${page.trimEnd()}\n${tag}` : page.slice(0, end) + tag + page.slice(end);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [files, options] = [[], {}];
    for (let i = 2; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (/^--(source|agent|label)$/.test(arg) && i + 1 < process.argv.length)
            options[arg.slice(2)] = process.argv[++i];
        else files.push(arg);
    }
    if (files.length !== 2) {
        process.stderr.write('usage: node inline.mjs <in.html> <out.html> [--source <text>]\n');
        process.exit(1);
    }
    fs.writeFileSync(files[1], inlineAnnotate(fs.readFileSync(files[0], 'utf8'), options));
    process.stdout.write(`${files[1]}\n`);
}
