// annotate.js — annotation layer for HTML report pages (ES2020, no dependencies; inline it with ./inline.mjs, which
// drops whole-line comments and indentation, so multi-line strings here hold neither). Note selected text, a tapped
// element or nothing (留言); notes stay marked on the page and copy out as one compact list to paste into any
// agent's chat. Where the page is a claude.ai artifact published with capabilities {db: {}}, every note is also a
// document in that artifact's own database (collection `annotations`): it survives cleared browser storage and an
// expired session, follows the reader to other devices, and an agent reads and clears it there. localStorage
// (keyed by data-source and title) is the cache and, anywhere else, the only store.
(() => {
    'use strict';
    if (window.__annotate) return;
    const tag = document.currentScript || document.querySelector('script[data-annotate]');
    const opt = (name, fallback) => (tag && tag.getAttribute('data-' + name)) || fallback;
    const cfg = { source: opt('source', ''), label: opt('label', '批注') };
    const HEADS = 'h2,h3,h4,h5,h6'; // the h1 is the page title
    const BLOCK = `[data-anchor],figure,img,video,svg,tr,li,p,pre,blockquote,h1,${HEADS}`;
    const CARD = /(^|\s)[\w-]*(card|decision|item)(\s|$)/i;
    const TOP = /^(html|body|main)$/;
    const NUM = /^(?:§\s*)?(\d+(?:\.\d+)*|[一二三四五六七八九十百]+(?=、)|[A-Z]{1,3}-?\d+(?:\.\d+)*)/; // 4.1 三 E1 PA-071
    const HL = !!(window.CSS && CSS.highlights && window.Highlight); // text marks; without it the block gets a pin
    const S = { notes: [], marks: new Map(), maps: new Map(), pinned: [], marked: [] };
    let root, ring, pins, chip, banner, pill, list, badge, scrim, toastEl, hovered, raf, timer;

    const DARK = `--ann-bg:#27242c;--ann-fg:#f3eee6;--ann-mute:#aea6b4;--ann-line:#ffffff2e;--ann-soft:#35313b;--ann-hi:#f2a65e;
--ann-ink:#24170b;--ann-ring:#f6a55c;--ann-wash:#f6a55c24;--ann-bad:#ff8f86;--ann-sh:0 12px 32px -10px #000d;color-scheme:dark`;
    const STYLE = `[data-annotate-ui]{all:revert;box-sizing:border-box;font:inherit;-webkit-tap-highlight-color:transparent}
[data-annotate-ui][hidden]{display:none!important}
[data-annotate-ui]:focus-visible{outline:2px solid var(--ann-ring);outline-offset:2px}
.ann-root{position:absolute;left:0;top:0;z-index:2147483000;color-scheme:light;--ann-bg:#fffdf9;--ann-fg:#25222a;--ann-mute:#68626e;
--ann-line:#25222a29;--ann-soft:#f2ede5;--ann-hi:#b8551a;--ann-ink:#fff;--ann-ring:#e8742a;--ann-wash:#e8742a1f;--ann-bad:#b3261e;
--ann-sh:0 12px 32px -10px #0007;--ann-b:max(14px,env(safe-area-inset-bottom));color:var(--ann-fg);
font:15px/1.55 system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .ann-root{${DARK}}}
:root[data-theme=dark] .ann-root{${DARK}}
::highlight(ann){background-color:#ffbf0047}
::highlight(ann-now){background-color:#ff8c00a6}
[data-ann-mark]{outline:2px dashed #e8742ab3;outline-offset:3px}
.ann-btn,.ann-panel,.ann-ta,.ann-item{border:1px solid var(--ann-line);background:var(--ann-bg);color:var(--ann-fg)}
.ann-btn,.ann-chip,.ann-pin,.ann-x,.ann-link,.ann-jump{cursor:pointer;touch-action:manipulation}
.ann-dock .ann-btn,.ann-panel,.ann-banner,.ann-toast,.ann-chip{box-shadow:var(--ann-sh)}
.ann-dock{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:var(--ann-b);display:flex;gap:8px}
.ann-btn{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 16px;border-radius:22px;font-weight:600}
.ann-dock .ann-btn{min-width:44px;min-height:44px}
.ann-pill[aria-pressed=true],.ann-primary,.ann-pin,.ann-badge{border-color:transparent;background:var(--ann-hi);color:var(--ann-ink)}
.ann-badge{min-width:20px;padding:0 6px;border-radius:10px;font-size:12px;line-height:20px;text-align:center}
.ann-banner,.ann-toast,.ann-chip{position:fixed;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100vw - 24px);
padding:8px 14px;border:0;border-radius:18px;background:var(--ann-fg);color:var(--ann-bg);font-size:14px;text-align:center}
.ann-banner,.ann-toast,.ann-ring{pointer-events:none}
.ann-banner{top:max(10px,env(safe-area-inset-top));font-size:13px}
.ann-toast{z-index:1;bottom:calc(var(--ann-b) + 58px)}
.ann-chip{position:absolute;transform:none;min-height:40px;padding:0 16px;font-weight:600}
.ann-ring{position:absolute;border:2px solid var(--ann-ring);border-radius:8px;background:var(--ann-wash)}
.ann-flash{animation:ann-flash .8s ease-out 2}
@keyframes ann-flash{from{box-shadow:0 0 0 0 var(--ann-ring)}to{box-shadow:0 0 0 14px transparent;opacity:0}}
.ann-pin{position:absolute;width:24px;height:24px;padding:0;border:2px solid var(--ann-bg);border-radius:12px;font-size:12px;
font-weight:700;line-height:20px}
.ann-scrim{position:fixed;inset:0;background:#0007}
.ann-panel{display:flex;flex-direction:column;gap:10px;padding:14px 16px 16px;border-radius:14px;overflow:auto;overscroll-behavior:contain}
.ann-pop{position:absolute;width:min(380px,calc(100vw - 16px));max-height:min(72vh,560px)}
.ann-side{position:fixed;right:14px;bottom:70px;width:400px;max-height:74vh}
.ann-sheet{position:fixed;left:0;right:0;bottom:0;max-height:80vh;border-radius:16px 16px 0 0;padding-bottom:var(--ann-b)}
.ann-head,.ann-row,.ann-meta{display:flex;align-items:center;gap:8px}
.ann-row{flex-wrap:wrap;justify-content:flex-end}
.ann-head>:first-child,.ann-meta>:first-child{flex:1}
.ann-loc,.ann-hint{margin:0;font-size:13px;color:var(--ann-mute)}
.ann-loc,.ann-quote,.ann-note{overflow-wrap:anywhere}
.ann-hint:empty{display:none}
.ann-x{width:36px;height:36px;margin:-8px -10px -8px 0;border:0;background:none;color:var(--ann-mute);font-size:17px}
.ann-jump{display:block;width:100%;padding:0;border:0;background:none;color:inherit;text-align:left}
.ann-quote{margin:0;padding:6px 10px;border-left:3px solid var(--ann-ring);border-radius:4px;background:var(--ann-soft);font-size:14px;
display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden}
.ann-ta{display:block;width:100%;min-height:96px;padding:10px 12px;border-radius:10px;font-size:16px;resize:vertical}
.ann-btn:disabled{opacity:.45;cursor:default}
.ann-items{display:grid;gap:10px;margin:0;padding:0;list-style:none}
.ann-item{display:grid;gap:6px;padding:6px 12px 10px;border-radius:10px}
.ann-on{border-color:var(--ann-ring);box-shadow:0 0 0 3px var(--ann-wash)}
.ann-note{white-space:pre-wrap}
.ann-drawer>.ann-acts{position:sticky;bottom:0;padding-top:8px;background:var(--ann-bg);box-shadow:0 40px var(--ann-bg)}
.ann-link{min-height:36px;padding:0 8px;border:0;background:none;color:var(--ann-hi);font-size:14px}
.ann-bad{color:var(--ann-bad)}
html[data-annotating] body :not([data-annotate-ui]){cursor:pointer!important}
@media (pointer:coarse){html[data-annotating] body :not([data-annotate-ui]){-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.ann-btn,.ann-chip,.ann-link{min-height:44px}}
@media (prefers-reduced-motion:reduce){.ann-flash{animation:none}}`;
    // static markup; page and reader text goes in through textContent only
    const X = '<button type="button" class="ann-x" aria-label="关闭">✕</button>';
    const ROOT = `<div class="ann-root"><style>${STYLE}</style><div class="ann-pins"></div><div class="ann-ring" hidden></div><button type="button" class="ann-chip" hidden>批注这段</button><div class="ann-banner" hidden></div><div class="ann-dock"><button type="button" class="ann-btn ann-free">留言</button><button type="button" class="ann-btn ann-list" hidden>清单<span class="ann-badge"></span></button><button type="button" class="ann-btn ann-pill" aria-pressed="false"></button></div><div class="ann-toast" role="status" hidden></div><div class="ann-scrim" hidden></div></div>`;
    const COMPOSER = `<div class="ann-panel ann-composer" role="dialog" aria-label="写批注"><div class="ann-head"><span class="ann-loc"></span>${X}</div><blockquote class="ann-quote"></blockquote><textarea class="ann-ta" rows="4" enterkeyhint="done" placeholder="写下你的意见…（回车存下，Shift+回车换行）" aria-label="批注内容"></textarea><p class="ann-hint" aria-live="polite"></p><div class="ann-row"><button type="button" class="ann-btn ann-primary">存下来</button></div></div>`;
    const DRAWER = `<div class="ann-panel ann-drawer" role="dialog" aria-label="批注清单"><div class="ann-head"><strong></strong>${X}</div><p class="ann-hint" aria-live="polite"></p><ol class="ann-items"></ol><textarea class="ann-ta" readonly hidden aria-label="批注清单全文"></textarea><div class="ann-row ann-acts"></div></div>`;
    const ITEM = `<li class="ann-item"><div class="ann-meta"><span class="ann-loc"></span></div><button type="button" class="ann-jump" title="跳到原处"><span class="ann-quote"></span></button><div class="ann-note"></div></li>`;

    const squash = (s) => (s ? String(s) : '').replace(/\s+/g, ' ').trim();
    const clip = (s, n, chars = Array.from(s)) => (chars.length > n ? chars.slice(0, n - 1).join('') + '…' : s);
    const clean = (s) => s.replace(/\r\n?/g, '\n').trim();
    const attempt = (fn, fallback) => {
        try {
            return fn();
        } catch {
            return fallback;
        }
    };
    // storage can be missing or throw (private mode, blocked site data): the notes then live for this visit only
    const load = () =>
        []
            .concat(attempt(() => JSON.parse(localStorage.getItem(S.key)), []) || [])
            .flatMap((n) =>
                n && n.id && n.note ? [{ ...n, kind: /^[ten]$/.test(n.kind) ? n.kind : 'e', loc: n.loc || '' }] : []
            );
    const save = () =>
        (S.volatile =
            !attempt(() => (localStorage.setItem(S.key, JSON.stringify(S.notes)), true), false) && !S.cloud);
    // The artifact's database, once it answers (claude.use('db'); null anywhere else). A note confirmed there carries
    // `cloud`; a confirmed note the database no longer has was cleared elsewhere (another device, or the agent after
    // handling the round) and goes here too, while one written before the database answered is sent up.
    const CLOUD = 'annotations';
    const fields = (n) => {
        const doc = { source: cfg.source, title: squash(document.title), at: n.at, kind: n.kind, loc: n.loc };
        Object.assign(doc, { quote: n.quote, note: n.note });
        if (n.kind !== 'n' && n.path) Object.assign(doc, { path: n.path, off: n.off || 0 });
        return doc;
    };
    const send = (n) => {
        if (!S.cloud) return;
        S.cloud
            .doc(n.id)
            .set(fields(n))
            .then(() => ((n.cloud = 1), save()))
            .catch(() => toast('没存进报告，先留在这台设备上'));
    };
    const unsend = (id) => S.cloud && S.cloud.doc(id).delete().catch(() => {});
    const connect = async () => {
        const db = await Promise.resolve(attempt(() => window.claude.use('db'), null)).catch(() => null);
        const col = db && attempt(() => db.collection(CLOUD), null);
        if (!col) return;
        S.cloud = col;
        let settled = false;
        col.onSnapshot(
            (snap) => {
                const remote = snap.docs
                    .map((d) => ({ ...d.data(), id: d.id, cloud: 1 }))
                    .filter((n) => n.note && (!n.source || n.source === cfg.source));
                const there = new Set(remote.map((n) => n.id));
                // until the database has answered for itself, nothing here is taken as cleared
                const definitive = !snap.metadata.fromCache;
                const mine = S.notes.filter((n) => !there.has(n.id) && !(definitive && n.cloud));
                if (definitive && !settled) {
                    settled = true;
                    for (const n of mine) send(n);
                }
                S.notes = remote
                    .map((n) => ({ ...n, kind: /^[ten]$/.test(n.kind) ? n.kind : 'e', loc: n.loc || '' }))
                    .concat(mine)
                    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
                for (const id of [...S.marks.keys()]) if (!S.notes.some((n) => n.id === id)) S.marks.delete(id);
                save();
                paint();
                if (S.panel && S.panel.matches('.ann-drawer')) openDrawer();
            },
            () => {} // a lost connection keeps what is here; the cache still holds it
        );
    };
    // the copied list: a two-line header, then per note its number, [place]「quote」 and the note verbatim below
    const exportText = () => {
        const items = S.notes.map((n, i) => {
            const at =
                n.kind === 'n' ? '[留言]' : (n.loc ? `[${n.loc}]` : '') + (n.quote ? `「${clip(n.quote, 100)}」` : '');
            return `${i + 1}. ${at || '[页面]'}\n${n.note}`;
        });
        const title = squash(document.title) || '无标题';
        const head = `批注｜${title}${cfg.source ? `（${cfg.source}）` : ''}\n逐条处理，回复按编号说改了什么。`;
        return `${head}\n\n${items.join('\n\n')}\n`;
    };
    window.__annotate = {
        notes: () => S.notes.map((n) => ({ ...n })),
        exportText,
        clear: () => (S.notes.forEach((n) => unsend(n.id)), (S.notes = []), S.marks.clear(), save(), paint())
    };

    const make = (html) => {
        const box = document.createElement('div');
        box.innerHTML = html;
        for (const e of box.querySelectorAll('*')) e.setAttribute('data-annotate-ui', '');
        return box.firstElementChild;
    };
    const $ = (el, selectors) => selectors.split(' ').map((s) => el.querySelector(s));
    const button = (text, cls, onclick) =>
        Object.assign(make(`<button type="button" class="${cls}"></button>`), { textContent: text, onclick });
    // acts on a second tap within 3 s: window.confirm does nothing inside artifacts
    const twice = (text, armed, cls, act) => {
        const b = button(text, cls, () => {
            if (b.dataset.armed) return act();
            Object.assign(b, { textContent: armed }).dataset.armed = 1;
            setTimeout(() => (delete b.dataset.armed, (b.textContent = text)), 3000);
        });
        return b;
    };
    // a note field: Enter saves, Shift+Enter breaks the line, and an Enter that commits an IME candidate does neither;
    // Escape runs `cancel` when given. Listeners, not on* properties: an on* handler that returns false cancels the key
    const field = (ta, save, cancel) => {
        let composing = false;
        ta.addEventListener('compositionstart', () => (composing = true));
        ta.addEventListener('compositionend', () => setTimeout(() => (composing = false)));
        ta.addEventListener('keydown', (e) => {
            if (composing || e.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                save();
            } else if (e.key === 'Escape' && cancel) {
                e.stopPropagation();
                cancel();
            }
        });
        return ta;
    };
    const inUI = (n) => !!(n && n.nodeType && root.contains(n));
    const place = (el, x, y) => Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
    // outline `el` with `box`, kept inside the viewport's width so it never widens the page
    const frame = (box, el) => {
        const [r, o] = [el.getBoundingClientRect(), root.getBoundingClientRect()];
        const left = Math.max(r.left - 4, 2);
        const right = Math.min(r.right + 4, document.documentElement.clientWidth - 2);
        place(box, left - o.left, r.top - o.top - 4);
        Object.assign(box.style, { width: `${Math.max(right - left, 8)}px`, height: `${r.height + 8}px` });
    };

    const isBlock = (e) => e.matches(BLOCK) || CARD.test(e.getAttribute('class') || '');
    const blockOf = (node) => {
        const start = node && node.nodeType !== 1 ? node.parentElement : node;
        for (let e = start; e && !TOP.test(e.localName); e = e.parentElement) if (isBlock(e)) return e;
        return start && !TOP.test(start.localName) ? start : null;
    };
    const headingOf = (el) => {
        let last = null;
        for (const h of document.querySelectorAll(HEADS)) {
            if (h !== el && !(h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
            if (!inUI(h)) last = h;
        }
        return last;
    };
    // the shortest name to find the place by in the source: the nearest data-anchor, the element's id, else the
    // number (or the start) of its own or the preceding heading
    const locOf = (el) => {
        const anchored = el.closest('[data-anchor]');
        if (anchored) return clip(squash(anchored.getAttribute('data-anchor')), 24);
        if (el.id) return '#' + el.id;
        const text = squash((el.querySelector(HEADS) || headingOf(el) || {}).textContent);
        const m = text.match(NUM);
        return m ? m[1] : clip(text, 16);
    };
    const summary = (el) => {
        const name = el.localName;
        const img = name === 'img' ? el : name === 'figure' && el.querySelector('img');
        const text = squash((img && img.alt) || ('innerText' in el ? el.innerText : el.textContent));
        return text ? clip(text, 120) : `<${name}>`;
    };
    const pathOf = (el) => {
        const parts = [];
        for (let e = el; e && e !== document.body && e.parentElement; e = e.parentElement) {
            const anchor = e.getAttribute('data-anchor');
            const own = e.id ? '#' + CSS.escape(e.id) : anchor ? `[data-anchor="${CSS.escape(anchor)}"]` : '';
            if (own && document.querySelectorAll(own).length === 1) return [own, ...parts].join(' > ');
            parts.unshift(`${e.localName}:nth-child(${[...e.parentElement.children].indexOf(e) + 1})`);
        }
        return ['body', ...parts].join(' > ');
    };
    // a note's target; a text one also keeps where its quote starts in the block, to find the same words again
    const target = (el, quote, range) => {
        const t = { kind: range ? 't' : 'e', el, quote, range, loc: locOf(el), path: pathOf(el) };
        if (range) {
            const before = document.createRange();
            before.setStart(el, 0);
            before.setEnd(range.startContainer, range.startOffset);
            t.off = before.toString().replace(/\s/g, '').length;
        }
        return t;
    };
    const selInfo = () => {
        const sel = getSelection();
        const range = sel && !sel.isCollapsed && sel.rangeCount && sel.getRangeAt(0);
        const node = range && range.commonAncestorContainer;
        const el = node && (node.nodeType === 1 ? node : node.parentElement);
        const text = squash(sel && sel.toString());
        if (!el || !text || inUI(el) || inUI(document.activeElement)) return null;
        return el.closest('input,textarea,[contenteditable]') ? null : { range: range.cloneRange(), text, el };
    };
    const fromSelection = (s) => target(blockOf(s.el) || s.el, clip(s.text, 1000), s.range);
    const below = (r) => ({ x: r.left, y: r.bottom });

    // Marks. A text note is found again by its words (whitespace ignored; the hit nearest its old offset), in its
    // block first and then anywhere on the page. An element note, or text no longer found, outlines its element.
    const textMap = (el) => {
        let map = S.maps.get(el);
        if (map) return map;
        map = { flat: '', nodes: [], offs: [] };
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            if (inUI(n) || n.parentElement.closest('script,style,noscript,template')) continue;
            for (let i = 0; i < n.data.length; i++)
                if (!/\s/.test(n.data[i])) ((map.flat += n.data[i]), map.nodes.push(n), map.offs.push(i));
        }
        S.maps.set(el, map);
        return map;
    };
    const findText = (el, quote, near) => {
        const needle = quote.replace(/…$/, '').replace(/\s/g, '');
        const map = needle && textMap(el);
        let at = -1;
        for (let i = needle ? map.flat.indexOf(needle) : -1; i >= 0; i = map.flat.indexOf(needle, i + 1))
            if (at < 0 || Math.abs(i - near) < Math.abs(at - near)) at = i;
        if (at < 0) return null;
        const [end, range] = [at + needle.length - 1, document.createRange()];
        range.setStart(map.nodes[at], map.offs[at]);
        range.setEnd(map.nodes[end], map.offs[end] + 1);
        return range;
    };
    const markOf = (n) => {
        let m = S.marks.get(n.id);
        if (m && m.el.isConnected && (!m.range || m.range.startContainer.isConnected)) return m;
        const el = n.kind !== 'n' && attempt(() => document.querySelector(n.path), null);
        const range =
            n.kind === 't' && ((el && findText(el, n.quote, n.off || 0)) || findText(document.body, n.quote, 0));
        m = { el: el || (range && blockOf(range.startContainer)), range: range || null };
        if (m.el) S.marks.set(n.id, m);
        return m;
    };
    const paint = () => {
        if (!root) return;
        S.maps = new Map();
        for (const el of S.marked) el.removeAttribute('data-ann-mark');
        const ranges = [];
        [S.pinned, S.marked] = [[], []];
        S.notes.forEach((n, i) => {
            const m = markOf(n);
            if (m.range && HL) return ranges.push(m.range);
            if (!m.el) return;
            S.pinned.push([m.el, n, i]);
            if (!TOP.test(m.el.localName)) S.marked.push(m.el);
        });
        for (const el of S.marked) el.setAttribute('data-ann-mark', '');
        if (HL) CSS.highlights.set('ann', new Highlight(...ranges));
        badge.textContent = S.notes.length;
        list.hidden = !S.notes.length;
        renderPins();
    };
    const renderPins = () => {
        pins.textContent = '';
        const [o, w] = [root.getBoundingClientRect(), document.documentElement.clientWidth];
        for (const [el, n, i] of S.pinned) {
            const r = el.getBoundingClientRect();
            if (!r.width && !r.height) continue;
            const pin = button(String(i + 1), 'ann-pin', () => openDrawer(n.id));
            pin.setAttribute('aria-label', `第 ${i + 1} 条批注`);
            place(pin, Math.min(r.right - 18, w - 28) - o.left, r.top - 10 - o.top);
            pins.append(pin);
        }
    };
    const later = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            renderPins();
            if (hovered && !ring.hidden) frame(ring, hovered);
        });
    };
    const flash = (m) => {
        if (m && m.range && HL) {
            CSS.highlights.set('ann-now', new Highlight(m.range));
            clearTimeout(flash.timer);
            flash.timer = setTimeout(() => CSS.highlights.delete('ann-now'), 1600);
        } else if (m && m.el && m.el.isConnected) {
            const f = root.appendChild(make('<div class="ann-ring ann-flash"></div>'));
            frame(f, m.el);
            setTimeout(() => f.remove(), 1600);
        }
    };
    const jump = (n) => {
        const m = markOf(n);
        const node = m.range && m.range.startContainer;
        const el = (node && (node.nodeType === 1 ? node : node.parentElement)) || m.el;
        if (!el) return toast('页面上找不到这一处了');
        closePanel();
        const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
        flash(m);
    };

    const openComposer = (t, pt) => {
        closePanel();
        hideChip();
        const panel = make(COMPOSER);
        const [loc, quote, ta, hint, store] = $(panel, '.ann-loc .ann-quote textarea .ann-hint .ann-primary');
        loc.textContent = t.kind === 'n' ? '留言' : t.loc || '批注';
        Object.assign(quote, { textContent: t.quote || '', hidden: !t.quote });
        if (S.volatile) hint.textContent = '这里存不住，刷新就会丢，写完记得在「清单」里复制';
        store.onclick = () => (clean(ta.value) ? add(t, clean(ta.value)) : (hint.textContent = '先写点什么'));
        field(ta, () => store.click());
        Object.assign(S, { t, ta });
        show(panel, pt);
        if (t.el) frame(ring, t.el);
        ring.hidden = !(hovered = t.el || null);
        ta.focus({ preventScroll: true });
    };
    const add = (t, note) => {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const n = { id, at: new Date().toISOString(), kind: t.kind, loc: t.loc || '', quote: t.quote || '', note };
        if (t.kind !== 'n') Object.assign(n, { path: t.path, off: t.off });
        if (t.el) S.marks.set(id, { el: t.el, range: t.range || null });
        S.notes.push(n);
        save();
        send(n);
        closePanel();
        if (t.range) getSelection().removeAllRanges();
        paint();
        flash(S.marks.get(id));
        toast(S.volatile ? '记下了，但这里存不住，刷新前记得复制' : '记下了');
    };

    const show = (panel, pt) => {
        const narrow = innerWidth <= 640;
        scrim.hidden = !narrow;
        panel.classList.add(narrow ? 'ann-sheet' : pt ? 'ann-pop' : 'ann-side');
        panel.querySelector('.ann-x').onclick = closePanel;
        root.append((S.panel = panel));
        S.shown = Date.now();
        if (narrow || !pt) return fit();
        const [o, w, h] = [root.getBoundingClientRect(), panel.offsetWidth, panel.offsetHeight];
        let y = pt.y + 14 + h > innerHeight - 8 ? pt.y - 14 - h : pt.y + 14;
        if (y < 8) y = Math.max(8, innerHeight - h - 8);
        const x = Math.min(Math.max(8, pt.x - 20), document.documentElement.clientWidth - w - 8);
        place(panel, x - o.left, y - o.top);
    };
    // keep the bottom sheet above the on-screen keyboard
    const fit = (vv = window.visualViewport) => {
        if (!vv || !S.panel || !S.panel.matches('.ann-sheet')) return;
        S.panel.style.bottom = `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`;
        S.panel.style.maxHeight = `${Math.round(Math.min(vv.height * 0.92, innerHeight * 0.8))}px`;
    };
    const typed = () => S.ta && clean(S.ta.value);
    const closePanel = () => {
        if (S.panel) S.panel.remove();
        Object.assign(S, { panel: null, t: null, ta: null });
        scrim.hidden = ring.hidden = !(hovered = null);
    };

    // the list, in writing order: a quote jumps to its place; each note can be edited or deleted
    const openDrawer = (focus) => {
        closePanel();
        hideChip();
        const panel = make(DRAWER);
        const [title, hint, ol, manual, acts] = $(panel, 'strong .ann-hint ol textarea .ann-acts');
        title.textContent = `批注清单（${S.notes.length}）`;
        hint.textContent = S.volatile
            ? '这里存不住，刷新就会丢，记得复制'
            : !S.notes.length
              ? '还没有批注：选中文字点「批注这段」，点「批注」再点内容，或者直接「留言」'
              : S.cloud
                ? '批注存在这份报告里：换设备、隔几天再打开都还在'
                : '';
        let on = null;
        S.notes.forEach((n, i) => {
            const li = make(ITEM);
            const [meta, where, jumper, quote, text] = $(li, '.ann-meta .ann-loc .ann-jump .ann-quote .ann-note');
            where.textContent = `${i + 1} · ${n.kind === 'n' ? '留言' : n.loc || '页面'}`;
            if (n.kind === 'n' || !n.quote) jumper.remove();
            else {
                jumper.onclick = () => jump(n);
                quote.textContent = `「${n.quote}」`;
            }
            text.textContent = n.note;
            const del = twice('删', '确认删除', 'ann-link ann-bad', () => drop(n));
            meta.append(
                button('改', 'ann-link', () => edit(li, n)),
                del
            );
            ol.append(li);
            if (n.id === focus) on = li;
        });
        if (S.notes.length) acts.append(twice('清空', '确认清空全部', 'ann-link ann-bad', () => drop()));
        acts.append(button('留言', 'ann-btn', () => openComposer({ kind: 'n' })));
        const copyAll = button('复制全部', 'ann-btn ann-primary', () => copy(manual, hint));
        acts.append(Object.assign(copyAll, { disabled: !S.notes.length }));
        show(panel);
        if (!on) return;
        on.classList.add('ann-on');
        on.scrollIntoView({ block: 'nearest' });
        setTimeout(() => on.classList.remove('ann-on'), 1600);
    };
    const edit = (li, n) => {
        const ta = make('<textarea class="ann-ta" rows="3" enterkeyhint="done" aria-label="改批注"></textarea>');
        const row = make('<div class="ann-row"></div>');
        const back = () => openDrawer(n.id);
        const keep = () => {
            if (!clean(ta.value)) return ta.focus();
            n.note = clean(ta.value);
            save();
            send(n);
            back();
            toast('改好了');
        };
        field(ta, keep, back).value = n.note;
        row.append(button('取消', 'ann-btn', back), button('保存', 'ann-btn ann-primary', keep));
        for (const b of li.querySelectorAll('.ann-meta button')) b.remove();
        li.querySelector('.ann-note').replaceWith(ta, row);
        ta.focus();
    };
    // one note, or all of them
    const drop = (n) => {
        for (const gone of n ? [n] : S.notes) unsend(gone.id);
        S.notes = n ? S.notes.filter((x) => x !== n) : [];
        if (n) S.marks.delete(n.id);
        else S.marks.clear();
        save();
        paint();
        openDrawer();
    };
    const copy = async (manual, hint, text = exportText()) => {
        try {
            await navigator.clipboard.writeText(text);
            return toast('已复制，粘贴到对话里就行');
        } catch {
            // no async clipboard (some app views, plain http): select the text for a manual copy
        }
        Object.assign(manual, { hidden: false, value: text }).focus();
        manual.setSelectionRange(0, text.length);
        hint.textContent = '已全部选中，请手动复制';
    };

    const toast = (msg) => {
        Object.assign(toastEl, { textContent: msg, hidden: false });
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => (toastEl.hidden = true), 2600);
    };
    const hover = (el) => {
        if (el !== hovered && (hovered = el)) frame(ring, el);
        ring.hidden = !el;
    };
    const hideChip = () => (chip.hidden = true);
    // above the selection; below it on touch, where the system menu sits
    const showChip = (s) => {
        const touch = S.pointer ? S.pointer !== 'mouse' : matchMedia('(pointer: coarse)').matches;
        const rects = s.range.getClientRects();
        const r = touch ? rects[rects.length - 1] : s.range.getBoundingClientRect();
        if (!r) return hideChip();
        chip.hidden = !(S.sel = s);
        const [o, w, h] = [root.getBoundingClientRect(), chip.offsetWidth, chip.offsetHeight];
        let y = touch ? r.bottom + 28 : r.top - h - 8;
        if (y < 8 || y + h > innerHeight - 8) y = touch ? r.top - h - 40 : r.bottom + 8;
        const x = Math.min(Math.max(8, touch ? r.right - w / 2 : r.left + (r.width - w) / 2), innerWidth - w - 8);
        place(chip, x - o.left, y - o.top);
    };
    const setPicking = (on) => {
        pill.setAttribute('aria-pressed', (S.picking = on));
        banner.hidden = !on;
        document.documentElement.toggleAttribute('data-annotating', on);
        if (!on && !S.t) hover(null);
        hideChip();
    };

    // annotate mode: the tap is ours, so the page's links, buttons and details do not fire
    const onClick = (e) => {
        if (!S.picking || inUI(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (typed()) return S.ta.focus(); // a half-written note is not dropped by a tap elsewhere
        const [s, el] = [selInfo(), blockOf(e.target)];
        const at = e.detail ? { x: e.clientX, y: e.clientY } : el && below(el.getBoundingClientRect());
        if (s) openComposer(fromSelection(s), below(s.range.getBoundingClientRect()));
        else if (el) openComposer(target(el, summary(el)), at);
    };
    const onDown = (e) => {
        S.pointer = e.pointerType;
        S.down = [e.clientX, e.clientY];
        if (S.picking && !inUI(e.target)) e.stopPropagation();
    };
    // outside annotate mode, a tap on marked text (not on a control) opens its note in the list
    const onUp = (e) => {
        const [down, x, y] = [S.down, e.clientX, e.clientY];
        S.down = null;
        if (S.picking) return inUI(e.target) || e.stopPropagation();
        if (!HL || S.panel || !down || inUI(e.target) || Math.hypot(x - down[0], y - down[1]) > 8) return;
        if (e.target.closest && e.target.closest('a,button,input,select,textarea,summary,label')) return;
        const within = (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        const hit = S.notes.find((n) => {
            const m = S.marks.get(n.id);
            return m && m.range && [...m.range.getClientRects()].some(within);
        });
        if (hit) setTimeout(() => getSelection().isCollapsed && openDrawer(hit.id));
    };
    // Escape closes the panel, then leaves annotate mode; not while an IME candidate is open (Escape cancels it)
    const onKey = (e) =>
        e.key === 'Escape' &&
        !e.isComposing &&
        e.keyCode !== 229 &&
        (S.panel ? closePanel() : S.picking ? setPicking(false) : hideChip());

    const start = () => {
        S.key = `annotate:${cfg.source || location.pathname}|${squash(document.title)}`;
        S.notes = load();
        const probe = S.key + ':probe';
        S.volatile = !attempt(() => (localStorage.setItem(probe, 1), localStorage.removeItem(probe), 1));
        root = make(ROOT);
        const parts =
            '.ann-pins .ann-ring .ann-chip .ann-banner .ann-free .ann-list .ann-badge .ann-pill .ann-toast .ann-scrim';
        let free;
        [pins, ring, chip, banner, free, list, badge, pill, toastEl, scrim] = $(root, parts);
        pill.textContent = cfg.label;
        banner.textContent = `点一下要批注的内容 · 再点「${cfg.label}」退出`;
        pill.onclick = () => closePanel() || setPicking(!S.picking);
        free.onclick = () => openComposer({ kind: 'n' });
        list.onclick = () => (S.panel && S.panel.matches('.ann-drawer') ? closePanel() : openDrawer());
        // the tap that opened a sheet must not close it again through the scrim
        scrim.onclick = () => Date.now() - S.shown > 400 && !typed() && closePanel();
        chip.onmousedown = (e) => e.preventDefault(); // keep the selection on desktop
        chip.onclick = () => S.sel && openComposer(fromSelection(S.sel), below(S.sel.range.getBoundingClientRect()));
        // keys pressed inside the layer stay there: the page's own shortcuts never see them
        for (const type of ['keydown', 'keypress', 'keyup'])
            root.addEventListener(type, (e) => (e.stopPropagation(), type === 'keydown' && onKey(e)));
        document.body.append(root);

        const passive = { capture: true, passive: true };
        const swallow = (e) => S.picking && !inUI(e.target) && e.stopPropagation();
        const onMove = (e) =>
            S.picking && !S.panel && e.pointerType === 'mouse' && hover(inUI(e.target) ? null : blockOf(e.target));
        addEventListener('click', onClick, true);
        addEventListener('pointerdown', onDown, true);
        addEventListener('pointerup', onUp, true);
        for (const type of ['mousedown', 'mouseup', 'touchstart', 'touchend']) addEventListener(type, swallow, passive);
        addEventListener('pointermove', onMove, passive);
        addEventListener('keydown', onKey);
        addEventListener('resize', () => (hideChip(), fit(), later()));
        addEventListener('load', paint); // late images and fonts move things: marks and pins again
        // inner scrollers and late layout move the pins
        addEventListener('scroll', (e) => e.target !== document && later(), passive);
        document.addEventListener('selectionchange', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const s = !S.picking && !S.panel && selInfo();
                if (s) showChip(s);
                else hideChip();
            }, 250);
        });
        if (window.visualViewport)
            for (const type of ['resize', 'scroll']) visualViewport.addEventListener(type, () => fit());
        if (window.ResizeObserver) new ResizeObserver(later).observe(document.body);
        paint();
        connect();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
