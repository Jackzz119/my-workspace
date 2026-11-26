// 收尾核对：子会话的分支有没有落进集成分支、有没有留下没提交的改动或远端分支。用法见 --help。
// 只读：不 fetch，不动引用、工作区和对象库；核对要用的临时对象写进系统临时目录，跑完删掉。
// 唯一的痕迹：仓库里已有的同名对象文件会被 git 顺手刷新修改时间，内容不变。
// 需要 Node 20+、Git 2.38+（merge-tree --write-tree）。入口文件直接执行 main，不判断「是不是被 import」。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HELP = `收尾核对（只读）：子会话的分支落进集成分支没有，有没有留下没提交的改动或远端分支。

用法：node closeout-check.mjs --base <集成分支引用> --branch <分支名> [--branch …] [--no-remote] [--text]
  --base       集成分支，例如 origin/dev。脚本不 fetch，先自己 git fetch 一次
  --branch     要核对的分支名，可重复；不带 origin/，写 refs/heads/… 也行
  --no-remote  不查远端 origin（remoteExists 为 null）
  --text       打给人看的文字；不加就把一个 JSON 打到 stdout
查哪个仓库：当前目录所在的仓库；当前目录不在仓库里时，用这个脚本所在的仓库。

每条分支：localExists · worktree · uncommitted {count, files 前 10 个} · landed · landedBy · unlanded · remoteExists
landedBy：ancestor 快进或合并 / rebase 补丁相同 / squash 压成一个提交 / content 内容已全在集成分支里
本地、远端都没有的分支算已清掉（status 为 gone）。

已知限制：
  补丁对不上、合入后集成分支又改了同一处的，会误报没落进（误报方向安全）
  比补丁不看行号：同样的几行插在另一处重复结构里，会当成同一个补丁
  正在 bisect 的 worktree 认不出它的分支，里面没提交的文件报不出来
  info/attributes 或 merge.default 设了 union 合并的，没合入的删除会误报已落进
  --base 和标签同名时取的是标签；写全 refs/heads/… 或 refs/remotes/… 可避开

退出码：0 全部收干净；2 有没收干净的（看 problems）；1 参数错误或 git 出错。
例：node closeout-check.mjs --base origin/dev --branch feat/a --branch feat/b --text`;

const MAX_FILES = 10; // 每条分支最多列几个没提交的文件
const MAX_UNLANDED = 50; // JSON 里最多列几个没落进的提交，总数另给
const MAX_TITLES = 5; // 一句问题里最多点名几个提交
const MAX_TRIM = 200; // 分支比这还长就不再逐段比对（每段要起几次 git），没落进的照单全列
const REMOTE_TIMEOUT_MS = 60_000; // 远端连不上时不无限等

class Failure extends Error {}

const note = (text) => process.stderr.write(`${text}\n`);

// 外面带进来的 GIT_DIR 之类会让 git 认错仓库（例如从 git 钩子里调用时），一律去掉
const baseEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'GIT_NAMESPACE'])
    delete baseEnv[key];

// 跑一次 git。ok 列出算正常的退出码，其余一律当 git 出错
function git(args, { cwd, env = baseEnv, ok = [0], input, timeout, stdout = 'pipe' } = {}) {
    const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], {
        cwd,
        env,
        input: input ?? '',
        encoding: 'utf8',
        stdio: ['pipe', stdout, 'pipe'],
        maxBuffer: 1 << 28,
        timeout
    });
    const command = `git ${args.find((arg, i) => !arg.startsWith('-') && args[i - 1] !== '-c')}`;
    if (result.error?.code === 'ENOENT' && (!cwd || fs.existsSync(cwd)))
        throw new Failure('找不到 git 命令，先装 git。');
    if (result.error?.code === 'ETIMEDOUT') throw new Failure(`${command} 超过 ${timeout / 1000} 秒没有结果。`);
    if (result.error) throw new Failure(`${command} 没跑起来：${result.error.message}`);
    if (!ok.includes(result.status)) {
        throw new Failure(`${command} 出错（退出码 ${result.status}）：${result.stderr.trim() || '没有错误信息'}`);
    }
    return { code: result.status, out: result.stdout };
}

const lines = (text) => text.split('\n').filter(Boolean);
const fields = (text) => text.split('\0');

function parseInput(argv) {
    let values, positionals;
    try {
        ({ values, positionals } = parseArgs({
            args: argv,
            allowPositionals: true,
            options: {
                base: { type: 'string', multiple: true },
                branch: { type: 'string', multiple: true },
                'no-remote': { type: 'boolean' },
                text: { type: 'boolean' },
                help: { type: 'boolean', short: 'h' }
            }
        }));
    } catch (error) {
        throw new Failure(`参数不对：${error.message}\n用法见 --help。`);
    }
    if (values.help) return { help: true };

    const wrong = [];
    const bases = (values.base ?? []).map((value) => value.trim());
    const names = (values.branch ?? []).map((value) => value.trim().replace(/^refs\/heads\//, ''));
    if (!bases[0]) wrong.push('缺 --base：写集成分支引用，例如 --base origin/dev');
    if (bases.length > 1) wrong.push('--base 只能给一个');
    if (!names.length || names.includes(''))
        wrong.push('缺 --branch：写要核对的分支名，例如 --branch feat/a（可重复）');
    if (positionals.length) wrong.push(`多出来的参数：${positionals.join(' ')}（分支要写成 --branch <分支名>）`);
    if (wrong.length) throw new Failure(`${wrong.join('\n')}\n用法见 --help。`);
    return { base: bases[0], names: [...new Set(names)], remote: !values['no-remote'], text: values.text };
}

// 找仓库：先看当前目录，不在仓库里再看脚本所在目录
function findRepo() {
    const probe = (cwd) => git(['rev-parse', '--git-dir'], { cwd, env: { ...baseEnv, LC_ALL: 'C' } });
    let cwd;
    try {
        cwd = process.cwd();
        probe(cwd);
        return cwd;
    } catch (error) {
        // 只有「不在仓库里」才换地方找；权限、归属之类的错照实报
        if (cwd && !/not a git repository/i.test(error.message)) throw error;
    }
    const own = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
    try {
        probe(own);
    } catch {
        throw new Failure('当前目录不在 git 仓库里，脚本自己也不在。先 cd 到要核对的仓库再跑。');
    }
    note(`当前目录不在 git 仓库里，改用脚本所在的仓库：${own}`);
    return own;
}

// 建一个临时对象库，真对象库只挂成只读的备用库：要造的临时提交和合并结果都不会写进仓库
function scratchEnv(cwd, dir) {
    const real = git(['rev-parse', '--path-format=absolute', '--git-path', 'objects'], { cwd }).out.trim();
    // 备用库列表用冒号（Windows 用分号）分隔，加引号后路径里有分隔符也不会断开
    const quoted = `"${real.replace(/["\\]/g, '\\$&')}"`;
    return {
        ...baseEnv,
        GIT_OBJECT_DIRECTORY: dir,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: [quoted, process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES]
            .filter(Boolean)
            .join(path.delimiter),
        // .gitattributes 可以给文件指定合并方式（如 merge=ours），会让合并结果失真：用空目录树代替它
        GIT_ATTR_SOURCE: git(['hash-object', '-t', 'tree', '--stdin'], { cwd }).out.trim(),
        GIT_AUTHOR_NAME: 'closeout-check',
        GIT_AUTHOR_EMAIL: 'closeout-check@localhost',
        GIT_COMMITTER_NAME: 'closeout-check',
        GIT_COMMITTER_EMAIL: 'closeout-check@localhost'
    };
}

// 「某个提交的改动落进集成分支没有」的判断器
function landingChecker(cwd, env, base) {
    const run = (args, options) => git(args, { cwd, env, ...options });
    // 自定义合并驱动一律换成「报冲突」：既不执行外部命令，也不会把没落进的改动吞掉
    const drivers = fields(
        run(['config', '-z', '--name-only', '--get-regexp', '^merge\\..+\\.driver$'], { ok: [0, 1] }).out
    )
        .filter(Boolean)
        .flatMap((key) => ['-c', `${key}=false`]);
    const treeOf = (sha) => run(['rev-parse', '--verify', `${sha}^{tree}`]).out.trim();
    const baseTree = treeOf(base);

    const mergeBase = (sha) => run(['merge-base', base, sha], { ok: [0, 1] }).out.trim();
    const isAncestor = (sha) => run(['merge-base', '--is-ancestor', sha, base], { ok: [0, 1] }).code === 0;
    const commits = (range, ...flags) => lines(run(['rev-list', '--topo-order', '--reverse', ...flags, range]).out);

    // 两个提交的干净合并结果；有冲突、没有共同祖先时是 null
    const mergedTree = (ours, theirs) => {
        const args = [...drivers, 'merge-tree', '--write-tree', '--no-messages', ours, theirs];
        const merged = run(args, { ok: [0, 1, 128] });
        return merged.code === 0 ? lines(merged.out)[0] : null;
    };
    // 合进去等于什么都没变：改动已经全在集成分支里（补丁周围的行变过、补丁对不上时靠它）
    const addsNothing = (sha) => mergedTree(base, sha) === baseTree;

    // 每个提交的补丁原文的指纹，去掉 @@ 行（行号、分块会随 base 变）和文本文件的 blob 编号；二进制文件只看 blob 编号。
    // 补丁可能很大：先写进临时文件，再分块读。按 latin1 读：非 UTF-8 文件的字节不会被并成同一个乱码
    const patchPrints = (shas) => {
        const file = path.join(env.GIT_OBJECT_DIRECTORY, 'patches');
        const fd = fs.openSync(file, 'w+');
        try {
            const args = ['diff-tree', '--stdin', '-r', '--root', '-p', '--full-index', '--no-ext-diff'];
            run([...args, '--no-textconv', '--no-renames'], { input: `${shas.join('\n')}\n`, stdout: fd });
            const prints = new Map(shas.map((sha) => [sha, createHash('sha256')]));
            const chunk = Buffer.alloc(1 << 23);
            let current;
            let index = '';
            let rest = '';
            for (let at = 0, size; (size = fs.readSync(fd, chunk, 0, chunk.length, at)) > 0; at += size) {
                const all = (rest + chunk.latin1Slice(0, size)).split('\n');
                rest = all.pop();
                for (const line of all) {
                    if (prints.has(line)) current = prints.get(line);
                    else if (line.startsWith('index ')) index = line;
                    else if (line.startsWith('Binary files ')) current?.update(`${index}\n${line}\n`, 'latin1');
                    else if (!line.startsWith('@@ ')) current?.update(`${line}\n`, 'latin1');
                }
            }
            return new Map([...prints].map(([sha, print]) => [sha, print.digest('hex')]));
        } finally {
            fs.closeSync(fd);
        }
    };
    // 按补丁内容比，不看 sha；返回集成分支里找不到同样补丁的提交（不含合并提交）。
    // git 判断补丁相同时忽略空白，只改缩进的提交会被当成已落进，所以它认为相同的再逐字比一遍
    const missingPatches = (sha) => {
        const own = new Set(commits(`${base}..${sha}`, '--no-merges'));
        const marked = lines(run(['rev-list', '--no-merges', '--cherry-mark', `${base}...${sha}`]).out);
        const same = marked.filter((line) => line.startsWith('=')).map((line) => line.slice(1));
        const patches = same.length ? patchPrints(same) : new Map();
        const landed = new Set(same.filter((commit) => !own.has(commit)).map((commit) => patches.get(commit)));
        return [...own].filter((commit) => !landed.has(patches.get(commit)));
    };
    // 把 from..to 压成一个提交（只存在于临时对象库），看集成分支里有没有同样的补丁
    const squashed = (from, to) => {
        if (!from) return false;
        const fake = run(['commit-tree', treeOf(to), '-p', from, '-m', 'squash']).out.trim();
        // 只问这个临时提交自己：from 之前没落进的提交也会出现在结果里
        return !missingPatches(fake).includes(fake);
    };
    // 合并提交自己带改动（解冲突或顺手改）：重新合一次，结果不一样就算
    const mergesWithOwnChanges = (sha) =>
        lines(run(['rev-list', '--min-parents=2', '--parents', `${base}..${sha}`]).out)
            .map((line) => line.split(' '))
            .filter(([merge, ...parents]) => parents.length !== 2 || mergedTree(...parents) !== treeOf(merge))
            .map(([merge]) => merge);

    // 整条分支没落进时，把其中已经落进的那几段挑出去（前几轮已经合过、又接着提交的分支）
    const trim = (sha, pending) => {
        const chain = commits(`${base}..${sha}`, '--first-parent');
        if (chain.length > MAX_TRIM) {
            note(`${sha.slice(0, 8)} 比集成分支多 ${chain.length} 个提交，不再逐段比对，下面列的可能含已落进的。`);
            return;
        }
        const drop = (range) => commits(range).forEach((commit) => pending.delete(commit));
        for (let end = chain.length - 2; end >= 0; end--) {
            if (!addsNothing(chain[end])) continue;
            drop(`${base}..${chain[end]}`);
            break;
        }
        for (let start = 0; start < chain.length; start++) {
            if (!pending.has(chain[start])) continue;
            const from = start > 0 ? chain[start - 1] : null;
            let end = chain.length - 1;
            while (end > start && !squashed(from ?? mergeBase(chain[end]), chain[end])) end--;
            if (end === start) break;
            drop(`${from ?? base}..${chain[end]}`);
            start = end;
        }
    };

    const describe = (shas) =>
        fields(
            run(
                [
                    ...['-c', 'i18n.logOutputEncoding=UTF-8', 'log', '--no-walk=unsorted', '--no-show-signature'],
                    ...['--no-color', '--no-notes', '--format=tformat:%h%x1f%s', '-z', '--stdin']
                ],
                { input: `${shas.join('\n')}\n` }
            ).out
        )
            .filter(Boolean)
            .map((entry) => entry.split('\x1f'))
            .map(([short, title]) => ({ sha: short, title }));

    return (sha) => {
        const done = (landedBy) => ({ landed: true, landedBy, unlanded: [], unlandedCount: 0 });
        if (isAncestor(sha)) return done('ancestor');
        const pending = new Set([...missingPatches(sha), ...mergesWithOwnChanges(sha)]);
        if (!pending.size) return done('rebase');
        if (squashed(mergeBase(sha), sha)) return done('squash');
        if (addsNothing(sha)) return done('content');
        trim(sha, pending);
        if (!pending.size) return done('squash');
        const missing = commits(`${base}..${sha}`).filter((commit) => pending.has(commit));
        return {
            landed: false,
            landedBy: null,
            unlanded: describe(missing.slice(0, MAX_UNLANDED)),
            unlandedCount: missing.length
        };
    };
}

// worktree 自己的 git 目录；目录打不开、里面的 .git 没了（git 会往上找到别的仓库）、或已是另一个仓库时是 null
function worktreeGitDir(cwd, commonDir) {
    try {
        const { out } = git(['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-prefix'], {
            cwd
        });
        const [gitDir, common, prefix] = out.split('\n');
        return prefix === '' && fs.realpathSync(common) === commonDir ? gitDir : null;
    } catch {
        return null;
    }
}

// 全部 worktree；正在 rebase 的 worktree 在清单里没有分支名，从它的 rebase 记录里找回来
function listWorktrees(cwd) {
    const commonDir = fs.realpathSync(
        git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd }).out.trimEnd()
    );
    return git(['worktree', 'list', '--porcelain', '-z'], { cwd })
        .out.split('\0\0')
        .filter(Boolean)
        .map((block) => {
            const entry = {};
            for (const line of fields(block).filter(Boolean)) {
                const [key] = line.split(' ', 1);
                entry[key] = line.slice(key.length + 1);
            }
            const worktree = {
                path: entry.worktree,
                ref: entry.branch ?? null,
                exists: fs.existsSync(entry.worktree),
                prunable: 'prunable' in entry,
                gitDir: worktreeGitDir(entry.worktree, commonDir),
                rebasing: false
            };
            if ('detached' in entry && worktree.gitDir) {
                for (const state of ['rebase-merge', 'rebase-apply']) {
                    const file = path.join(worktree.gitDir, state, 'head-name');
                    if (!fs.existsSync(file)) continue;
                    worktree.ref = fs.readFileSync(file, 'utf8').trim();
                    worktree.rebasing = true;
                }
            }
            return worktree;
        });
}

// 一个 worktree 里没提交的文件，未跟踪的逐个算；没法查是 null（只影响这一条分支，不让整次核对失败）
function uncommittedFiles(worktree) {
    if (!worktree.gitDir) return null;
    const args = ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'];
    let entries;
    try {
        entries = fields(git(args, { cwd: worktree.path }).out);
    } catch (error) {
        note(`${worktree.path}：${error.message}`);
        return null;
    }
    const files = [];
    for (let i = 0; i < entries.length; i++) {
        if (!entries[i]) continue;
        files.push(entries[i].slice(3));
        if (/[RC]/.test(entries[i].slice(0, 2))) i++; // 改名、复制的条目后面跟着一条旧路径
    }
    return files;
}

// 问远端 origin 上有哪些同名分支：返回 分支名 → sha。任何要人输入密码的情况都直接失败
function remoteHeads(cwd, names) {
    const hasOrigin = lines(git(['remote'], { cwd }).out).includes('origin');
    if (!hasOrigin) throw new Failure('这个仓库没有叫 origin 的远端；不查远端就加 --no-remote。');
    const env = { ...baseEnv, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GCM_INTERACTIVE: 'never' };
    const customSsh = git(['config', '--get', 'core.sshCommand'], { cwd, ok: [0, 1] }).out.trim();
    if (!customSsh && !env.GIT_SSH_COMMAND && !env.GIT_SSH) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
    const heads = new Map();
    try {
        const refs = names.map((name) => `refs/heads/${name}`);
        const { out } = git(['ls-remote', '--heads', 'origin', ...refs], { cwd, env, timeout: REMOTE_TIMEOUT_MS });
        for (const line of lines(out)) {
            const [sha, ref] = line.split('\t');
            if (refs.includes(ref)) heads.set(ref.slice('refs/heads/'.length), sha);
        }
    } catch (error) {
        throw new Failure(`查不到远端 origin：${error.message}\n不查远端就加 --no-remote。`);
    }
    return heads;
}

function check({ base, names, remote }, cwd, env) {
    const version = git(['version'], { cwd }).out.match(/(\d+)\.(\d+)/);
    if (version && (+version[1] < 2 || (+version[1] === 2 && +version[2] < 38))) {
        throw new Failure(`Git 版本太旧（${version[0]}），需要 2.38 以上。`);
    }
    const resolveBase = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${base}^{commit}`], {
        cwd,
        ok: [0, 1, 128]
    });
    if (resolveBase.code !== 0) {
        throw new Failure(`--base 找不到提交：${base}。写本地认得的引用，例如 origin/dev；没有就先 git fetch。`);
    }
    const baseSha = resolveBase.out.trim();
    const local = new Map(
        lines(git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/'], { cwd }).out).map((line) => {
            const [ref, sha] = line.split(' ');
            return [ref.slice('refs/heads/'.length), sha];
        })
    );
    for (const name of names) {
        if (git(['check-ref-format', `refs/heads/${name}`], { cwd, ok: [0, 1] }).code !== 0) {
            throw new Failure(`--branch 不是合法的分支名：${name}`);
        }
        // 带 origin/ 的名字在本地和远端都查无此分支，会被误当成「已清掉」
        if (/^(origin|refs\/remotes)\//.test(name) && !local.has(name)) {
            throw new Failure(`--branch 只写分支名，不带 origin/：${name}`);
        }
    }

    const worktrees = listWorktrees(cwd);
    const baseRef = git(['rev-parse', '--symbolic-full-name', '--end-of-options', base], { cwd, ok: [0, 128] }).out;
    const baseOnOrigin = baseRef.match(/^refs\/remotes\/origin\/(.+)$/m)?.[1];
    const heads = remote ? remoteHeads(cwd, baseOnOrigin ? [...names, baseOnOrigin] : names) : null;
    const stale = Boolean(heads && baseOnOrigin && heads.get(baseOnOrigin) !== baseSha);
    const staleHint = stale ? `（本地的 ${base} 和远端不一致，先 git fetch origin 再核一次）` : '';
    if (stale) note(`本地的 ${base} 和远端不一致，结果按本地这份算；先 git fetch origin 再核一次更准。`);

    const landing = landingChecker(cwd, env, baseSha);
    const problems = [];
    const listed = ({ unlanded, unlandedCount }) =>
        unlanded
            .slice(0, MAX_TITLES)
            .map((commit) => `${commit.sha} ${commit.title}`)
            .join('；') + (unlandedCount > MAX_TITLES ? ` 等 ${unlandedCount} 个` : '');

    const branches = names.map((name) => {
        const problem = (text) => problems.push(`分支 ${name}：${text}`);
        const sha = local.get(name) ?? null;
        const remoteSha = heads?.get(name) ?? null;
        const result = sha ? landing(sha) : { landed: null, landedBy: null, unlanded: [], unlandedCount: 0 };
        const before = problems.length;

        // 一条分支可能被强行检出到几个 worktree：都查，JSON 里放最要紧的那个
        const states = worktrees
            .filter((worktree) => worktree.ref === `refs/heads/${name}`)
            .map((worktree) => ({ ...worktree, files: uncommittedFiles(worktree) }));
        for (const state of states) {
            if (state.rebasing) problem(`worktree ${state.path} 里有一次没做完的 rebase`);
            if (state.files?.length) {
                const shown = state.files.slice(0, MAX_FILES).join('、');
                const more = state.files.length > MAX_FILES ? ' 等' : '';
                problem(`worktree ${state.path} 里有 ${state.files.length} 个文件没提交：${shown}${more}`);
            }
            if (!state.exists && state.prunable) note(`分支 ${name}：worktree 目录已不在，只剩登记：${state.path}`);
            else if (!state.files) problem(`worktree ${state.path} 打不开，没法查有没有没提交的改动`);
        }
        const state = states.find((item) => item.files?.length) ?? states[0];

        if (result.landed === false) {
            problem(`有 ${result.unlandedCount} 个提交没落进 ${base}：${listed(result)}${staleHint}`);
        }

        let remoteLanded = null;
        if (remoteSha) {
            const known = git(['cat-file', '-e', `${remoteSha}^{commit}`], { cwd, ok: [0, 1, 128] }).code === 0;
            const onRemote = remoteSha === sha ? result : known ? landing(remoteSha) : null;
            remoteLanded = onRemote?.landed ?? null;
            const where = sha ? '远端 origin 上还有同名分支' : '本地已经没有，远端 origin 上还留着';
            if (!onRemote) problem(`${where}，它的提交本地没有，没法核对落进没有；先 git fetch origin`);
            else if (remoteSha === sha || onRemote.landed) problem(where);
            else
                problem(
                    `${where}，其中 ${onRemote.unlandedCount} 个提交没落进 ${base}：${listed(onRemote)}${staleHint}`
                );
        }

        const gone = !sha && !remoteSha && !states.length;
        return {
            name,
            status: problems.length > before ? 'problem' : gone ? 'gone' : 'ok',
            localExists: Boolean(sha),
            worktree: state?.path ?? null,
            uncommitted: state?.files ? { count: state.files.length, files: state.files.slice(0, MAX_FILES) } : null,
            ...result,
            remoteExists: heads ? Boolean(remoteSha) : null,
            remoteLanded
        };
    });
    return { ok: !problems.length, repo: worktrees[0].path, base, branches, problems };
}

const LANDED_BY = { ancestor: '快进或合并', rebase: 'rebase，补丁相同', squash: 'squash', content: '内容已全在里面' };

function toText({ ok, repo, base, branches, problems }) {
    const out = [`仓库 ${repo} · 集成分支 ${base}`];
    for (const branch of branches) {
        out.push('', `${branch.status === 'problem' ? '✗' : '✓'} ${branch.name}`);
        const remote = { true: '还有同名分支', false: '没有', null: '没查' }[branch.remoteExists];
        if (branch.status === 'gone') {
            out.push(`  已清掉（本地没有；远端${remote}）`);
            continue;
        }
        if (branch.localExists) {
            out.push(
                branch.landed
                    ? `  已落进（${LANDED_BY[branch.landedBy]}）`
                    : `  没落进 ${branch.unlandedCount} 个提交：`
            );
            for (const commit of branch.unlanded) out.push(`    ${commit.sha} ${commit.title}`);
            if (branch.unlandedCount > branch.unlanded.length) out.push(`    …共 ${branch.unlandedCount} 个`);
        } else {
            out.push('  本地没有这条分支');
        }
        out.push(`  worktree：${branch.worktree ?? '没有'}`);
        if (branch.uncommitted) {
            const { count, files } = branch.uncommitted;
            out.push(`  没提交的文件：${count} 个`);
            for (const file of files) out.push(`    ${file}`);
            if (count > files.length) out.push(`    …共 ${count} 个`);
        }
        out.push(`  远端 origin：${remote}`);
    }
    out.push('', ok ? '全部收干净了。' : `没收干净的 ${problems.length} 处：`);
    for (const problem of problems) out.push(`- ${problem}`);
    return out.join('\n');
}

function main() {
    const input = parseInput(process.argv.slice(2));
    if (input.help) {
        console.log(HELP);
        return 0;
    }
    const cwd = findRepo();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'closeout-check-'));
    try {
        const report = check(input, cwd, scratchEnv(cwd, scratch));
        console.log(input.text ? toText(report) : JSON.stringify(report, null, 2));
        return report.ok ? 0 : 2;
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}

// 用 exitCode 而不是 process.exit：等 stdout 写完再退
try {
    process.exitCode = main();
} catch (error) {
    note(error instanceof Failure ? error.message : `脚本出错：${error.stack}`);
    process.exitCode = 1;
}
