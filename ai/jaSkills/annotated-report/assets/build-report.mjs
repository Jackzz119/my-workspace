// build-report.mjs — turns a report written in a small Markdown dialect into a finished, annotatable page in one
// step: the dialect is rendered into a page template (report-template.html beside this file, or --template) and the
// annotation layer is inlined. The default template follows the claude.ai artifact page contract, so the output can
// be published as it is.
//   node <skill dir>/assets/build-report.mjs <src.md> <out.html> --title "…" --source "<repo path>"
//        [--template <file>] [--repo-url <base>]
//
// Dialect (blank lines separate blocks):
//   ## / ### headings with an optional {#id} (an id is made up when missing); a leading number (4.1 · 三、 · P1)
//     becomes the section's data-anchor, so notes there read [4.1]. A first line "# Title" stands in for --title.
//   paragraphs (lines join without a space between CJK text); - or 1. lists, nested by indent; | tables, the first
//     row is the head; fenced code with "lang title" after the fence: diff lines are coloured, shell blocks get a
//     copy button.
//   :::classes | anchor … ::: containers: lead (the summary, shown above the contents), card decision, callout.
//   {.class …} or {caption: …} alone on a line applies to the next list or table; {.bugs .p1} adds severity chips.
//   [[anchor]] at the start of a list item makes it an item of its own, with that anchor.
//   inline: `code`, **bold**, [label](href); a repo path links under --repo-url, otherwise it shows as code.
//
// Template placeholders: {title} {source} {date} {toc} {lead} {body}.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineAnnotate } from './inline.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HEAD = /^(#{2,4})\s+(.*?)(?:\s+\{#([^\s{}]+)\})?\s*$/;
const NUM = /^([一二三四五六七八九十百]+、|\d+(?:\.\d+)*\s|[A-Z]{1,3}-?\d+(?:\.\d+)*\s)/;
const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const ATTR = /^\{([^#].*)\}$/;
const SHELL = /^(bash|sh|shell|zsh|console|powershell|pwsh|ps1|cmd|bat)$/;
const WIDE = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/; // CJK text and full-width marks

const esc = (s) =>
    String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
const unesc = (s) =>
    s
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');
const indentOf = (line) => line.length - line.trimStart().length;
// paragraph lines join with a space, except where either side is CJK
const joinLines = (lines) => {
    let text = '';
    for (const line of lines) text += !text || WIDE.test(text.at(-1)) || WIDE.test(line[0]) ? line : ` ${line}`;
    return text;
};

/** Renders `source` (the dialect) to { title, toc, lead, body, stats }; `repoUrl` is the base for repo-path links. */
export function renderReport(source, { repoUrl = '' } = {}) {
    const base = repoUrl && !repoUrl.endsWith('/') ? `${repoUrl}/` : repoUrl;
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    let title = '';
    const first = lines.findIndex((line) => line.trim());
    if (first >= 0 && /^#\s+\S/.test(lines[first])) title = lines.splice(first, 1)[0].replace(/^#\s+/, '').trim();
    const toc = [];
    const state = { anchor: 'top', counts: new Map(), lead: null };
    const stats = { sections: 0, subsections: 0, items: 0, code: 0, tables: 0 };
    // explicit ids are reserved first, so a made-up id never takes one
    const ids = new Set(lines.map((line) => (line.match(HEAD) || [])[3]).filter(Boolean));
    let made = 0;
    const makeId = () => {
        while (ids.has(`h-${++made}`));
        ids.add(`h-${made}`);
        return `h-${made}`;
    };

    // inline markup: code spans (kept verbatim), **bold**, [label](href)
    const inline = (text) => {
        const codes = [];
        const restore = (s) => s.replace(/\x00(\d+)\x00/g, (_, k) => codes[+k]);
        const link = (label, href) => {
            const outside = /^[a-z][\w+.-]*:/i.test(href);
            if (href.startsWith('#')) return `<a href="${esc(href)}">${label}</a>`;
            if (outside || base) {
                const url = outside ? href : base + href.replace(/^\.?\//, '');
                return `<a href="${esc(url)}" target="_blank" rel="noopener">${label}</a>`;
            }
            // no repo URL: show the path as code, after the label when the label says more than the file name
            const name = unesc(restore(label).replace(/<[^>]+>/g, '')).trim();
            const file = href.split(/[#?]/)[0].split('/').filter(Boolean).pop() || href;
            const code = `<code>${esc(href)}</code>`;
            return [href, file, file.replace(/\.[^.]+$/, '')].includes(name) ? code : `${label} ${code}`;
        };
        let out = text.replace(/(`+)(.+?)\1/g, (_, ticks, body) => {
            codes.push(`<code>${esc(ticks.length > 1 ? body.trim() : body)}</code>`);
            return `\x00${codes.length - 1}\x00`;
        });
        out = esc(out).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => link(label, unesc(href)));
        return restore(out);
    };
    // the next anchor of a kind (c code, t table) within the current section: 4.1-c3
    const count = (kind) => {
        const key = `${state.anchor}\n${kind}`;
        state.counts.set(key, (state.counts.get(key) || 0) + 1);
        return `${state.anchor}-${kind}${state.counts.get(key)}`;
    };
    const parseAttrs = (spec) => {
        spec = spec.trim();
        if (spec.startsWith('caption:')) return { caption: spec.slice(8).trim() };
        return { class: spec.split(/\s+/).flatMap((c) => (c.startsWith('.') ? [c.slice(1)] : [])) };
    };

    const codeBlock = (info, body) => {
        const [lang = 'text', ...rest] = info.split(' ');
        const kind = lang || 'text';
        const anchor = count('c');
        stats.code++;
        let code, pre;
        if (kind === 'diff') {
            const type = (line) =>
                line.startsWith('+')
                    ? 'add'
                    : line.startsWith('-')
                      ? 'del'
                      : line.startsWith('@@')
                        ? 'hunk'
                        : line.startsWith('# ')
                          ? 'file'
                          : 'ctx';
            code = body.map((line) => `<span class="ln ${type(line)}">${line ? esc(line) : '&#8203;'}</span>`).join('');
            pre = 'diff';
        } else [code, pre] = [esc(body.join('\n')), 'plain'];
        const button = SHELL.test(kind)
            ? `<button class="copy" type="button" id="copy-${esc(anchor)}">复制</button>`
            : '';
        const caption = `<figcaption><span class="path">${esc(rest.join(' ').trim())}</span><span class="lang">${esc(kind)}</span>${button}</figcaption>`;
        return `<figure class="code" data-lang="${esc(kind)}" data-anchor="${esc(anchor)}">${caption}<pre class="${pre}"><code>${code}</code></pre></figure>`;
    };

    // a row's cells; a | inside a code span or written as \| stays in its cell
    const cells = (row) => {
        const out = [''];
        const text = row.trim().replace(/^\|/, '').replace(/\|$/, '');
        for (let i = 0, ticks = 0; i < text.length; i++) {
            const c = text[i];
            if (c === '\\' && text[i + 1] === '|') out[out.length - 1] += text[++i];
            else if (c === '|' && !ticks) out.push('');
            else {
                if (c === '`') ticks = ticks ? 0 : 1;
                out[out.length - 1] += c;
            }
        }
        return out.map((cell) => cell.trim());
    };
    const table = (rows, attrs) => {
        stats.tables++;
        const ruled = rows.length > 1 && /^\|?\s*:?-{2,}/.test(rows[1].trim());
        const [head, body] = [cells(rows[0]), rows.slice(ruled ? 2 : 1).map(cells)];
        const caption = attrs && attrs.caption ? `<caption>${inline(attrs.caption)}</caption>` : '';
        const thead = head.map((c) => `<th scope="col">${inline(c)}</th>`).join('');
        const tbody = body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
        return `<div class="table-wrap" data-anchor="${esc(count('t'))}"><table>${caption}<thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
    };

    const parseList = (lines, i, attrs) => {
        const first = lines[i].match(LIST);
        const base = first[1].length;
        const ordered = /\d/.test(first[2]);
        const start = ordered ? parseInt(first[2], 10) : 1;
        const sameKind = (m) => m && m[1].length === base && /\d/.test(m[2]) === ordered;
        const items = [];
        while (i < lines.length) {
            const line = lines[i];
            if (!line.trim()) {
                // a blank line: the list goes on when an indented line or another item of the same list follows
                let j = i + 1;
                while (j < lines.length && !lines[j].trim()) j++;
                if (j >= lines.length) break;
                if (indentOf(lines[j]) > base && items.length) {
                    items.at(-1).rest.push('');
                    i = j;
                    continue;
                }
                if (sameKind(lines[j].match(LIST))) {
                    i = j;
                    continue;
                }
                break;
            }
            const m = line.match(LIST);
            if (sameKind(m)) {
                items.push({ text: m[3], rest: [], indent: base + m[2].length + 1 });
                i++;
                continue;
            }
            if (indentOf(line) > base && items.length) {
                items.at(-1).rest.push(line.slice(Math.min(indentOf(line), items.at(-1).indent)));
                i++;
                continue;
            }
            break;
        }
        const classes = (attrs && attrs.class) || [];
        const level = classes.includes('bugs') && classes.find((c) => /^p\d$/.test(c));
        const tag = ordered ? 'ol' : 'ul';
        const out = [
            `<${tag}${classes.length ? ` class="${esc(classes.join(' '))}"` : ''}${ordered && start !== 1 ? ` start="${start}"` : ''}>`
        ];
        for (const item of items) {
            let text = item.text;
            const m = text.match(/^\[\[([^\]]+)\]\]\s*/);
            const anchor = m && m[1];
            if (m) text = text.slice(m[0].length);
            const body = inline(text) + (item.rest.some((l) => l.trim()) ? parse(item.rest) : '');
            if (anchor) stats.items++;
            const attr = anchor ? ` class="item" id="${esc(anchor)}" data-anchor="${esc(anchor)}"` : '';
            if (level && anchor)
                out.push(
                    `<li${attr}><span class="sev">${level.toUpperCase()}</span><div class="bug-body">${body}</div></li>`
                );
            else out.push(`<li${attr}>${body}</li>`);
        }
        out.push(`</${tag}>`);
        return [out.join(''), i];
    };

    const startsBlock = (line) => {
        const s = line.trim();
        return HEAD.test(line) || LIST.test(line) || /^(```|\||:::)/.test(s) || ATTR.test(s);
    };
    // a heading's anchor (its number, else its id) and inner HTML; ## and ### join the contents
    const heading = (level, raw, id) => {
        const m = raw.match(NUM);
        const num = m ? m[1].trim() : '';
        const rest = m ? raw.slice(m[0].length) : raw;
        const gap = num.endsWith('、') ? '' : ' ';
        const inner = (num ? `<span class="num">${esc(num)}</span>${gap}` : '') + inline(rest);
        let plain = rest
            .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
            .replace(/\*\*|`/g, '')
            .trim();
        if (level === 3) plain = plain.split(/[：（]/)[0].trim();
        const label = num ? num + gap + plain : plain;
        if (id) toc.push([level, id, label]);
        return [num.replace(/、$/, '') || id || '', inner];
    };
    const container = (classes, anchor, inner) => {
        const previous = state.anchor;
        if (anchor) state.anchor = anchor;
        const lead = classes.includes('lead');
        const entry = lead && [2, 'lead', anchor || '结论'];
        if (entry) toc.push(entry);
        const body = parse(inner);
        state.anchor = previous;
        const head = lead ? `<h2 id="lead" class="lead-title">${esc(anchor || '结论')}</h2>` : '';
        const html = `<div class="${esc(classes.join(' '))}"${anchor ? ` data-anchor="${esc(anchor)}"` : ''}>${head}${body}</div>`;
        if (!lead || state.lead) return html;
        // the first lead goes above the contents, and its entry to the top of them
        toc.splice(toc.indexOf(entry), 1);
        toc.unshift(entry);
        state.lead = html;
        return '';
    };

    function parse(lines, top = false) {
        const out = [];
        let attrs = null;
        let [openSec, openSub] = [false, false];
        for (let i = 0; i < lines.length; ) {
            const line = lines[i];
            const s = line.trim();
            if (!s) {
                i++;
                continue;
            }
            const am = s.match(ATTR);
            if (am) {
                attrs = parseAttrs(am[1]);
                i++;
                continue;
            }
            if (s.startsWith('```')) {
                // a fence closes only on a line of backticks at least as long as the opening one (CommonMark), so
                // a block can quote ``` lines by opening with four or more backticks
                const fence = s.match(/^`+/)[0];
                const closes = (line) => /^`+$/.test(line.trim()) && line.trim().length >= fence.length;
                let j = i + 1;
                const body = [];
                while (j < lines.length && !closes(lines[j])) body.push(lines[j++]);
                out.push(codeBlock(s.slice(fence.length).trim(), body));
                [i, attrs] = [j + 1, null];
                continue;
            }
            if (s.startsWith(':::') && s !== ':::') {
                const spec = s.slice(3);
                const bar = spec.includes('|') ? spec.indexOf('|') : spec.length;
                let j = i + 1;
                const inner = [];
                while (j < lines.length && lines[j].trim() !== ':::') inner.push(lines[j++]);
                const classes = spec.slice(0, bar).trim().split(/\s+/).filter(Boolean);
                out.push(container(classes, spec.slice(bar + 1).trim(), inner));
                i = j + 1;
                continue;
            }
            const hm = line.match(HEAD);
            if (hm) {
                const level = hm[1].length;
                const id = hm[3] || (level <= 3 ? makeId() : '');
                const [anchor, inner] = heading(level, hm[2], id);
                if (top && level === 2) {
                    if (openSub) out.push('</section>');
                    if (openSec) out.push('</section>');
                    out.push(`<section class="sec" id="${esc(id)}" data-anchor="${esc(anchor)}"><h2>${inner}</h2>`);
                    [openSec, openSub, state.anchor] = [true, false, anchor];
                    stats.sections++;
                } else if (top && level === 3) {
                    if (openSub) out.push('</section>');
                    out.push(`<section class="sub" id="${esc(id)}" data-anchor="${esc(anchor)}"><h3>${inner}</h3>`);
                    [openSub, state.anchor] = [true, anchor];
                    stats.subsections++;
                } else out.push(`<h${level}${id ? ` id="${esc(id)}"` : ''}>${inner}</h${level}>`);
                i++;
                continue;
            }
            if (s.startsWith('|')) {
                let j = i;
                const rows = [];
                while (j < lines.length && lines[j].trim().startsWith('|')) rows.push(lines[j++]);
                out.push(table(rows, attrs));
                [i, attrs] = [j, null];
                continue;
            }
            if (LIST.test(line)) {
                const [block, next] = parseList(lines, i, attrs);
                out.push(block);
                [i, attrs] = [next, null];
                continue;
            }
            let j = i;
            const para = [];
            while (j < lines.length && lines[j].trim() && !startsBlock(lines[j])) para.push(lines[j++].trim());
            out.push(`<p>${inline(joinLines(para))}</p>`);
            i = j;
        }
        if (openSub) out.push('</section>');
        if (openSec) out.push('</section>');
        return out.join('');
    }

    const body = parse(lines, true);
    return { title, toc: tocHtml(toc), entries: toc.length, lead: state.lead || '', body, stats };
}

// the contents: ## entries, each with its ### entries nested
function tocHtml(toc) {
    const out = ['<ol>'];
    let [inChild, started] = [false, false];
    for (const [level, id, label] of toc) {
        const a = `<a href="#${esc(id)}">${esc(label)}</a>`;
        if (level === 2) {
            if (inChild) out.push('</ol>');
            if (started) out.push('</li>');
            out.push(`<li>${a}`);
            [inChild, started] = [false, true];
        } else {
            if (!inChild) out.push('<ol>');
            out.push(`<li>${a}</li>`);
            inChild = true;
        }
    }
    if (inChild) out.push('</ol>');
    if (started) out.push('</li>');
    out.push('</ol>');
    return out.join('');
}

/** The finished page: `markdown` rendered into `template`, with the annotation layer inlined. */
export function buildReport(markdown, { title, source = '', template, repoUrl } = {}) {
    const report = renderReport(markdown, { repoUrl });
    const shell = template ?? fs.readFileSync(path.join(here, 'report-template.html'), 'utf8');
    const now = new Date();
    const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
        .map((n) => String(n).padStart(2, '0'))
        .join('-');
    const values = {
        title: esc(title || report.title || 'Report'),
        source: esc(source),
        date,
        toc: report.toc,
        // a template without {lead} still shows the summary, at the top of the body
        lead: report.lead,
        body: shell.includes('{lead}') ? report.body : report.lead + report.body
    };
    // one pass, so text inside the report that looks like a placeholder stays as written
    const page = shell.replace(/\{(title|source|date|toc|lead|body)\}/g, (_, key) => values[key]);
    return { html: inlineAnnotate(page, { source }), report };
}

const real = (file) => fs.realpathSync(path.resolve(file));
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
    const [files, options] = [[], {}];
    const flags = { '--title': 'title', '--source': 'source', '--template': 'template', '--repo-url': 'repoUrl' };
    for (let i = 2; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (flags[arg] && i + 1 < process.argv.length) options[flags[arg]] = process.argv[++i];
        else files.push(arg);
    }
    if (files.length !== 2) {
        process.stderr.write(
            'usage: node build-report.mjs <src.md> <out.html> --title "…" --source "<repo path>" [--template <file>] [--repo-url <base>]\n'
        );
        process.exit(1);
    }
    if (options.template) options.template = fs.readFileSync(options.template, 'utf8');
    const { html, report } = buildReport(fs.readFileSync(files[0], 'utf8'), options);
    fs.mkdirSync(path.dirname(path.resolve(files[1])), { recursive: true });
    fs.writeFileSync(files[1], html);
    const summary = { page: path.resolve(files[1]), bytes: Buffer.byteLength(html), contents: report.entries };
    process.stdout.write(`${JSON.stringify({ ...summary, ...report.stats })}\n`);
}
