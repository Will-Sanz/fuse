import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, [incoming, '--repo', mine, '--no-llm', ...args], {
      encoding: 'utf8',
      env,
    });
    return { status: r.status, out: r.stdout.trim(), stderr: r.stderr };
  };
  const push = (branch: string, file: string, text: string, message: string) => {
    git(mate, 'checkout', '-q', '-B', branch);
    writeFileSync(join(mate, file), text);
    git(mate, 'add', '.');
    git(mate, 'commit', '-q', '-m', message);
    git(mate, 'push', '-q', 'origin', branch);
  };
  const state = () => JSON.parse(readFileSync(join(mine, '.git/fuse/incoming.json'), 'utf8'));
  return { mine, run, push, state };
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
});
