const probeDir = process.env.FUSE_HOST_PROBE_DIR;
if (!probeDir)
  throw new Error('Run projection.mjs or appserver.mjs, not this child probe directly.');
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const marker = 'ARTIFICIAL_PROBE_' + randomUUID();
writeFileSync(`${probeDir}/marker.txt`, marker);
const s = new McpServer({ name: 'fuse_host_probe', version: '1' });
s.registerTool(
  'probe_meta_privacy',
  {
    description:
      'Harmless diagnostic returning public data and an artificial metadata marker. Do not read marker files.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async () => ({
    content: [{ type: 'text', text: 'PUBLIC_PROBE_RESULT' }],
    structuredContent: { public: 'PUBLIC_STRUCTURED_RESULT' },
    _meta: { privateMarker: marker },
  }),
);
s.registerTool(
  'probe_ui_action',
  {
    description: 'Synthetic component-only echo-free action',
    inputSchema: { capability: z.string() },
    _meta: { ui: { visibility: ['app'] }, 'openai/visibility': 'private' },
    annotations: { destructiveHint: false, readOnlyHint: false, openWorldHint: false },
  },
  async ({ capability }) => {
    if (capability !== marker) throw Error('Synthetic invalid capability');
    writeFileSync(`${probeDir}/ui-action-argument.txt`, capability);
    return { content: [{ type: 'text', text: 'UI_ACTION_ACCEPTED' }] };
  },
);
s.server.oninitialized = () =>
  writeFileSync(
    `${probeDir}/client-capabilities.json`,
    JSON.stringify(
      { capabilities: s.server.getClientCapabilities(), clientInfo: s.server.getClientVersion() },
      null,
      2,
    ),
  );
await s.connect(new StdioServerTransport());
