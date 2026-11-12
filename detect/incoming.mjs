#!/usr/bin/env node
// Checks what teammates pushed against your current local code, and tells your
// coding agent when the two conflict.
//
// A run fetches the remote, finds branches with commits you do not have and
// that it has not checked before, snapshots your local code (uncommitted work
// included, without touching your files or index) and runs check.mjs on each
// pair. What it has seen and found is kept in <git dir>/fuse/incoming.json.
//
// Usage:
//   node incoming.mjs [--repo .] [--target <target.json>] [--no-llm]   check now
//   node incoming.mjs --hook [--interval 15]                           for an agent hook
//   node incoming.mjs on | off | status
//
//   --hook       prints conflicts found since the last report (the agent sees
//                them), then starts the next check in the background. Never
//                waits and always exits 0.
//   --interval   minutes between background checks started by the hook
//   --max        most new pushes checked in one run (default 5)
//   --remote     default origin
//   --target     default <repo>/.fuse/detect.json when it exists
//   --task       what your local work is meant to do
//   --no-fetch   use the remote branches as already fetched
//
// The first run checks nothing: it records the remote as it is and watches for
// pushes after that. Exit code when checking now: 0 no conflict, 1 conflict,
// 2 a check failed to run.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const self = fileURLToPath(import.meta.url);
const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    repo: { type: 'string', default: '.' },
    remote: { type: 'string', default: 'origin' },
    target: { type: 'string' },
    task: { type: 'string' },
    max: { type: 'string', default: '5' },
    interval: { type: 'string', default: '15' },
    'no-llm': { type: 'boolean', default: false },
    'no-fetch': { type: 'boolean', default: false },
    hook: { type: 'boolean', default: false },
    background: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});

function fail(message) {
  // A hook must never block the prompt, whatever went wrong.
  if (args.hook) process.exit(0);
  console.error(`incoming: ${message}`);
  process.exit(2);
}

const max = Number(args.max);
const intervalMs = Number(args.interval) * 60_000;
if (!(max > 0)) fail('--max must be a positive number');
if (!(intervalMs >= 0)) fail('--interval must be zero or more minutes');
const command = positionals[0];
if (command && !['on', 'off', 'status'].includes(command)) fail(`unknown command: ${command}`);

function git(gitArgs, env = process.env, cwd = repo) {
  const res = spawnSync('git', gitArgs, { cwd, env, encoding: 'utf8' });
  return { ok: res.status === 0, out: (res.stdout ?? '').trim(), err: (res.stderr ?? '').trim() };
}
function gitOk(gitArgs, env) {
  const res = git(gitArgs, env);
  if (!res.ok) fail(`git ${gitArgs.join(' ')} failed:\n${res.err}`);
  return res.out;
}

let repo = path.resolve(args.repo);
repo = gitOk(['rev-parse', '--show-toplevel']);
const stateFile = path.join(
  gitOk(['rev-parse', '--path-format=absolute', '--git-common-dir']),
  'fuse',
  'incoming.json',
);
const defaultTarget = path.join(repo, '.fuse', 'detect.json');
const target = args.target
  ? path.resolve(args.target)
  : fs.existsSync(defaultTarget)
    ? defaultTarget
    : undefined;

// ---------- state ----------

function readState() {
  try {
    return { enabled: true, results: [], ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
  } catch {
    return { enabled: true, results: [] };
  }
}
// Reads the file again each time: the hook and a background run can overlap.
function update(change) {
  const state = readState();
  change(state);
  state.results = state.results.slice(-50);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const temporary = `${stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temporary, stateFile);
  return state;
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}
const isRunning = (state) =>
  Boolean(state.running) && alive(state.running.pid) && Date.now() - state.running.at < 30 * 60_000;

// ---------- git ----------

/** Remote branches as { ref: { sha, date } }, without the remote's HEAD alias. */
function remoteBranches() {
  const prefix = `refs/remotes/${args.remote}/`;
  const branches = {};
  const lines = gitOk([
    'for-each-ref',
    '--format=%(refname) %(objectname) %(committerdate:unix)',
    prefix,
  ]);
  for (const line of lines.split('\n').filter(Boolean)) {
    const [name, sha, date] = line.split(' ');
    if (name === `${prefix}HEAD`) continue;
    branches[name.slice('refs/remotes/'.length)] = { sha, date: Number(date) };
  }
  return branches;
}
const shas = (branches) =>
  Object.fromEntries(Object.entries(branches).map(([ref, b]) => [ref, b.sha]));

function fetch() {
  if (args['no-fetch']) return;
  const res = git(['fetch', '--quiet', '--prune', args.remote]);
  if (!res.ok) fail(`git fetch ${args.remote} failed:\n${res.err}`);
}

/**
 * Your local code as a commit: HEAD when nothing is changed, otherwise a commit
 * of the working files (untracked ones included, ignored ones not) on top of
 * HEAD. Built with a scratch index, so the real index and files are untouched.
 */
function snapshot() {
  const head = gitOk(['rev-parse', 'HEAD']);
  const realIndex = gitOk(['rev-parse', '--path-format=absolute', '--git-path', 'index']);
  const index = path.join(os.tmpdir(), `fuse-incoming-index-${process.pid}`);
  if (fs.existsSync(realIndex)) fs.copyFileSync(realIndex, index);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    gitOk(['add', '-A'], env);
    const tree = gitOk(['write-tree'], env);
    if (tree === gitOk(['rev-parse', 'HEAD^{tree}'])) return { commit: head, dirty: false };
    const identity = ['-c', 'user.name=Fuse', '-c', 'user.email=fuse@localhost'];
    const message = 'Local work in progress';
    const commit = gitOk([...identity, 'commit-tree', tree, '-p', head, '-m', message], env);
    return { commit, dirty: true };
  } finally {
    fs.rmSync(index, { force: true });
  }
}

// ---------- one run ----------

function checkPair(mine, ref, sha) {
  const checkArgs = [
    path.join(path.dirname(self), 'check.mjs'),
    ...['--repo', repo, '--a', mine.commit, '--b', sha],
  ];
  if (target) checkArgs.push('--target', target);
  if (args.task) checkArgs.push('--task', args.task);
  if (args['no-llm']) checkArgs.push('--no-llm');
  const res = spawnSync(process.execPath, checkArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const [author, subject] = gitOk(['log', '-1', '--format=%an%n%s', sha]).split('\n');
  const result = { ref, sha, mine: mine.commit, at: new Date().toISOString(), author, subject };
  if (res.status !== 0 && res.status !== 1) {
    const tail = (res.stderr ?? '').trim().split('\n').slice(-3).join(' | ');
    return { ...result, error: tail || `check exited with ${res.status ?? res.signal}` };
  }
  const answer = JSON.parse(res.stdout);
  return {
    ...result,
    conflict: answer.conflict,
    stage: answer.stage,
    ...(answer.conflict ? { category: answer.category } : {}),
    explanation: answer.explanation,
    involved_symbols: answer.involved_symbols,
    tested: answer.tested,
    seconds: answer.seconds,
    cost_usd: answer.cost_usd,
  };
}

/** Fetches and checks new pushes. `reported` marks results as already shown. */
function runOnce(reported) {
  update((s) => {
    s.running = { pid: process.pid, at: Date.now() };
    s.lastRun = Date.now();
  });
  try {
    fetch();
    const branches = remoteBranches();
    const state = readState();
    if (!state.seen) {
      update((s) => (s.seen = shas(branches)));
      return { watching: Object.keys(branches).length, checked: [] };
    }
    const head = gitOk(['rev-parse', 'HEAD']);
    const fresh = [];
    const seen = {};
    for (const [ref, { sha, date }] of Object.entries(branches)) {
      if (state.seen[ref] === sha) seen[ref] = sha;
      // Commits you already have cannot conflict with your code.
      else if (git(['merge-base', '--is-ancestor', sha, head]).ok) seen[ref] = sha;
      else fresh.push({ ref, sha, date });
    }
    // Newest first; pushes over the limit stay unseen and wait for the next run.
    fresh.sort((x, y) => y.date - x.date);
    const now = fresh.slice(0, max);
    update((s) => (s.seen = seen));
    if (!now.length) return { checked: [], waiting: 0 };

    const mine = snapshot();
    const checked = [];
    for (const { ref, sha } of now) {
      const result = { ...checkPair(mine, ref, sha), reported };
      checked.push(result);
      update((s) => {
        s.seen[ref] = sha;
        s.results.push(result);
      });
    }
    return { checked, waiting: fresh.length - now.length };
  } finally {
    update((s) => delete s.running);
  }
}

// ---------- output ----------

function describe(result) {
  const where = `${result.ref} (${result.sha.slice(0, 7)}, last commit by ${result.author}: "${result.subject}")`;
  if (result.error) return `Fuse could not check ${where} against your local work: ${result.error}`;
  if (!result.conflict) return `${where} does not conflict with your local work.`;
  const lines = [
    `${where} conflicts with your local work.`,
    `Kind: ${result.category} (found by ${result.stage})`,
    result.explanation,
  ];
  if (result.involved_symbols?.length)
    lines.push(`Involved: ${result.involved_symbols.join(', ')}`);
  return lines.join('\n');
}

function status() {
  const state = readState();
  const last = state.lastRun ? new Date(state.lastRun).toISOString() : 'never';
  const lines = [
    `Incoming checks are ${state.enabled ? 'on' : 'off'} for ${repo}.`,
    `Last run: ${last}${isRunning(state) ? ' (a check is running now)' : ''}`,
    `Watching ${Object.keys(state.seen ?? {}).length} branches on ${args.remote}.`,
  ];
  const recent = state.results.slice(-5);
  if (recent.length) lines.push('', 'Latest results:', ...recent.map((r) => `- ${describe(r)}`));
  return { state, text: lines.join('\n') };
}

// ---------- main ----------

if (command === 'off') {
  update((s) => (s.enabled = false));
  console.log('Incoming checks are off for this repository.');
} else if (command === 'on') {
  // Watch from now: pushes made while it was off are not checked.
  fetch();
  const branches = remoteBranches();
  update((s) => {
    s.enabled = true;
    s.seen = shas(branches);
  });
  console.log(`Incoming checks are on. Watching ${Object.keys(branches).length} branches.`);
} else if (command === 'status') {
  const { state, text } = status();
  console.log(args.json ? JSON.stringify(state) : text);
} else if (args.hook) {
  const state = readState();
  if (!state.enabled) process.exit(0);
  const news = state.results.filter((r) => !r.reported && (r.conflict || r.error));
  if (news.length) {
    update((s) => s.results.forEach((r) => (r.reported = true)));
    const conflicts = news.filter((r) => r.conflict).length;
    console.log(
      [
        'Fuse checked what teammates pushed against the local code in this repository.',
        ...news.map(describe),
        ...(conflicts ? ['Tell the user about this before continuing with other work.'] : []),
      ].join('\n\n'),
    );
  }
  if (!isRunning(state) && Date.now() - (state.lastRun ?? 0) >= intervalMs) {
    const passed = ['--repo', repo, '--remote', args.remote, '--max', args.max];
    if (target) passed.push('--target', target);
    if (args.task) passed.push('--task', args.task);
    if (args['no-llm']) passed.push('--no-llm');
    if (args['no-fetch']) passed.push('--no-fetch');
    spawn(process.execPath, [self, '--background', ...passed], {
      cwd: repo,
      detached: true,
      stdio: 'ignore',
    }).unref();
  }
} else {
  if (!readState().enabled && !args.background) {
    if (args.json) console.log(JSON.stringify({ off: true, checked: [] }));
    else console.log('Incoming checks are off for this repository. Run `fuse incoming on` first.');
    process.exit(0);
  }
  // Shown directly when checking now; left for the hook when in the background.
  const run = runOnce(!args.background);
  if (args.json) console.log(JSON.stringify(run));
  else if (run.watching !== undefined)
    console.log(`Watching ${run.watching} branches on ${args.remote}. Nothing checked yet.`);
  else if (!run.checked.length) console.log('No new pushes to check.');
  else console.log(run.checked.map(describe).join('\n\n'));
  if (run.waiting) console.error(`incoming: ${run.waiting} more new pushes wait for the next run`);
  if (run.checked.some((r) => r.error)) process.exit(2);
  if (run.checked.some((r) => r.conflict)) process.exit(1);
}
