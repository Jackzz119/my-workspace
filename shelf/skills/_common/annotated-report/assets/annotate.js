// annotate.js — annotation layer for HTML report pages (ES2020, no dependencies; inline it with ./inline.mjs, which
// drops whole-line comments and indentation, so multi-line strings here hold neither). Note selected text, a tapped
// element or nothing (留言); notes stay marked on the page and copy out as one compact list to paste into any
// agent's chat. Where the page is a claude.ai artifact published with capabilities {db: {}}, every note is also a
// document in that artifact's own database (collection `annotations`): it survives cleared browser storage and an
// expired session, follows the reader to other devices, and an agent reads and clears it there. localStorage
// (keyed by data-source and title) is the cache and, anywhere else, the only store. Published with {assets: {}} as
// well, a note can carry pictures (pasted, dropped or picked): they go into the artifact's assets and the note keeps
// their ids; without that capability the picture button stays hidden. Ctrl+F / ⌘F, or the magnifier in the dock,
// opens a find bar for the page: the host app's own find may not reach into an artifact's frame, and a phone has none.
// The reader can reorder the list (buttons, or the grip on a desktop); the order is each note's `pos`.
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
    // writes queued per note; notes moved here whose order is not written yet (how many moves), and where they were
    Object.assign(S, { writes: new Map(), held: new Map(), from: new Map() });
    // the database's collection once known (null: none here); a move made before then waits for it
    S.ready = new Promise((ok) => (S.linked = ok));
    let root, ring, pins, chip, banner, pill, list, copier, badge, scrim, toastEl, hovered, raf, timer;
    let finder, q, count, prevB, nextB, seek;

    const DARK = `--ann-bg:#27242c;--ann-fg:#f3eee6;--ann-mute:#aea6b4;--ann-line:#ffffff2e;--ann-soft:#35313b;--ann-hi:#f2a65e;
--ann-ink:#24170b;--ann-ring:#f6a55c;--ann-wash:#f6a55c24;--ann-bad:#ff8f86;--ann-sh:0 12px 32px -10px #000d;color-scheme:dark`;
    // find hits are blue, apart from the amber of noted text; the one being looked at is solid
    const HITS_DARK = (on) =>
        `${on} ::highlight(ann-find){background-color:#6f9bff4d}${on} ::highlight(ann-find-now){background-color:#a5c2ff;color:#0d1526}`;
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
::highlight(ann-find){background-color:#2f6bff47}
::highlight(ann-find-now){background-color:#1d4ed8;color:#fff}
@media (prefers-color-scheme:dark){${HITS_DARK(':root:not([data-theme=light])')}}
${HITS_DARK(':root[data-theme=dark]')}
[data-ann-mark]{outline:2px dashed #e8742ab3;outline-offset:3px}
.ann-btn,.ann-panel,.ann-ta,.ann-item{border:1px solid var(--ann-line);background:var(--ann-bg);color:var(--ann-fg)}
.ann-btn,.ann-chip,.ann-pin,.ann-x,.ann-link,.ann-jump,.ann-fb{cursor:pointer;touch-action:manipulation}
.ann-dock .ann-btn,.ann-panel,.ann-banner,.ann-toast,.ann-chip,.ann-find{box-shadow:var(--ann-sh)}
.ann-dock{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:var(--ann-b);display:flex;gap:8px}
.ann-btn{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 16px;border-radius:22px;font-weight:600}
.ann-dock .ann-btn{min-width:44px;min-height:44px}
.ann-copy{gap:0}
.ann-seek{justify-content:center;padding:0}
.ann-ico{display:block;position:relative;width:13px;height:13px;margin:-3px 0 0 -3px;border:2px solid currentColor;border-radius:50%}
.ann-ico::after{content:"";position:absolute;left:8px;top:7px;width:6px;height:2px;border-radius:1px;background:currentColor;
transform:rotate(45deg);transform-origin:0 50%}
@media (max-width:420px){.ann-wide{display:none}.ann-dock{gap:6px}.ann-dock .ann-btn:not(.ann-seek){padding:0 12px}}
@media (max-width:340px){.ann-dock{gap:4px}.ann-dock .ann-btn:not(.ann-seek){padding:0 9px}}
.ann-find{position:fixed;top:max(10px,env(safe-area-inset-top));right:max(14px,env(safe-area-inset-right));display:flex;
align-items:center;gap:2px;width:min(400px,calc(100vw - 28px));padding:4px 4px 4px 14px;border:1px solid var(--ann-line);
border-radius:24px;background:var(--ann-bg);color:var(--ann-fg)}
.ann-find:focus-within{border-color:var(--ann-ring);box-shadow:0 0 0 3px var(--ann-wash),var(--ann-sh)}
.ann-q{flex:1;min-width:0;height:36px;margin:0;padding:0;border:0;background:none;color:inherit;font-size:16px;
-webkit-appearance:none;appearance:none}
.ann-q:focus-visible{outline:none}
.ann-q::placeholder{color:var(--ann-mute);opacity:1}
.ann-q::-webkit-search-cancel-button{display:none}
.ann-count{flex-shrink:0;padding:0 6px;font-size:13px;color:var(--ann-mute);white-space:nowrap;font-variant-numeric:tabular-nums}
.ann-count:empty{display:none}
.ann-find[data-miss] .ann-count{color:var(--ann-bad)}
.ann-fb{flex-shrink:0;width:36px;height:36px;padding:0;border:0;border-radius:18px;background:none;color:inherit;font-size:16px;line-height:1}
.ann-fb:disabled{opacity:.4;cursor:default}
.ann-find:not([hidden])~.ann-banner{top:calc(max(10px,env(safe-area-inset-top)) + 54px)}
@media (max-width:640px){.ann-find{top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));
right:max(8px,env(safe-area-inset-right));width:auto}}
@media (max-width:360px){.ann-find{padding-left:10px}.ann-count{padding:0 2px}.ann-root .ann-fb{width:38px}}
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
.ann-side{position:fixed;right:14px;bottom:70px;width:400px;max-height:74vh}
.ann-side.ann-composer{max-height:min(74vh,640px)}
.ann-composer>*{flex-shrink:0}
.ann-sheet{position:fixed;left:0;right:0;bottom:0;max-height:80vh;border-radius:16px 16px 0 0;padding-bottom:var(--ann-b)}
.ann-sheet.ann-top{top:max(8px,env(safe-area-inset-top));bottom:auto;left:8px;right:8px;border-radius:16px;padding-bottom:16px}
.ann-head,.ann-row,.ann-meta{display:flex;align-items:center;gap:8px}
.ann-row{flex-wrap:wrap;justify-content:flex-end}
.ann-head>:first-child,.ann-meta>.ann-loc{flex:1}
.ann-loc,.ann-hint{margin:0;font-size:13px;color:var(--ann-mute)}
.ann-loc,.ann-quote,.ann-note{overflow-wrap:anywhere}
.ann-hint:empty{display:none}
.ann-x{width:36px;height:36px;margin:-8px -10px -8px 0;border:0;background:none;color:var(--ann-mute);font-size:17px}
.ann-jump{display:block;width:100%;padding:0;border:0;background:none;color:inherit;text-align:left}
.ann-quote{margin:0;padding:6px 10px;border-left:3px solid var(--ann-ring);border-radius:4px;background:var(--ann-soft);font-size:14px;
display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden}
.ann-ta{display:block;width:100%;min-height:96px;padding:10px 12px;border-radius:10px;font-size:16px;resize:none}
.ann-ta[readonly]{resize:vertical}
.ann-composer>.ann-ta{flex-shrink:1}
.ann-item .ann-ta{max-height:min(40vh,360px)}
.ann-sheet .ann-item .ann-ta{max-height:15vh}
.ann-btn:disabled{opacity:.45;cursor:default}
.ann-items{display:grid;gap:10px;margin:0;padding:0;list-style:none}
.ann-item{display:grid;gap:6px;padding:6px 12px 10px;border-radius:10px}
.ann-mv{color:var(--ann-mute)}
.ann-grip{flex-shrink:0;width:20px;height:29px;margin:0 -2px 0 -6px;padding:4px 3px;color:var(--ann-mute);cursor:grab;
touch-action:none;background:radial-gradient(circle,currentColor 1.5px,transparent 2px) 0 0/7px 7px content-box}
.ann-editing .ann-mv,.ann-editing .ann-grip{visibility:hidden}
.ann-dragging,.ann-dragging *{cursor:grabbing!important;-webkit-user-select:none;user-select:none}
.ann-on{position:relative;z-index:1;border-color:var(--ann-ring);box-shadow:0 0 0 3px var(--ann-wash)}
.ann-note{white-space:pre-wrap}
.ann-drawer>.ann-acts{position:sticky;bottom:0;padding-top:8px;background:var(--ann-bg);box-shadow:0 40px var(--ann-bg)}
.ann-link{min-height:36px;padding:0 8px;border:0;background:none;color:var(--ann-hi);font-size:14px}
.ann-bad{color:var(--ann-bad)}
.ann-imgs{display:flex;flex-wrap:wrap;gap:6px}
.ann-thumb{position:relative;width:64px;height:64px;border:1px solid var(--ann-line);border-radius:8px;overflow:hidden;background:var(--ann-soft)}
.ann-see{display:block;width:100%;height:100%;padding:0;border:0;background:none;cursor:zoom-in}
.ann-see img{display:block;width:100%;height:100%;object-fit:cover}
.ann-rm{position:absolute;top:3px;right:3px;width:22px;height:22px;padding:0;border:0;border-radius:11px;background:#000b;color:#fff;font-size:12px;cursor:pointer}
.ann-drop{outline:2px dashed var(--ann-ring);outline-offset:-6px}
.ann-view{position:fixed;inset:0;overflow:hidden;background:#000d;cursor:zoom-out;touch-action:none;user-select:none;-webkit-user-select:none}
.ann-view img{position:absolute;left:0;top:0;max-width:none;max-height:none;border-radius:6px;cursor:zoom-in}
.ann-view img.ann-zoomed{cursor:grab}
.ann-view.ann-drag img{cursor:grabbing}
.ann-zoom{position:fixed;left:50%;bottom:max(12px,env(safe-area-inset-bottom));translate:-50% 0;display:flex;align-items:center;gap:2px;padding:4px;border-radius:22px;background:#000b;color:#fff;font:13px/1 system-ui,sans-serif}
.ann-zoom button{min-width:36px;height:36px;padding:0 10px;border:0;border-radius:18px;background:none;color:#fff;font:inherit;cursor:pointer}
.ann-zoom .ann-pct{min-width:58px;text-align:center;font-variant-numeric:tabular-nums}
@media (hover:hover){.ann-zoom button:hover{background:#fff2}}
.ann-view .ann-shut{position:fixed;top:12px;right:12px;width:36px;height:36px;padding:0;border:0;border-radius:18px;background:#000b;color:#fff;font-size:16px;cursor:pointer}
img:not(.ann-root img){cursor:zoom-in}
/* motion: one damped spring (about 2% overshoot, settles in ~540 ms) for things arriving, hover and press; leaving is quick and plain */
.ann-root{--ann-spring:linear(0, 0.004 1.1%, 0.023 2.8%, 0.063 4.9%, 0.125 7.2%, 0.204 9.8%, 0.297 12.5%, 0.397 15.4%, 0.499 18.4%, 0.597 21.6%, 0.688 24.9%, 0.769 28.3%, 0.837 31.9%, 0.893 35.5%, 0.937 39.2%, 0.969 43.1%, 0.992 47%, 1.007 51%, 1.015 55.1%, 1.019 59.2%, 1.02 63.5%, 1.018 67.8%, 1.016 72.2%, 1.013 76.7%, 1.01 81.2%, 1.007 85.8%, 1.005 90.5%, 1.003 95.2%, 1);--ann-out:cubic-bezier(.4,0,1,1)}
.ann-btn,.ann-chip,.ann-link,.ann-x,.ann-pin,.ann-see,.ann-shut,.ann-jump,.ann-fb{transition:scale .54s var(--ann-spring),background-color .2s,color .2s,box-shadow .2s,filter .2s}
@media (hover:hover){.ann-btn:not(:disabled):hover,.ann-chip:hover,.ann-shut:hover{scale:1.04}
.ann-btn:not(.ann-primary):not(.ann-pill[aria-pressed=true]):not(:disabled):hover,.ann-fb:not(:disabled):hover{background:var(--ann-soft)}
.ann-primary:not(:disabled):hover,.ann-pill[aria-pressed=true]:hover{filter:brightness(1.08)}
.ann-pin:hover,.ann-see:hover{scale:1.12}
.ann-link:hover,.ann-x:hover,.ann-fb:not(:disabled):hover{scale:1.06}
.ann-mv:not(:disabled):hover,.ann-grip:hover{color:var(--ann-fg)}}
.ann-btn:not(:disabled):active,.ann-chip:active,.ann-link:active,.ann-x:active,.ann-pin:active,.ann-see:active,.ann-shut:active,.ann-jump:active,.ann-fb:not(:disabled):active{scale:.94;transition-duration:.1s}
@keyframes ann-pop{from{opacity:0;scale:.92;translate:0 8px}}
@keyframes ann-rise{from{opacity:0;translate:0 12px;scale:.96}}
@keyframes ann-sheet{from{translate:0 100%}}
@keyframes ann-fade{from{opacity:0}}
@keyframes ann-dot{from{scale:0}}
.ann-side{animation:ann-pop .54s var(--ann-spring) both;transform-origin:100% 100%}
.ann-sheet{animation:ann-sheet .54s var(--ann-spring) both}
@keyframes ann-drop{from{translate:0 -110%}}
.ann-sheet.ann-top{animation-name:ann-drop}
.ann-chip,.ann-toast,.ann-banner{animation:ann-rise .54s var(--ann-spring) both}
@keyframes ann-fall{from{opacity:0;translate:0 -8px;scale:.96}}
.ann-find{animation:ann-fall .54s var(--ann-spring) both;transform-origin:100% 0}
.ann-scrim,.ann-view{animation:ann-fade .22s ease-out both}
.ann-view img{animation:ann-pop .54s var(--ann-spring) both}
.ann-pin{animation:ann-dot .54s var(--ann-spring) both}
.ann-item{animation:ann-rise .54s var(--ann-spring) both}
.ann-still,.ann-still .ann-item{animation:none}
.ann-glide{transition:translate .54s var(--ann-spring)}
.ann-lift{position:relative;z-index:1;scale:1.02;box-shadow:var(--ann-sh);transition:scale .54s var(--ann-spring),box-shadow .2s}
@media (prefers-reduced-motion:reduce){.ann-root *{animation:none!important;transition:none!important}}
html[data-annotating] body :not([data-annotate-ui]){cursor:pointer!important}
@media (pointer:coarse){html[data-annotating] body :not([data-annotate-ui]){-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.ann-btn,.ann-chip,.ann-link{min-height:44px}
.ann-fb{width:44px;height:44px;border-radius:22px}
.ann-grip{display:none}}
@media (prefers-reduced-motion:reduce){.ann-flash{animation:none}}`;
    // static markup; page and reader text goes in through textContent only
    const X = '<button type="button" class="ann-x" aria-label="关闭">✕</button>';
    const FIND = `<div class="ann-find" role="search" aria-label="页内搜索" hidden><input type="search" class="ann-q" placeholder="搜索这份报告" aria-label="搜索这份报告" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"><span class="ann-count" role="status" aria-live="polite"></span><button type="button" class="ann-fb" aria-label="上一处（Shift+回车）" title="上一处（Shift+回车）" disabled>↑</button><button type="button" class="ann-fb" aria-label="下一处（回车）" title="下一处（回车）" disabled>↓</button><button type="button" class="ann-fb" aria-label="关闭搜索（Esc）" title="关闭搜索（Esc）">✕</button></div>`;
    const ROOT = `<div class="ann-root"><style>${STYLE}</style><div class="ann-pins"></div><div class="ann-ring" hidden></div><button type="button" class="ann-chip" hidden>批注这段</button>${FIND}<div class="ann-banner" hidden></div><div class="ann-dock"><button type="button" class="ann-btn ann-seek" aria-expanded="false"><span class="ann-ico"></span></button><button type="button" class="ann-btn ann-free">留言</button><button type="button" class="ann-btn ann-list" hidden>清单<span class="ann-badge"></span></button><button type="button" class="ann-btn ann-copy" aria-label="复制全部批注" hidden>复制<span class="ann-wide">全部</span></button><button type="button" class="ann-btn ann-pill" aria-pressed="false"></button></div><div class="ann-toast" role="status" hidden></div><div class="ann-scrim" hidden></div></div>`;
    const COMPOSER = `<div class="ann-panel ann-composer" role="dialog" aria-label="写批注"><div class="ann-head"><span class="ann-loc"></span>${X}</div><blockquote class="ann-quote"></blockquote><textarea class="ann-ta" rows="4" enterkeyhint="done" placeholder="写下你的意见…（回车存下，Shift+回车换行）" aria-label="批注内容"></textarea><div class="ann-imgs" hidden></div><p class="ann-hint" aria-live="polite"></p><div class="ann-row"><input type="file" accept="image/*" multiple hidden><button type="button" class="ann-btn ann-pic" hidden>图片</button><button type="button" class="ann-btn ann-primary">存下来</button></div></div>`;
    const DRAWER = `<div class="ann-panel ann-drawer" role="dialog" aria-label="批注清单"><div class="ann-head"><strong></strong>${X}</div><p class="ann-hint" aria-live="polite"></p><ol class="ann-items"></ol><textarea class="ann-ta" readonly hidden aria-label="批注清单全文"></textarea><div class="ann-row ann-acts"></div></div>`;
    const ITEM = `<li class="ann-item"><div class="ann-meta"><span class="ann-loc"></span></div><button type="button" class="ann-jump" title="跳到原处"><span class="ann-quote"></span></button><div class="ann-note"></div><div class="ann-imgs" hidden></div></li>`;
    const THUMB = '<span class="ann-thumb"><button type="button" class="ann-see" aria-label="看大图"><img alt=""></button></span>';

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
    // a note says something, in words or in pictures
    const kept = (n) => !!(n && n.id && (n.note || (Array.isArray(n.imgs) && n.imgs.length)));
    const tidy = (n) => ({ ...n, kind: /^[ten]$/.test(n.kind) ? n.kind : 'e', loc: n.loc || '', note: n.note || '' });
    // The list's order is each note's `pos`, a number on the scale of the time it was written (ms since 1970): a note
    // from before there was an order has none and stands at its `at`, a new one goes after all the others, and a
    // moved one takes the midpoint of its new neighbours, so a move writes that note alone.
    const rank = (n) => (Number.isFinite(n.pos) ? n.pos : Date.parse(n.at) || 0);
    const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const order = (a, b) => rank(a) - rank(b) || cmp(String(a.at), String(b.at)) || cmp(String(a.id), String(b.id));
    // storage can be missing or throw (private mode, blocked site data): the notes then live for this visit only
    const load = () =>
        []
            .concat(attempt(() => JSON.parse(localStorage.getItem(S.key)), []) || [])
            .flatMap((n) => (kept(n) ? [tidy(n)] : []))
            .sort(order);
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
        if (n.imgs && n.imgs.length) doc.imgs = n.imgs;
        if (Number.isFinite(n.pos)) doc.pos = n.pos;
        return doc;
    };
    // one write at a time per note, as the database asks: each waits for the one before it, however that ended
    const write = (id, op) => {
        const run = (S.writes.get(id) || Promise.resolve()).then(op);
        const tail = run.catch(() => {});
        S.writes.set(id, tail);
        tail.then(() => S.writes.get(id) === tail && S.writes.delete(id));
        return run;
    };
    const send = (n) => {
        if (!S.cloud) return;
        const put = () => {
            if (!S.notes.some((x) => x.id === n.id)) return; // deleted before its turn: not written back
            return S.cloud
                .doc(n.id)
                .set(fields(n))
                .then(() => ((n.cloud = 1), save()));
        };
        write(n.id, put).catch(() => toast('没存进报告，先留在这台设备上'));
    };
    // a deleted note takes its pictures with it: nothing else points at them
    const unsend = (n) => {
        if (S.cloud) write(n.id, () => S.cloud.doc(n.id).delete()).catch(() => {});
        if (S.assets) for (const id of n.imgs || []) S.assets.delete(id).catch(() => {});
    };
    // A move goes up as the new `pos` of each note it moved, by update: the rest of the note stays as another device
    // may just have written it. One whose later move is queued already leaves the writing to that one; a passing
    // fault is tried once more. Until it is through, the note keeps the place it was given here.
    const LASTING =
        /^(invalid_argument|resource_exhausted|quota_exceeded|revoked|not_granted|transform_error|capability_)/;
    const sendPos = (id) =>
        write(id, async () => {
            const db = await S.ready;
            const n = S.notes.find((x) => x.id === id);
            if (!db || !n || S.held.get(id) > 1) return;
            const ref = db.doc(id);
            const put = () => (n.cloud ? ref.update({ pos: n.pos }) : ref.set(fields(n)));
            const pause = () => new Promise((ok) => setTimeout(ok, 300 + Math.random() * 500));
            await put().catch((err) => (LASTING.test(err && err.code) ? Promise.reject(err) : pause().then(put)));
            if (!n.cloud) ((n.cloud = 1), save());
        }).then(
            () => settle(id),
            () => settle(id, true)
        );
    // A move that did not get into the database is undone: the note goes back where it was before this run of moves
    // (unless a later move of it is still on its way). A note that is only on this device keeps its place here.
    const settle = (id, failed) => {
        const left = (S.held.get(id) || 1) - 1;
        if (left) return void S.held.set(id, left);
        const was = S.from.get(id);
        S.held.delete(id);
        S.from.delete(id);
        const n = failed && S.notes.find((x) => x.id === id);
        if (!n) return;
        if (!n.cloud) return toast('没存进报告，先留在这台设备上');
        if (Number.isFinite(was)) n.pos = was;
        else delete n.pos;
        S.notes.sort(order);
        save();
        paint();
        redraw();
        toast('顺序没存进报告，换回了原来的位置');
    };
    const use = (name) => Promise.resolve(attempt(() => window.claude.use(name), null)).catch(() => null);
    const connect = async () => {
        use('assets').then((assets) => {
            S.assets = assets || null;
            const pic = S.assets && S.panel && S.panel.querySelector('.ann-pic');
            if (pic) pic.hidden = false;
        });
        const db = await use('db');
        const col = db && attempt(() => db.collection(CLOUD), null);
        S.linked((S.cloud = col || null));
        if (!col) return;
        let settled = false;
        col.onSnapshot(
            (snap) => {
                const remote = snap.docs
                    .map((d) => ({ ...d.data(), id: d.id, cloud: 1 }))
                    .filter((n) => kept(n) && (!n.source || n.source === cfg.source));
                const there = new Set(remote.map((n) => n.id));
                // until the database has answered for itself, nothing here is taken as cleared
                const definitive = !snap.metadata.fromCache;
                const mine = S.notes.filter((n) => !there.has(n.id) && !(definitive && n.cloud));
                if (definitive && !settled) {
                    settled = true;
                    for (const n of mine) send(n);
                }
                // a note moved here keeps the place it was given until that is written
                const held = new Map(S.notes.filter((n) => S.held.has(n.id)).map((n) => [n.id, n.pos]));
                S.notes = remote
                    .map((n) => tidy(held.has(n.id) ? { ...n, pos: held.get(n.id) } : n))
                    .concat(mine)
                    .sort(order);
                for (const id of [...S.marks.keys()]) if (!S.notes.some((n) => n.id === id)) S.marks.delete(id);
                save();
                paint();
                redraw();
            },
            () => {} // a lost connection keeps what is here; the cache still holds it
        );
    };
    // the copied list: a two-line header (the page, then how to answer: grouped by feature or module, not note by note,
    // so each round's reply gathers a subject in the same place), then per note its number, [place]「quote」, the note
    // verbatim below and the asset ids of its pictures (an agent fetches them from the report)
    const REPLY =
        '按功能 / 模块归类回复（不按批注先后）：每个模块一节，写涉及的批注编号 → 结论与处理 → 改动与证据；沿用并合并上一轮报告已有的模块分区；每条批注都归进一个模块，一条不漏。';
    const exportText = () => {
        const items = S.notes.map((n, i) => {
            const at =
                n.kind === 'n' ? '[留言]' : (n.loc ? `[${n.loc}]` : '') + (n.quote ? `「${clip(n.quote, 100)}」` : '');
            const imgs = n.imgs && n.imgs.length ? `\n附图 ${n.imgs.length} 张（报告里的资源 id）：${n.imgs.join(' ')}` : '';
            return `${i + 1}. ${at || '[页面]'}${n.note ? '\n' + n.note : ''}${imgs}`;
        });
        const title = squash(document.title) || '无标题';
        const head = `批注｜${title}${cfg.source ? `（${cfg.source}）` : ''}\n${REPLY}`;
        return `${head}\n\n${items.join('\n\n')}\n`;
    };
    window.__annotate = {
        notes: () => S.notes.map((n) => ({ ...n })),
        exportText,
        clear: () => (S.notes.forEach((n) => unsend(n)), (S.notes = []), S.marks.clear(), save(), paint())
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
    // A box as tall as what is written in it, up to what its panel allows (then it scrolls inside). Taking the height
    // away to measure can pull a scrolled panel back, so its position is put back too.
    const grow = (ta) => {
        const box = ta.closest('.ann-panel');
        const y = box.scrollTop;
        ta.style.height = 'auto';
        ta.style.height = `${ta.scrollHeight + ta.offsetHeight - ta.clientHeight}px`;
        box.scrollTop = y;
    };
    // a note field: Enter saves, Shift+Enter breaks the line, and an Enter that commits an IME candidate does neither;
    // Escape runs `cancel` when given. Listeners, not on* properties: an on* handler that returns false cancels the key
    const field = (ta, save, cancel) => {
        let composing = false;
        ta.addEventListener('input', () => grow(ta));
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
        list.hidden = copier.hidden = !S.notes.length;
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

    // Pictures: a phone photo is several MB, so anything big or of a type the assets store refuses is redrawn as a
    // JPEG no longer than 2000px on a side. They go up when the note is saved; a list shows them by their asset id.
    const PIC_TYPE = /^image\/(png|jpeg|gif|webp)$/;
    const PIC_MAX = 6;
    const PIC_ERR = { too_large: '图片太大了', unsupported_type: '这种图片传不了', quota_or_state: '报告的存储满了' };
    const shrink = async (file) => {
        if (PIC_TYPE.test(file.type) && file.size <= 2e6) return file;
        const bmp = await createImageBitmap(file);
        const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
        const c = Object.assign(document.createElement('canvas'), {
            width: Math.round(bmp.width * k),
            height: Math.round(bmp.height * k)
        });
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(bmp, 0, 0, c.width, c.height);
        return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(b)), 'image/jpeg', 0.86));
    };
    // A picture over the page, fitted at first. The wheel, a pinch, the − / + buttons and the + − 0 1 keys zoom it
    // about the pointer, up to ZOOM_MAX times its own pixels (drawn as sharp squares from 2× on, so single pixels
    // can be read); a drag pans it; a tap on it goes between fitted and 1:1 (2× when it already
    // fits at its own size); a tap beside it, the ✕ or Escape closes it.
    const ZOOM_MAX = 32;
    const viewPic = (src) => {
        const v = make(
            '<div class="ann-view" role="dialog" aria-label="看图"><img alt="" draggable="false">' +
                '<div class="ann-zoom"><button type="button" aria-label="缩小">−</button><span class="ann-pct"></span>' +
                '<button type="button" aria-label="放大">+</button><button type="button">适应</button>' +
                '<button type="button">1:1</button></div></div>'
        );
        const img = v.firstChild;
        const [out, pct, inn, fitB, oneB] = v.lastChild.children;
        // the browser's own image drag would cancel the pan on its first move
        img.draggable = false;
        v.ondragstart = (e) => e.preventDefault();
        // k: screen px per picture px; x, y: where the picture's corner is in the viewer
        let k = 1;
        let x = 0;
        let y = 0;
        const size = () => [v.clientWidth, v.clientHeight];
        const fit = () => {
            const [w, h] = size();
            return Math.min(1, (w - 32) / img.naturalWidth, (h - 72) / img.naturalHeight);
        };
        // a picture smaller than the viewer stays centred; a bigger one cannot leave a gap at its edges
        const hold = (pos, len, room) => (len <= room ? (room - len) / 2 : Math.min(0, Math.max(room - len, pos)));
        const show = (glide) => {
            const [w, h] = size();
            x = hold(x, img.naturalWidth * k, w);
            y = hold(y, img.naturalHeight * k, h);
            // drawn at its zoomed size rather than scaled as a layer: a scaled layer is smoothed whatever the
            // image-rendering says, so the pixels would never show as squares
            img.style.transition = glide ? 'transform .24s cubic-bezier(.2,.8,.2,1), width .24s, height .24s' : 'none';
            img.style.width = `${img.naturalWidth * k}px`;
            img.style.height = `${img.naturalHeight * k}px`;
            img.style.transform = `translate(${x}px,${y}px)`;
            img.style.imageRendering = k >= 2 ? 'pixelated' : '';
            img.classList.toggle('ann-zoomed', k > fit() + 1e-3);
            pct.textContent = `${Math.round(k * 100)}%`;
        };
        // zoom to `to` about the viewer point (px, py), which stays over the same picture pixel
        const zoomAt = (to, px, py, glide) => {
            const nk = Math.min(ZOOM_MAX, Math.max(fit() / 2, to));
            x = px - ((px - x) * nk) / k;
            y = py - ((py - y) * nk) / k;
            k = nk;
            show(glide);
        };
        const middle = () => size().map((n) => n / 2);
        const fitted = (glide) => {
            k = fit();
            show(glide);
        };
        img.onload = () => fitted(false);
        img.src = src;
        out.onclick = () => zoomAt(k / 1.5, ...middle(), true);
        inn.onclick = () => zoomAt(k * 1.5, ...middle(), true);
        fitB.onclick = () => fitted(true);
        oneB.onclick = () => zoomAt(1, ...middle(), true);
        v.zoomKey = (key) =>
            key === '0' ? fitted(true) : zoomAt(key === '1' ? 1 : key === '-' ? k / 1.5 : k * 1.5, ...middle(), true);
        v.onwheel = (e) => {
            e.preventDefault();
            const r = v.getBoundingClientRect();
            // a trackpad pinch arrives as a wheel with ctrl held, in small steps
            const step = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
            zoomAt(k * Math.exp(-e.deltaY * step * (e.ctrlKey ? 0.01 : 0.002)), e.clientX - r.left, e.clientY - r.top);
        };
        // one pointer pans, two pinch; a press that hardly moves is a tap
        const down = new Map();
        let moved = 0;
        let pinch = null;
        const at = (e) => {
            const r = v.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        const pair = () => {
            const [a, b] = [...down.values()];
            return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        };
        v.onpointerdown = (e) => {
            if (e.target.closest('.ann-zoom, .ann-shut')) return;
            v.setPointerCapture(e.pointerId);
            down.set(e.pointerId, at(e));
            if (down.size === 1) moved = 0;
            if (down.size === 2) pinch = { ...pair(), k };
        };
        v.onpointermove = (e) => {
            const was = down.get(e.pointerId);
            if (!was) return;
            const now = at(e);
            down.set(e.pointerId, now);
            moved += Math.hypot(now.x - was.x, now.y - was.y);
            if (down.size === 2 && pinch) {
                const p = pair();
                x += p.x - pinch.x;
                y += p.y - pinch.y;
                Object.assign(pinch, { x: p.x, y: p.y });
                zoomAt((pinch.k * p.d) / pinch.d, p.x, p.y);
            } else if (down.size === 1 && moved > 4) {
                v.classList.add('ann-drag');
                x += now.x - was.x;
                y += now.y - was.y;
                show(false);
            }
        };
        const shut = () => leave(v, { opacity: 0 });
        v.onpointerup = v.onpointercancel = (e) => {
            if (!down.delete(e.pointerId)) return;
            if (down.size < 2) pinch = null;
            if (down.size) return;
            v.classList.remove('ann-drag');
            if (moved > 4 || e.type === 'pointercancel') return;
            const r = img.getBoundingClientRect();
            const on = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
            if (!on) return shut();
            const f = fit();
            const p = at(e);
            if (k > f + 1e-3) fitted(true);
            else zoomAt(f < 1 ? 1 : 2, p.x, p.y, true);
        };
        // a new window size refits a fitted picture and keeps a zoomed one in bounds
        const refit = () => {
            if (!v.isConnected) return removeEventListener('resize', refit);
            if (img.classList.contains('ann-zoomed')) show(false);
            else fitted(false);
        };
        addEventListener('resize', refit);
        v.append(button('✕', 'ann-shut', shut));
        v.lastChild.setAttribute('aria-label', '关闭');
        root.append((S.view = v));
    };
    const thumb = (src, remove) => {
        const t = make(THUMB);
        t.querySelector('img').src = src;
        t.firstChild.onclick = () => viewPic(src);
        const rm = remove && t.appendChild(button('✕', 'ann-rm', remove));
        if (rm) rm.setAttribute('aria-label', '去掉这张图');
        return t;
    };

    const openComposer = (t) => {
        closePanel();
        hideChip();
        const panel = make(COMPOSER);
        const parts = '.ann-loc .ann-quote textarea .ann-imgs .ann-hint input .ann-pic .ann-primary';
        const [loc, quote, ta, imgs, hint, input, pic, store] = $(panel, parts);
        loc.textContent = t.kind === 'n' ? '留言' : t.loc || '批注';
        Object.assign(quote, { textContent: t.quote || '', hidden: !t.quote });
        if (S.volatile) hint.textContent = '这里存不住，刷新就会丢，写完记得在「清单」里复制';
        // the pictures picked so far: a preview each, until the note is saved and they have asset ids
        const pics = [];
        const unpick = (p) => (URL.revokeObjectURL(p.url), pics.splice(pics.indexOf(p), 1), showPics());
        const showPics = () => {
            imgs.replaceChildren(...pics.map((p) => thumb(p.url, () => unpick(p))));
            imgs.hidden = !pics.length;
        };
        const take = async (files) => {
            for (const f of [...files].filter((f) => /^image\//.test(f.type))) {
                if (pics.length >= PIC_MAX) {
                    hint.textContent = `一条最多 ${PIC_MAX} 张图`;
                    break;
                }
                const blob = await shrink(f).catch(() => null);
                if (blob) pics.push({ blob, url: URL.createObjectURL(blob) });
                else hint.textContent = '有一张图读不了，换一张试试';
            }
            showPics();
        };
        pic.hidden = !S.assets;
        pic.onclick = () => input.click();
        input.onchange = () => (take(input.files), (input.value = ''));
        ta.addEventListener('paste', (e) => {
            const files = e.clipboardData ? [...e.clipboardData.files] : [];
            if (S.assets && files.some((f) => /^image\//.test(f.type))) (e.preventDefault(), take(files));
        });
        panel.ondragover = (e) => S.assets && (e.preventDefault(), panel.classList.add('ann-drop'));
        panel.ondragleave = () => panel.classList.remove('ann-drop');
        panel.ondrop = (e) => {
            panel.classList.remove('ann-drop');
            if (S.assets && e.dataTransfer) (e.preventDefault(), take(e.dataTransfer.files));
        };
        // a picture already up is not sent again when a later one failed and the note is saved once more
        store.onclick = async () => {
            const note = clean(ta.value);
            if (!note && !pics.length) return (hint.textContent = '先写点什么');
            if (store.disabled) return;
            store.disabled = true;
            if (pics.length) hint.textContent = '正在上传图片…';
            try {
                for (const p of pics) p.id = p.id || (await S.assets.upload(p.blob, { type: p.blob.type })).id;
                add(t, note, pics.map((p) => p.id));
            } catch (err) {
                store.disabled = false;
                hint.textContent = (err && PIC_ERR[err.code]) || '图片没传上去，再存一次试试';
            }
        };
        field(ta, () => store.click());
        Object.assign(S, { t, ta, pics });
        show(panel);
        if (t.el) frame(ring, t.el);
        ring.hidden = !(hovered = t.el || null);
        ta.focus({ preventScroll: true });
    };
    const add = (t, note, imgs) => {
        const now = Date.now();
        const [id, at] = [now.toString(36) + Math.random().toString(36).slice(2, 6), new Date(now).toISOString()];
        // last in the list, whatever order the others were put in
        const pos = Math.max(now, ...S.notes.map((x) => rank(x) + 1));
        const n = { id, at, pos, kind: t.kind, loc: t.loc || '', quote: t.quote || '', note };
        if (imgs && imgs.length) n.imgs = imgs;
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

    // Every panel opens in the same fixed place, never by what is being noted: what it covers scrolls back into view
    const show = (panel) => {
        const narrow = innerWidth <= 640;
        scrim.hidden = !narrow;
        panel.classList.add(narrow ? 'ann-sheet' : 'ann-side');
        // writing on a phone: the keyboard takes the lower half, so the box hangs from the top instead
        if (narrow && panel.matches('.ann-composer')) panel.classList.add('ann-top');
        panel.querySelector('.ann-x').onclick = closePanel;
        root.append((S.panel = panel));
        S.shown = Date.now();
        fit();
    };
    // Keep a sheet in what the eye sees. Fixed panels stand in the layout viewport (clientHeight); iPhone's
    // innerHeight shrinks with the keyboard, so it cannot tell how far the keyboard covers. In a frame (an
    // artifact page) the keyboard is not seen at all, so a sheet being written in hangs from the top and
    // takes at most 44% of the height, which stays above an iPhone keyboard with its suggestion bar.
    const fit = (vv = window.visualViewport) => {
        const p = S.panel;
        if (!p || !p.matches('.ann-sheet')) return;
        // (a page without a doctype reports the whole document there; innerHeight is the best it has)
        const layout = document.compatMode === 'CSS1Compat' ? document.documentElement.clientHeight : innerHeight;
        const [seen, above] = vv ? [vv.height, vv.offsetTop] : [innerHeight, 0];
        if (p.matches('.ann-top')) {
            p.style.bottom = '';
            p.style.top = `calc(${Math.max(0, above)}px + max(8px, env(safe-area-inset-top)))`;
            p.style.maxHeight = `${Math.round(Math.min(seen - 16, layout * 0.44))}px`;
        } else {
            p.style.bottom = `${Math.max(0, layout - seen - above)}px`;
            p.style.maxHeight = `${Math.round(Math.min(seen * 0.92, layout * 0.8))}px`;
        }
    };
    const typed = () => S.ta && (clean(S.ta.value) || (S.pics && S.pics.length));
    // leave quickly and plainly (no spring), then go; without motion, at once
    const leave = (el, to, ms = 160) => {
        if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches || !el.animate) return el && el.remove();
        el.style.pointerEvents = 'none';
        const done = () => el.remove();
        el.animate([{}, to], { duration: ms, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).finished.then(done, done);
        // a background tab may not run the animation at all; it goes anyway
        setTimeout(done, ms + 120);
    };
    const closePanel = (instant) => {
        if (S.drag) (cancelAnimationFrame(S.drag.raf), (S.drag = null));
        if (S.panel && instant === true) S.panel.remove();
        else if (S.panel)
            leave(
                S.panel,
                S.panel.matches('.ann-top')
                    ? { translate: '0 -110%' }
                    : S.panel.matches('.ann-sheet')
                      ? { translate: '0 100%' }
                      : { opacity: 0, scale: '.96' }
            );
        for (const p of S.pics || []) URL.revokeObjectURL(p.url);
        Object.assign(S, { panel: null, t: null, ta: null, pics: null });
        scrim.hidden = ring.hidden = !(hovered = null);
    };

    // The list, in the reader's order (as written, until a note is moved): a quote jumps to its place; each note can
    // be moved up or down (or dragged by its grip), edited or deleted. Redrawn while open, after a change here or news
    // from another device, it does not arrive again: it keeps its scroll and the focus, and each note that changed
    // place slides there from where it was.
    const openDrawer = (focus) => {
        const old = S.panel && S.panel.matches('.ann-drawer') ? S.panel : null;
        const tops = new Map();
        for (const li of old ? old.querySelectorAll('.ann-item') : [])
            tops.set(li.dataset.id, li.getBoundingClientRect().top);
        // a focused control is found again by its note and its text
        const was = old && old.contains(document.activeElement) && document.activeElement;
        const refocus = was && was.localName === 'button' && [owner(was), was.textContent];
        const y = old ? old.scrollTop : 0;
        closePanel(!!old);
        hideChip();
        const panel = make(DRAWER);
        if (old) panel.classList.add('ann-still');
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
            li.dataset.id = n.id;
            const parts = '.ann-meta .ann-loc .ann-jump .ann-quote .ann-note .ann-imgs';
            const [meta, where, jumper, quote, text, imgs] = $(li, parts);
            where.textContent = `${i + 1} · ${n.kind === 'n' ? '留言' : n.loc || '页面'}`;
            if (n.kind === 'n' || !n.quote) jumper.remove();
            else {
                jumper.onclick = () => jump(n);
                quote.textContent = `「${n.quote}」`;
            }
            Object.assign(text, { textContent: n.note, hidden: !n.note });
            // an asset id read back from the database is shown from the artifact's own path for it
            imgs.replaceChildren(...(n.imgs || []).map((id) => thumb('/_blob/' + id)));
            imgs.hidden = !(n.imgs && n.imgs.length);
            const del = twice('删', '确认删除', 'ann-link ann-bad', () => drop(n));
            meta.append(
                button('改', 'ann-link', () => edit(li, n)),
                del
            );
            if (S.notes.length > 1) {
                const grip = make('<span class="ann-grip" title="拖动排序" aria-hidden="true"></span>');
                grip.onpointerdown = (e) => grab(e, li, n);
                meta.prepend(grip);
                where.after(mover(n, i, -1), mover(n, i, 1));
            }
            ol.append(li);
            if (n.id === focus) on = li;
        });
        if (S.notes.length) acts.append(twice('清空', '确认清空全部', 'ann-link ann-bad', () => drop()));
        acts.append(button('留言', 'ann-btn', () => openComposer({ kind: 'n' })));
        const copyAll = button('复制全部', 'ann-btn ann-primary', () => copy(manual, hint));
        acts.append(Object.assign(copyAll, { disabled: !S.notes.length }));
        show(panel);
        panel.scrollTop = y;
        if (refocus) {
            // ↑ that has reached the top (or ↓ the bottom) hands the focus to the other one
            const [id, text] = refocus;
            const pool = [...panel.querySelectorAll('button:not(:disabled)')].filter((b) => owner(b) === id);
            const same = pool.find((b) => b.textContent === text);
            const b = same || (/^[↑↓]$/.test(text) && pool.find((x) => x.matches('.ann-mv')));
            if (b) b.focus({ preventScroll: true });
        }
        if (on) {
            on.classList.add('ann-on');
            on.scrollIntoView({ block: 'nearest' });
            setTimeout(() => on.classList.remove('ann-on'), 1600);
        }
        if (old) glide(panel, tops);
    };
    // which note a control in the list belongs to ('' for the list's own controls)
    const owner = (el) => (el.closest('.ann-item') || { dataset: {} }).dataset.id || '';
    // the list again, unless a note is being dragged or edited in it (that ends in a redraw of its own)
    const editing = () => !!(S.panel && S.panel.querySelector('.ann-item .ann-ta'));
    const redraw = () => S.panel && S.panel.matches('.ann-drawer') && !S.drag && !editing() && openDrawer();
    // each note that changed place starts where it was on screen and slides to where it is now
    const glide = (panel, tops) => {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const moved = [];
        for (const li of panel.querySelectorAll('.ann-item')) {
            const dy = tops.has(li.dataset.id) ? tops.get(li.dataset.id) - li.getBoundingClientRect().top : 0;
            if (Math.abs(dy) >= 1) moved.push([li, dy]);
        }
        for (const [li, dy] of moved) li.style.translate = `0 ${dy}px`;
        void panel.offsetWidth; // the slide starts from there
        for (const [li] of moved) (li.classList.add('ann-glide'), (li.style.translate = ''));
    };
    // Put note `id` at place `to` among the others. Only that note changes, unless its new neighbours leave no room
    // between them (a tie, or a gap halved too often): then the list is spaced out again and each note that changes
    // is written. Where a note was before is kept until its write is through, to go back to if it fails.
    const ROOM = 1000;
    const move = (id, to) => {
        const n = S.notes.find((x) => x.id === id);
        const rest = S.notes.filter((x) => x !== n);
        if (!n || to < 0 || to > rest.length || S.notes.indexOf(n) === to) return false;
        const [lo, hi] = [rest[to - 1], rest[to]];
        const mid = !lo ? rank(hi) - ROOM : !hi ? rank(lo) + ROOM : (rank(lo) + rank(hi)) / 2;
        const base = Math.min(...S.notes.map(rank));
        rest.splice(to, 0, n);
        const fits = !lo || !hi || (mid > rank(lo) && mid < rank(hi));
        const moves = fits ? [[n, mid]] : rest.map((x, i) => [x, base + i * ROOM]).filter(([x, p]) => x.pos !== p);
        for (const [x, p] of moves) {
            if (!S.held.has(x.id)) S.from.set(x.id, x.pos);
            S.held.set(x.id, (S.held.get(x.id) || 0) + 1);
            x.pos = p;
            sendPos(x.id);
        }
        S.notes = rest;
        save();
        paint();
        return true;
    };
    // ↑ / ↓ beside a note's number; to a screen reader the label says which note it moves
    const mover = (n, i, by) => {
        const label = by < 0 ? '上移' : '下移';
        const b = button(by < 0 ? '↑' : '↓', 'ann-fb ann-mv', (e) => nudge(n, i + by, e));
        Object.assign(b, { title: label, disabled: i + by < 0 || i + by >= S.notes.length });
        b.setAttribute('aria-label', `${label}第 ${i + 1} 条`);
        return b;
    };
    // Just after a note moved, a click at the same spot that lands on another note's button (it slid there with the
    // move) is not taken: the second click of a quick double click was meant for the note that moved. Keys are always
    // taken; the focus stays on the moved note's button.
    const nudge = (n, to, e) => {
        const [last, now, at] = [S.nudged, Date.now(), e && e.detail ? [e.clientX, e.clientY] : null];
        const again = last && at && last.at && Math.hypot(at[0] - last.at[0], at[1] - last.at[1]) < 12;
        if (editing() || (again && last.id !== n.id && now - last.t < 450)) return;
        if (!move(n.id, to)) return;
        S.nudged = { id: n.id, t: now, at };
        openDrawer(n.id);
    };
    // Dragged by its grip (a mouse or a pen; a phone has the buttons), a note is lifted and follows the pointer, the
    // others make room on the spring, and near the top or bottom of the list it scrolls along. On release it takes
    // the place between the two notes it was dropped between; Escape or a lost pointer puts it back.
    const grab = (e, li, n) => {
        if (e.button || S.drag || editing()) return;
        e.preventDefault();
        const [grip, box, ol] = [e.currentTarget, li.closest('.ann-panel'), li.parentElement];
        const items = [...ol.children];
        const from = items.indexOf(li);
        // in the list's own coordinates, as laid out (a note still sliding counts where it is going)
        const mids = items.map((x) => x.offsetTop + x.offsetHeight / 2);
        const room = li.offsetHeight + (parseFloat(getComputedStyle(ol).rowGap) || 0);
        const bar = box.querySelector('.ann-acts');
        const d = (S.drag = { to: from, y: e.clientY, at: e.clientY, top: box.scrollTop, raf: 0 });
        const track = () => {
            const dy = d.at - d.y + box.scrollTop - d.top;
            li.style.translate = `0 ${dy}px`;
            const to = items.reduce((k, _, j) => (j !== from && mids[j] < mids[from] + dy ? k + 1 : k), 0);
            if (to === d.to) return;
            d.to = to;
            items.forEach((x, j) => {
                const by = from < j && j <= to ? -room : to <= j && j < from ? room : 0;
                if (j !== from) x.style.translate = by ? `0 ${by}px` : '';
            });
        };
        // within 40px of the list's top or bottom edge it scrolls, faster nearer the edge
        const tick = () => {
            const r = box.getBoundingClientRect();
            const bottom = bar ? Math.min(r.bottom, bar.getBoundingClientRect().top) : r.bottom;
            const v = d.at < r.top + 40 ? d.at - r.top - 40 : d.at > bottom - 40 ? d.at - bottom + 40 : 0;
            const top = box.scrollTop;
            if (v) box.scrollTop += Math.max(-16, Math.min(16, v / 3));
            if (box.scrollTop !== top) track();
            d.raf = requestAnimationFrame(tick);
        };
        d.end = (put) => {
            if (S.drag !== d) return;
            S.drag = null;
            cancelAnimationFrame(d.raf);
            if (put && d.to !== from) {
                // between the same neighbours in the list as it is now (another device may have changed it)
                const rest = items.filter((x) => x !== li);
                const [prev, next] = [rest[d.to - 1], rest[d.to]].map((x) => x && x.dataset.id);
                const others = S.notes.filter((x) => x.id !== n.id);
                const at = next ? others.findIndex((x) => x.id === next) : -1;
                move(n.id, at >= 0 ? at : others.findIndex((x) => x.id === prev) + 1);
            }
            openDrawer();
        };
        attempt(() => grip.setPointerCapture(e.pointerId));
        grip.onpointermove = (ev) => ((d.at = ev.clientY), track());
        grip.onpointerup = () => d.end(true);
        grip.onpointercancel = grip.onlostpointercapture = () => d.end(false);
        box.classList.add('ann-still', 'ann-dragging');
        li.classList.add('ann-lift');
        for (const x of items) if (x !== li) x.classList.add('ann-glide');
        d.raf = requestAnimationFrame(tick);
    };
    const edit = (li, n) => {
        const ta = make('<textarea class="ann-ta" rows="3" enterkeyhint="done" aria-label="改批注"></textarea>');
        const row = make('<div class="ann-row"></div>');
        const back = () => openDrawer(n.id);
        const keep = () => {
            if (!clean(ta.value) && !(n.imgs && n.imgs.length)) return ta.focus();
            // the list may have been read again from the database meanwhile: the note as it is now
            const cur = S.notes.find((x) => x.id === n.id) || n;
            cur.note = clean(ta.value);
            save();
            send(cur);
            back();
            toast('改好了');
        };
        field(ta, keep, back).value = n.note;
        row.append(button('取消', 'ann-btn', back), button('保存', 'ann-btn ann-primary', keep));
        for (const b of li.querySelectorAll('.ann-meta button')) b.remove();
        li.querySelector('.ann-note').replaceWith(ta, row);
        // no moving while a note is open for editing (a move redraws the list)
        li.closest('.ann-panel').classList.add('ann-editing');
        // editing in the phone's list: the list moves up out of the keyboard's way, this note in view
        const sheet = li.closest('.ann-sheet');
        if (sheet) (sheet.classList.add('ann-top', 'ann-still'), fit());
        grow(ta);
        ta.focus();
        ta.scrollIntoView({ block: 'nearest' });
    };
    // one note, or all of them
    const drop = (n) => {
        for (const gone of n ? [n] : S.notes) unsend(gone);
        S.notes = n ? S.notes.filter((x) => x.id !== n.id) : [];
        if (n) S.marks.delete(n.id);
        else S.marks.clear();
        save();
        paint();
        openDrawer();
    };
    // from the list, or from the dock without opening it (`manual` and `hint` not given)
    const copy = async (manual, hint, text = exportText()) => {
        try {
            await navigator.clipboard.writeText(text);
            // copied: an open list has done its job, so it closes; a note being written stays
            if (S.panel && S.panel.matches('.ann-drawer')) closePanel();
            return toast('已复制，粘贴到对话里就行');
        } catch {
            // no async clipboard (some app views, plain http): select the text for a manual copy, in the list
        }
        if (!manual) {
            openDrawer();
            [hint, manual] = $(S.panel, '.ann-hint textarea');
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
        // outside annotate mode a picture in the report opens large (not one that is a link)
        if (!S.picking) {
            const pic = !inUI(e.target) && e.target.closest && e.target.closest('img');
            if (pic && !pic.closest('a')) viewPic(pic.currentSrc || pic.src);
            return;
        }
        if (inUI(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (typed()) return S.ta.focus(); // a half-written note is not dropped by a tap elsewhere
        const [s, el] = [selInfo(), blockOf(e.target)];
        if (s) openComposer(fromSelection(s));
        else if (el) openComposer(target(el, summary(el)));
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
        // a tap beside the open list closes it, as the scrim does on a phone; a drag that selects text does not
        const tap = down && Math.hypot(x - down[0], y - down[1]) <= 8;
        if (S.panel && S.panel.matches('.ann-drawer') && tap && !inUI(e.target) && Date.now() - S.shown > 300)
            return closePanel();
        if (!HL || S.panel || !down || inUI(e.target) || Math.hypot(x - down[0], y - down[1]) > 8) return;
        if (e.target.closest && e.target.closest('a,button,input,select,textarea,summary,label')) return;
        const within = (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        const hit = S.notes.find((n) => {
            const m = S.marks.get(n.id);
            return m && m.range && [...m.range.getClientRects()].some(within);
        });
        if (hit) setTimeout(() => getSelection().isCollapsed && openDrawer(hit.id));
    };
    // Find in the page. Hits are CSS highlights, so the page's DOM, the notes' anchors and a selection being made stay
    // as they are; without the Highlight API the block of the hit flashes instead. The bar keeps its words for the
    // next time it opens, and Ctrl+F / ⌘F pressed inside it again is the browser's own find.
    const MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
    const FIND_MAX = 1000;
    const SKIP = 'script,style,noscript,template,textarea,select,nav'; // nav: the contents repeat the headings
    const LINES = /^(pre|pre-wrap|pre-line|break-spaces)$/;
    const F = { on: false, hits: [], at: -1, more: false, opened: new Set(), wait: 0, seq: 0, from: null, anim: null };
    // lower case that keeps every character where it was (the rare letter that grows when lowered stays as it is)
    const lower = (s, l = s.toLowerCase()) =>
        l.length === s.length ? l : s.replace(/[^]/g, (c) => (c.toLowerCase().length === 1 ? c.toLowerCase() : c));
    const fold = (s) => lower(s.replace(/\s+/g, ' ').trim());
    // The page's text as one folded string, each character tied to its place. Text that reads on (inline elements in
    // one block) joins up, a run of white space is one space, and a new block, a <br> or a line break in preformatted
    // text starts a new line, so a hit never runs across them. Left out: the layer, form fields, the contents and
    // anything display:none or visibility:hidden; the text of a closed <details> is in, and a hit there opens it.
    const scan = () => {
        const [chars, nodes, offs, seen] = [[], [], [], new Map()];
        const cut = () =>
            chars.length && chars[chars.length - 1] !== '\n' && (chars.push('\n'), nodes.push(null), offs.push(0));
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => {
                if (n.nodeType === 3 || n.localName === 'br') return NodeFilter.FILTER_ACCEPT;
                if (n === root || n.matches(SKIP)) return NodeFilter.FILTER_REJECT;
                const cs = getComputedStyle(n);
                if (cs.display === 'none') return NodeFilter.FILTER_REJECT;
                const up = seen.get(n.parentElement);
                const inline = up && (cs.display === 'inline' || cs.display === 'contents');
                seen.set(n, {
                    block: inline ? up.block : n,
                    shown: cs.visibility === 'visible',
                    lines: LINES.test(cs.whiteSpace)
                });
                return NodeFilter.FILTER_SKIP;
            }
        });
        let block = null;
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            if (n.nodeType === 1) {
                cut();
                continue;
            }
            const at = seen.get(n.parentElement) || { block: document.body, shown: true };
            if (!at.shown) continue;
            if (at.block !== block) ((block = at.block), cut());
            const text = n.data;
            const folded = lower(text);
            for (let i = 0; i < text.length; i++) {
                let c = folded[i];
                if (c === '\n' && at.lines) {
                    cut();
                    continue;
                }
                if (/\s/.test(c)) {
                    if (!chars.length || /[ \n]/.test(chars[chars.length - 1])) continue;
                    c = ' ';
                }
                chars.push(c);
                nodes.push(n);
                offs.push(i);
            }
        }
        return { text: chars.join(''), nodes, offs };
    };
    // where a hit is down the window; one in a closed <details> is where that shows its summary
    const yOf = (r) => {
        const box = r.getClientRects()[0];
        if (box) return box.bottom;
        let shut = null;
        for (let e = r.startContainer.parentElement; e; e = e.parentElement)
            if (e.localName === 'details' && !e.open) shut = e;
        return shut ? shut.getBoundingClientRect().bottom : -1;
    };
    // a hit inside closed <details> opens them; ones opened for an earlier hit close again
    const unfold = (r) => {
        const holds = new Set();
        for (let e = r && r.startContainer.parentElement; e; e = e.parentElement) {
            if (e.localName !== 'details') continue;
            holds.add(e);
            const sum = e.querySelector(':scope > summary');
            if (!e.open && !(sum && sum.contains(r.startContainer))) ((e.open = true), F.opened.add(e));
        }
        for (const d of F.opened) if (!holds.has(d)) ((d.open = false), F.opened.delete(d));
    };
    // Into the boxes that scroll on their own first (a wide table), then into the window: between the bar and the
    // dock, or on a phone being typed on above the keyboard (a frame is not told about it; it takes the lower half).
    // A hit in sight already stays where it is. It jumps, as a browser's find does: stepping through hits quickly,
    // a glide would still be on its way (and one glide started over another lands short).
    const reveal = (r) => {
        const el = r.startContainer.parentElement;
        for (let e = el; e && e !== document.body; e = e.parentElement) {
            const [cs, box, hit] = [getComputedStyle(e), e.getBoundingClientRect(), r.getBoundingClientRect()];
            if (
                e.scrollWidth > e.clientWidth &&
                /auto|scroll/.test(cs.overflowX) &&
                (hit.left < box.left || hit.right > box.right)
            )
                e.scrollLeft += hit.left - box.left - (box.width - hit.width) / 2;
            if (
                e.scrollHeight > e.clientHeight &&
                /auto|scroll/.test(cs.overflowY) &&
                (hit.top < box.top || hit.bottom > box.bottom)
            )
                e.scrollTop += hit.top - box.top - (box.height - hit.height) / 2;
        }
        if (!HL) flash({ el: blockOf(el) || el });
        const hit = r.getBoundingClientRect();
        const typing = document.activeElement === q && matchMedia('(pointer: coarse)').matches;
        const [top, bottom] = [
            finder.getBoundingClientRect().bottom + 12,
            typing ? innerHeight * 0.44 : innerHeight - 72
        ];
        if (hit.height && hit.top >= top && hit.bottom <= bottom) return;
        scrollTo({ top: scrollY + hit.top - (top + bottom - hit.height) / 2, behavior: 'instant' });
    };
    const go = (at) => {
        F.at = at;
        const r = F.hits[at];
        if (HL && r) CSS.highlights.set('ann-find-now', Object.assign(new Highlight(r), { priority: 2 }));
        else if (HL) CSS.highlights.delete('ann-find-now');
        unfold(r);
        const [n, asked] = [F.hits.length, !!q.value.trim()];
        count.textContent = !asked ? '' : n ? `第 ${at + 1} / 共 ${n}${F.more ? '+' : ''} 处` : '无结果';
        finder.toggleAttribute('data-miss', asked && !n);
        prevB.disabled = nextB.disabled = !n;
        if (r) reveal(r);
    };
    // case does not count, nor how much white space; refining the words keeps to the hit it was on, a new search
    // starts from what is in view
    const search = () => {
        clearTimeout(F.wait);
        F.wait = 0;
        const needle = fold(q.value);
        const was = F.hits[F.at];
        Object.assign(F, { hits: [], more: false });
        const map = needle ? scan() : { text: '' };
        for (let i = needle ? map.text.indexOf(needle) : -1; i >= 0; i = map.text.indexOf(needle, i + needle.length)) {
            if (F.hits.length === FIND_MAX) {
                F.more = true;
                break;
            }
            const [end, r] = [i + needle.length - 1, document.createRange()];
            r.setStart(map.nodes[i], map.offs[i]);
            r.setEnd(map.nodes[end], map.offs[end] + 1);
            F.hits.push(r);
        }
        if (HL && F.hits.length)
            CSS.highlights.set('ann-find', Object.assign(new Highlight(...F.hits), { priority: 1 }));
        else if (HL) CSS.highlights.delete('ann-find');
        const top = finder.getBoundingClientRect().bottom;
        const at = F.hits.findIndex((r) =>
            was ? r.compareBoundaryPoints(Range.START_TO_START, was) >= 0 : yOf(r) > top
        );
        go(at < 0 && F.hits.length ? 0 : at);
    };
    // words still being typed are searched first, and that search stands on its first hit
    const stepFind = (by) => (F.wait ? search() : F.hits.length && go((F.at + by + F.hits.length) % F.hits.length));
    const openFind = () => {
        if (S.view && S.view.isConnected) leave(S.view, { opacity: 0 });
        if (F.anim) F.anim.cancel();
        F.seq++;
        if (!F.on) {
            const now = document.activeElement;
            F.from = now && now !== document.body && !finder.contains(now) ? now : null;
            F.on = true;
            finder.hidden = false;
            seek.setAttribute('aria-expanded', 'true');
            if (q.value.trim()) search();
        }
        q.focus();
        q.setSelectionRange(0, q.value.length);
    };
    // the marks go and the page is as it was, but for a <details> the hit being read is in: that stays open
    const closeFind = () => {
        if (!F.on) return;
        clearTimeout(F.wait);
        if (HL) (CSS.highlights.delete('ann-find'), CSS.highlights.delete('ann-find-now'));
        F.opened.clear();
        Object.assign(F, { on: false, hits: [], at: -1, wait: 0 });
        seek.setAttribute('aria-expanded', 'false');
        // the focus goes back to where it was on the page, or just out of the bar
        if (finder.contains(document.activeElement)) {
            if (F.from && F.from.isConnected) F.from.focus({ preventScroll: true });
            else document.activeElement.blur();
        }
        F.from = null;
        const seq = ++F.seq;
        const done = () => seq === F.seq && (finder.hidden = true);
        if (matchMedia('(prefers-reduced-motion: reduce)').matches || !finder.animate) return done();
        const to = { opacity: 0, translate: '0 -8px' };
        F.anim = finder.animate([{}, to], { duration: 160, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
        F.anim.finished.then(done, done);
        setTimeout(done, 280);
    };
    // Ctrl+F (⌘F on a Mac) opens the bar wherever the focus is on the page; Ctrl/⌘+G or F3 step while it is open. A
    // sheet open on a phone keeps the keys, and the bar's own field hands the shortcut to the browser.
    const onFindKey = (e) => {
        if (e.isComposing || e.keyCode === 229 || e.altKey) return;
        const mod = MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
        const key = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : (e.code || '').replace(/^Key/, '').toLowerCase();
        const open = mod && key === 'f' && !e.shiftKey && e.target !== q && !(S.panel && S.panel.matches('.ann-sheet'));
        const step = F.on && F.hits.length && ((mod && key === 'g') || e.key === 'F3');
        if (!open && !step) return;
        e.preventDefault();
        e.stopPropagation();
        if (open) openFind();
        else stepFind(e.shiftKey ? -1 : 1);
    };

    // Escape puts back a note being dragged, else closes a picture, then the panel, then leaves annotate mode, then
    // the find bar; not while an IME candidate is open (Escape cancels it). Over a picture, + − 0 1 zoom it.
    const onKey = (e) =>
        (S.view && S.view.isConnected && /^[-+=01]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.target.closest?.('input, textarea')
            ? (e.preventDefault(), S.view.zoomKey(e.key === '=' ? '+' : e.key), true)
            : false) ||
        (e.key === 'Escape' &&
        !e.isComposing &&
        e.keyCode !== 229 &&
        (S.drag
            ? S.drag.end(false)
            : S.view && S.view.isConnected
              ? leave(S.view, { opacity: 0 })
              : S.panel
                ? closePanel()
                : S.picking
                  ? setPicking(false)
                  : F.on
                    ? closeFind()
                    : hideChip()));

    const start = () => {
        // annotate2: notes the browser-only layer kept for a page that is now republished were handled from the
        // copied list already; under a new key they are not sent up into the database as if they were new
        S.key = `annotate2:${cfg.source || location.pathname}|${squash(document.title)}`;
        S.notes = load();
        const probe = S.key + ':probe';
        S.volatile = !attempt(() => (localStorage.setItem(probe, 1), localStorage.removeItem(probe), 1));
        root = make(ROOT);
        const parts =
            '.ann-pins .ann-ring .ann-chip .ann-banner .ann-free .ann-list .ann-copy .ann-badge .ann-pill .ann-toast .ann-scrim';
        let free;
        [pins, ring, chip, banner, free, list, copier, badge, pill, toastEl, scrim] = $(root, parts);
        pill.textContent = cfg.label;
        banner.textContent = `点一下要批注的内容 · 再点「${cfg.label}」退出`;
        pill.onclick = () => closePanel() || setPicking(!S.picking);
        free.onclick = () => openComposer({ kind: 'n' });
        list.onclick = () => (S.panel && S.panel.matches('.ann-drawer') ? closePanel() : openDrawer());
        copier.onclick = () => copy();
        let closer;
        [finder, q, count, seek] = $(root, '.ann-find .ann-q .ann-count .ann-seek');
        [prevB, nextB, closer] = finder.querySelectorAll('.ann-fb');
        const keys = MAC ? '⌘F' : 'Ctrl+F';
        Object.assign(seek, { title: `搜索（${keys}）`, onclick: () => (F.on ? closeFind() : openFind()) });
        seek.setAttribute('aria-label', `搜索这份报告（${keys}）`);
        seek.setAttribute('aria-keyshortcuts', MAC ? 'Meta+F' : 'Control+F');
        prevB.onclick = () => stepFind(-1);
        nextB.onclick = () => stepFind(1);
        closer.onclick = closeFind;
        // typing searches after a pause, and an IME's letters once a candidate is chosen; Enter steps, Escape closes
        let composing = false;
        const soon = () => (clearTimeout(F.wait), (F.wait = setTimeout(search, 160)));
        q.addEventListener('input', (e) => composing || e.isComposing || soon());
        q.addEventListener('compositionstart', () => (composing = true));
        q.addEventListener('compositionend', () => (setTimeout(() => (composing = false)), soon()));
        q.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || composing || e.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            stepFind(e.shiftKey ? -1 : 1);
        });
        finder.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || composing || e.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            e.stopPropagation();
            closeFind();
        });
        // the tap that opened a sheet must not close it again through the scrim
        scrim.onclick = () => Date.now() - S.shown > 400 && !typed() && closePanel();
        chip.onmousedown = (e) => e.preventDefault(); // keep the selection on desktop
        chip.onclick = () => S.sel && openComposer(fromSelection(S.sel));
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
        addEventListener('keydown', onFindKey, true); // before the page's own shortcuts
        addEventListener('resize', () => {
            hideChip();
            fit();
            later();
            // a new width wraps the text differently
            if (S.panel) S.panel.querySelectorAll('.ann-ta:not([readonly])').forEach((ta) => grow(ta));
        });
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
