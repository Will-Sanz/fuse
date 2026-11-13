import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The conflict check without its LLM stage: no API key and no network needed.
const check = resolve('detect/check.mjs');
const dirs: string[] = [];
function directory() {
  const p = realpathSync(mkdtempSync(join(tmpdir(), 'fuse-detect-')));
  dirs.push(p);
  return p;
}
function git(repo: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}
/** A repository with a base commit and one branch per entry of `sides`. */
function repository(sides: Record<string, Record<string, string>>) {
  const repo = join(directory(), 'repo');
  spawnSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'shared.txt'), 'base\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'Base');
  for (const [branch, files] of Object.entries(sides)) {
    git(repo, 'checkout', '-q', '-b', branch, 'main');
    for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, name), text);
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', `Change on ${branch}`);
  }
  git(repo, 'checkout', '-q', 'main');
  return repo;
}
function run(repo: string, ...extra: string[]) {
  const r = spawnSync(
    process.execPath,
    [check, '--repo', repo, '--a', 'a', '--b', 'b', '--no-llm', ...extra],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        TMPDIR: directory(),
        FUSE_DETECT_DB_LOCK: join(directory(), 'db.lock'),
      },
    },
  );
  return { status: r.status, answer: JSON.parse(r.stdout || 'null'), stderr: r.stderr };
}
afterEach(() => dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));

describe('conflict check without the LLM stage', () => {
  it('reports a git merge conflict as textual', () => {
    const repo = repository({ a: { 'shared.txt': 'from a\n' }, b: { 'shared.txt': 'from b\n' } });
    const { status, answer } = run(repo);
    expect(status).toBe(1);
    expect(answer).toMatchObject({ conflict: true, stage: 'merge-check', category: 'textual' });
    expect(answer.explanation).toContain('shared.txt');
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('passes a clean merge and says it was not built or tested', () => {
    const repo = repository({ a: { 'a.txt': 'a\n' }, b: { 'b.txt': 'b\n' } });
    const summary = join(directory(), 'summary.md');
    const { status, answer } = run(repo, '--summary', summary);
    expect(status).toBe(0);
    expect(answer).toMatchObject({ conflict: false, tested: false, cost_usd: 0 });
    expect(readFileSync(summary, 'utf8')).toContain('not built or tested');
  });

  it('reports a failure of the configured checks on the merged code', () => {
    // Each side passes alone; only the merge has both files.
    const repo = repository({ a: { 'a.txt': 'a\n' }, b: { 'b.txt': 'b\n' } });
    const target = join(directory(), 'target.json');
    const both = 'test -f a.txt && test -f b.txt';
    writeFileSync(target, JSON.stringify({ typecheck: 'true', test: `! (${both})` }));
    const failing = run(repo, '--target', target);
    expect(failing.status).toBe(1);
    expect(failing.answer).toMatchObject({ conflict: true, category: 'test', tested: true });

    writeFileSync(target, JSON.stringify({ typecheck: `! (${both})`, test: 'true' }));
    expect(run(repo, '--target', target).answer).toMatchObject({ category: 'build' });

    writeFileSync(target, JSON.stringify({ typecheck: 'true', test: 'true' }));
    const passing = run(repo, '--target', target);
    expect(passing.status).toBe(0);
    expect(passing.answer).toMatchObject({ conflict: false, tested: true });
  });

  it('fails without both sides', () => {
    const r = spawnSync(process.execPath, [check, '--a', 'a'], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--a and --b are required');
  });
  it('builds the AI prompt with or without a task, and finds the key', async () => {
    // Loaded at run time: the detector is plain JavaScript with no type declarations.
    const llm = await import(/* @vite-ignore */ resolve('detect/llm.mjs'));
    const repo = repository({ a: { 'a.txt': 'a\n' }, b: { 'b.txt': 'b\n' } });
    const refs = { repo, base: 'main', a: 'a', b: 'b' };
    const without = llm.buildPrompt(refs, { graph: true, intent: true }).text;
    expect(without).not.toContain('<agent_task>');
    expect(without).toContain('<commit_message_a>\nChange on a');
    expect(without).toContain('<diff_b>');
    const withTask = llm.buildPrompt({ ...refs, task: 'Add a.txt' }, { graph: true, intent: true });
    expect(withTask.text).toContain('<agent_task>\nAdd a.txt');

    const envFile = join(directory(), '.env');
    expect(llm.apiKeyFrom({}, envFile)).toBeUndefined();
    writeFileSync(envFile, 'OTHER=1\nANTHROPIC_API_KEY=from-file\n');
    expect(llm.apiKeyFrom({}, envFile)).toBe('from-file');
    expect(llm.apiKeyFrom({ ANTHROPIC_API_KEY: '' }, envFile)).toBe('from-file');
    expect(llm.apiKeyFrom({ ANTHROPIC_API_KEY: 'from-env' }, envFile)).toBe('from-env');
  });
  it('lets one waiter at a time take over a dead lock on the test database', async () => {
    const dir = directory();
    const lock = join(dir, 'db.lock');
    // A lock left by a process that has exited.
    const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], {
      encoding: 'utf8',
    });
    mkdirSync(lock);
    writeFileSync(join(lock, 'owner'), `${dead.stdout.trim()} old run\n`);
    // Each holder fails if another is inside at the same time.
    const holder = `
      const fs = require('node:fs');
      import(${JSON.stringify(resolve('detect/db-lock.mjs'))}).then(({ acquireDbLock }) => {
        const release = acquireDbLock('test', () => {});
        fs.writeFileSync(${JSON.stringify(join(dir, 'inside'))}, '', { flag: 'wx' });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
        fs.rmSync(${JSON.stringify(join(dir, 'inside'))});
        release();
      });`;
    const exits = await Promise.all(
      Array.from(
        { length: 5 },
        () =>
          new Promise<number | null>((done) =>
            spawn(process.execPath, ['-e', holder], {
              env: { ...process.env, FUSE_DETECT_DB_LOCK: lock },
              stdio: 'ignore',
            }).on('exit', done),
          ),
      ),
    );
    expect(exits).toEqual([0, 0, 0, 0, 0]);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(`${lock}.reclaim`)).toBe(false);
  });
  it('keeps a separate workspace for each repository with the same folder name', () => {
    const sides = { a: { 'a.txt': 'a\n' }, b: { 'b.txt': 'b\n' } };
    const tmp = directory();
    const lock = join(directory(), 'db.lock');
    const checkIn = (repo: string) =>
      spawnSync(process.execPath, [check, '--repo', repo, '--a', 'a', '--b', 'b', '--no-llm'], {
        encoding: 'utf8',
        env: { ...process.env, TMPDIR: tmp, FUSE_DETECT_DB_LOCK: lock },
      }).status;
    // Both are called "repo", in different parent folders.
    expect(checkIn(repository(sides))).toBe(0);
    expect(checkIn(repository(sides))).toBe(0);
    const workspaces = readdirSync(join(tmp, 'fuse-detect', 'merge-check'));
    expect(workspaces.filter((name) => name.startsWith('repo-'))).toHaveLength(2);
  });
  it("runs one check at a time in a repository's workspace", async () => {
    const repo = repository({ a: { 'a.txt': 'a\n' }, b: { 'b.txt': 'b\n' } });
    const tmp = directory();
    // The typecheck step fails if another run is inside the workspace with it.
    const inside = join(directory(), 'inside');
    const target = join(directory(), 'target.json');
    const alone = `test ! -e '${inside}' && touch '${inside}' && sleep 1 && rm '${inside}'`;
    writeFileSync(target, JSON.stringify({ typecheck: alone, test: 'true' }));
    const statuses = await Promise.all(
      [1, 2, 3].map(
        (n) =>
          new Promise<number | null>((done) =>
            spawn(
              process.execPath,
              [check, '--repo', repo, '--a', 'a', '--b', 'b', '--no-llm', '--target', target],
              {
                env: {
                  ...process.env,
                  TMPDIR: tmp,
                  // Separate database locks, so only the workspace lock is tested.
                  FUSE_DETECT_DB_LOCK: join(tmp, `db-${n}.lock`),
                },
                stdio: 'ignore',
              },
            ).on('exit', done),
          ),
      ),
    );
    expect(statuses).toEqual([0, 0, 0]);
  });
  it('runs setup again when its workspace has to be recreated', () => {
    const repo = repository({ a: { 'a.txt': 'a\n' }, b: { 'b.txt': 'b\n' } });
    const tmp = directory();
    const runs = join(directory(), 'setup-runs');
    const target = join(directory(), 'target.json');
    const setup = [{ run: `echo ran >> '${runs}'`, inputs: ['shared.txt'] }];
    writeFileSync(target, JSON.stringify({ setup, typecheck: 'true', test: 'true' }));
    const checkOnce = () =>
      spawnSync(
        process.execPath,
        [check, '--repo', repo, '--a', 'a', '--b', 'b', '--no-llm', '--target', target],
        { env: { ...process.env, TMPDIR: tmp, FUSE_DETECT_DB_LOCK: join(tmp, 'db.lock') } },
      ).status;
    const setupRuns = () => readFileSync(runs, 'utf8').trim().split('\n').length;

    expect(checkOnce()).toBe(0);
    expect(checkOnce()).toBe(0);
    // Unchanged inputs: setup ran once.
    expect(setupRuns()).toBe(1);

    // The system clears part of the temp folder, taking the worktree's link to Git.
    const workspaces = join(tmp, 'fuse-detect', 'merge-check');
    const workspace = readdirSync(workspaces).find((name) => !name.includes('.'))!;
    rmSync(join(workspaces, workspace, '.git'));
    expect(checkOnce()).toBe(0);
    expect(setupRuns()).toBe(2);
  });
  it('does not blame the merge for what already fails on one side alone', () => {
    const repo = repository({ a: { 'a.txt': 'a\n' }, b: { 'b.txt': 'b\n' } });
    const target = join(directory(), 'target.json');
    // Side A's own tests fail, as unfinished local work often does.
    writeFileSync(target, JSON.stringify({ typecheck: 'true', test: 'test ! -f a.txt' }));
    const summary = join(directory(), 'summary.md');
    const inherited = run(repo, '--target', target, '--summary', summary);
    expect(inherited.status).toBe(0);
    expect(inherited.answer).toMatchObject({
      conflict: false,
      tested: false,
      inherited: [{ side: 'a', step: 'test' }],
    });
    expect(inherited.answer.explanation).toContain('already fails on side A alone');
    expect(readFileSync(summary, 'utf8')).toContain('test step already fails on side A alone');

    // A type error side A already has, plus one only the merged code has.
    const typecheck = [
      'if test -f a.txt; then echo "a.ts(3,1): error TS1000: old"; fi',
      'if test -f a.txt && test -f b.txt; then echo "m.ts(9,2): error TS2000: new"; fi',
      '! test -f a.txt',
    ].join('; ');
    writeFileSync(target, JSON.stringify({ typecheck, test: 'true' }));
    const both = run(repo, '--target', target);
    expect(both.status).toBe(1);
    expect(both.answer).toMatchObject({ conflict: true, category: 'build' });
    expect(both.answer.explanation).toContain('TS2000');
    expect(both.answer.explanation).not.toContain('TS1000');
  });
});
