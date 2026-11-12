// Second stage of the conflict check: Claude reads the two diffs, a ts-morph
// graph linking them, both commit messages and the agent's task.
//
// It only sees pairs that merge cleanly, and normally ones that also typecheck
// and pass the repo's tests, so it only answers runtime or intent. With
// --untested the prompt says the pair was not built or tested.
//
// Usage:
//   node llm.mjs --repo <path> --base <ref> --a <branch> --b <branch>
//                [--task <text>] [--untested]

import Anthropic from '@anthropic-ai/sdk';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildGraph, fileRanks } from './graph.mjs';

export const MODEL = 'claude-sonnet-5-5';
// Claude Sonnet 5.5 first-party prices, USD per million tokens.
const PRICE = { input: 2, output: 10 };
const CONTEXT_LINES = 10;
// Every input is capped, in characters.
const MAX_DIFF_CHARS = 150_000;
const MAX_GRAPH_CHARS = 30_000;
const MAX_TEXT_CHARS = 4_000; // the task and each commit message
const MAX_TOKENS = 4_000;
// A request that takes longer is retried, so one hung call does not stall a case.
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;

export const SYSTEM_PROMPT = `You review two sets of changes made at the same time to the same codebase:
- Change A: a coding agent's work in progress.
- Change B: a teammate's change, just pushed to main.

Together they merge cleanly, typecheck, and pass the repo's existing tests.
Your job is to decide whether they still conflict once combined.

They conflict if either:
- runtime: the merged code behaves wrongly in a way neither change does alone,
  e.g. one change breaks an assumption the other relies on.
- intent: both changes solve the same problem in different ways, so the
  merged code duplicates or contradicts itself. This is a conflict even when
  running the work twice is harmless: one of the two should be removed.

They do not conflict if they touch related code but stay correct together.
Most concurrent changes are fine. Only flag a conflict if you can describe a
concrete scenario where the merged code goes wrong or does the work twice.

The agent's task and the commit messages, when given, say what each side
meant to do. Use them as hints about where to look, but they can be
incomplete or wrong: a change may do more than its message says, or
something different. Decide from the code. When a message and the code
disagree, trust the code.

confidence is how sure you are of your answer (0 to 1).`;

const TESTED_LINE = "Together they merge cleanly, typecheck, and pass the repo's existing tests.";
// For a pair that was only merged: the model must not assume a passing build.
export const UNTESTED_PROMPT = SYSTEM_PROMPT.replace(
  TESTED_LINE,
  'Together they merge cleanly. They have not been typechecked or tested together.',
);

// explanation comes first so the model reasons before it decides.
const SCHEMA = {
  type: 'object',
  properties: {
    explanation: { type: 'string' },
    conflict: { type: 'boolean' },
    category: { type: 'string', enum: ['runtime', 'intent', 'none'] },
    confidence: { type: 'number' },
    involved_symbols: { type: 'array', items: { type: 'string' } },
  },
  required: ['explanation', 'conflict', 'category', 'confidence', 'involved_symbols'],
  additionalProperties: false,
};

function fail(message) {
  console.error(`llm: ${message}`);
  process.exit(2);
}

function git(repo, args) {
  const res = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) fail(`git ${args.join(' ')} failed:\n${res.stderr}`);
  return res.stdout;
}

// Cut at the last full line under the cap, and say so, so the model knows it
// is not seeing everything.
function capped(text, max) {
  if (text.length <= max) return { text, truncated: false };
  const cut = text.slice(0, max);
  const kept = cut.slice(0, cut.lastIndexOf('\n') + 1) || cut;
  return {
    text: `${kept}[truncated: ${text.length - kept.length} more characters not shown]\n`,
    truncated: true,
  };
}

// Files that rarely matter for a conflict (lockfiles, docs, seed data,
// fixtures, snapshots, build output) go last, so the cap cuts them first. They
// are named up front, so the model knows they changed even if they are cut.
const LATE_FILES = [
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/,
  /\.(md|snap)$/i,
  /\.min\.js$/,
  /(^|\/)(docs|fixtures?|__fixtures__|__snapshots__|dist|build)\//,
  /(^|\/)seeds?(\.[^/]+)?$/,
  /(^|\/)seeds?\//,
];

// When a side's code does not fit under the cap, its files are ordered by how
// related they are to the other side (graph.mjs fileRanks), so the cap cuts
// the least related ones. Diffs that fit keep git's path order.
function diff(repo, base, branch, ranks) {
  const range = `${base}...${branch}`;
  const args = ['diff', `-U${CONTEXT_LINES}`, range, '--'];
  const show = (files) =>
    files.length ? git(repo, [...args, ...files.map((file) => `:(literal)${file}`)]) : '';
  const files = git(repo, ['diff', '--name-only', range, '--']).split('\n').filter(Boolean);
  const isLate = (file) => LATE_FILES.some((re) => re.test(file));
  const late = files.filter(isLate);
  const code = files.filter((file) => !isLate(file));

  const notes = [];
  let body = late.length ? show(code) : git(repo, args);
  if (body.length > MAX_DIFF_CHARS) {
    let rank;
    try {
      rank = ranks();
    } catch {
      // No ranking (say the merge has conflicts): keep path order.
    }
    if (rank) {
      body = [0, 1, 2]
        .map((r) => show(code.filter((file) => (rank.get(file) ?? 2) === r)))
        .join('');
      notes.push(
        '[files ordered by how related they are to the other side: files it also changed, then files that import or are imported by its changed files, then the rest]',
      );
    }
  }
  if (late.length) {
    const parts = late.map((file) => show([file]));
    notes.push(
      `[moved to the end as lower priority: ${late
        .map((file, i) => `${file} (${parts[i].length} characters)`)
        .join(', ')}]`,
    );
    body += parts.join('');
  }
  return capped(notes.map((note) => `${note}\n`).join('') + body, MAX_DIFF_CHARS);
}

function commitMessages(repo, base, branch) {
  return capped(
    git(repo, ['log', '--reverse', '--format=%B', `${base}..${branch}`])
      .trim()
      .replace(/\n{3,}/g, '\n\n') + '\n',
    MAX_TEXT_CHARS,
  );
}

function loadApiKey() {
  // The Fuse installation's own .env, never the target repository's.
  const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');
  if (!process.env.ANTHROPIC_API_KEY && fs.existsSync(envFile)) process.loadEnvFile(envFile);
  if (!process.env.ANTHROPIC_API_KEY)
    fail("ANTHROPIC_API_KEY is not set and Fuse's .env does not provide it");
}

// Builds the user message for the requested inputs. Returns which inputs were
// cut and how long the graph took.
export function buildPrompt({ repo, base, a, b, task }, include) {
  let ranks;
  const ranksOf = (side) => () => (ranks ??= fileRanks({ repo, base, a, b }))[side];
  const inputs = [
    ['diff_a', diff(repo, base, a, ranksOf('a'))],
    ['diff_b', diff(repo, base, b, ranksOf('b'))],
  ];
  let graphSeconds;
  if (include.graph) {
    const started = Date.now();
    let graph;
    try {
      graph = buildGraph({ repo, base, a, b, depth: include.depth });
    } catch (err) {
      fail(`graph failed: ${err.message}`);
    }
    graphSeconds = Math.round((Date.now() - started) / 100) / 10;
    inputs.push(['related_code', capped(graph, MAX_GRAPH_CHARS)]);
  }
  if (include.intent) {
    if (!task) fail('this variant needs --task');
    inputs.push(
      ['agent_task', capped(`${task.trim()}\n`, MAX_TEXT_CHARS)],
      ['commit_message_a', commitMessages(repo, base, a)],
      ['commit_message_b', commitMessages(repo, base, b)],
    );
  }
  return {
    text: inputs.map(([tag, { text }]) => `<${tag}>\n${text}</${tag}>`).join('\n\n'),
    truncated: inputs.filter(([, v]) => v.truncated).map(([tag]) => tag),
    graphSeconds,
  };
}

export async function run(include) {
  const { values: args } = parseArgs({
    options: {
      repo: { type: 'string' },
      base: { type: 'string' },
      a: { type: 'string' },
      b: { type: 'string' },
      task: { type: 'string' },
      target: { type: 'string' },
      untested: { type: 'boolean', default: false },
    },
  });
  if (!args.repo || !args.base || !args.a || !args.b)
    fail('--repo, --base, --a and --b are required');
  args.repo = path.resolve(args.repo);
  loadApiKey();

  const prompt = buildPrompt(args, include);
  const client = new Anthropic({
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  });
  const started = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // Lowest thinking setting on Claude Sonnet 5.5 (no extended thinking).
    thinking: { type: 'between_tools' },
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    system: args.untested ? UNTESTED_PROMPT : SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt.text }],
  });
  const seconds = Math.round((Date.now() - started) / 100) / 10;

  if (response.stop_reason === 'refusal')
    fail(`model refused: ${JSON.stringify(response.stop_details)}`);
  if (response.stop_reason === 'max_tokens')
    fail(`hit max_tokens (${MAX_TOKENS}) before finishing`);
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  let answer;
  try {
    answer = JSON.parse(text);
  } catch {
    fail(`response is not JSON:\n${text}`);
  }

  const { input_tokens, output_tokens } = response.usage;
  console.log(
    JSON.stringify(
      {
        conflict: answer.conflict,
        confidence: answer.confidence,
        category: answer.category === 'none' ? null : answer.category,
        involved_symbols: answer.involved_symbols,
        explanation: answer.explanation,
        cost_usd: (input_tokens * PRICE.input + output_tokens * PRICE.output) / 1e6,
        timings:
          prompt.graphSeconds === undefined
            ? { llm: seconds }
            : { graph: prompt.graphSeconds, llm: seconds },
        usage: { input_tokens, output_tokens },
        model: response.model,
        truncated: prompt.truncated,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await run({ graph: true, intent: true });
