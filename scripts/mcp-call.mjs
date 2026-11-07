// Portable real-transport helper used by the recorded live host-agent proof.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const [repo, name, argumentFile, trace] = process.argv.slice(2);
const client = new Client({ name: 'fuse-live-host-agent', version: '1' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../cli/run.mjs', import.meta.url)), 'mcp', '--repo', repo],
    stderr: 'pipe',
  }),
);
try {
  const args = argumentFile ? JSON.parse(readFileSync(argumentFile, 'utf8')) : {};
  const result = await client.callTool({ name, arguments: { ...args, repo } }, undefined, {
    timeout: 300000,
  });
  const texts = result.content.filter((c) => c.type === 'text').map((c) => c.text);
  for (const block of result.content.filter((c) => c.type === 'image')) {
    if (trace) writeFileSync(`${trace}.png`, Buffer.from(block.data, 'base64'));
  }
  if (trace)
    appendFileSync(
      trace,
      JSON.stringify({
        at: new Date().toISOString(),
        name,
        args,
        isError: result.isError || false,
        texts,
        images: result.content
          .filter((c) => c.type === 'image')
          .map((c) => createHash('sha256').update(c.data).digest('hex')),
      }) + '\n',
      { mode: 0o600 },
    );
  console.log(texts.join('\n'));
  if (result.isError) process.exitCode = 1;
} finally {
  await client.close();
}
