import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const probeDir = process.env.FUSE_HOST_PROBE_DIR || mkdtempSync(join(tmpdir(), 'fuse-host-probe-'));
process.env.FUSE_HOST_PROBE_DIR = probeDir;
import http from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
let n = 0;
const server = http.createServer(async (req, res) => {
  let b = '';
  for await (const d of req) b += d;
  let body;
  try {
    body = JSON.parse(b);
  } catch {
    res.writeHead(404).end();
    return;
  }
  const count = ++n;
  writeFileSync(`${probeDir}/request-${count}.json`, JSON.stringify(body, null, 2));
  const tools = body.tools || [];
  console.log(
    'REQUEST',
    count,
    'TOOLS',
    tools.map((t) => t.name || t.type),
  );
  let item =
    count === 1
      ? {
          type: 'custom_tool_call',
          id: 'ct_probe_1',
          call_id: 'call_probe_1',
          name: 'exec',
          namespace: 'functions',
          input: 'text(await tools.mcp__fuse_probe__probe_meta_privacy({}));',
        }
      : {
          type: 'message',
          id: 'msg_probe_2',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Projection capture complete.' }],
        };
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = (type, x) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...x })}\n\n`);
  event('response.created', {
    response: { id: 'resp_probe_' + count, status: 'in_progress', output: [] },
  });
  event('response.output_item.added', { output_index: 0, item });
  event('response.output_item.done', { output_index: 0, item });
  event('response.completed', {
    response: {
      id: 'resp_probe_' + count,
      status: 'completed',
      output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  });
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const args = [
  'exec',
  '--ignore-user-config',
  '--ephemeral',
  '--skip-git-repo-check',
  '-s',
  'read-only',
  '-C',
  probeDir,
  '-c',
  'model_provider="capture"',
  '-c',
  `model_providers.capture={name="capture",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=false}`,
  '-c',
  `mcp_servers={fuse_probe={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(fileURLToPath(new URL('./mcp.mjs', import.meta.url)))}],env={FUSE_HOST_PROBE_DIR=${JSON.stringify(probeDir)}},default_tools_approval_mode="approve"}}`,
  '-c',
  'features.apps=false',
  '--json',
  'Call the synthetic probe MCP tool once, then stop. Do not read files or execute commands.',
];
const child = spawn(process.env.FUSE_CODEX_BINARY || 'codex', args, {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '',
  err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));
const timer = setTimeout(() => {
  child.kill('SIGTERM');
  server.close();
  console.error('Probe timed out');
  process.exit(1);
}, 90000);
child.on('close', (code) => {
  clearTimeout(timer);
  server.close();
  writeFileSync(`${probeDir}/mock-cli.jsonl`, out);
  writeFileSync(`${probeDir}/mock-cli.stderr`, err);
  console.log('EXIT', code);
  assert.ok(n >= 2, 'Expected a second model request');
  if (n >= 2) {
    const marker = readFileSync(`${probeDir}/marker.txt`, 'utf8'),
      second = readFileSync(`${probeDir}/request-2.json`, 'utf8');
    const native = out
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find(
        (event) =>
          event.type === 'item.completed' &&
          event.item?.type === 'mcp_tool_call' &&
          event.item.tool === 'probe_meta_privacy',
      );
    assert.equal(
      native?.item.result?._meta?.privateMarker,
      marker,
      'Private sentinel must match the actual native MCP result',
    );
    console.log('MARKER_IN_MODEL_INPUT', second.includes(marker));
    console.log('META_KEY_IN_MODEL_INPUT', second.includes('privateMarker'));
    console.log('PUBLIC_IN_MODEL_INPUT', second.includes('PUBLIC_PROBE_RESULT'));
    assert.ok(second.includes('PUBLIC_PROBE_RESULT'));
    assert.ok(second.includes('PUBLIC_STRUCTURED_RESULT'));
    assert.ok(!second.includes(marker));
    assert.ok(!second.includes('privateMarker'));
    console.log('PASS: actual Codex client metadata projection; artifacts ' + probeDir);
  }
  process.exitCode = code || 0;
});
