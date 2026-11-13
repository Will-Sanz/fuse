#!/usr/bin/env node
// First stage of the conflict check: what CI would catch, with no extra analysis.
//
// Merges B into A in its own git worktree, then runs the target's typecheck and
// tests on the result. The first failing step is the answer:
//   merge conflict -> textual, typecheck fails -> build, tests fail -> test,
//   all pass -> no conflict.
// A failing check proves a conflict, so flags have confidence 1. Passing checks
// prove nothing either way, so "no conflict" has confidence 0.5.
// Without --target only the merge is tried; nothing is built or tested.
//
// Prints the answer as JSON on stdout; progress goes to stderr.
//
// Usage:
//   node merge-check.mjs --repo <path> --base <ref> --a <branch> --b <branch>
//                        [--target <target.json>] [--workdir <dir>]

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { acquireDbLock, acquireLock } from './db-lock.mjs';

const { values: args } = parseArgs({
  options: {
    repo: { type: 'string' },
    base: { type: 'string' },
    a: { type: 'string' },
    b: { type: 'string' },
    task: { type: 'string' },
    target: { type: 'string' },
    workdir: { type: 'string' },
  },
});

function fail(message) {
  console.error(`merge-check: ${message}`);
  process.exit(2);
}

if (!args.repo || !args.base || !args.a || !args.b)
  fail('--repo, --base, --a and --b are required');

const repo = path.resolve(args.repo);
const target = args.target ? JSON.parse(fs.readFileSync(args.target, 'utf8')) : null;
// One workspace per repository: two clones with the same folder name must not
// share one, so the name carries a hash of the repository's real path.
const repoKey = `${path.basename(repo)}-${createHash('sha256')
  .update(fs.realpathSync(repo))
  .digest('hex')
  .slice(0, 12)}`;
// Real path, because git lists worktrees by it (on macOS /var -> /private/var).
const workdir = path.resolve(
  args.workdir ?? path.join(fs.realpathSync(os.tmpdir()), 'fuse-detect', 'merge-check', repoKey),
);
const env = { ...process.env, ...(target?.env ?? {}) };
const timings = {};

// ---------- shell helpers ----------

function run(cmd, cwd) {
  const res = spawnSync(cmd, {
    cwd,
    env,
    shell: '/bin/bash',
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: (target?.timeout_seconds ?? 900) * 1000,
  });
  killStragglers();
  return {
    exit: res.status ?? (res.signal ? 124 : 1),
    output: `${res.stdout ?? ''}${res.stderr ?? ''}`,
  };
}

// A timeout only kills the shell, not what it started, so kill anything left
// running from the worktree's own tools (it could hold the test database).
function killStragglers() {
  const found = spawnSync('pgrep', ['-f', `${workdir}/node_modules`], {
    encoding: 'utf8',
  });
  for (const pid of (found.stdout ?? '').split('\n').map(Number)) {
    if (!pid || pid === process.pid) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

function git(gitArgs, cwd = repo) {
  const res = run(`git ${gitArgs}`, cwd);
  return { ...res, out: res.output.trim() };
}

function gitOk(gitArgs, cwd = repo) {
  const res = git(gitArgs, cwd);
  if (res.exit !== 0) fail(`git ${gitArgs} failed in ${cwd}:\n${res.out}`);
  return res.out;
}

function timed(name, fn) {
  const started = Date.now();
  const result = fn();
  timings[name] = Math.round((Date.now() - started) / 100) / 10;
  return result;
}

// ---------- worktree and setup ----------

function ensureWorktree() {
  const known = gitOk('worktree list --porcelain')
    .split('\n')
    .some((line) => line === `worktree ${workdir}`);
  // The OS can clear part of a temp dir, leaving files but no .git link.
  if (known && fs.existsSync(path.join(workdir, '.git'))) return;
  if (known) gitOk('worktree prune');
  fs.rmSync(workdir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(workdir), { recursive: true });
  // Whatever setup produced (say node_modules) went with the old worktree, so
  // its steps must run again even if their inputs did not change.
  const hashPrefix = `${path.basename(workdir)}.setup-hash-`;
  for (const file of fs.readdirSync(path.dirname(workdir)))
    if (file.startsWith(hashPrefix))
      fs.rmSync(path.join(path.dirname(workdir), file), { force: true });
  gitOk(`worktree add --detach "${workdir}" HEAD`);
}

function checkout(ref) {
  git('merge --abort', workdir);
  gitOk('reset --hard -q', workdir);
  const keep = (target?.keep_between_checkouts ?? []).map((p) => `-e "${p}"`).join(' ');
  gitOk(`clean -fdq ${keep}`, workdir);
  gitOk(`checkout -q --detach ${ref}`, workdir);
}

// Same caching as verify.mjs: a step re-runs only when its input files change,
// and once one runs, every later step runs too.
function setupSteps() {
  if (!target.setup) return [];
  if (Array.isArray(target.setup)) return target.setup;
  return [{ run: target.setup, inputs: target.setup_inputs }];
}

// What a setup step's result depends on: its command, the target's
// environment and its input files. Changing any of them reruns the step.
function stepDigest(step) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ run: step.run, env: target.env ?? {} }));
  for (const file of step.inputs) {
    const p = path.join(workdir, file);
    hash.update(file);
    hash.update(fs.existsSync(p) ? fs.readFileSync(p) : '<missing>');
  }
  return hash.digest('hex');
}

function setup() {
  const steps = setupSteps();
  let rerunRest = false;
  for (const [index, step] of steps.entries()) {
    const hashFile = `${workdir}.setup-hash-${index}`;
    const digest = step.inputs ? stepDigest(step) : null;
    const previous = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, 'utf8') : null;
    if (!rerunRest && digest !== null && previous === digest) continue;
    rerunRest = true;
    console.error(`merge-check: setup: ${step.run}`);
    const res = run(step.run, workdir);
    if (res.exit !== 0) {
      for (let i = index; i < steps.length; i++)
        fs.rmSync(`${workdir}.setup-hash-${i}`, { force: true });
      fail(`setup step failed: ${step.run}\n${res.output.slice(-4000)}`);
    }
    if (digest !== null) fs.writeFileSync(hashFile, digest);
  }
}

// ---------- checks ----------

// Returns the failing tests, and how many tests ran (null if unknown).
function readReport(reportPath) {
  if (target.test_report !== 'jest-json') return { failed: [], ran: null };
  if (!fs.existsSync(reportPath)) return { failed: [], ran: 0 };
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const failed = [];
  for (const file of report.testResults ?? []) {
    const rel = path.relative(workdir, file.name);
    const assertions = (file.assertionResults ?? []).filter((t) => t.status === 'failed');
    if (assertions.length === 0 && file.status === 'failed') failed.push(rel);
    for (const t of assertions) failed.push(`${rel} > ${t.fullName}`);
  }
  const ran = (report.numPassedTests ?? 0) + (report.numFailedTests ?? 0);
  return { failed, ran };
}

function answer(fields) {
  console.log(JSON.stringify({ involved_symbols: [], ...fields, timings }, null, 2));
  process.exit(0);
}

// ---------- main ----------

// Held until this process exits: another check of the same repository (say a
// hook's background run) would reset and re-merge the workspace under this one.
fs.mkdirSync(path.dirname(workdir), { recursive: true });
acquireLock(`${workdir}.lock`, 'merge-check', "this repository's check workspace");
ensureWorktree();
checkout(args.a);

const merge = timed('merge', () =>
  git(
    `-c user.name=detect -c user.email=detect@localhost merge --no-ff --no-commit ${args.b}`,
    workdir,
  ),
);
const conflicted = git('diff --name-only --diff-filter=U', workdir).out;
if (merge.exit !== 0 && conflicted) {
  answer({
    conflict: true,
    confidence: 1,
    category: 'textual',
    explanation: `git merge conflict in ${conflicted.split('\n').join(', ')}`,
  });
}
if (merge.exit !== 0) fail(`merge of ${args.b} into ${args.a} failed:\n${merge.out}`);

if (!target)
  answer({
    conflict: false,
    confidence: 0.3,
    category: null,
    tested: false,
    explanation: 'merges cleanly; not built or tested (no target config)',
  });

// TypeScript errors without their positions, which move when code is merged.
function typeErrors(output) {
  return output
    .split('\n')
    .filter((l) => /error TS\d+/.test(l))
    .map((l) => l.replace(/\(\d+,\d+\)/, '').trim());
}

/**
 * Sets up, typechecks and tests whatever is checked out in the workspace.
 * Returns the step that failed (null if none) and what failed in it: type
 * errors, or failing tests when the target has a test report.
 */
function runChecks(where) {
  setup();
  const tc = run(target.typecheck, workdir);
  // Like a test timeout: an unfinished typecheck says nothing about the code.
  if (tc.exit === 124) fail(`typecheck timed out ${where}:\n${tc.output.slice(-1000)}`);
  if (tc.exit !== 0)
    return { step: 'typecheck', failures: typeErrors(tc.output), output: tc.output };

  const reportPath = path.join(os.tmpdir(), `conflict-detect-report-${process.pid}.json`);
  fs.rmSync(reportPath, { force: true });
  // Only the tests use the database, and only one run may use it at a time.
  const releaseDb = acquireDbLock('merge-check');
  const tests = run(target.test.replaceAll('{report}', reportPath), workdir);
  releaseDb();
  const { failed, ran } = readReport(reportPath);
  fs.rmSync(reportPath, { force: true });
  // A timeout, or a run where no test got to run and none is named as failing
  // (say the database is down), says nothing about the code: an error, not a
  // result. Suites that fail to load are named, so they are compared below.
  if (tests.exit === 124) fail(`tests timed out ${where}:\n${tests.output.slice(-1000)}`);
  if (tests.exit !== 0 && ran === 0 && failed.length === 0)
    fail(`tests did not run ${where}:\n${tests.output.slice(-1000)}`);
  if (tests.exit !== 0) return { step: 'test', failures: failed, output: tests.output };
  return { step: null, failures: [] };
}

const merged = timed('checks', () => runChecks('after merge'));
if (!merged.step)
  answer({
    conflict: false,
    confidence: 0.5,
    category: null,
    tested: true,
    explanation: 'merges cleanly; typecheck and tests pass',
  });

// Something fails after the merge. That is a conflict only if it does not
// already fail on a side alone: unfinished local work often has failing tests,
// whatever the other side pushed.
const alone = {};
for (const side of ['a', 'b']) {
  checkout(args[side]);
  alone[side] = timed(`alone_${side}`, () => runChecks(`on side ${side.toUpperCase()} alone`));
}
const failing = ['a', 'b'].filter((side) => alone[side].step);
const sameStep = failing.filter((side) => alone[side].step === merged.step);
// Counted, not just listed: a second copy of an error a side already has (same
// code and message elsewhere in the file) is a new failure.
const known = new Map();
for (const side of sameStep) {
  const counts = new Map();
  for (const f of alone[side].failures) counts.set(f, (counts.get(f) ?? 0) + 1);
  for (const [f, n] of counts) known.set(f, Math.max(known.get(f) ?? 0, n));
}
// Without names to compare (no test report, or a checker that is not tsc), a
// side failing the same step alone is taken to explain the merged failure.
const named = merged.failures.length > 0;
const fresh = [];
if (named)
  for (const f of merged.failures) {
    const left = known.get(f) ?? 0;
    if (left > 0) known.set(f, left - 1);
    else fresh.push(f);
  }
const isConflict = named ? fresh.length > 0 : sameStep.length === 0;
const sides = failing.map((side) => `side ${side.toUpperCase()}`).join(' and ');
const what = merged.step === 'typecheck' ? 'typecheck fails' : 'tests fail';

if (isConflict)
  answer({
    conflict: true,
    confidence: 1,
    category: merged.step === 'typecheck' ? 'build' : 'test',
    tested: true,
    explanation: `${what} after merge${failing.length ? `, beyond what already fails on ${sides} alone` : ''}:\n${
      named ? fresh.slice(0, 5).join('\n') : merged.output.slice(-1000)
    }`,
  });

answer({
  conflict: false,
  confidence: 0.3,
  category: null,
  tested: false,
  inherited: failing.map((side) => ({ side, step: alone[side].step })),
  explanation: `${what} after merge, but the same already fails on ${sides} alone, so it is not caused by combining them; the merged code could not be fully checked`,
});
