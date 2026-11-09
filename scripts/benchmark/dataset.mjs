import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

export const UPSTREAM_URL = 'https://github.com/elizedrac/realworld-express-prisma';
export const UPSTREAM_COMMIT = '8e8aa21b1c9968c291a981d7d97f30049a4525a8';
export const CASE_TYPES = ['textual', 'build', 'test', 'runtime', 'intent', 'negative'];
const ID = /^rw-\d{3}$/;
const SHA = /^[a-f0-9]{40}$/;
const date = '2000-01-01T00:00:00Z';
const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Developer',
  GIT_AUTHOR_EMAIL: 'developer@example.invalid',
  GIT_COMMITTER_NAME: 'Developer',
  GIT_COMMITTER_EMAIL: 'developer@example.invalid',
  GIT_AUTHOR_DATE: date,
  GIT_COMMITTER_DATE: date,
};
function git(repo, args, input, encoding = 'utf8') {
  return execFileSync('git', ['-C', resolve(repo), ...args], {
    env,
    input,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
export const scrubCaseIds = (message) => message.replace(/\brw-\d{3}\b/gi, '[case]');

export function parseCases(content) {
  const cases = content
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const ids = new Set();
  if (cases.length !== 53) throw new Error('The pinned benchmark must contain exactly 53 cases.');
  for (const c of cases) {
    if (
      !ID.test(c.id) ||
      ids.has(c.id) ||
      !CASE_TYPES.includes(c.type) ||
      c.label !== (c.type === 'negative' ? 'no_conflict' : 'conflict') ||
      c.base !== 'eval-base-v2' ||
      c.branch_a !== `${c.id}-a` ||
      c.branch_b !== `${c.id}-b` ||
      typeof c.intent_a !== 'string' ||
      !c.intent_a.trim()
    )
      throw new Error(`Invalid or duplicate pinned case: ${c.id}`);
    ids.add(c.id);
  }
  return cases;
}

/** Labels stay in the controller; never pass this object to the evaluated agent. */
export function loadDataset(sourceRepo, { lock } = {}) {
  const source = resolve(sourceRepo);
  const content = git(source, ['show', `${UPSTREAM_COMMIT}:eval/cases.jsonl`]);
  const cases = parseCases(content);
  const baseCommit = git(source, ['rev-parse', 'eval-base-v2^{commit}']).trim();
  const recorded = lock?.cases && new Map(lock.cases.map((c) => [c.id, c]));
  if (lock && (lock.upstreamCommit !== UPSTREAM_COMMIT || lock.casesSha256 !== hash(content)))
    throw new Error('Dataset lock does not match the pinned upstream case definitions.');
  for (const c of cases) {
    const saved = recorded?.get(c.id);
    if (lock && (!saved || saved.baseCommit !== baseCommit))
      throw new Error(`Missing or changed locked case ${c.id}`);
    for (const side of ['a', 'b']) {
      const commit =
        saved?.[`${side}Commit`] ||
        git(source, ['rev-parse', `refs/remotes/origin/${c[`branch_${side}`]}^{commit}`]).trim();
      if (!SHA.test(commit)) throw new Error(`Invalid ${side} commit for ${c.id}`);
      git(source, ['cat-file', '-e', `${commit}^{commit}`]);
      git(source, ['merge-base', '--is-ancestor', baseCommit, commit]);
      c[`${side}Commit`] = commit;
      c[`${side}Tree`] = git(source, ['rev-parse', `${commit}^{tree}`]).trim();
    }
    c.baseCommit = baseCommit;
    c.baseTree = git(source, ['rev-parse', `${baseCommit}^{tree}`]).trim();
  }
  const summary = JSON.parse(git(source, ['show', `${UPSTREAM_COMMIT}:eval/results/summary.json`]));
  if (summary.total !== 53 || summary.valid !== 53)
    throw new Error('Pinned upstream verification summary does not report 53 valid cases.');
  const manifest = {
    schemaVersion: 1,
    upstreamUrl: UPSTREAM_URL,
    upstreamCommit: UPSTREAM_COMMIT,
    casesSha256: hash(content),
    baseCommit,
    sourceReportedValidation: {
      valid: summary.valid,
      total: summary.total,
      writtenAt: summary.written_at,
      versions: summary.versions,
      independentlyRerun: false,
      branchHeadsBound: false,
    },
    cases,
  };
  return { cases, manifest };
}

function inspectTree(repo, commit) {
  const rows = git(repo, ['ls-tree', '-rz', '--full-tree', commit]).split('\0').filter(Boolean);
  if (rows.length > 10000) throw new Error('Benchmark tree unexpectedly exceeds 10000 files.');
  for (const row of rows) {
    const tab = row.indexOf('\t');
    const [mode, type] = row.slice(0, tab).split(' ');
    const name = row.slice(tab + 1);
    if (
      !['100644', '100755'].includes(mode) ||
      type !== 'blob' ||
      name.startsWith('/') ||
      name
        .split('/')
        .some((part) =>
          ['..', '.git', '.codex', '.agents', 'eval', 'oracle', '__oracle__', 'AGENTS.md'].includes(
            part,
          ),
        )
    )
      throw new Error(`Unsafe or evaluator-only benchmark path: ${name}`);
  }
  return git(repo, ['rev-parse', `${commit}^{tree}`]).trim();
}

/** Transfers only app trees/blobs, then reconstructs three commits without upstream history. */
export function prepareCase({ sourceRepo, case: c, root }) {
  if (/\brw-\d{3}\b/i.test(resolve(root)))
    throw new Error('Agent-facing directory must not contain a benchmark case identifier.');
  const refs = { base: c.baseCommit, a: c.aCommit, b: c.bCommit };
  for (const commit of Object.values(refs))
    if (!SHA.test(commit)) throw new Error('Invalid commit.');
  const trees = Object.fromEntries(
    Object.entries(refs).map(([side, commit]) => [side, inspectTree(sourceRepo, commit)]),
  );
  mkdirSync(root, { recursive: true });
  const repo = mkdtempSync(join(resolve(root), 'source-'));
  git(repo, ['init', '-q', '--initial-branch=base']);
  // A tree-rooted pack cannot carry the evaluator's main commit or unrelated branches.
  const pack = git(
    sourceRepo,
    ['pack-objects', '--stdout', '--revs'],
    `${Object.values(trees).join('\n')}\n`,
    null,
  );
  git(repo, ['unpack-objects', '-r'], pack);
  const base = git(repo, ['commit-tree', trees.base], 'Initial application snapshot\n').trim();
  const messages = {};
  const reconstructed = { base };
  for (const side of ['a', 'b']) {
    const original = git(sourceRepo, [
      'log',
      '--reverse',
      '--format=%B',
      `${refs.base}..${refs[side]}`,
    ]);
    messages[side] = scrubCaseIds(original);
    reconstructed[side] = git(
      repo,
      ['commit-tree', trees[side], '-p', base],
      messages[side],
    ).trim();
  }
  for (const [side, ref] of [
    ['base', 'base'],
    ['a', 'side-a'],
    ['b', 'side-b'],
  ])
    git(repo, ['update-ref', `refs/heads/${ref}`, reconstructed[side]]);
  git(repo, ['reset', '--hard', '-q', 'base']);
  if (git(repo, ['remote']).trim() || existsSync(join(repo, '.git/objects/info/alternates')))
    throw new Error('Prepared source repository unexpectedly has external object access.');
  const commits = git(repo, ['rev-list', '--all']).trim().split('\n');
  if (commits.length !== 3)
    throw new Error('Prepared source repo must contain only three commits.');
  const objects = git(repo, [
    'cat-file',
    '--batch-all-objects',
    '--batch-check=%(objectname) %(objecttype)',
  ])
    .trim()
    .split('\n');
  const reachable = new Set(
    git(repo, ['rev-list', '--objects', '--all'])
      .trim()
      .split('\n')
      .map((line) => line.split(' ')[0]),
  );
  if (
    objects.filter((line) => line.endsWith(' commit')).length !== 3 ||
    objects.some((line) => !reachable.has(line.split(' ')[0]))
  )
    throw new Error('Prepared source repo contains unrelated or dangling Git objects.');
  return {
    repo,
    base: reconstructed.base,
    a: reconstructed.a,
    b: reconstructed.b,
    task: scrubCaseIds(c.intent_a),
    provenance: {
      originalCommits: refs,
      originalTrees: trees,
      reconstructedCommits: reconstructed,
      commitMessagesSha256: Object.fromEntries(
        Object.entries(messages).map(([s, m]) => [s, hash(m)]),
      ),
      messageTransformation:
        'Preserve side commit message content; replace explicit rw-XXX IDs only. Generic base message.',
      taskSha256: hash(scrubCaseIds(c.intent_a)),
    },
  };
}
