import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

const installation = fileURLToPath(new URL('../', import.meta.url));
const cli = join(installation, 'cli/run.mjs');
const { values } = parseArgs({
  options: {
    repo: { type: 'string' },
    sessions: { type: 'boolean' },
  },
});
const command = (...args) => {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
    encoding: 'utf8',
    timeout: 45000,
  });
  assert.ok(
    result.status === 0 || result.status === 2,
    `Fuse command failed: ${result.stderr || result.error?.message || result.status}`,
  );
  return JSON.parse(result.stdout).data;
};
const fixture = values.repo
  ? undefined
  : command('demo', '--dir', join(installation, 'data/demos', randomUUID()));
const repo = values.repo ? resolve(values.repo) : fixture.repo;
const sessions = !!fixture || !!values.sessions;
const output = join(installation, 'data/codex', randomUUID());
mkdirSync(output, { recursive: true });
const started = Date.now();
const recording = { recordedAt: new Date(started).toISOString(), events: [] };
const raw = [];
const results = [];
function record(text) {
  recording.events.push({ atMs: Date.now() - started, text });
  console.log(text);
}
record('Codex → Fuse MCP');
record(
  `Inspect ${sessions ? 'two registered worktrees' : 'working changes'} and read the saved review.`,
);
const args = [
  'exec',
  '--ignore-user-config',
  '--ephemeral',
  '--sandbox',
  'read-only',
  '--json',
  '-C',
  repo,
  '-c',
  `mcp_servers.fuse.command=${JSON.stringify(process.execPath)}`,
  '-c',
  `mcp_servers.fuse.args=${JSON.stringify([cli, 'mcp', '--repo', repo])}`,
  '-c',
  'mcp_servers.fuse.required=true',
  '-c',
  'mcp_servers.fuse.enabled_tools=["fuse_inspect","fuse_review"]',
  '-c',
  'mcp_servers.fuse.tools.fuse_inspect.approval_mode="approve"',
  '-c',
  'mcp_servers.fuse.tools.fuse_review.approval_mode="approve"',
  `Call fuse_inspect with ${sessions ? 'sessions=true' : 'no arguments'}, then call fuse_review for the returned ID. Use only these two tools. Report the changed filename, overlapping function if any, and the intent question. Do not edit or apply source. Do not include absolute paths in your answer.`,
];
const codex = spawn(process.env.FUSE_CODEX_BIN || 'codex', args, {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
codex.stderr.on('data', (chunk) => {
  stderr = (stderr + chunk).slice(-8000);
});
const lines = createInterface({ input: codex.stdout });
let parseError;
lines.on('line', (line) => {
  raw.push(line);
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    parseError = new Error('Codex returned invalid JSON. Update the Codex CLI and retry.');
    codex.kill('SIGTERM');
    return;
  }
  const item = event.item;
  if (item?.type !== 'mcp_tool_call' || item.server !== 'fuse') return;
  record(
    `${event.type === 'item.started' ? 'CALL' : item.status === 'completed' ? 'PASS' : 'FAIL'} ${item.tool} ${JSON.stringify(item.arguments)}`,
  );
  if (event.type === 'item.completed') results.push(item);
});
const timeout = setTimeout(() => codex.kill('SIGTERM'), 180000);
try {
  const code = await new Promise((accept, reject) => {
    codex.on('error', reject);
    codex.on('close', accept);
  });
  writeFileSync(join(output, 'codex.jsonl'), raw.join('\n') + '\n');
  if (parseError) throw parseError;
  assert.equal(code, 0, `Codex did not complete. Sign in with codex login and retry. ${stderr}`);
  const readResult = (tool) => {
    const item = results.find((r) => r.tool === tool);
    assert.ok(
      item && item.status === 'completed' && !item.error && !item.result?.isError,
      `${tool} did not complete successfully`,
    );
    return JSON.parse(item.result.content.find((c) => c.type === 'text').text).data;
  };
  const inspected = readResult('fuse_inspect');
  const reviewed = readResult('fuse_review');
  assert.equal(inspected.id, reviewed.id, 'Codex must read the review it created');
  const saved = command('review', inspected.id, '--repo', repo);
  assert.deepEqual(
    saved.sources,
    reviewed.sources,
    'MCP evidence must match the persisted Git review',
  );
  assert.equal(saved.status, 'proposed');
  record(`Saved review: ${saved.id}`);
  for (const file of saved.files) {
    record(`File: ${file.path}`);
    for (const conflict of file.analysis.conflicts)
      record(`Review: ${conflict.functions.join(', ')} (${conflict.kind})`);
    for (const recommendation of file.recommendations)
      if (recommendation.question) record(recommendation.question);
  }
  record('PASS · Both MCP calls match the saved Git evidence. No source application.');
  recording.durationMs = Date.now() - started;
  recording.reviewId = saved.id;
  writeFileSync(join(output, 'session.json'), JSON.stringify(recording, null, 2) + '\n');
  console.log(`\nRecording: ${join(output, 'session.json')}`);
  if (fixture) console.log(`Open with npm start: http://127.0.0.1:3001/?review=${saved.id}`);
  else console.log(`Open the saved review with the Fuse review server for this repository.`);
  const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
  console.log(
    `${quote(process.execPath)} ${quote(cli)} review ${saved.id} --repo ${quote(repo)} --serve --open --port 3002`,
  );
} catch (error) {
  console.error(
    error.code === 'ENOENT'
      ? 'Codex was not found. Install the Codex CLI or set FUSE_CODEX_BIN to its executable path.'
      : error.message,
  );
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  lines.close();
}
