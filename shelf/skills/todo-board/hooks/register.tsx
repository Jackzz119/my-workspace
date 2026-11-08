import { atom, read, update } from 'claude-code';
import type { EngineInterface, Register } from 'claude-code';

import type { TodoItem, TodoProject, TodoSummary } from '../types';

// The todos live in the 待办 page, a claude.ai artifact whose database and
// image store follow the account to every device and app. This mod keeps a
// copy in ai/board/board.md (pictures in ai/board/images/) for agents that
// cannot reach the page, takes back the lines someone typed into that file,
// and draws a band above the prompt that opens the page.
const SYNC_EVERY_MS = 3 * 60_000;
const PAGE_LINK = /https:\/\/claude\.ai\/artifact\/[A-Za-z0-9]+/;
const ASSET_FILE = /^([0-9a-f]{32})(\.[A-Za-z0-9]+)$/;
const SAVED = /Asset saved: ("(?:[^"\\]|\\.)*")/;

const project = atom({ plugin: 'todo-board', key: 'project' } as const, null, {
    shape: 'project-1'
});
const summary = atom({ plugin: 'todo-board', key: 'summary' } as const, null, { shape: 'summary-1' });
const note = atom({ plugin: 'todo-board', key: 'note' } as const, null);

type Host = { os: 'windows' | 'mac' | 'other'; sep: string };
type Places = { sep: string; aiDir: string; dir: string; board: string; images: string };
type Board = { head: string[]; items: TodoItem[]; tail: string[] };

/** One todo as the page stores it, with the version a write pins. */
export type Remote = {
    id: string;
    version: number;
    text: string;
    done: boolean;
    at: string | null;
    doneAt: string | null;
    order: number;
    images: { id: string; w: number; h: number }[];
};

/** What the page needs to hear about lines changed in board.md. */
export type Takeback = {
    creates: Remote[];
    changes: { id: string; version: number; patch: Record<string, unknown> }[];
};

let host: Promise<Host> | undefined;
const aiDirs = new Map<string, Promise<string>>();
let syncing: Promise<string> | undefined;
let lastSyncAt = 0;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const minute = (iso: string | null) => (iso && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(iso) ? `${iso.slice(0, 16)}Z` : null);
const hash = (text: string) => {
    let n = 5381;
    for (const char of text) n = ((n * 33) ^ (char.codePointAt(0) ?? 0)) >>> 0;

    return n.toString(36);
};

// Keys name folders too, so nothing a file system refuses (`:` on Windows).
const slug = (part: string) => part.replace(/[^A-Za-z0-9_.\-@+]/g, '-').replace(/^\.+$/, '-');

export function localProject(folder: string): TodoProject {
    const name = folder || 'project';

    return { key: `local~${slug(name.toLowerCase())}`.slice(0, 200), name, source: null };
}

// Every clone of one repository maps to the same key, whatever the machine or
// the spelling of the remote (https, ssh, scp-like, with credentials).
export function projectFromRemote(remote: string, folder: string): TodoProject {
    const source = remote
        .trim()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
        .replace(/^[^@/]+@/, '')
        .replace(/^([^/:]+):\d+\//, '$1/')
        .replace(/^([^/:]+):/, '$1/')
        .replace(/\.git$/i, '')
        .replace(/\/+$/, '')
        .toLowerCase();
    const parts = source.split('/').map(slug).filter(Boolean);
    if (parts.length < 2) return localProject(folder);

    return {
        key: parts.join('~').slice(0, 200),
        name: parts.at(-1) ?? folder,
        source: parts.join('/')
    };
}

// ---------- board.md ----------

const ITEM_LINE = /^[-*] \[([ xX])\](?: (.*))?$/;
const META = /\s*<!--\s*(.*?)\s*-->\s*$/;
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const SIZE = /(\d+)\s*[x×]\s*(\d+)/;

const DEFAULT_HEAD = ['# 个人待办', '', '> 用户自己的随手清单，不是项目任务来源。'];

// The paragraph that says where the original is; the mod reads the link back from it.
export function withLink(head: string[], link: string, aiDir: string): string[] {
    if (head.length > 0) return [...head, '', `> 正本在[待办页](${link})。`];

    return [
        '# 个人待办',
        '',
        `> 用户自己的随手清单，不是项目任务来源（任务看 [TODO](../TODO.md)）。正本在[待办页](${link})（claude.ai，跟账号走，手机电脑都能开）；这里是 Claude Code 会话同步过来的副本，给别的 agent 读。在这里新加一行 \`- [ ] 文字\`（不带注释），下次同步会收进待办页。格式见 \`${aiDir}/jaSkills/todo-board/SKILL.md\`。`
    ];
}

const escapeHtml = (text: string) =>
    text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

// page/board.html names its project and its copy through these two slots.
export function fillPage(source: string, name: string, board: string): string {
    return source.replaceAll('{{name}}', () => escapeHtml(name)).replaceAll('{{board}}', () => escapeHtml(board));
}

const trimEnd = (lines: string[]) => {
    const kept = [...lines];
    while (kept.length > 0 && kept.at(-1)?.trim() === '') kept.pop();

    return kept;
};

// A todo is a `- [ ]` / `- [x]` line, its id and times in the comment at its
// end, its further text and pictures on the lines indented under it. What comes
// before the first todo, and from the first other line after them, is kept as
// written. A line typed by hand without a comment gets an id from its text.
export function parseBoard(text: string): Board {
    const head: string[] = [];
    const list: TodoItem[] = [];
    const tail: string[] = [];
    const seen = new Set<string>();
    let current: TodoItem | null = null;
    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
        if (tail.length > 0) {
            tail.push(line);
            continue;
        }
        const start = ITEM_LINE.exec(line);
        if (start) {
            let body = start[2] ?? '';
            const fields = new Map<string, string>();
            const meta = META.exec(body);
            if (meta) {
                body = body.slice(0, meta.index);
                for (const part of (meta[1] ?? '').split(/\s+/)) {
                    const cut = part.indexOf(':');
                    if (cut > 0) fields.set(part.slice(0, cut), part.slice(cut + 1));
                }
            }
            let id = fields.get('id') ?? `h${hash(body.trim())}`;
            if (seen.has(id)) id = `${id}-${list.length}`;
            seen.add(id);
            current = {
                id,
                text: body.trim(),
                images: [],
                done: start[1] !== ' ',
                at: fields.get('at') ?? null,
                doneAt: fields.get('done') ?? null
            };
            list.push(current);
            continue;
        }
        if (!current) {
            head.push(line);
            continue;
        }
        if (line.trim() === '') continue;
        const under = /^(?: {2,}|\t)(.*)$/.exec(line);
        if (!under) {
            tail.push(line);
            continue;
        }
        const content = (under[1] ?? '').trim();
        const image = IMAGE_LINE.exec(content);
        if (image) {
            const size = SIZE.exec(image[1] ?? '');
            current.images.push({
                path: image[2] ?? '',
                w: size ? Number(size[1]) : 0,
                h: size ? Number(size[2]) : 0
            });
        } else {
            current.text = current.text ? `${current.text}\n${content}` : content;
        }
    }

    return { head: trimEnd(head), items: list, tail: trimEnd(tail) };
}

export function formatBoard(board: Board): string {
    const lines = [...(board.head.length > 0 ? board.head : DEFAULT_HEAD), ''];
    for (const item of board.items) {
        const [first = '', ...rest] = item.text.split('\n');
        const meta = [`id:${item.id}`, item.at && `at:${item.at}`, item.doneAt && `done:${item.doneAt}`]
            .filter(Boolean)
            .join(' ');
        lines.push(`- [${item.done ? 'x' : ' '}] ${first ? `${first} ` : ''}<!-- ${meta} -->`);
        for (const line of rest) lines.push(`  ${line}`);
        for (const image of item.images) {
            lines.push(`  ![${image.w && image.h ? `${image.w}×${image.h}` : '图片'}](${image.path})`);
        }
    }
    if (board.tail.length > 0) lines.push('', ...board.tail);

    return `${lines.join('\n')}\n`;
}

// ---------- the page's store ----------

// ArtifactData answers in text: one JSON line per document between its
// BEGIN and END markers, a sentence when there is none.
export function parseDocs(text: string): { id: string; version: number; data: Record<string, unknown> }[] {
    const docs: { id: string; version: number; data: Record<string, unknown> }[] = [];
    for (const line of text.split('\n')) {
        if (!line.startsWith('{')) continue;
        try {
            const doc = JSON.parse(line) as { id?: unknown; version?: unknown; data?: unknown };
            if (typeof doc.id === 'string' && doc.data && typeof doc.data === 'object') {
                docs.push({ id: doc.id, version: Number(doc.version) || 0, data: doc.data as Record<string, unknown> });
            }
        } catch {
            // a line of prose that opens with a brace
        }
    }

    return docs;
}

export function remoteOf(doc: { id: string; version: number; data: Record<string, unknown> }): Remote {
    const d = doc.data;
    const images = Array.isArray(d.images)
        ? (d.images as { id?: unknown; w?: unknown; h?: unknown }[])
              .filter((p) => typeof p?.id === 'string' && /^[0-9a-f]{32}$/.test(p.id))
              .map((p) => ({ id: String(p.id), w: Number(p.w) || 0, h: Number(p.h) || 0 }))
        : [];

    return {
        id: doc.id,
        version: doc.version,
        text: typeof d.text === 'string' ? d.text : '',
        done: d.done === true,
        at: typeof d.at === 'string' ? d.at : null,
        doneAt: typeof d.doneAt === 'string' ? d.doneAt : null,
        order: Number(d.order) || 0,
        images
    };
}

// What changed in board.md since this device last wrote it, for the page:
// a line typed without a comment is new; a tick or an edit on a known line
// counts only while the page still holds what was written, so the page's
// own later change always wins. Lines whose todo the page deleted stay gone.
export function takeBack(file: Board, base: Board | null, remote: Remote[], gone: Set<string>, nowMs: number): Takeback {
    const byId = new Map(remote.map((r) => [r.id, r]));
    const was = new Map((base?.items ?? []).map((item) => [item.id, item]));
    const now = new Date(nowMs).toISOString();
    const out: Takeback = { creates: [], changes: [] };
    file.items.forEach((item, index) => {
        const r = byId.get(item.id);
        if (r) {
            const before = was.get(item.id);
            const isEdited = before && (before.done !== item.done || before.text !== item.text);
            const isPageSame = before && r.done === before.done && r.text === before.text;
            if (isEdited && isPageSame) {
                out.changes.push({
                    id: r.id,
                    version: r.version,
                    patch: { text: item.text, done: item.done, doneAt: item.done ? (r.doneAt ?? now) : null, updatedAt: now }
                });
            }

            return;
        }
        const isTyped = item.at === null && item.id.startsWith('h');
        if (!isTyped || gone.has(item.id) || was.has(item.id) || (!item.text && item.images.length === 0)) return;
        out.creates.push({
            id: newId() + index,
            version: 0,
            text: item.text,
            done: item.done,
            at: now,
            doneAt: item.done ? now : null,
            order: nowMs - index,
            images: []
        });
    });

    return out;
}

// The copy: open todos newest first, then the done ones by when they were ticked.
export function mirrorOf(head: string[], tail: string[], remote: Remote[], ext: Map<string, string>): Board {
    const open = remote.filter((r) => !r.done).sort((a, b) => b.order - a.order);
    const done = remote
        .filter((r) => r.done)
        .sort((a, b) => String(b.doneAt ?? '').localeCompare(String(a.doneAt ?? '')));
    const items = [...open, ...done].map((r) => ({
        id: r.id,
        text: r.text,
        done: r.done,
        at: minute(r.at),
        doneAt: r.done ? minute(r.doneAt) : null,
        images: r.images.map((p) => ({ path: `images/${p.id}${ext.get(p.id) ?? '.jpg'}`, w: p.w, h: p.h }))
    }));

    return { head, items, tail };
}

async function ask($: EngineInterface, input: Record<string, unknown>, consent?: string): Promise<string> {
    const call = { ...input, ...(consent ? { consent } : {}) } as unknown as Parameters<EngineInterface['tool']['call']>[0];
    const got = (await $.tool.call(call)) as { deny?: string; text?: string; isError?: boolean };
    if (got.deny !== undefined) throw new Error(got.deny);
    if (got.isError) throw new Error(got.text ?? '没成功');

    return got.text ?? '';
}

// ---------- where things are ----------

async function resolveProject($: EngineInterface): Promise<TodoProject> {
    const root = await $.session.root();
    const folder = root.split(/[\\/]/).filter(Boolean).pop() ?? 'project';
    try {
        const got = await $.process.run(['git', 'remote', 'get-url', 'origin'], {
            cwd: root,
            timeoutMs: 5000
        });
        if (got.exitCode === 0 && got.stdout.trim()) return projectFromRemote(got.stdout, folder);
    } catch {
        // no git on this machine
    }

    return localProject(folder);
}

function hostOf($: EngineInterface): Promise<Host> {
    host ??= (async (): Promise<Host> => {
        if ((await $.env.get('OS')) === 'Windows_NT') return { os: 'windows', sep: '\\' };
        const uname = await $.process.run(['uname'], { timeoutMs: 5000 }).catch(() => undefined);

        return { os: uname?.stdout.trim() === 'Darwin' ? 'mac' : 'other', sep: '/' };
    })();

    return host;
}

// The project's ai folder as the shelf ledger names it (`AI` in .NET projects).
async function aiDirOf($: EngineInterface, root: string, sep: string): Promise<string> {
    const ledger = await $.fs.read(`${root}${sep}.shelf.json`).catch(() => '');
    try {
        const dir = (JSON.parse(ledger) as { aiDir?: unknown }).aiDir;
        if (typeof dir === 'string' && /^[A-Za-z0-9_.-]+$/.test(dir)) return dir;
    } catch {
        // no ledger: the default
    }

    return 'ai';
}

async function placesOf($: EngineInterface): Promise<Places> {
    const [h, rawRoot] = await Promise.all([hostOf($), $.session.root()]);
    const root = rawRoot.replace(/[\\/]+$/, '');
    if (!aiDirs.has(root)) aiDirs.set(root, aiDirOf($, root, h.sep));
    const ai = (await aiDirs.get(root)) ?? 'ai';
    const dir = [root, ai, 'board'].join(h.sep);

    return { sep: h.sep, aiDir: ai, dir, board: `${dir}${h.sep}board.md`, images: `${dir}${h.sep}images` };
}

async function readFile($: EngineInterface, p: Places): Promise<{ text: string; board: Board; page: string | null }> {
    const text = await $.fs.read(p.board).catch(() => '');
    const board = parseBoard(text);

    return { text, board, page: PAGE_LINK.exec(board.head.join('\n'))?.[0] ?? null };
}

const countOf = (list: { done: boolean }[]): TodoSummary => ({
    open: list.filter((item) => !item.done).length,
    done: list.filter((item) => item.done).length
});

// ---------- pictures ----------

async function run($: EngineInterface, argv: string[]): Promise<void> {
    await $.process.run(argv, { timeoutMs: 20_000 }).catch(() => undefined);
}

// Pictures come down from the page once, named by their id; ones no todo
// links any more go.
async function syncImages($: EngineInterface, p: Places, page: string, remote: Remote[]): Promise<Map<string, string>> {
    const h = await hostOf($);
    const ext = new Map<string, string>();
    const files = await $.fs.list(p.images).catch(() => []);
    for (const entry of files) {
        const named = entry.kind === 'file' ? ASSET_FILE.exec(entry.name) : null;
        if (named?.[1] && named[2]) ext.set(named[1], named[2]);
    }
    const wanted = new Set(remote.flatMap((r) => r.images.map((image) => image.id)));
    const missing = [...wanted].filter((id) => !ext.has(id));
    if (missing.length > 0) await run($, h.os === 'windows' ? ['cmd', '/c', 'mkdir', p.images] : ['mkdir', '-p', p.images]);
    for (const id of missing) {
        try {
            const said = SAVED.exec(await ask($, { tool: 'Artifact', action: 'read', url: page, path: id }));
            const from = said?.[1] ? (JSON.parse(said[1]) as string) : null;
            const suffix = from ? (/\.[A-Za-z0-9]+$/.exec(from)?.[0] ?? '.jpg') : null;
            if (!from || !suffix) continue;
            const to = `${p.images}${p.sep}${id}${suffix}`;
            await run($, h.os === 'windows' ? ['cmd', '/c', 'copy', '/y', from, to] : ['cp', from, to]);
            if (await $.fs.exists(to)) ext.set(id, suffix);
        } catch {
            // left for the next sync
        }
    }
    const stale = [...ext].filter(([id]) => !wanted.has(id)).map(([id, suffix]) => `${p.images}${p.sep}${id}${suffix}`);
    if (stale.length > 0) await run($, h.os === 'windows' ? ['cmd', '/c', 'del', '/q', ...stale] : ['rm', '-f', ...stale]);
    for (const [id] of [...ext].filter(([id]) => !wanted.has(id))) ext.delete(id);

    return ext;
}

// ---------- syncing ----------

async function syncOnce($: EngineInterface): Promise<string> {
    const p = await placesOf($);
    const { text, board, page } = await readFile($, p);
    if (!page) {
        await update($, summary, () => countOf(board.items));
        await update($, note, () => '还没有待办页：点「打开」建一个');
        return '这个项目还没有待办页：点「打开」或发 /todo，会给它建一个。';
    }
    const here = await read($, project);
    const baseKey = `mirror:${here?.key ?? 'project'}`;
    const [todosText, metaText, baseText] = await Promise.all([
        ask($, { tool: 'ArtifactData', action: 'list', url: page, collection: 'todos', query: { limit: 1000 } }),
        ask($, { tool: 'ArtifactData', action: 'get', url: page, collection: 'meta', doc_id: 'board' }),
        $.store.get(baseKey)
    ]);
    let remote = parseDocs(todosText).map(remoteOf);
    const meta = parseDocs(metaText)[0]?.data;
    const gone = new Set(
        Array.isArray(meta?.deleted)
            ? (meta.deleted as { id?: unknown }[]).flatMap((d) => (typeof d?.id === 'string' ? [d.id] : []))
            : []
    );
    const base = typeof baseText === 'string' ? parseBoard(baseText) : null;
    const back = takeBack(board, base, remote, gone, await $.clock.now());
    let took = 0;
    if (back.creates.length + back.changes.length > 0) {
        const writes = [
            ...back.creates.map((r) => ({
                op: 'set',
                collection: 'todos',
                doc_id: r.id,
                data: { text: r.text, done: r.done, at: r.at, doneAt: r.doneAt, order: r.order, images: [], updatedAt: r.at }
            })),
            ...back.changes.map((c) => ({ op: 'update', collection: 'todos', doc_id: c.id, data: c.patch, if_version: c.version }))
        ];
        try {
            await ask($, { tool: 'ArtifactData', action: 'batch', url: page, writes });
            took = writes.length;
            const patched = new Map(back.changes.map((c) => [c.id, c.patch]));
            remote = [
                ...back.creates,
                ...remote.map((r) => (patched.has(r.id) ? { ...r, ...(patched.get(r.id) as Partial<Remote>) } : r))
            ];
        } catch (err) {
            // board.md keeps what was typed into it until the page has it.
            await update($, summary, () => countOf(remote));
            await update($, note, () => 'board.md 里的改动还没收进待办页');
            lastSyncAt = await $.clock.now();

            return `没同步完：board.md 里的改动没收进待办页（${message(err)}），board.md 原样留着，下次再试。`;
        }
    }
    const ext = await syncImages($, p, page, remote);
    const next = formatBoard(mirrorOf(board.head, board.tail, remote, ext));
    if (next !== text) await $.fs.write(p.board, next);
    await $.store.set(baseKey, next);
    const count = countOf(remote);
    await update($, summary, () => count);
    await update($, note, () => null);
    lastSyncAt = await $.clock.now();

    return `同步好了：${count.open} 条待做，${count.done} 条已完成${took ? `；board.md 里的 ${took} 处改动收进了待办页` : ''}。`;
}

function sync($: EngineInterface): Promise<string> {
    syncing ??= syncOnce($)
        .catch(async (err) => {
            await update($, note, () => `没同步上：${message(err)}`);
            return `没同步上：${message(err)}`;
        })
        .finally(() => {
            syncing = undefined;
        });

    return syncing;
}

// The page is the skill's page/board.html with the project's name filled in,
// written beside board.md for the publish and gone after it. Updating an
// existing page reads it first, as the Artifact tool asks.
async function publishPage($: EngineInterface, p: Places, url: string | null, consent?: string): Promise<string> {
    const name = (await read($, project))?.name ?? 'project';
    const source = await $.fs.read(`${$.plugin.root}/page/board.html`);
    const temp = `${p.dir}${p.sep}.page-${newId()}.html`;
    await $.fs.write(temp, fillPage(source, name, `${p.aiDir}/board/board.md`));
    try {
        if (url) await ask($, { tool: 'Artifact', action: 'read', url }, consent);
        const said = await ask(
            $,
            {
                tool: 'Artifact',
                action: 'publish',
                file_path: temp,
                ...(url
                    ? { url }
                    : { icon: 'checklist', description: `${name} 的个人随手待办：文字和截图，勾掉有动画和音效，换设备都在。` }),
                capabilities: { db: {}, assets: {} }
            },
            consent
        );
        const link = PAGE_LINK.exec(said)?.[0];
        if (!link) throw new Error('发布结果里没有页面链接');

        return link;
    } finally {
        const h = await hostOf($);
        await run($, h.os === 'windows' ? ['cmd', '/c', 'del', '/q', temp] : ['rm', '-f', temp]);
    }
}

// A project without a page gets one the first time someone opens or adds,
// never unasked at the start of a session.
async function ensurePage($: EngineInterface, consent?: string): Promise<{ page: string; isNew: boolean }> {
    const p = await placesOf($);
    const { board, page } = await readFile($, p);
    if (page) return { page, isNew: false };
    const link = await publishPage($, p, null, consent);
    await $.fs.write(p.board, formatBoard({ ...board, head: withLink(board.head, link, p.aiDir) }));

    return { page: link, isNew: true };
}

async function openPage($: EngineInterface, consent?: string): Promise<string> {
    let got: { page: string; isNew: boolean };
    try {
        got = await ensurePage($, consent);
    } catch (err) {
        return `没建成待办页：${message(err)}`;
    }
    void sync($);
    try {
        await ask($, { tool: 'Artifact', action: 'open', url: got.page }, consent);

        return got.isNew ? `给这个项目建好了待办页，也打开了：${got.page}` : `打开了待办页：${got.page}`;
    } catch (err) {
        return `没能在这里打开，链接是 ${got.page}（${message(err)}）`;
    }
}

async function republish($: EngineInterface): Promise<string> {
    const p = await placesOf($);
    const { page } = await readFile($, p);
    if (!page) return '这个项目还没有待办页：发 /todo 会建一个。';
    await publishPage($, p, page, 'The user typed "/todo 更新页面" to republish the todo page from the skill');

    return `待办页换成了技能里的最新版，待办和图片不变：${page}`;
}

async function addRemote($: EngineInterface, text: string): Promise<string> {
    const { page } = await ensurePage($, `The user typed "/todo ${text}" to add this todo`);
    const nowMs = await $.clock.now();
    const at = new Date(nowMs).toISOString();
    await ask(
        $,
        {
            tool: 'ArtifactData',
            action: 'set',
            url: page,
            collection: 'todos',
            doc_id: newId(),
            data: { text, done: false, at, doneAt: null, order: nowMs, images: [], updatedAt: at }
        },
        `The user typed "/todo ${text}" to add this todo`
    );
    await sync($);

    return `记下了：${text}`;
}

function listForModel(here: TodoProject | null, board: Board, where: string): string {
    const name = here?.name ?? '这个项目';
    const open = board.items.filter((item) => !item.done);
    if (board.items.length === 0) return `「${name}」还没有待办（${where}，正本在待办页）。`;
    const lines = open.map((item, at) => {
        const text = item.text.replace(/\n/g, ' / ') || '（只有图片）';
        return `${at + 1}. ${text}${item.images.length ? ` [${item.images.length} 张图]` : ''}`;
    });

    return [
        `「${name}」的待办（${open.length} 条待做，已完成 ${board.items.length - open.length} 条；${where}，正本在待办页）：`,
        ...(lines.length ? lines : ['（全部完成）'])
    ].join('\n');
}

// ---------- hooks ----------

export const register: Register = (on) => {
    on('session.start', async ($, e, next) => {
        const p = await placesOf($);
        const ai = p.aiDir;
        await $.command.register({
            name: 'todo',
            description: `打开个人待办页（没有就建一个）；/todo <文字> 直接记一条；/todo 同步 把待办页同步到 ${ai}/board；/todo 更新页面 换成技能里的最新页面`,
            argumentHint: '[一条待办 | 同步 | 更新页面]',
            immediate: true
        });
        await $.tool.register({
            name: 'todo_open',
            description: '打开用户的个人待办页（claude.ai artifact；这个项目还没有就建一个）。只在用户要你打开待办时调用。',
            inputSchema: { type: 'object', properties: {} }
        });
        await $.tool.register({
            name: 'todo_list',
            description: `只读：先把待办页同步到 ${ai}/board/board.md，再列出用户的个人待办（未完成的逐条，已完成的只给数量）。用户问起自己的待办时用；这不是项目任务来源（任务看 ${ai}/TODO.md），也不要替用户增删。`,
            inputSchema: { type: 'object', properties: {} }
        });
        await $.tool.register({
            name: 'todo_sync',
            description: `把用户的待办页同步到 ${ai}/board/board.md 和 ${ai}/board/images/，并把 board.md 里新加的行收进待办页。`,
            inputSchema: { type: 'object', properties: {} }
        });
        const here = await resolveProject($);
        await update($, project, () => here);
        const { board } = await readFile($, p);
        await update($, summary, () => countOf(board.items));
        void sync($);

        return next(e);
    });

    on('command.run', { command: 'todo' }, async ($, e) => {
        const text = e.args.trim();
        if (!text) return { text: await openPage($, 'The user typed "/todo" to open the todo page') };
        if (text === '同步' || text === 'sync') return { text: await sync($) };
        if (text === '更新页面') return { text: await republish($).catch((err) => `没更新成：${message(err)}`) };

        return { text: await addRemote($, text).catch((err) => `没记上：${message(err)}`) };
    });

    on('tool.call', { tool: 'mcp__todo-board__todo_open' }, async ($) => ({
        result: await openPage($)
    })).catch(() => ({ result: '打开待办页失败。' }));

    on('tool.call', { tool: 'mcp__todo-board__todo_list' }, async ($) => {
        await sync($);
        const p = await placesOf($);
        const { board } = await readFile($, p);
        return { result: listForModel(await read($, project), board, `${p.aiDir}/board/board.md`) };
    }).catch(() => ({ result: '读不到待办。' }));

    on('tool.call', { tool: 'mcp__todo-board__todo_sync' }, async ($) => ({
        result: await sync($)
    })).catch(() => ({ result: '同步待办失败。' }));

    on('turn.complete', async ($, e, next) => {
        const done = await next(e);
        if ((await $.clock.now()) - lastSyncAt > SYNC_EVERY_MS) void sync($);

        return done;
    });

    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
        if (e.props.hasSurvey) return next(e);
        const { Box, Button, Text } = $.ui.resolve(e);
        const [count, hint] = await Promise.all([read($, summary), read($, note)]);
        const total = count ? count.open + count.done : 0;
        const said =
            count === null
                ? ''
                : total === 0
                  ? '还没有待办'
                  : count.open === 0
                    ? `全部完成 · ${total} 条`
                    : `${count.open} 条待做 · 已完成 ${count.done}`;

        return (
            <Box flexDirection="row" alignItems="center" gap={1}>
                <Text bold>待办</Text>
                <Text dimColor wrap="truncate-end">
                    {said}
                </Text>
                <Button
                    key="open"
                    label="打开"
                    variant="primary"
                    onPress={() => openPage($, 'The user pressed "打开" on the todo band above the prompt')}
                />
                {hint !== null && (
                    <Text dimColor wrap="truncate-end">
                        {hint}
                    </Text>
                )}
            </Box>
        );
    });
};
