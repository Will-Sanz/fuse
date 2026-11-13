import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
});
