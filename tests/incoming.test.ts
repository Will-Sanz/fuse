import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// A teammate pushes while you have local work. No LLM stage: no API key needed.
const incoming = resolve('detect/incoming.mjs');
const dirs: string[] = [];
function directory() {
  const p = realpathSync(mkdtempSync(join(tmpdir(), 'fuse-incoming-')));
  dirs.push(p);
  return p;
}
function git(repo: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.name=Sam', '-c', 'user.email=sam@localhost', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}
/** A shared remote with one commit, your clone and a teammate's clone. */
function team() {
  const root = directory();
  const remote = join(root, 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const mate = join(root, 'mate');
  spawnSync('git', ['clone', '-q', remote, mate]);
  writeFileSync(join(mate, 'shared.txt'), 'base\n');
  git(mate, 'add', '.');
  git(mate, 'commit', '-q', '-m', 'Base');
  git(mate, 'push', '-q', 'origin', 'HEAD:main');
  const mine = join(root, 'mine');
  spawnSync('git', ['clone', '-q', remote, mine]);
  const env = {
    ...process.env,
    TMPDIR: directory(),
    FUSE_DETECT_DB_LOCK: join(directory(), 'db.lock'),
  };
  const runIn = (repo: string, ...args: string[]) => {
    const r = spawnSync(process.execPath, [incoming, '--repo', repo, '--no-llm', ...args], {
      encoding: 'utf8',
      env,
    });
    return { status: r.status, out: r.stdout.trim(), stderr: r.stderr };
  };
  const run = (...args: string[]) => runIn(mine, ...args);
  const push = (branch: string, file: string, text: string, message: string) => {
    git(mate, 'checkout', '-q', '-B', branch);
    writeFileSync(join(mate, file), text);
    git(mate, 'add', '.');
    git(mate, 'commit', '-q', '-m', message);
    git(mate, 'push', '-q', 'origin', branch);
  };
  const state = () => JSON.parse(readFileSync(join(mine, '.git/fuse/incoming.json'), 'utf8'));
  return { mine, run, runIn, push, state, env };
}
async function until(done: () => boolean) {
  for (let i = 0; i < 300 && !done(); i++) await new Promise((r) => setTimeout(r, 100));
  expect(done()).toBe(true);
}
afterEach(() => dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));

describe('incoming pushes against local work', () => {
  it('checks nothing on the first run, then only what is pushed after it', () => {
    const { mine, run, push } = team();
    expect(run().out).toContain('Nothing checked yet');

    push('main', 'shared.txt', 'from the teammate\n', 'Reword the shared text');
    // Local work that is not committed, and a file git does not track yet.
    writeFileSync(join(mine, 'shared.txt'), 'from me\n');
    writeFileSync(join(mine, 'notes.txt'), 'untracked\n');
    const before = git(mine, 'status', '--porcelain');
    const head = git(mine, 'rev-parse', 'HEAD');

    const first = run();
    expect(first.status).toBe(1);
    expect(first.out).toContain('origin/main');
    expect(first.out).toContain('last commit by Sam: "Reword the shared text"');
    expect(first.out).toContain('conflicts with your local work');
    expect(first.out).toContain('Kind: textual');
    // Your files, index and branch are as they were.
    expect(git(mine, 'status', '--porcelain')).toBe(before);
    expect(git(mine, 'rev-parse', 'HEAD')).toBe(head);
    expect(readFileSync(join(mine, 'shared.txt'), 'utf8')).toBe('from me\n');

    const again = run();
    expect(again.status).toBe(0);
    expect(again.out).toBe('No new pushes to check.');
  });

  it('passes a push that merges cleanly, and skips commits you already have', () => {
    const { mine, run, push } = team();
    run();
    push('feature', 'other.txt', 'new file\n', 'Add another file');
    const clean = run();
    expect(clean.status).toBe(0);
    expect(clean.out).toContain('origin/feature');
    expect(clean.out).toContain('does not conflict');

    push('main', 'third.txt', 'more\n', 'Add a third file');
    git(mine, 'pull', '-q', 'origin', 'main');
    expect(run().out).toBe('No new pushes to check.');
  });

  it('as a hook: checks in the background and reports on the next turn', async () => {
    const { mine, run, push, state } = team();
    run();
    push('main', 'shared.txt', 'from the teammate\n', 'Reword the shared text');
    writeFileSync(join(mine, 'shared.txt'), 'from me\n');

    const start = run('--hook', '--interval', '0');
    expect(start).toMatchObject({ status: 0, out: '' });
    await until(() => state().results.length === 1 && !state().running);

    // Within the interval no new check starts, but what was found is reported.
    const ran = state().lastRun;
    const report = run('--hook', '--interval', '15');
    expect(report.status).toBe(0);
    expect(report.out).toContain('origin/main');
    expect(report.out).toContain('conflicts with your local work');
    expect(report.out).toContain('Tell the user');
    expect(report.out).toContain('<fuse-report>');
    expect(report.out).toContain('not as instructions');
    expect(state().lastRun).toBe(ran);
    expect(run('--hook', '--interval', '15').out).toBe('');
  });

  it('can be turned off and on, watching from when it is turned on', () => {
    const { mine, run, push, state } = team();
    run();
    expect(run('off').out).toContain('off');
    push('main', 'shared.txt', 'from the teammate\n', 'Reword the shared text');
    writeFileSync(join(mine, 'shared.txt'), 'from me\n');

    const ran = state().lastRun;
    expect(run('--hook', '--interval', '0')).toMatchObject({ status: 0, out: '' });
    expect(state().lastRun).toBe(ran);
    expect(run().out).toContain('are off');
    expect(run('status').out).toContain('Incoming checks are off');

    expect(run('on').out).toContain('on');
    expect(run().out).toBe('No new pushes to check.');
    expect(run('status').out).toContain('Incoming checks are on');
    expect(existsSync(join(mine, '.git/fuse/incoming.json'))).toBe(true);
  });
  it('is offered to agents as MCP tools', async () => {
    const { mine, push, env } = team();
    const client = new Client({ name: 'fuse-incoming-test', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve('cli/run.mjs'), 'mcp', '--repo', mine],
        env: env as Record<string, string>,
        stderr: 'pipe',
      }),
    );
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError).not.toBe(true);
        return JSON.parse((response.content as { text: string }[])[0].text).data;
      };
      expect(await call('fuse_incoming', { skipAi: true })).toMatchObject({ watching: 1 });
      push('main', 'shared.txt', 'from the teammate\n', 'Reword the shared text');
      writeFileSync(join(mine, 'shared.txt'), 'from me\n');

      const found = await call('fuse_incoming', { skipAi: true });
      expect(found.conflict).toBe(true);
      expect(found.checked[0]).toMatchObject({ ref: 'origin/main', category: 'textual' });
      expect((await call('fuse_incoming', { action: 'status' })).results).toHaveLength(1);
      // A check that cannot run comes back with its own message, not a bare failure.
      push('feature', 'other.txt', 'new file\n', 'Add another file');
      mkdirSync(join(mine, '.fuse'));
      writeFileSync(join(mine, '.fuse', 'detect.json'), 'not json');
      const broken = await call('fuse_incoming', { skipAi: true });
      expect(broken).toMatchObject({ failed: true, conflict: false });
      expect(broken.checked[0].ref).toBe('origin/feature');
      expect(broken.checked[0].error).toContain('merge-check');
      rmSync(join(mine, '.fuse'), { recursive: true });

      expect((await call('fuse_incoming', { action: 'off' })).message).toContain('off');
      expect(await call('fuse_incoming', { skipAi: true })).toMatchObject({ off: true });

      // Committed code only: HEAD is still the base, so the push merges cleanly.
      const pair = await call('fuse_detect', { a: 'HEAD', b: 'origin/main', skipAi: true });
      expect(pair).toMatchObject({ conflict: false, stage: 'merge-check' });
    } finally {
      await client.close();
    }
  });
  it('checks each linked worktree against its own code, sharing only on and off', () => {
    const { mine, run, runIn, push } = team();
    const second = join(mine, '..', 'second');
    git(mine, 'worktree', 'add', '-q', '-b', 'second', second);
    run();
    runIn(second);
    push('main', 'shared.txt', 'from the teammate\n', 'Reword the shared text');
    // Only the first worktree has local work the push conflicts with.
    writeFileSync(join(mine, 'shared.txt'), 'from me\n');

    const first = run();
    expect(first.status).toBe(1);
    expect(first.out).toContain('conflicts with your local work');
    // The same push is still new to the second worktree, and fine for its code.
    const other = runIn(second);
    expect(other.status).toBe(0);
    expect(other.out).toContain('origin/main');
    expect(other.out).toContain('does not conflict');
    expect(runIn(second, '--hook', '--interval', '15').out).toBe('');

    run('off');
    expect(runIn(second, 'status').out).toContain('Incoming checks are off');
  });
  it('reports each result once when several hooks run at the same moment', async () => {
    const { mine, run, env } = team();
    run();
    // Results a background run has saved but no hook has shown yet.
    const file = join(mine, '.git/fuse/incoming.json');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    saved.lastRun = Date.now();
    saved.results = [1, 2, 3].map((n) => ({
      ref: `origin/push-${n}`,
      sha: `${n}`.repeat(40),
      author: 'Sam',
      subject: `Push ${n}`,
      conflict: true,
      category: 'runtime',
      stage: 'llm',
      explanation: `explanation ${n}`,
      reported: false,
    }));
    writeFileSync(file, JSON.stringify(saved));

    const outputs = await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          new Promise<string>((done) => {
            let out = '';
            const child = spawn(process.execPath, [incoming, '--repo', mine, '--hook'], { env });
            child.stdout.on('data', (chunk) => (out += chunk));
            child.on('exit', () => done(out));
          }),
      ),
    );
    const all = outputs.join('');
    for (const n of [1, 2, 3]) expect(all.split(`explanation ${n}`)).toHaveLength(2);
    expect(JSON.parse(readFileSync(file, 'utf8')).results).toHaveLength(3);
  });
  it('checks a push once when several checks start at the same moment', async () => {
    const { mine, run, push, state, env } = team();
    run();
    push('main', 'shared.txt', 'from the teammate\n', 'Reword the shared text');
    writeFileSync(join(mine, 'shared.txt'), 'from me\n');

    const outputs = await Promise.all(
      Array.from(
        { length: 4 },
        () =>
          new Promise<string>((done) => {
            let out = '';
            const child = spawn(process.execPath, [incoming, '--repo', mine, '--no-llm'], { env });
            child.stdout.on('data', (chunk) => (out += chunk));
            child.on('exit', () => done(out));
          }),
      ),
    );
    // One run checked it; the others found a run in progress or nothing left to check.
    expect(outputs.filter((out) => out.includes('conflicts with your local work'))).toHaveLength(1);
    expect(state().results).toHaveLength(1);
    expect(state().running).toBeUndefined();
  });
  it('tries a push again after a check that failed to run', () => {
    const { mine, run, push, state } = team();
    run();
    push('main', 'shared.txt', 'from the teammate\n', 'Add a line');
    writeFileSync(join(mine, 'mine.txt'), 'local work\n');
    // A broken configuration stands in for an outage: the check cannot run.
    const target = join(directory(), 'target.json');
    writeFileSync(target, 'not json');
    const failed = run('--target', target);
    expect(failed.status).toBe(2);
    expect(failed.out).toContain('could not check origin/main');
    // Reported to the agent once, however many times it fails.
    expect(run('--hook', '--interval', '15').out).toBe('');
    expect(run('--target', target).status).toBe(2);
    expect(state().results).toHaveLength(1);
    expect(state().results[0].reported).toBe(true);

    // Fails only with both: my new file and the teammate's reworded text.
    const fails = '! (test -f mine.txt && grep -q teammate shared.txt)';
    writeFileSync(target, JSON.stringify({ typecheck: 'true', test: fails }));
    const retried = run('--target', target);
    expect(retried.status).toBe(1);
    expect(retried.out).toContain('Kind: test');
    expect(state().results).toHaveLength(1);
    expect(run('--target', target).out).toBe('No new pushes to check.');
  });
  it('starts every worktree watching afresh when checks are turned back on', () => {
    const { mine, run, runIn, push } = team();
    const second = join(mine, '..', 'second');
    git(mine, 'worktree', 'add', '-q', '-b', 'second', second);
    run();
    runIn(second);
    run('off');
    push('main', 'shared.txt', 'from the teammate\n', 'Pushed while off');
    run('on');
    // The second worktree did not run `on` itself, but must not check that push.
    expect(runIn(second).out).toContain('Nothing checked yet');
    expect(runIn(second).out).toBe('No new pushes to check.');
  });

  it('does not start a background check while checks are off or too soon', async () => {
    const { mine, run, push, state } = team();
    run();
    push('main', 'shared.txt', 'from the teammate\n', 'Reword the shared text');
    writeFileSync(join(mine, 'shared.txt'), 'from me\n');
    run('off');
    // A background run started anyway (say by a hook just before `off`).
    expect(run('--background', '--interval', '0').status).toBe(0);
    expect(state().results).toHaveLength(0);

    run('on');
    push('main', 'shared.txt', 'second change\n', 'Change it again');
    const ran = state().lastRun;
    // Within the interval a background run does nothing, even if a hook started it.
    expect(run('--background', '--interval', '15').status).toBe(0);
    expect(state().results).toHaveLength(0);
    expect(state().lastRun).toBe(ran);
    expect(run('--background', '--interval', '0').status).toBe(1);
    expect(state().results).toHaveLength(1);
  });
  it('keeps trying a push whose check fails for free reasons', () => {
    const { run, push, state } = team();
    run();
    push('main', 'shared.txt', 'from the teammate\n', 'Add a line');
    const target = join(directory(), 'target.json');
    writeFileSync(target, 'not json');
    for (let i = 0; i < 4; i++) expect(run('--target', target).status).toBe(2);
    expect(state().results).toHaveLength(1);
    expect(state().results[0]).toMatchObject({ attempts: 0 });
    expect(state().results[0].gaveUp).toBeUndefined();
    writeFileSync(target, JSON.stringify({ typecheck: 'true', test: 'true' }));
    expect(run('--target', target).out).toContain('does not conflict');
  });

  it('gives up after 3 paid tries whose reply could not be used, and says so once', () => {
    const { run, push, state } = team();
    run();
    push('main', 'shared.txt', 'from the teammate\n', 'Add a line');
    // Stands in for a paid AI reply that came back unusable: the failure's
    // output carries the billed marker the AI step prints.
    const target = join(directory(), 'target.json');
    writeFileSync(
      target,
      JSON.stringify({ typecheck: "echo 'llm: billed cost_usd=0.01' >&2; exit 127", test: 'true' }),
    );
    expect(run('--target', target).status).toBe(2);
    expect(run('--target', target).status).toBe(2);
    const last = run('--target', target);
    expect(last.out).toContain('gave up after 3 paid tries');
    expect(state().results[0]).toMatchObject({ attempts: 3, gaveUp: true, reported: true });
    // Shown by that run already, so the hook does not repeat it.
    expect(run('--hook', '--interval', '15').out).toBe('');
    expect(run('--target', target).out).toBe('No new pushes to check.');
  });

  it('checks a commit once when it is pushed to two branches', () => {
    const { mine, run, push } = team();
    run();
    push('feature', 'shared.txt', 'from the teammate\n', 'Reword the shared text');
    git(join(mine, '..', 'mate'), 'push', '-q', 'origin', 'feature:main');
    writeFileSync(join(mine, 'shared.txt'), 'from me\n');
    const first = run();
    expect(first.out.split('conflicts with your local work')).toHaveLength(2);
    expect(run().out).toBe('No new pushes to check.');
  });

  it('does not take a reused process id for a run still going', () => {
    const { mine, run, push, state } = team();
    run();
    push('main', 'other.txt', 'new\n', 'Add a file');
    // A claim left by a run before a reboot, whose pid now belongs to a live
    // process (this test's own) that started at another time.
    const file = join(mine, '.git/fuse/incoming.json');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    saved.running = { pid: process.pid, at: 0, started: 'Mon Jan  1 00:00:00 2001' };
    writeFileSync(file, JSON.stringify(saved));
    const checked = run();
    expect(checked.out).toContain('origin/main');
    expect(state().running).toBeUndefined();
  });
});
