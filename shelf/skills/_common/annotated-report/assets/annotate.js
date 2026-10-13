// annotate.js — annotation layer for HTML report pages (ES2020, no dependencies; inline it with ./inline.mjs). In
// claude.ai (capabilities: {comments: {}}) notes go to Claude or stay comments; elsewhere they are kept and exported.
(() => {
    'use strict';
    if (window.__annotate) return;
    const tag = document.currentScript || document.querySelector('script[data-annotate]');
    const opt = (name, fallback) => (tag && tag.getAttribute('data-' + name)) || fallback;
    const cfg = { source: opt('source', ''), agent: opt('agent', 'claude'), label: opt('label', '批注') };
    const LIMIT = 4096; // UTF-8 bytes
    const CTRL = /[\0-\x08\v\f\x0e-\x1f\x7f]/g; // rejected by the platform; newline and tab pass
    const HEADS = 'h1,h2,h3,h4,h5,h6';
    const BLOCK = `[data-anchor],[data-comment-target],figure,img,video,svg,tr,li,p,pre,blockquote,${HEADS}`;
    const CARD = /(^|\s)[\w-]*(card|decision|item)(\s|$)/i;
    const TOP = /^(html|body|main)$/;
    const WHY = { writers_only: '只有能编辑这页的人能发给 Claude', no_session: '现在没有在线的 Claude 会话' };
    const KIND = { local: '存在本机', claude: '已发给 Claude', comment: '已留批注' };
    const S = { mode: 'local', why: '', local: [], sent: [] };
    let root, ring, pins, chip, banner, pill, badge, list, scrim, toastEl, hovered, raf, timer;

    const STYLE = `[data-annotate-ui]{all:revert;box-sizing:border-box;font:inherit;-webkit-tap-highlight-color:transparent}
[data-annotate-ui][hidden]{display:none!important}
[data-annotate-ui]:focus-visible{outline:2px solid var(--ann-ring);outline-offset:2px}
.ann-root{position:absolute;left:0;top:0;z-index:2147483000;color-scheme:light dark;--ann-bg:#fffdf9;--ann-fg:#25222a;--ann-mute:#68626e;
--ann-line:#25222a29;--ann-soft:#f2ede5;--ann-hi:#b8551a;--ann-ink:#fff;--ann-ring:#e8742a;--ann-wash:#e8742a1f;--ann-bad:#b3261e;
--ann-sh:0 12px 32px -10px #0007;--ann-b:max(14px,env(safe-area-inset-bottom));color:var(--ann-fg);
font:15px/1.55 system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}
@media (prefers-color-scheme:dark){.ann-root{--ann-bg:#27242c;--ann-fg:#f3eee6;--ann-mute:#aea6b4;--ann-line:#ffffff2e;--ann-soft:#35313b;
--ann-hi:#f2a65e;--ann-ink:#24170b;--ann-ring:#f6a55c;--ann-wash:#f6a55c24;--ann-bad:#ff8f86;--ann-sh:0 12px 32px -10px #000d}}
.ann-btn,.ann-pill,.ann-list,.ann-panel,.ann-ta,.ann-item{border:1px solid var(--ann-line);background:var(--ann-bg);color:var(--ann-fg)}
.ann-btn,.ann-pill,.ann-list,.ann-chip,.ann-pin,.ann-x,.ann-link{cursor:pointer;touch-action:manipulation}
.ann-pill,.ann-list,.ann-panel,.ann-banner,.ann-toast,.ann-chip{box-shadow:var(--ann-sh)}
.ann-dock{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:var(--ann-b);display:flex;gap:8px}
.ann-btn,.ann-pill,.ann-list{min-height:40px;padding:0 16px;border-radius:22px;font-weight:600}
.ann-pill,.ann-list{display:inline-flex;align-items:center;gap:6px;min-width:44px;min-height:44px}
.ann-pill[aria-pressed=true],.ann-badge,.ann-primary,.ann-pin{border-color:transparent;background:var(--ann-hi);color:var(--ann-ink)}
.ann-badge{min-width:20px;padding:0 6px;border-radius:10px;font-size:12px;line-height:20px;text-align:center}
.ann-pill[aria-pressed=true] .ann-badge{background:var(--ann-ink);color:var(--ann-hi)}
.ann-banner,.ann-toast,.ann-chip{position:fixed;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100vw - 24px);
padding:8px 14px;border:0;border-radius:18px;background:var(--ann-fg);color:var(--ann-bg);font-size:14px;text-align:center}
.ann-banner,.ann-toast,.ann-ring{pointer-events:none}
.ann-banner{top:max(10px,env(safe-area-inset-top));font-size:13px}
.ann-toast{z-index:1;bottom:calc(var(--ann-b) + 58px)}
.ann-chip{position:absolute;transform:none;min-height:40px;padding:0 16px;font-weight:600}
.ann-ring{position:absolute;border:2px solid var(--ann-ring);border-radius:8px;background:var(--ann-wash)}
.ann-flash{animation:ann-flash .9s ease-out forwards}
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
.ann-meta{justify-content:space-between}
.ann-head>:first-child,.ann-count{flex:1}
.ann-loc,.ann-meta,.ann-hint,.ann-count{margin:0;font-size:13px;color:var(--ann-mute)}
.ann-loc,.ann-quote,.ann-note{overflow-wrap:anywhere}
.ann-hint:empty{display:none}
.ann-bad{color:var(--ann-bad)}
.ann-x{width:36px;height:36px;margin:-8px -10px -8px 0;border:0;background:none;color:var(--ann-mute);font-size:17px}
.ann-quote{margin:0;padding:6px 10px;border-left:3px solid var(--ann-ring);border-radius:4px;background:var(--ann-soft);font-size:14px;
display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden}
.ann-ta{display:block;width:100%;min-height:96px;padding:10px 12px;border-radius:10px;font-size:16px;resize:vertical}
.ann-btn:disabled{opacity:.45;cursor:default}
.ann-items{display:grid;gap:10px;margin:0;padding:0;list-style:none}
.ann-item{display:grid;gap:6px;padding:10px 12px;border-radius:10px}
.ann-note{white-space:pre-wrap}
.ann-drawer>.ann-acts{position:sticky;bottom:0;padding-top:8px;background:var(--ann-bg);box-shadow:0 40px var(--ann-bg)}
.ann-link{padding:6px 4px;border:0;background:none;color:var(--ann-bad)}
html[data-annotating] body :not([data-annotate-ui]){cursor:pointer!important}
@media (pointer:coarse){html[data-annotating] body :not([data-annotate-ui]){-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.ann-btn,.ann-chip{min-height:44px}}
@media (prefers-reduced-motion:reduce){.ann-flash{animation:none}}`;
    // static markup; page and reader text goes in through textContent only
    const X = '<button type="button" class="ann-x" aria-label="关闭">✕</button>';
    const ROOT = `<div class="ann-root" data-uncommentable><style>${STYLE}</style><div class="ann-pins"></div><div class="ann-ring" hidden></div><button type="button" class="ann-chip" hidden>批注这段</button><div class="ann-banner" hidden></div><div class="ann-dock"><button type="button" class="ann-list" hidden>清单</button><button type="button" class="ann-pill" aria-pressed="false"><span></span><span class="ann-badge" hidden></span></button></div><div class="ann-toast" role="status" hidden></div><div class="ann-scrim" hidden></div></div>`;
    const COMPOSER = `<div class="ann-panel ann-composer" role="dialog" aria-label="写批注"><div class="ann-head"><span class="ann-loc"></span>${X}</div><blockquote class="ann-quote"></blockquote><textarea class="ann-ta" rows="4" placeholder="写下你的意见…" aria-label="批注内容"></textarea><p class="ann-hint" aria-live="polite"></p><div class="ann-row"><span class="ann-count"></span><span class="ann-row ann-acts"></span></div></div>`;
    const DRAWER = `<div class="ann-panel ann-drawer" role="dialog" aria-label="批注清单"><div class="ann-head"><strong></strong>${X}</div><p class="ann-hint" aria-live="polite"></p><ol class="ann-items"></ol><textarea class="ann-ta" readonly hidden aria-label="导出的批注"></textarea><div class="ann-row ann-acts"></div></div>`;
    const ITEM = `<li class="ann-item"><div class="ann-loc"></div><div class="ann-quote"></div><div class="ann-note"></div><div class="ann-meta"><span></span></div></li>`;

    const squash = (s) => (s ? String(s) : '').replace(/\s+/g, ' ').trim();
    const key = (s) => s.replace(/[\s§·]/g, '');
    const clip = (s, n, chars = Array.from(s)) => (chars.length > n ? chars.slice(0, n - 1).join('') + '…' : s);
    const bytes = (s) => new TextEncoder().encode(s).length;
    const clean = (s) => s.replace(/\r\n?/g, '\n').replace(CTRL, '').trim();
    const two = (n) => String(n).padStart(2, '0');
    const stamp = (d = new Date()) =>
        `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
    const safe = (fn, fallback) => new Promise((resolve) => resolve(fn())).catch(() => fallback);
    const attempt = (fn, fallback) => {
        try {
            return fn();
        } catch {
            return fallback;
        }
    };
    // local notes in localStorage; copies of what was sent this visit in sessionStorage
    const load = (area, key) =>
        [].concat(attempt(() => JSON.parse(window[area].getItem(key)), []) || []).filter((n) => n && n.at && n.note);
    const persist = () => {
        S.volatile = !attempt(() => (localStorage.setItem(S.key, JSON.stringify(S.local)), true), false);
        attempt(() => sessionStorage.setItem(S.key + ':sent', JSON.stringify(S.sent)));
    };
    const all = () => [...S.sent, ...S.local].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const exportMarkdown = () => {
        const lines = [`# 页面批注：${squash(document.title) || '无标题'}`];
        lines.push(`来源：${cfg.source || location.href}  ·  ${stamp()}`);
        lines.push('请逐条处理下面的批注（位置 + 原文 + 我的意见）；改完一条在回复里说改了什么。', '');
        all().forEach((n, i) => {
            const pad = ' '.repeat(String(i + 1).length + 2);
            lines.push(`${i + 1}. 位置：${n.label}`, `${pad}原文：「${clip(n.quote, 300)}」`);
            lines.push(`${pad}批注：${n.note.split('\n').join('\n' + pad)}`, '');
        });
        return lines.join('\n');
    };
    const api = { mode: S.mode, notes: () => all().map((n) => ({ ...n })), exportMarkdown };
    window.__annotate = Object.assign(api, { clear: () => ((S.local = []), (S.sent = []), persist(), paint()) });

    const make = (html) => {
        const box = document.createElement('div');
        box.innerHTML = html;
        for (const e of box.querySelectorAll('*')) e.setAttribute('data-annotate-ui', '');
        return box.firstElementChild;
    };
    const $ = (el, ...selectors) => selectors.map((s) => el.querySelector(s));
    const fill = (el, texts) => {
        for (const [selector, text] of Object.entries(texts)) el.querySelector(selector).textContent = text;
        return el;
    };
    const button = (text, cls, onclick) =>
        Object.assign(make(`<button type="button" class="${cls}"></button>`), { textContent: text, onclick });
    const inUI = (n) => !!(n && n.nodeType && root.contains(n));
    const place = (el, x, y) => Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
    const frame = (box, el) => {
        const [r, o] = [el.getBoundingClientRect(), root.getBoundingClientRect()];
        place(box, r.left - o.left - 4, r.top - o.top - 4);
        Object.assign(box.style, { width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    };

    const isBlock = (e) => e.matches(BLOCK) || CARD.test(e.getAttribute('class') || '');
    const blockOf = (node) => {
        const start = node && node.nodeType !== 1 ? node.parentElement : node;
        for (let e = start; e && !TOP.test(e.localName); e = e.parentElement) if (isBlock(e)) return e;
        return start && !TOP.test(start.localName) ? start : null;
    };
    const boxOf = (e) => {
        for (e = e.parentElement; e && !TOP.test(e.localName); e = e.parentElement) if (isBlock(e)) return e;
    };
    // preceding headings h1 › h2 › h3; a heading inside another card is that card's title
    const chainOf = (el) => {
        const stack = [];
        for (const hd of document.querySelectorAll(HEADS)) {
            if (hd !== el && !(hd.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
            const box = boxOf(hd);
            if (box && !box.contains(el)) continue;
            while (stack.length && stack[stack.length - 1][0] >= hd.localName[1]) stack.pop();
            stack.push([hd.localName[1], clip(squash(hd.textContent), 40)]);
        }
        const [title, h1] = [squash(document.title), stack[0] && stack[0][0] === '1' && stack[0][1]];
        if (h1 && title && (title.includes(h1) || h1.includes(title))) stack.shift();
        return stack.map((x) => x[1]).filter(Boolean);
    };
    const labelOf = (el) => {
        const out = chainOf(el);
        const n = out.length;
        // names compare without spaces and § · marks, so a heading and its own data-anchor count once
        const add = (node, s = node && node.textContent) => {
            s = clip(squash(s), 40);
            const k = s && key(s);
            if (!k) return;
            const same = out.findIndex((x) => key(x) === k);
            if (same >= 0) return void (s.length > out[same].length && (out[same] = s));
            if (out.some((x) => key(x).includes(k))) return;
            for (let i = out.length - 1; i >= n; i--) if (k.includes(key(out[i]))) out.splice(i, 1);
            if (out.length < n + 2) out.push(s);
        };
        const [anchored, figure, table] = [el.closest('[data-anchor]'), el.closest('figure'), el.closest('table')];
        add(anchored, anchored && anchored.getAttribute('data-anchor'));
        add(el, el.getAttribute('aria-label'));
        add(figure && figure.querySelector(':scope > figcaption'));
        add(table && table.caption);
        add(el.querySelector(HEADS) || (boxOf(el) || el).querySelector(HEADS)); // or its card's title
        if (out.length === n && el.id) add(el, '#' + el.id);
        return out.join(' › ') || squash(document.title) || '页面';
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
    const target = (el, quote) => ({ el, quote, label: labelOf(el), path: pathOf(el) });
    const selInfo = () => {
        const sel = getSelection();
        const range = sel && !sel.isCollapsed && sel.rangeCount && sel.getRangeAt(0);
        const node = range && range.commonAncestorContainer;
        const el = node && (node.nodeType === 1 ? node : node.parentElement);
        const text = squash(sel && sel.toString());
        if (!el || !text || inUI(el) || inUI(document.activeElement)) return null;
        return el.closest('input,textarea,[contenteditable]') ? null : { range: range.cloneRange(), text, el };
    };
    const fromSelection = (s) => target(blockOf(s.el) || blockOf(s.range.startContainer) || s.el, clip(s.text, 1000));
    const below = (r) => ({ x: r.left, y: r.bottom });

    // modes: claude (send to Claude), comments (comment only), local (this device)
    const setMode = (mode, why = '') => {
        const changed = mode !== S.mode || why !== S.why; // a fresh answer must not wipe an error on screen
        Object.assign(S, { mode, why });
        api.mode = mode;
        if (S.refresh) S.refresh(changed);
        paint();
    };
    // claude.ai's own answer goes on screen as a code: the reasons differ by view and are not all documented
    const recheck = async (ns = S.ns) => {
        const can = String(await safe(() => ns.canSendToClaude(), 'error'));
        const why = `${WHY[can] || 'claude.ai 说这里发不到 Claude'}（${can}）。会留成这页的评论，回聊天说「看批注」就行`;
        if (S.ns === ns) setMode(can === 'available' ? 'claude' : 'comments', can === 'available' ? '' : why);
    };
    const detect = async () => {
        if (cfg.agent !== 'claude' || !window.claude || typeof window.claude.use !== 'function') return;
        // use() never answers synchronously and may hang: after 10 s the page stays local
        const wait = new Promise((resolve) => setTimeout(resolve, 1e4));
        const ns = await Promise.race([safe(() => window.claude.use('comments')), wait]);
        if (ns && !S.off) recheck((S.ns = ns));
    };

    const openComposer = (t, pt) => {
        closePanel();
        hideChip();
        const ns = (S.t = t) && S.ns;
        if (ns) t.anchor = safe(() => ns.anchorFor(t.el)); // geometry read at the reader's gesture
        const head = `〔${t.label}〕\n「${clip(t.quote, 200)}」\n\n`;
        const room = LIMIT - bytes(head);
        const panel = fill(make(COMPOSER), { '.ann-loc': t.label, '.ann-quote': t.quote });
        const [ta, hint, count, acts] = $(panel, 'textarea', '.ann-hint', '.ann-count', '.ann-acts');
        const say = (msg, bad) => (hint.classList.toggle('ann-bad', !!bad), (hint.textContent = msg || ''));
        const act = (text, kind, primary, off) => {
            const b = button(text, primary ? 'ann-btn ann-primary' : 'ann-btn', () => submit(kind));
            return Object.assign(b, { disabled: !!(off || S.busy || bytes(clean(ta.value)) > room) });
        };
        const refresh = (withHint) => {
            const [used, send] = [bytes(clean(ta.value)), !t.noSend];
            count.textContent = `${used} / ${room} 字节`;
            count.classList.toggle('ann-bad', used > room);
            if (S.mode !== 'claude') acts.replaceChildren(act(S.mode === 'local' ? '存下来' : '留批注', S.mode, true));
            else acts.replaceChildren(act('只留批注', 'comments', !send), act('发给 Claude', 'claude', send, !send));
            const why = S.why || (S.mode === 'local' ? '存在本机，可在「清单」里复制给 agent' : '');
            if (withHint) say(S.mode === 'claude' ? '' : why);
        };
        const submit = async (kind, ns = S.ns) => {
            const note = clean(ta.value);
            if (!note || bytes(note) > room) return say(note ? '太长了' : '先写点什么', true);
            if (kind === 'local' || !ns) return done(t, note, 'local');
            S.busy = true;
            refresh();
            let code = '';
            try {
                const anchor = (await t.anchor) || (await ns.anchorFor(t.el));
                const text = head + note;
                await (kind === 'claude' ? ns.sendToClaude({ anchor, text }) : ns.create({ anchor, text }));
            } catch (error) {
                code = String((error && error.code) || 'upstream_error');
            }
            S.busy = false;
            if (code) fail(t, note, kind, code);
            else done(t, note, kind === 'claude' ? kind : 'comment');
            if (S.refresh) S.refresh();
        };
        ta.oninput = () => refresh();
        Object.assign(S, { ta, say, refresh });
        refresh(true);
        show(panel, pt);
        frame(ring, t.el);
        ring.hidden = !(hovered = t.el);
        ta.focus({ preventScroll: true });
        if (ns) recheck();
    };
    const done = (t, note, kind) => {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const item = { id, at: new Date().toISOString(), kind, label: t.label, quote: t.quote, note, path: t.path };
        S[kind === 'local' ? 'local' : 'sent'].push(item);
        persist();
        if (S.t === t) closePanel();
        flash(t.el);
        paint();
        toast(kind === 'claude' ? '已发给 Claude' : kind === 'local' ? '存好了' : '批注已留下');
    };
    // never retried: a rejected write may still have landed, so only a fresh tap sends again
    const fail = (t, note, kind, code) => {
        let msg = `没发出去（${code}），草稿还在`;
        if (code === 'consent_required') msg = '没有授权这页代你评论，可以在 claude.ai 的评论面板里允许';
        else if (code === 'rate_limited') msg = '发得太快了，稍后再试';
        else if (code === 'claude_unavailable') msg = '现在发不到 Claude，可以只留批注';
        else if (/^(forbidden|not_granted|capability_)/.test(code)) {
            const why = '这页不能代你评论，批注先存在本机';
            Object.assign(S, { ns: null, off: true });
            setMode('local', why);
            msg = `${why}（${code}），草稿还在`;
        }
        t.noSend = t.noSend || code === 'claude_unavailable';
        if (S.t !== t) return toast(msg);
        S.refresh(true);
        S.say(msg, true);
    };

    const show = (panel, pt) => {
        const narrow = innerWidth <= 640;
        scrim.hidden = !narrow;
        panel.classList.add(narrow ? 'ann-sheet' : pt ? 'ann-pop' : 'ann-side');
        panel.querySelector('.ann-x').onclick = closePanel;
        root.append((S.panel = panel));
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
        Object.assign(S, { panel: null, t: null, ta: null, refresh: null });
        scrim.hidden = ring.hidden = !(hovered = null);
    };

    const openDrawer = () => {
        closePanel();
        const items = all();
        const panel = make(DRAWER);
        const [hint, ol, manual, acts, title] = $(panel, '.ann-hint', 'ol', 'textarea', '.ann-acts', 'strong');
        title.textContent = `批注清单（${items.length}）`;
        hint.textContent = S.volatile
            ? '这里存不住，刷新就会丢，记得复制'
            : S.mode === 'comments' && S.sent.length
              ? '留成评论的批注在 claude.ai 的评论里，回聊天说「看批注」Claude 就能读到'
              : '';
        items.forEach((n, i) => {
            const li = fill(make(ITEM), { '.ann-loc': `${i + 1}. ${n.label}`, '.ann-quote': n.quote });
            fill(li, { '.ann-note': n.note, span: `${KIND[n.kind]} · ${stamp(new Date(n.at)).slice(5)}` });
            if (n.kind === 'local') li.lastChild.append(button('删除', 'ann-link', (e) => remove(n, e.currentTarget)));
            ol.append(li);
        });
        acts.append(button('下载 .md', 'ann-btn', download));
        acts.append(button('复制给 agent', 'ann-btn ann-primary', () => copy(manual, hint)));
        show(panel);
    };
    const remove = (n, b) => {
        if (!b.dataset.armed) {
            Object.assign(b, { textContent: '确认删除' }).dataset.armed = 1;
            return setTimeout(() => Object.assign(b, { textContent: '删除' }).removeAttribute('data-armed'), 3000);
        }
        S.local = S.local.filter((x) => x.id !== n.id);
        persist();
        paint();
        if (all().length) openDrawer();
        else closePanel();
    };
    const copy = async (manual, hint, md = exportMarkdown()) => {
        try {
            await navigator.clipboard.writeText(md);
            return toast('已复制，粘贴给 agent 就行');
        } catch {
            // no async clipboard (iOS frames, plain http): select the text for a manual copy
        }
        Object.assign(manual, { hidden: false, value: md }).focus();
        manual.setSelectionRange(0, md.length);
        hint.textContent = '已全部选中，请手动复制';
    };
    const download = () => {
        const url = URL.createObjectURL(new Blob([exportMarkdown()], { type: 'text/markdown;charset=utf-8' }));
        const name = `annotations-${stamp().replace(/\D/g, '')}.md`;
        const a = Object.assign(make('<a></a>'), { href: url, download: name });
        root.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    };

    const renderPins = () => {
        pins.textContent = '';
        const o = root.getBoundingClientRect();
        all().forEach((n, i) => {
            const el = n.kind === 'local' && attempt(() => document.querySelector(n.path));
            const r = el && el.getBoundingClientRect();
            if (!r || !(r.width || r.height)) return;
            const pin = button(String(i + 1), 'ann-pin', openDrawer);
            pin.setAttribute('aria-label', `第 ${i + 1} 条批注`);
            place(pin, r.right - 18 - o.left, r.top - 10 - o.top);
            pins.append(pin);
        });
    };
    const paint = () => {
        if (!root) return;
        const n = all().length;
        Object.assign(badge, { textContent: n, hidden: !n });
        list.hidden = !n;
        renderPins();
    };
    const later = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            renderPins();
            if (hovered && !ring.hidden) frame(ring, hovered);
        });
    };
    const flash = (el) => {
        if (!el || !el.isConnected) return;
        const f = root.appendChild(make('<div class="ann-ring ann-flash"></div>'));
        frame(f, el);
        setTimeout(() => f.remove(), 900);
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
        if (!S.picking || inUI(e.target)) return;
        e.stopPropagation();
    };
    const onKey = (e) => e.key === 'Escape' && (S.panel ? closePanel() : S.picking ? setPicking(false) : hideChip());

    const start = () => {
        S.key = `annotate:${location.pathname}|${squash(document.title)}`;
        S.local = load('localStorage', S.key);
        S.sent = load('sessionStorage', S.key + ':sent');
        root = make(ROOT);
        const parts = '.ann-pins .ann-ring .ann-chip .ann-banner .ann-list .ann-pill .ann-badge .ann-toast .ann-scrim';
        [pins, ring, chip, banner, list, pill, badge, toastEl, scrim] = $(root, ...parts.split(' '));
        pill.firstChild.textContent = cfg.label;
        banner.textContent = `点一下要批注的内容 · 再点「${cfg.label}」退出`;
        pill.onclick = () => closePanel() || setPicking(!S.picking);
        list.onclick = () => (S.panel && S.panel.matches('.ann-drawer') ? closePanel() : openDrawer());
        scrim.onclick = () => typed() || closePanel();
        chip.onmousedown = (e) => e.preventDefault(); // keep the selection on desktop
        chip.onclick = () => S.sel && openComposer(fromSelection(S.sel), below(S.sel.range.getBoundingClientRect()));
        document.body.append(root);

        const passive = { capture: true, passive: true };
        const swallow = (e) => S.picking && !inUI(e.target) && e.stopPropagation();
        const onMove = (e) =>
            S.picking && !S.panel && e.pointerType === 'mouse' && hover(inUI(e.target) ? null : blockOf(e.target));
        addEventListener('click', onClick, true);
        addEventListener('pointerdown', onDown, true);
        for (const type of ['pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'])
            addEventListener(type, swallow, passive);
        addEventListener('pointermove', onMove, passive);
        addEventListener('keydown', onKey);
        addEventListener('resize', () => (hideChip(), fit(), later()));
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
        detect();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
