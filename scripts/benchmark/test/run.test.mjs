import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { armOrder, productSnapshot } from '../run.mjs';

test('the frozen schedule counterbalances both arms without changing case membership', () => {
  const orders = Array.from({ length: 53 }, (_, i) => armOrder(i, 'fixed-seed'));
  assert.ok(
    Math.abs(
      orders.filter((o) => o[0] === 'agent').length - orders.filter((o) => o[0] === 'fuse').length,
    ) === 1,
  );
  for (const order of orders) assert.deepEqual([...order].sort(), ['agent', 'fuse']);
  assert.deepEqual(armOrder(7, 'fixed-seed'), armOrder(7, 'fixed-seed'));
});

test('production provenance rejects dirty/untracked code while allowing result documentation', () => {
  const repo = mkdtempSync(join(tmpdir(), 'fuse-benchmark-freeze-'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  try {
    git('init', '-q');
    mkdirSync(join(repo, 'server'));
    writeFileSync(join(repo, 'server/app.ts'), 'export const value = 1;\n');
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Base');
    const pinned = productSnapshot(repo);
    writeFileSync(join(repo, 'RESULTS.md'), 'Documentation only');
    assert.equal(productSnapshot(repo), pinned);
    writeFileSync(join(repo, 'server/new.ts'), 'untracked source');
    assert.throws(() => productSnapshot(repo), /Commit production inputs/);
    rmSync(join(repo, 'server/new.ts'));
    writeFileSync(join(repo, 'server/app.ts'), 'changed source');
    assert.throws(() => productSnapshot(repo));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
