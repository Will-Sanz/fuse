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
let count = 0;
const requests = [];
const httpServer = http.createServer(async (req, res) => {
  let body = '';
  for await (const d of req) body += d;
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    res.writeHead(404).end();
    return;
  }
  requests.push(data);
  const n = ++count;
  writeFileSync(`${probeDir}/appserver-request-${n}.json`, JSON.stringify(data, null, 2));
  const item =
    n === 1
      ? {
          type: 'custom_tool_call',
          id: 'ct_as_1',
          call_id: 'call_as_1',
          name: 'exec',
          namespace: 'functions',
          input: 'text(await tools.mcp__fuse_probe__probe_meta_privacy({}));',
        }
      : {
          type: 'message',
          id: 'msg_as_' + n,
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Synthetic response ' + n }],
        };
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const [type, extra] of [
    ['response.created', { response: { id: 'resp_as_' + n, status: 'in_progress', output: [] } }],
    ['response.output_item.added', { output_index: 0, item }],
    ['response.output_item.done', { output_index: 0, item }],
    [
      'response.completed',
      {
        response: {
          id: 'resp_as_' + n,
          status: 'completed',
          output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      },
    ],
  ])
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`);
  res.end();
});
await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
const port = httpServer.address().port;
const cfg = [
  '-c',
  'model_provider="capture"',
  '-c',
  `model_providers.capture={name="capture",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=false}`,
  '-c',
  `mcp_servers={fuse_probe={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(fileURLToPath(new URL('./mcp.mjs', import.meta.url)))}],env={FUSE_HOST_PROBE_DIR=${JSON.stringify(probeDir)}},default_tools_approval_mode="approve"}}`,
  '-c',
  'features.apps=false',
];
const child = spawn(
  process.env.FUSE_CODEX_BINARY || 'codex',
  ['app-server', ...cfg, '--listen', 'stdio://'],
  { stdio: ['pipe', 'pipe', 'pipe'] },
);
let serial = 0,
  buffer = '',
  stderr = '';
const pending = new Map(),
  notifications = [],
  turnWaiters = [];
child.stdout.on('data', (d) => {
  buffer += d;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.id != null) {
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        m.error ? p.reject(Error(JSON.stringify(m.error))) : p.accept(m.result);
      }
    } else {
      notifications.push(m);
      if (m.method === 'turn/completed') turnWaiters.shift()?.(m.params);
    }
  }
});
child.stderr.on('data', (d) => (stderr += d));
function rpc(method, params) {
  const id = ++serial;
  return new Promise((accept, reject) => {
    pending.set(id, { accept, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function nextTurn() {
  return new Promise((r) => turnWaiters.push(r));
}
const timeout = setTimeout(() => {
  child.kill('SIGTERM');
  httpServer.close();
  console.error('Probe timed out');
  process.exit(1);
}, 90000);
try {
  console.log(
    'INIT',
    await rpc('initialize', {
      clientInfo: { name: 'fuse_synthetic_host_probe', version: '1' },
      capabilities: { experimentalApi: true },
    }),
  );
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }) + '\n');
  const started = await rpc('thread/start', {
    cwd: probeDir,
    ephemeral: true,
    sandbox: 'read-only',
    approvalPolicy: 'never',
  });
  const id = started.thread.id;
  console.log('THREAD', id);
  let done = nextTurn();
  await rpc('turn/start', {
    threadId: id,
    input: [{ type: 'text', text: 'Call the synthetic metadata probe once.', text_elements: [] }],
  });
  await done;
  const marker = readFileSync(`${probeDir}/marker.txt`, 'utf8');
  const action = await rpc('mcpServer/tool/call', {
    threadId: id,
    server: 'fuse_probe',
    tool: 'probe_ui_action',
    arguments: { capability: marker },
    _meta: { thread_id: id, threadId: id },
  });
  assert.ok(
    JSON.stringify(action).includes('UI_ACTION_ACCEPTED'),
    'Direct component action must reach its MCP handler',
  );
  assert.equal(readFileSync(`${probeDir}/ui-action-argument.txt`, 'utf8'), marker);
  console.log('UI_CALL_RETURNED', true);
  const rejected = await rpc('mcpServer/tool/call', {
    threadId: id,
    server: 'fuse_probe',
    tool: 'probe_ui_action',
    arguments: { capability: marker + '_FAILED' },
    _meta: { thread_id: id, threadId: id },
  });
  assert.ok(
    JSON.stringify(rejected).includes('Synthetic invalid capability'),
    'Rejected component action must reach its MCP handler',
  );
  console.log('UI_REJECTION_RETURNED', true);

  done = nextTurn();
  await rpc('turn/start', {
    threadId: id,
    input: [
      {
        type: 'text',
        text: 'Continue after the synthetic UI action. Say done.',
        text_elements: [],
      },
    ],
  });
  await done;
  writeFileSync(`${probeDir}/appserver-notifications.json`, JSON.stringify(notifications, null, 2));
  const last = JSON.stringify(requests.at(-1));
  console.log('REQUEST_COUNT', requests.length);
  console.log('NEXT_MODEL_PUBLIC_PRESENT', last.includes('PUBLIC_PROBE_RESULT'));
  console.log('NEXT_MODEL_PRIVATE_MARKER_PRESENT', last.includes(marker));
  console.log('NEXT_MODEL_FAILED_MARKER_PRESENT', last.includes(marker + '_FAILED'));
  console.log('NEXT_MODEL_UI_ACTION_RESULT_PRESENT', last.includes('UI_ACTION_ACCEPTED'));
  console.log('NEXT_MODEL_UI_TOOL_NAME_PRESENT', last.includes('probe_ui_action'));
  const native = notifications.find(
    (event) =>
      event.method === 'item/completed' &&
      event.params?.item?.type === 'mcpToolCall' &&
      event.params.item.tool === 'probe_meta_privacy',
  );
  assert.equal(
    native?.params.item.result?._meta?.privateMarker,
    marker,
    'Private sentinel must match the actual native MCP result',
  );
  assert.ok(requests.length >= 3);
  assert.ok(last.includes('PUBLIC_PROBE_RESULT'));
  assert.ok(!last.includes(marker));
  assert.ok(!last.includes('UI_ACTION_ACCEPTED'));
  assert.ok(!last.includes('probe_ui_action'));
  console.log(
    'PASS: actual app-server UI action excluded from model history; artifacts ' + probeDir,
  );
  console.log('CLIENT_HANDSHAKE', readFileSync(`${probeDir}/client-capabilities.json`, 'utf8'));
} finally {
  clearTimeout(timeout);
  child.kill('SIGTERM');
  httpServer.close();
  writeFileSync(`${probeDir}/appserver.stderr`, stderr);
}
