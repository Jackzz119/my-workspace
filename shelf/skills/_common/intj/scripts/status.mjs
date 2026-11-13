// Status lines injected at the top of the intj skill: open TODO items, open bugs, and collaborator pointers.
// Read-only: reads ai/TODO.md and ai/SYNC.md under the current directory and runs `git rev-list --count`.
// Always exits 0, because a failing injected command aborts the whole skill invocation.
// Counting matches the shell one-liner it replaced: an open item is `- [ ]` or `- [~]`; it is a bug when it sits
// under a `## ` heading that mentions "bug" (any case) or carries a `[BUG]` tag.
// node <skill>/scripts/status.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const read = (file) => {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return null;
    }
};

let tasks = 0;
let bugs = 0;
let inBugSection = false;
for (const line of (read('ai/TODO.md') ?? '').split('\n')) {
    if (line.startsWith('## ')) inBugSection = /bug/i.test(line);
    if (!/^[ \t]*- \[[ ~]\]/.test(line)) continue;
    tasks++;
    if (inBugSection || line.includes('[BUG]')) bugs++;
}
console.log(`待办：${tasks} 项（含进行中）| Bug：${bugs} 项`);

// ai/SYNC.md exists only in repos with collaborators; one `pointer.<branch> = <sha>` line per tracked branch.
for (const [, branch, sha] of (read('ai/SYNC.md') ?? '').matchAll(/^pointer\.([A-Za-z0-9/_-]+) = ([0-9a-f]+)/gm)) {
    let count = '?';
    try {
        count = execFileSync('git', ['rev-list', '--count', '--no-merges', `${sha}..origin/${branch}`], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    } catch {
        // unknown sha or branch: keep the question mark
    }
    console.log(`协作指针 ${branch}：${sha.slice(0, 7)}，origin/${branch} 之后还有 ${count} 个 commit（以上次 fetch 为准）`);
}
