#!/usr/bin/env node
// The conflict check, as a hook or a CI job would run it on one pair of
// branches: merge-check first (merge, typecheck, tests), then the LLM stage
// if that passes. The first stage that finds a conflict is the answer.
//
// Prints the answer as JSON on stdout; progress goes to stderr. Exit code:
//   0 no conflict, 1 conflict, 2 the check itself failed.
//
// Usage:
//   node check.mjs --a <ref> --b <ref> [--repo .] [--base <ref>] [--task <text>]
//                  [--target <target.json>] [--skip-merge-check] [--no-llm]
//                  [--summary <file.md>]
//
//   --base               default: the merge base of a and b
//   --target             the repo's setup, typecheck and test commands; without
//                        it the pair is only merged, and the LLM is told so
//   --skip-merge-check   when CI already merged, built and tested the pair
//   --no-llm             merge-check only; makes no API call
//   --summary <file>     also write the answer as Markdown, for a PR comment

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    repo: { type: 'string', default: '.' },
    base: { type: 'string' },
    a: { type: 'string' },
    b: { type: 'string' },
    task: { type: 'string' },
    target: { type: 'string' },
    'skip-merge-check': { type: 'boolean', default: false },
    'no-llm': { type: 'boolean', default: false },
    summary: { type: 'string' },
  },
});

function fail(message) {
  console.error(`check: ${message}`);
  process.exit(2);
}

if (!args.a || !args.b) fail('--a and --b are required');
if (args['skip-merge-check'] && args['no-llm'])
  fail('--skip-merge-check and --no-llm together leave nothing to run');
const repo = path.resolve(args.repo);
const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = { 'merge-check': 'merge-check.mjs', llm: 'llm.mjs' };
// Nothing built or tested the merged pair: no target, and no CI did it either.
const untested = !args.target && !args['skip-merge-check'];

// The stages work in a separate worktree, where a name like HEAD means that
// worktree's own commit, so each side is pinned to its commit here.
function commitOf(ref) {
  const res = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (res.status !== 0) fail(`not a commit in ${repo}: ${ref}`);
  return res.stdout.trim();
}
const sideA = commitOf(args.a);
const sideB = commitOf(args.b);

function mergeBase() {
  const res = spawnSync('git', ['merge-base', sideA, sideB], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (res.status !== 0) fail(`no merge base for ${args.a} and ${args.b}:\n${res.stderr}`);
  return res.stdout.trim();
}
const base = args.base ? commitOf(args.base) : mergeBase();

function runStage(name) {
  const detectArgs = [
    path.join(here, SCRIPTS[name]),
    '--repo',
    repo,
    '--base',
    base,
    '--a',
    sideA,
    '--b',
    sideB,
  ];
  if (args.task) detectArgs.push('--task', args.task);
  if (args.target) detectArgs.push('--target', args.target);
  if (name === 'llm' && untested) detectArgs.push('--untested');
  console.error(`check: running ${name}`);
  const started = Date.now();
  const res = spawnSync(process.execPath, detectArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  if (res.status !== 0) fail(`${name} exited with ${res.status ?? res.signal}`);
  try {
    return { name, seconds, ...JSON.parse(res.stdout) };
  } catch {
    fail(`${name} did not print valid JSON`);
  }
}

const stages = [];
if (!args['skip-merge-check']) stages.push('merge-check');
if (!args['no-llm']) stages.push('llm');

const ran = [];
for (const name of stages) {
  ran.push(runStage(name));
  if (ran.at(-1).conflict) break;
}
const last = ran.at(-1);
const answer = {
  conflict: last.conflict,
  stage: last.name,
  ...(last.conflict ? { category: last.category } : {}),
  involved_symbols: last.involved_symbols,
  explanation: last.explanation,
  a: args.a,
  b: args.b,
  base,
  stages_run: ran.map((s) => s.name),
  tested: !untested,
  seconds: Math.round(ran.reduce((t, s) => t + s.seconds, 0) * 10) / 10,
  cost_usd: ran.reduce((t, s) => t + (s.cost_usd ?? 0), 0),
};

if (args.summary) {
  const lines = answer.conflict
    ? [
        `### Conflict found between \`${args.a}\` and \`${args.b}\``,
        '',
        `**Kind:** ${answer.category} (found by ${answer.stage})`,
        '',
        answer.explanation,
        ...(answer.involved_symbols.length
          ? ['', `**Involved:** ${answer.involved_symbols.map((s) => `\`${s}\``).join(', ')}`]
          : []),
      ]
    : [
        `### No conflict found between \`${args.a}\` and \`${args.b}\``,
        '',
        `Checked with ${answer.stages_run.join(', then ')}.`,
      ];
  if (untested) lines.push('', 'The merged code was not built or tested.');
  fs.writeFileSync(args.summary, `${lines.join('\n')}\n`);
}

console.log(JSON.stringify(answer));
process.exit(answer.conflict ? 1 : 0);
