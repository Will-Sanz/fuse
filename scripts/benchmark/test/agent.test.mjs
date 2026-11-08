import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSource } from '../source-mcp.mjs';
import {
  summarizeEvents,
  validateAssessment,
  sourceState,
  CONTROL_CONFIG,
  buildAgentArgs,
  RESULT_SCHEMA,
} from '../agent.mjs';

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'fuse-source-test-'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'fixture');
  git('config', 'user.email', 'fixture@localhost');
  writeFileSync(join(repo, 'source.ts'), 'export const answer = 1;\n');
  writeFileSync(join(repo, '.env.test'), 'PUBLIC_BENCHMARK_VALUE=1\n');
  writeFileSync(join(repo, '.env'), 'PRIVATE_CANARY=DO_NOT_READ\n');
  symlinkSync('/etc/passwd', join(repo, 'symlink.ts'));
  git('add', '.');
  git('commit', '-qm', 'Base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'source.ts'), 'export const answer = 2;\n');
  writeFileSync(join(repo, '.env'), 'PRIVATE_CANARY=CHANGED_DO_NOT_READ\n');
  git('add', '.');
  git('commit', '-qm', 'Change');
  const a = git('rev-parse', 'HEAD');
  return { repo, refs: { base, a, b: base } };
}

test('source MCP permits only pinned committed regular source and public test config', async () => {
  const { repo, refs } = fixture();
  const server = createSource(repo, refs),
    client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const call = (name, args) => client.callTool({ name, arguments: args });
  try {
    const read = await call('source_read', { ref: 'base', path: '.env.test' });
    assert.match(read.content[0].text, /PUBLIC_BENCHMARK_VALUE/);
    for (const path of [
      '.env',
      '.git/config',
      '../outside',
      '/etc/passwd',
      'eval/cases.jsonl',
      'symlink.ts',
    ]) {
      assert.equal((await call('source_read', { ref: 'base', path })).isError, true, path);
    }
    assert.equal((await call('source_read', { ref: 'HEAD', path: 'source.ts' })).isError, true);
    const diff = await call('source_diff', { side: 'a' });
    assert.match(diff.content[0].text, /answer = 2/);
    assert.doesNotMatch(diff.content[0].text, /PRIVATE_CANARY/);
  } finally {
    await client.close();
    await server.close();
    rmSync(repo, { recursive: true, force: true });
  }
});

test('missing token usage stays unknown; unexpected tools are protocol evidence', () => {
  assert.equal(summarizeEvents([], 'agent').tokens, null);
  assert.equal(summarizeEvents([{ type: 'turn.failed', error: {} }], 'agent').tokens, null);
  for (const type of [
    'command_execution',
    'file_change',
    'web_search',
    'collabAgentToolCall',
    'dynamicToolCall',
    'imageView',
    'sleep',
  ]) {
    assert.deepEqual(
      summarizeEvents([{ type: 'item.completed', item: { type } }], 'agent').forbiddenTools,
      [type],
    );
  }
  const tokens = summarizeEvents(
    [{ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 2 } }],
    'agent',
  ).tokens;
  assert.equal(tokens.input_tokens, 5);
  assert.equal(tokens.output_tokens, 2);
});

test('MCP assistance requires matching requested commits and returned review provenance', () => {
  const { repo, refs } = fixture(),
    expected = { repo, ...refs };
  const event = (args, data, isError = false) => ({
    type: 'item.completed',
    item: {
      id: 'call',
      type: 'mcp_tool_call',
      server: 'fuse',
      tool: 'fuse_inspect',
      arguments: args,
      result: { isError, content: [{ type: 'text', text: JSON.stringify({ data }) }] },
    },
  });
  const data = {
    repository: repo,
    baseCommit: refs.base,
    sources: { a: { head: refs.a }, b: { head: refs.b } },
    unsupported: ['non-TypeScript fixture'],
  };
  try {
    let summary = summarizeEvents([event(expected, data)], 'fuse', expected);
    assert.equal(summary.mcp.matchedInspectAttempts, 1);
    assert.equal(summary.mcp.matchedInspectSuccesses, 1);
    assert.equal(summary.mcp.status, 'partial');
    summary = summarizeEvents([event({ ...expected, b: refs.a }, data)], 'fuse', expected);
    assert.equal(summary.mcp.matchedInspectAttempts, 0);
    summary = summarizeEvents([event(expected, { ...data, baseCommit: refs.a })], 'fuse', expected);
    assert.equal(summary.mcp.matchedInspectSuccesses, 0);
    assert.deepEqual(summary.mcp.sourceMismatches, ['call']);
    summary = summarizeEvents([event(expected, null, true)], 'fuse', expected);
    assert.equal(summary.mcp.matchedInspectAttempts, 1);
    assert.equal(summary.mcp.matchedInspectSuccesses, 0);
    assert.equal(summary.mcp.status, 'error');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('source fingerprint catches tracked/index/ref changes, not Fuse metadata', () => {
  const { repo } = fixture();
  try {
    const before = sourceState(repo);
    writeFileSync(join(repo, 'source.ts'), 'changed');
    assert.notEqual(sourceState(repo), before);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('final assessment distinguishes unknown from clean and freezes source-only controls', () => {
  const clean = {
    assessment: 'no-conflict',
    confidence: 0.7,
    category: 'none',
    explanation: 'Independent changes.',
    involved_symbols: [],
  };
  assert.equal(validateAssessment(clean), clean);
  assert.throws(() => validateAssessment({ ...clean, assessment: 'conflict' }));
  assert.equal(
    validateAssessment({ ...clean, assessment: 'insufficient-evidence' }).assessment,
    'insufficient-evidence',
  );
  assert.equal(CONTROL_CONFIG['features.shell_tool'], false);
  assert.equal(CONTROL_CONFIG['skills.include_instructions'], false);
  assert.equal(CONTROL_CONFIG.project_doc_max_bytes, 0);
  const args = buildAgentArgs({
    workdir: '/tmp',
    schemaPath: '/tmp/schema',
    finalPath: '/tmp/final',
    repo: '/tmp/repo',
    base: 'a'.repeat(40),
    a: 'b'.repeat(40),
    b: 'c'.repeat(40),
    task: 'Public task',
    arm: 'agent',
    model: 'gpt-6-astra',
    effort: 'high',
    fuseRoot: process.cwd(),
  });
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ephemeral'));
  assert.doesNotMatch(
    args.find((x) => x.startsWith('mcp_servers=')),
    /"fuse"=/,
  );
});

test(
  'installed-client unscored canary proves effective deferred registry and no skill/evaluator context',
  { skip: !process.env.FUSE_CODEX_CANARY },
  async () => {
    const { repo, refs } = fixture();
    const root = process.cwd(),
      workdir = mkdtempSync(join(tmpdir(), 'fuse-registry-canary-'));
    const captures = [];
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      const request = JSON.parse(body);
      captures.push(request);
      writeFileSync(
        join(workdir, `request-${captures.length}.json`),
        JSON.stringify(request, null, 2),
      );
      const item =
        captures.length % 2 === 1
          ? {
              type: 'custom_tool_call',
              id: `ct_${captures.length}`,
              call_id: `call_${captures.length}`,
              name: 'exec',
              namespace: 'functions',
              input: 'text(ALL_TOOLS.map(x=>x.name));',
            }
          : {
              type: 'message',
              id: `msg_${captures.length}`,
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    assessment: 'insufficient-evidence',
                    confidence: 0,
                    category: 'none',
                    explanation: 'Unscored registry canary.',
                    involved_symbols: [],
                  }),
                },
              ],
            };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const event = (type, value) =>
        res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
      event('response.created', {
        response: { id: `resp_${captures.length}`, status: 'in_progress', output: [] },
      });
      event('response.output_item.added', { output_index: 0, item });
      event('response.output_item.done', { output_index: 0, item });
      event('response.completed', {
        response: {
          id: `resp_${captures.length}`,
          status: 'completed',
          output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      });
      res.end();
    });
    await new Promise((accept) => server.listen(0, '127.0.0.1', accept));
    try {
      writeFileSync(join(workdir, 'schema.json'), JSON.stringify(RESULT_SCHEMA));
      for (const arm of ['agent', 'fuse']) {
        const args = buildAgentArgs({
          workdir,
          schemaPath: join(workdir, 'schema.json'),
          finalPath: join(workdir, `${arm}.json`),
          repo,
          ...refs,
          task: 'Synthetic registry canary only.',
          arm,
          model: 'gpt-6-astra',
          effort: 'high',
          fuseRoot: root,
          providerConfig: {
            model_provider: 'canary',
            'model_providers.canary': {
              name: 'canary',
              base_url: `http://127.0.0.1:${server.address().port}/v1`,
              wire_api: 'responses',
              requires_openai_auth: false,
            },
          },
        });
        const env = Object.fromEntries(
          ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'CODEX_HOME', 'LANG', 'TERM']
            .filter((key) => process.env[key] !== undefined)
            .map((key) => [key, process.env[key]]),
        );
        const child = spawn(process.env.FUSE_CODEX_BINARY || 'codex', args, {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '',
          stderr = '';
        child.stdout.on('data', (b) => (stdout += b));
        child.stderr.on('data', (b) => (stderr += b));
        const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
        const exit = await new Promise((accept) => {
          child.once('close', accept);
          child.once('error', (e) => accept(e.message));
        });
        clearTimeout(timer);
        assert.equal(exit, 0, stderr);
        writeFileSync(join(workdir, `${arm}-events.jsonl`), stdout);
        const [first, second] = captures.slice(-2);
        const input = JSON.stringify(first.input);
        for (const forbidden of [
          '<skills_instructions>',
          'PONYTAIL',
          'AGENTS.md instructions',
          'PRIVATE_CANARY',
          'eval/cases',
          'rw-012',
          'loginAfterPasswordChange',
        ])
          assert.ok(!input.includes(forbidden), forbidden);
        const output = second.input.find((item) => item.type === 'custom_tool_call_output');
        const names = JSON.parse(
          output.output.find((item) => item.type === 'input_text' && item.text.startsWith('['))
            .text,
        );
        const expected = [
          'apply_patch',
          'clock__curr_time',
          'create_goal',
          'get_goal',
          'list_mcp_resource_templates',
          'list_mcp_resources',
          'mcp__source__source_diff',
          'mcp__source__source_list',
          'mcp__source__source_log',
          'mcp__source__source_read',
          'read_mcp_resource',
          'update_goal',
        ];
        if (arm === 'fuse') expected.push('mcp__fuse__fuse_inspect', 'mcp__fuse__fuse_review');
        assert.deepEqual(names.sort(), expected.sort());
      }
      console.log(`PASS: unscored installed-client registry/context canary; captures ${workdir}`);
    } finally {
      server.closeAllConnections();
      await new Promise((accept) => server.close(accept));
      rmSync(repo, { recursive: true, force: true });
    }
  },
);
