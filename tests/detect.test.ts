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
  it('counts a second copy of an error a side already has as new', () => {
    const repo = repository({ a: { 'a.txt': 'a\n' }, b: { 'b.txt': 'b\n' } });
    const target = join(directory(), 'target.json');
    // Side A has one TS2322 in a.ts; the merge adds an identical one elsewhere.
    const typecheck = [
      'if test -f a.txt; then echo "a.ts(3,1): error TS2322: bad"; fi',
      'if test -f a.txt && test -f b.txt; then echo "a.ts(9,1): error TS2322: bad"; fi',
      '! test -f a.txt',
    ].join('; ');
    writeFileSync(target, JSON.stringify({ typecheck, test: 'true' }));
    const { status, answer } = run(repo, '--target', target);
    expect(status).toBe(1);
    expect(answer).toMatchObject({ conflict: true, category: 'build' });
  });

  it('treats a typecheck that times out as a check that failed to run', () => {
    const repo = repository({ a: { 'a.txt': 'a\n' }, b: { 'b.txt': 'b\n' } });
    const target = join(directory(), 'target.json');
    writeFileSync(
      target,
      JSON.stringify({ typecheck: 'sleep 5', test: 'true', timeout_seconds: 1 }),
    );
    const { status, stderr } = run(repo, '--target', target);
    expect(status).toBe(2);
    expect(stderr).toContain('typecheck timed out');
  });

  it('compares test suites that fail to load instead of calling it an outage', () => {
    // Every suite fails to load after the merge only, so no assertion runs.
    const repo = repository({ a: { 'a.txt': 'a\n' }, b: { 'b.txt': 'b\n' } });
    const target = join(directory(), 'target.json');
    const report = (failed: boolean) =>
      JSON.stringify({
        numPassedTests: failed ? 0 : 1,
        numFailedTests: 0,
        testResults: failed
          ? [{ name: 'suite.test.ts', status: 'failed', assertionResults: [] }]
          : [],
      });
    const test = `if test -f a.txt && test -f b.txt; then echo '${report(true)}' > {report}; exit 1; else echo '${report(false)}' > {report}; fi`;
    writeFileSync(target, JSON.stringify({ typecheck: 'true', test, test_report: 'jest-json' }));
    const { status, answer } = run(repo, '--target', target);
    expect(status).toBe(1);
    expect(answer).toMatchObject({ conflict: true, category: 'test' });
    expect(answer.explanation).toContain('suite.test.ts');
  });

  it('runs setup again when its command or environment changes', () => {
    const repo = repository({ a: { 'a.txt': 'a\n' }, b: { 'b.txt': 'b\n' } });
    const tmp = directory();
    const runs = join(directory(), 'setup-runs');
    const target = join(directory(), 'target.json');
    const write = (run: string, env: Record<string, string> = {}) =>
      writeFileSync(
        target,
        JSON.stringify({
          setup: [{ run, inputs: ['shared.txt'] }],
          env,
          typecheck: 'true',
          test: 'true',
        }),
      );
    const checkOnce = () =>
      spawnSync(
        process.execPath,
        [check, '--repo', repo, '--a', 'a', '--b', 'b', '--no-llm', '--target', target],
        {
          env: { ...process.env, TMPDIR: tmp, FUSE_DETECT_DB_LOCK: join(tmp, 'db.lock') },
        },
      ).status;
    const setupRuns = () => readFileSync(runs, 'utf8').trim().split('\n');

    write(`echo one >> '${runs}'`);
    checkOnce();
    checkOnce();
    expect(setupRuns()).toEqual(['one']);
    write(`echo two >> '${runs}'`);
    checkOnce();
    expect(setupRuns()).toEqual(['one', 'two']);
    write(`echo two >> '${runs}'`, { MODE: 'other' });
    checkOnce();
    expect(setupRuns()).toEqual(['one', 'two', 'two']);
  });
  it('counts a changed import as a change to the code that uses it', async () => {
    const { buildGraph } = await import(/* @vite-ignore */ resolve('detect/graph.mjs'));
    const repo = join(directory(), 'repo');
    spawnSync('git', ['init', '-q', '-b', 'main', repo]);
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src/old.ts'), 'export function provide() {\n  return 1;\n}\n');
    writeFileSync(join(repo, 'src/new.ts'), 'export function provide() {\n  return 2;\n}\n');
    const handler = (from: string) =>
      `import { provide } from './${from}';\n\nexport function handle() {\n  return provide();\n}\n`;
    writeFileSync(join(repo, 'src/handler.ts'), handler('old'));
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'Base');
    // A only redirects the import; B changes the module it now points to.
    git(repo, 'checkout', '-q', '-b', 'a');
    writeFileSync(join(repo, 'src/handler.ts'), handler('new'));
    git(repo, 'commit', '-qam', 'Use the new provider');
    git(repo, 'checkout', '-q', '-b', 'b', 'main');
    writeFileSync(join(repo, 'src/new.ts'), 'export function provide() {\n  return 3;\n}\n');
    git(repo, 'commit', '-qam', 'Change the new provider');
    const graph = buildGraph({ repo, base: 'main', a: 'a', b: 'b' });
    expect(graph).toContain('src/handler.ts#handle');
    expect(graph).toContain('src/new.ts#provide');
    expect(graph).not.toContain('No links found');
  });
  it('keeps a repository path with shell characters literal', () => {
    const root = directory();
    const marker = join(root, 'ran');
    const repo = join(root, `repo$(touch ${marker})`);
    spawnSync('git', ['init', '-q', '-b', 'main', repo]);
    writeFileSync(join(repo, 'shared.txt'), 'base\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'Base');
    for (const side of ['a', 'b']) {
      git(repo, 'checkout', '-q', '-b', side, 'main');
      writeFileSync(join(repo, `${side}.txt`), `${side}\n`);
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', side);
    }
    expect(run(repo).answer).toMatchObject({ conflict: false });
    expect(existsSync(marker)).toBe(false);
  });

  it('marks a textual conflict as untested, and a checker that cannot run as an error', () => {
    const textual = repository({ a: { 'shared.txt': 'a\n' }, b: { 'shared.txt': 'b\n' } });
    const target = join(directory(), 'target.json');
    writeFileSync(target, JSON.stringify({ typecheck: 'no-such-checker-xyz', test: 'true' }));
    expect(run(textual, '--target', target).answer).toMatchObject({
      category: 'textual',
      tested: false,
    });

    const clean = repository({ a: { 'a.txt': 'a\n' }, b: { 'b.txt': 'b\n' } });
    const missing = run(clean, '--target', target);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('could not run');
  });

  it('does not call an error both sides added on their own a conflict', () => {
    const repo = repository({ a: { 'a.txt': 'a\n' }, b: { 'b.txt': 'b\n' } });
    const target = join(directory(), 'target.json');
    // Each side adds the same TS2322 at its own place; the merge has both.
    const typecheck = [
      'if test -f a.txt; then echo "x.ts(1,1): error TS2322: bad"; fi',
      'if test -f b.txt; then echo "x.ts(5,1): error TS2322: bad"; fi',
      '! (test -f a.txt || test -f b.txt)',
    ].join('; ');
    writeFileSync(target, JSON.stringify({ typecheck, test: 'true' }));
    expect(run(repo, '--target', target).answer).toMatchObject({ conflict: false, tested: false });
  });

  it('leaves nothing a check started running after it ends', () => {
    const pidFile = join(directory(), 'pid');
    const r = spawnSync(
      process.execPath,
      [resolve('detect/run-group.mjs'), '5000', `sleep 30 & echo $! > '${pidFile}'`],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
    const timedOut = spawnSync(process.execPath, [
      resolve('detect/run-group.mjs'),
      '200',
      'sleep 5',
    ]);
    expect(timedOut.status).toBe(124);
  });

  it('tells apart unnamed statements and follows aliased imports', async () => {
    const { buildGraph } = await import(/* @vite-ignore */ resolve('detect/graph.mjs'));
    const repo = join(directory(), 'repo');
    spawnSync('git', ['init', '-q', '-b', 'main', repo]);
    mkdirSync(join(repo, 'src'));
    const routes = (second: string) =>
      `import { provide as getValue } from './new';\n\nrouter.get(\n  '/one', () => 1,\n);\n\nrouter.get(\n  '/two', () => ${second},\n);\n`;
    writeFileSync(join(repo, 'src/new.ts'), 'export function provide() {\n  return 2;\n}\n');
    writeFileSync(join(repo, 'src/routes.ts'), routes('getValue()'));
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'Base');
    git(repo, 'checkout', '-q', '-b', 'a');
    writeFileSync(join(repo, 'src/routes.ts'), routes('getValue() + 1'));
    git(repo, 'commit', '-qam', 'Change the second route');
    git(repo, 'checkout', '-q', '-b', 'b', 'main');
    writeFileSync(join(repo, 'src/new.ts'), 'export function provide() {\n  return 3;\n}\n');
    git(repo, 'commit', '-qam', 'Change the provider');
    const graph = buildGraph({ repo, base: 'main', a: 'a', b: 'b' });
    expect(graph).toContain('src/routes.ts#router.get( (2)');
    expect(graph).toContain('src/new.ts#provide');
  });
  it('does not blame the merge for tests a side could not reach alone', () => {
    // Base has a type error that B fixes; A's unfinished work fails a test.
    const repo = repository({ a: { 'a.txt': 'a\n' }, b: { 'fixed.txt': 'b\n' } });
    const target = join(directory(), 'target.json');
    writeFileSync(
      target,
      JSON.stringify({ typecheck: 'test -f fixed.txt', test: '! test -f a.txt' }),
    );
    const { status, answer } = run(repo, '--target', target);
    expect(status).toBe(0);
    expect(answer).toMatchObject({ conflict: false, tested: false });
    expect(answer.explanation).toContain('already fails the typecheck alone');
  });

  it('reports a checker killed by a signal as an error, and takes 0 as no time limit', () => {
    const repo = repository({ a: { 'a.txt': 'a\n' }, b: { 'b.txt': 'b\n' } });
    const target = join(directory(), 'target.json');
    writeFileSync(target, JSON.stringify({ typecheck: 'kill -9 $$', test: 'true' }));
    const killed = run(repo, '--target', target);
    expect(killed.status).toBe(2);
    expect(killed.stderr).toContain('killed by a signal');

    writeFileSync(
      target,
      JSON.stringify({ typecheck: 'sleep 0.2', test: 'true', timeout_seconds: 0 }),
    );
    expect(run(repo, '--target', target).answer).toMatchObject({ conflict: false, tested: true });
    writeFileSync(target, JSON.stringify({ typecheck: 'true', test: 'true', timeout_seconds: -1 }));
    expect(run(repo, '--target', target).stderr).toContain('timeout_seconds must be');
  });

  it('kills what a check started when the process running it dies', async () => {
    const dir = directory();
    const pidFile = join(dir, 'pid');
    const group = JSON.stringify(resolve('detect/run-group.mjs'));
    const command = JSON.stringify(`sleep 30 & echo $! > '${pidFile}'; wait`);
    // A stand-in for merge-check: starts run-group, then is killed outright.
    const parent = spawn(
      process.execPath,
      [
        '-e',
        `require('node:child_process').spawn(process.execPath, [${group}, '0', ${command}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`,
      ],
      { stdio: 'ignore' },
    );
    for (let i = 0; i < 50 && !existsSync(pidFile); i++)
      await new Promise((r) => setTimeout(r, 100));
    const pid = Number(readFileSync(pidFile, 'utf8'));
    parent.kill('SIGKILL');
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 40 && alive(); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive()).toBe(false);
  });
});
