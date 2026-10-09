import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDemo } from '../server/demo';
import {
  applyReview,
  configureCheck,
  decide,
  inspect,
  linkCommit,
  markMerged,
  preview,
  registerSession,
  setIntent,
  watchOnce,
} from '../server/local';
import { LocalStore } from '../server/local-store';
import { git } from '../server/git';
import type { Review } from '../shared/review';

const dirs: string[] = [];
function directory() {
  const p = mkdtempSync(join(tmpdir(), 'fuse-local-'));
  dirs.push(p);
  return p;
}
function demo(single = false) {
  return createDemo(join(directory(), 'demo'), single);
}
function accepted(repo: string, r: Review, order: 'a-first' | 'b-first' = 'a-first') {
  r = decide(repo, r.id, r.revision, 'checkout.ts', 'overlap:validateBody', {
    choice: 'both',
    order,
    note: 'Preserve both validations with the chosen error precedence.',
  });
  return preview(repo, r.id, r.revision);
}
afterEach(() => dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
describe('local Git companion', () => {
  it('explains ordinary working changes without guessing an agent or inventing overlap', () => {
    const d = demo(true),
      r = d.review;
    expect(r.files[0].analysis.conflicts).toEqual([]);
    expect(r.sources.a.ref.sessionId).toBeUndefined();
    expect(r.files[0].evidence.find((e) => e.revision === 'a')?.observations.join(' ')).toContain(
      'Your order is incomplete',
    );
    expect(r.files[0].graphs.base.find((n) => n.id === 'validateBody')?.calls).toEqual([]);
    expect(r.files[0].input.agentA).toBe(readFileSync(join(d.repo, 'checkout.ts'), 'utf8'));
  });
  it('uses explicit worktree registration and actual Git revisions', () => {
    const d = demo();
    expect(d.review.sources.a.ref.sessionId).toBe('request');
    expect(d.review.sources.b.ref.sessionId).toBe('schema');
    for (const path of [d.sessionA!, d.sessionB!]) {
      git(path, ['add', 'checkout.ts']);
      git(path, ['commit', '-m', 'Session edit']);
    }
    const r = inspect({ repo: d.repo, a: 'session/request', b: 'session/schema' });
    expect(r.baseCommit).toBe(d.review.baseCommit);
    expect(r.files[0].analysis.conflicts[0].id).toBe('overlap:validateBody');
    expect(r.sources.a.ref.sessionId).toBeUndefined();
    expect(() => inspect({ repo: d.repo, a: '--bad-ref' })).toThrow('Invalid Git');
    const other = demo();
    expect(() => registerSession(d.repo, 'other', 'Other', other.repo)).toThrow('worktree');
  });
  it('asks about ambiguous intent, then grounds the recommendation in the answer', () => {
    const d = demo();
    expect(d.review.files[0].recommendations[0].action).toBeUndefined();
    expect(d.review.files[0].recommendations[0].question).toContain('should A or B');
    const r = setIntent(d.repo, d.review.id, 0, {
      first: 'b',
      rationale: 'Malformed fields should get their specific error first.',
    });
    expect(r.files[0].recommendations[0].action?.order).toBe('b-first');
    expect(r.files[0].recommendations[0].confidence).toBe('intent-guided');
    expect(() => setIntent(d.repo, r.id, 0, { first: 'a', rationale: 'Old tab' })).toThrow('stale');
  });
  it('previews without writing, applies with approval, runs real checks, and persists evidence', () => {
    const d = demo(),
      before = readFileSync(join(d.repo, 'checkout.ts'), 'utf8');
    const r = accepted(d.repo, d.review);
    expect(readFileSync(join(d.repo, 'checkout.ts'), 'utf8')).toBe(before);
    expect(() => applyReview(d.repo, r.id, r.revision, 'wrong')).toThrow('preview token');
    const applied = applyReview(d.repo, r.id, r.revision, r.preview!.token);
    expect(applied.status).toBe('applied');
    expect(applied.checks[0].status).toBe('passed');
    expect(applied.checks[0].stdout).toContain('PASS: empty order');
    expect(new LocalStore(d.repo).get(r.id)).toEqual(applied);
    expect(applied.attribution.verified).toBe(false);
    expect(applied.events.at(-1)?.reviewer).toContain('unverified');
    expect(() => applyReview(d.repo, r.id, applied.revision, r.preview!.token)).toThrow();
    git(d.repo, ['add', 'checkout.ts']);
    git(d.repo, ['commit', '-m', 'Resolve checkout']);
    const linked = linkCommit(d.repo, r.id, applied.revision, 'HEAD');
    expect(linked.status).toBe('committed');
    expect(linked.commit).toBe(git(d.repo, ['rev-parse', 'HEAD']));
    expect(() => markMerged(d.repo, r.id, linked.revision, 'HEAD')).toThrow('later integration');
    git(d.repo, ['commit', '--allow-empty', '-m', 'Integration checkpoint']);
    expect(markMerged(d.repo, r.id, linked.revision, 'HEAD').status).toBe('merged');
  });
  it('records different observable checkout behavior for different orders', () => {
    const d = demo(),
      r = accepted(d.repo, d.review, 'b-first');
    const applied = applyReview(d.repo, r.id, r.revision, r.preview!.token);
    expect(applied.checks[0].status).toBe('failed');
    expect(applied.checks[0].stderr).toContain('email: enter a valid email address');
    expect(applied.checks[0].stderr).toContain('Your order is incomplete');
    const run = spawnSync(process.execPath, ['checkout.test.mjs', 'specific'], {
      cwd: d.repo,
      encoding: 'utf8',
    });
    expect(run.status).toBe(0);
  });
  it('refuses stale sources, new target work, and changed check configuration', () => {
    const d = demo(),
      r = accepted(d.repo, d.review);
    writeFileSync(
      join(d.sessionA!, 'checkout.ts'),
      d.review.files[0].input.agentA + '\n// newer work\n',
    );
    expect(() => applyReview(d.repo, r.id, r.revision, r.preview!.token)).toThrow(
      'Input revisions',
    );
    writeFileSync(join(d.sessionA!, 'checkout.ts'), d.review.files[0].input.agentA);
    writeFileSync(join(d.repo, 'notes.txt'), 'protect this');
    expect(() => applyReview(d.repo, r.id, r.revision, r.preview!.token)).toThrow('uncommitted');
    expect(readFileSync(join(d.repo, 'notes.txt'), 'utf8')).toBe('protect this');
    rmSync(join(d.repo, 'notes.txt'));
    configureCheck(d.repo, {
      name: 'New check',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      timeoutMs: 1000,
    });
    expect(() => applyReview(d.repo, r.id, r.revision, r.preview!.token)).toThrow('checks changed');
  });
  it('does not automatically execute repository scripts and reports command errors and timeouts', () => {
    const d = demo();
    configureCheck(d.repo, {
      name: 'Timeout',
      command: process.execPath,
      args: ['-e', 'setInterval(()=>{},1000)'],
      timeoutMs: 100,
    });
    configureCheck(d.repo, {
      name: 'Missing executable',
      command: 'fuse-no-such-executable',
      args: [],
      timeoutMs: 1000,
    });
    const r = accepted(d.repo, d.review),
      applied = applyReview(d.repo, r.id, r.revision, r.preview!.token);
    expect(applied.checks.map((c) => c.status)).toEqual(['passed', 'timed-out', 'error']);
  });
  it('deduplicates alerts across invocations and refreshes changed evidence', () => {
    const d = demo();
    const first = watchOnce({ repo: d.repo });
    expect(first.alert).toBe(true);
    expect(watchOnce({ repo: d.repo }).alert).toBe(false);
    writeFileSync(
      join(d.sessionA!, 'checkout.ts'),
      d.review.files[0].input.agentA.replace('Your order is incomplete', 'Complete your order'),
    );
    const next = watchOnce({ repo: d.repo });
    expect(next.alert).toBe(true);
    expect(next.updated).toBe(true);
    expect(next.review.id).not.toBe(first.review.id);
    expect(next.review.files[0].input.agentA).toContain('Complete your order');
    expect(watchOnce({ repo: d.repo }).alert).toBe(false);
  });
  it('keeps unsupported and malformed changes visible and blocks unsafe application', () => {
    const d = demo();
    writeFileSync(join(d.sessionA!, 'README.md'), 'A real change outside TypeScript');
    writeFileSync(join(d.sessionB!, 'broken.ts'), 'function {');
    const r = inspect({ repo: d.repo, sessions: true });
    expect(r.unsupported.map((f) => f.path)).toEqual(['README.md', 'broken.ts']);
    expect(() => preview(d.repo, r.id, r.revision)).toThrow('Unsupported changes');
    expect(readFileSync(join(d.sessionA!, 'README.md'), 'utf8')).toContain('real change');
  });
  it('distinguishes independent edits and possible interactions in real worktrees', () => {
    const d = demo();
    const base = d.review.files[0].input.base;
    writeFileSync(
      join(d.sessionA!, 'checkout.ts'),
      base.replace('return sendResponse(order)', 'return { ok: false }'),
    );
    writeFileSync(
      join(d.sessionB!, 'checkout.ts'),
      base.replace('email: enter a valid email address', 'Check your email'),
    );
    let r = inspect({ repo: d.repo, sessions: true });
    expect(r.files[0].analysis.conflicts).toEqual([]);
    writeFileSync(
      join(d.sessionA!, 'checkout.ts'),
      base.replace('return sendResponse(order)', 'return { ok: result.ok }'),
    );
    writeFileSync(
      join(d.sessionB!, 'checkout.ts'),
      base.replace(
        'function validateBody(order: Order): Result {\n  return { ok: true };',
        'function validateBody(order: Order): Result {\n  return { ok: false };',
      ),
    );
    r = inspect({ repo: d.repo, sessions: true });
    expect(r.files[0].analysis.conflicts[0].kind).toBe('dependency');
    expect(r.files[0].recommendations[0].reason).toContain('not proof');
  });
  it('exercises the actual executable, JSON output, and exit codes', () => {
    const d = demo();
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [resolve('cli/run.mjs'), ...args, '--repo', d.repo, '--json'], {
        encoding: 'utf8',
      });
    const inspectResult = run('inspect', '--sessions');
    expect(inspectResult.status, inspectResult.stderr).toBe(2);
    expect(JSON.parse(inspectResult.stdout).data.sources.a.ref.sessionId).toBe('request');
    expect(run('inspect', '--a', 'missing-ref').status).toBe(1);
    expect(run('wat').status).toBe(1);
    expect(run('watch', '--once').status).toBe(2);
    expect(run('watch', '--once').status).toBe(0);
    const r = accepted(d.repo, d.review);
    expect(run('apply', r.id, '--approve', 'wrong').status).toBe(3);
    expect(run('apply', r.id, '--approve', r.preview!.token).status).toBe(0);
    expect(
      JSON.parse(run('history').stdout).data.some(
        (x: { status: string }) => x.status === 'applied',
      ),
    ).toBe(true);
  });
});
