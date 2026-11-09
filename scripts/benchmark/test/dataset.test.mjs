import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareCase, parseCases } from '../dataset.mjs';

const git = (repo, args, input) =>
  execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fuse-dataset-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceRepo = join(root, 'upstream');
  mkdirSync(sourceRepo);
  git(sourceRepo, ['init', '-q', '--initial-branch=main']);
  git(sourceRepo, ['config', 'user.name', 'Fixture']);
  git(sourceRepo, ['config', 'user.email', 'fixture@example.invalid']);
  const commit = (message) => {
    git(sourceRepo, ['add', '-f', '.']);
    git(sourceRepo, ['commit', '-qm', message]);
    return git(sourceRepo, ['rev-parse', 'HEAD']).trim();
  };
  writeFileSync(join(sourceRepo, 'app.ts'), 'export const value = 1;\n');
  writeFileSync(join(sourceRepo, '.env.test'), 'JWT_SECRET=public-test-fixture\n');
  const baseCommit = commit('rw-012 secret evaluation base label');
  writeFileSync(join(sourceRepo, 'app.ts'), 'export const value = 2;\n');
  const aCommit = commit('rw-012: shared helper hashes passwords');
  git(sourceRepo, ['checkout', '-q', '--detach', baseCommit]);
  writeFileSync(join(sourceRepo, 'route.ts'), 'export const route = "password";\n');
  const bCommit = commit('rw-012 claims to use shared compareWithHash, regardless of code');
  mkdirSync(join(sourceRepo, 'eval/oracle'), { recursive: true });
  writeFileSync(join(sourceRepo, 'eval/oracle/answers.json'), 'HIDDEN_EVALUATOR_ANSWER');
  const mainCommit = commit('Evaluator history must not be transferred');
  const evaluatorBlob = git(sourceRepo, [
    'rev-parse',
    `${mainCommit}:eval/oracle/answers.json`,
  ]).trim();
  git(sourceRepo, ['hash-object', '-w', '--stdin'], 'DANGLING_HIDDEN_ANSWER');
  return {
    root,
    sourceRepo,
    baseCommit,
    aCommit,
    bCommit,
    mainCommit,
    evaluatorBlob,
    case: {
      id: 'rw-012',
      baseCommit,
      aCommit,
      bCommit,
      intent_a: 'Move password handling into the helper.',
    },
  };
}

test('reconstructs exact source trees with no evaluator, remote, alternates, or dangling objects', (t) => {
  const d = fixture(t);
  const prepared = prepareCase({ ...d, root: join(d.root, 'actors') });
  assert.ok(!prepared.repo.includes('rw-012'));
  assert.equal(prepared.task, d.case.intent_a);
  assert.deepEqual(Object.keys(prepared).sort(), ['a', 'b', 'base', 'provenance', 'repo', 'task']);
  for (const [side, original] of [
    ['base', d.baseCommit],
    ['a', d.aCommit],
    ['b', d.bCommit],
  ]) {
    assert.match(prepared[side], /^[a-f0-9]{40}$/);
    assert.equal(
      git(prepared.repo, ['rev-parse', `${prepared[side]}^{tree}`]),
      git(d.sourceRepo, ['rev-parse', `${original}^{tree}`]),
    );
  }
  assert.match(
    git(prepared.repo, ['log', '--format=%B', prepared.b]),
    /claims to use shared compareWithHash/,
  );
  assert.doesNotMatch(
    git(prepared.repo, ['log', '--all', '--format=%B']),
    /rw-012|secret evaluation base label/,
  );
  assert.equal(git(prepared.repo, ['remote']).trim(), '');
  assert.ok(!existsSync(join(prepared.repo, '.git/objects/info/alternates')));
  assert.ok(!existsSync(join(prepared.repo, 'eval')));
  assert.equal(
    readFileSync(join(prepared.repo, '.env.test'), 'utf8'),
    'JWT_SECRET=public-test-fixture\n',
  );
  const objects = git(prepared.repo, [
    'cat-file',
    '--batch-all-objects',
    '--batch-check=%(objectname) %(objecttype)',
  ]);
  assert.equal(objects.split('\n').filter((line) => line.endsWith(' commit')).length, 3);
  assert.ok(!objects.includes(d.evaluatorBlob));
  assert.ok(!objects.includes(d.mainCommit));
  assert.throws(() => git(prepared.repo, ['cat-file', '-e', d.evaluatorBlob]));
  assert.equal(git(prepared.repo, ['status', '--porcelain']), '');
  const second = prepareCase({ ...d, root: join(d.root, 'actors') });
  assert.deepEqual([prepared.base, prepared.a, prepared.b], [second.base, second.a, second.b]);
});

test('rejects evaluator paths, symlinks and case identifiers in actor directory', (t) => {
  const d = fixture(t);
  assert.throws(
    () =>
      prepareCase({
        ...d,
        case: { ...d.case, aCommit: d.mainCommit },
        root: join(d.root, 'actors'),
      }),
    /evaluator-only/,
  );
  assert.throws(() => prepareCase({ ...d, root: join(d.root, 'rw-012') }), /case identifier/);
  git(d.sourceRepo, ['checkout', '-q', '--detach', d.baseCommit]);
  symlinkSync('/private/etc/passwd', join(d.sourceRepo, 'outside'));
  git(d.sourceRepo, ['add', 'outside']);
  git(d.sourceRepo, ['commit', '-qm', 'unsafe link']);
  const aCommit = git(d.sourceRepo, ['rev-parse', 'HEAD']).trim();
  assert.throws(
    () => prepareCase({ ...d, case: { ...d.case, aCommit }, root: join(d.root, 'actors') }),
    /Unsafe/,
  );
});

test('accepts exactly 53 unique cases with matching labels and generic input schema', () => {
  const cases = Array.from({ length: 53 }, (_, i) => {
    const id = `rw-${String(i + 1).padStart(3, '0')}`;
    return {
      id,
      type: 'negative',
      label: 'no_conflict',
      base: 'eval-base-v2',
      branch_a: `${id}-a`,
      branch_b: `${id}-b`,
      intent_a: 'A task.',
    };
  });
  const encode = (rows) => rows.map((c) => JSON.stringify(c)).join('\n');
  assert.equal(parseCases(encode(cases)).length, 53);
  assert.throws(() => parseCases(encode(cases.slice(1))), /exactly 53/);
  assert.throws(() => parseCases(encode([cases[0], ...cases.slice(0, -1)])), /duplicate/);
  assert.throws(
    () => parseCases(encode(cases.map((c, i) => (i === 0 ? { ...c, label: 'conflict' } : c)))),
    /Invalid/,
  );
});
