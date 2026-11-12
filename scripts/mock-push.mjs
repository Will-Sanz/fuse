#!/usr/bin/env node
// Mocks a push for eval cases: for each case, acts as if side A was just
// pushed while side B is a teammate's branch, runs check.mjs the way the hook
// or the CI job would, and compares the answer with the case's label.
// Nothing is pushed anywhere.
//
// Usage:
//   node scripts/mock-push.mjs --repo <eval repo> (--case <id>... | --all)
//                      [--cases <cases.jsonl>] [--target <target.json>] [--no-llm]
//
//   --repo     a checkout of the eval repository (its cases are branch pairs)
//   --cases    default: <repo>/eval/cases.jsonl
//   --target   default: <repo>/eval/targets/realworld-express-prisma.json
//
//   --no-llm   merge-check only, no API call. A case merge-check does not flag
//              is then reported as "needs the LLM" rather than pass or fail.
//
// Exit code: 0 every checked case matched its label, 1 some did not, 2 a check
// failed to run.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    repo: { type: 'string' },
    cases: { type: 'string' },
    target: { type: 'string' },
    case: { type: 'string', multiple: true, default: [] },
    all: { type: 'boolean', default: false },
    'no-llm': { type: 'boolean', default: false },
  },
});

function fail(message) {
  console.error(`mock-push: ${message}`);
  process.exit(2);
}

if (!args.repo) fail('--repo <eval repo> is required');
if (args.all === args.case.length > 0) fail('give either --all or one or more --case <id>');
const repo = path.resolve(args.repo);
const casesFile = args.cases ?? path.join(repo, 'eval/cases.jsonl');
const target = args.target ?? path.join(repo, 'eval/targets/realworld-express-prisma.json');

const all = fs
  .readFileSync(casesFile, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const unknown = args.case.filter((id) => !all.some((c) => c.id === id));
if (unknown.length) fail(`no such case: ${unknown.join(', ')}`);
const cases = args.all ? all : all.filter((c) => args.case.includes(c.id));

let failed = 0,
  errors = 0,
  unchecked = 0,
  cost = 0;
for (const c of cases) {
  const checkArgs = [
    path.join(here, '../detect/check.mjs'),
    '--repo',
    repo,
    '--base',
    c.base,
    '--a',
    c.branch_a,
    '--b',
    c.branch_b,
    '--target',
    target,
  ];
  if (c.intent_a) checkArgs.push('--task', c.intent_a);
  if (args['no-llm']) checkArgs.push('--no-llm');
  const res = spawnSync(process.execPath, checkArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  const expected = c.label === 'conflict';
  let line;
  if (res.status !== 0 && res.status !== 1) {
    errors++;
    const tail = (res.stderr ?? '').trim().split('\n').slice(-3).join(' | ');
    line = `ERROR  ${c.id}  check failed to run: ${tail}`;
  } else {
    const answer = JSON.parse(res.stdout);
    cost += answer.cost_usd;
    const got = answer.conflict ? `conflict (${answer.stage})` : 'no conflict';
    const detail = `expected ${c.label}, got ${got}, ${answer.seconds}s`;
    if (args['no-llm'] && !answer.conflict) {
      unchecked++;
      line = `SKIP   ${c.id}  merge-check passed; needs the LLM (${c.label} expected)`;
    } else if (answer.conflict === expected) {
      line = `PASS   ${c.id}  ${detail}`;
    } else {
      failed++;
      line = `FAIL   ${c.id}  ${detail}`;
    }
  }
  console.log(line);
}

const passed = cases.length - failed - errors - unchecked;
console.log(
  `\n${passed} passed, ${failed} failed, ${errors} errors` +
    (unchecked ? `, ${unchecked} need the LLM` : '') +
    ` of ${cases.length}; cost $${cost.toFixed(2)}`,
);
process.exit(errors ? 2 : failed ? 1 : 0);
