// Human-click simulation ONLY for the explicitly disposable live acceptance fixture.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const [repo, id, stage, label, trace] = process.argv.slice(2);
assert.match(repo, /^\/tmp\/fuse-live-behavioral-20261107\/checkout$/);
assert.ok(['confirm', 'apply'].includes(stage));
const hash = (data) => createHash('sha256').update(data).digest('hex');
const before = readFileSync(join(repo, 'checkout.ts'));
const client = new Client({ name: 'fuse-disposable-human-simulation', version: '1' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../cli/run.mjs', import.meta.url)), 'mcp', '--repo', repo],
    stderr: 'pipe',
  }),
);
let browser;
try {
  async function call(name, args) {
    const result = await client.callTool({ name, arguments: { repo, ...args } });
    assert.ok(!result.isError, JSON.stringify(result));
    const data = JSON.parse(result.content[0].text).data;
    appendFileSync(
      trace,
      JSON.stringify({ at: new Date().toISOString(), name, args, data }) + '\n',
    );
    return data;
  }
  const { url } = await call('fuse_open_review', { id });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(url);
  if (stage === 'confirm') {
    await page.getByRole('button', { name: new RegExp(label) }).click();
    await page.getByText(/Return to your coding agent/).waitFor();
    assert.deepEqual(readFileSync(join(repo, 'checkout.ts')), before);
  } else {
    await page.getByRole('button', { name: 'Preview verified change' }).click();
    await page.getByLabel('Verified preview').waitFor();
    assert.deepEqual(readFileSync(join(repo, 'checkout.ts')), before);
    await page.getByRole('button', { name: 'Approve and apply verified code' }).click();
    await page.getByText(/^Applied verified candidate/).waitFor();
  }
  const r = await call('fuse_review', { id });
  const after = readFileSync(join(repo, 'checkout.ts'));
  if (stage === 'apply') assert.equal(after.toString(), r.behavioral.proposal.source);
  await page.screenshot({ path: `${trace}.${stage}.png`, fullPage: true });
  writeFileSync(`${trace}.${stage}.review.json`, JSON.stringify(r, null, 2));
  const receipt = {
    simulation: 'disposable human browser clicks; live agent submissions are separate',
    stage,
    id,
    revision: r.revision,
    beforeHash: hash(before),
    afterHash: hash(after),
    candidateHash: r.behavioral.proposal?.hash,
    status: r.status,
  };
  appendFileSync(trace, JSON.stringify(receipt) + '\n');
  console.log(JSON.stringify(receipt));
} finally {
  await browser?.close();
  await client.close();
}
