import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';
const installation = fileURLToPath(new URL('../', import.meta.url));
const cli = join(installation, 'cli/run.mjs');
if (existsSync(join(installation, '.env'))) process.loadEnvFile(join(installation, '.env'));
const { values } = parseArgs({
  options: {
    scenario: { type: 'string', default: 'checkout' },
    verify: { type: 'boolean' },
    'no-open': { type: 'boolean' },
    port: { type: 'string', default: '3002' },
  },
});
if (!process.env.OPENAI_API_KEY) {
  console.error(`Add OPENAI_API_KEY to ${join(installation, '.env')} and run this command again.`);
  process.exit(1);
}
const command = (...args) => {
  const r = spawnSync(process.execPath, [cli, ...args, '--json'], {
    encoding: 'utf8',
    timeout: 45000,
  });
  assert.ok([0, 2].includes(r.status), r.stderr || r.stdout || 'Fuse command failed');
  return JSON.parse(r.stdout).data;
};
const output = join(installation, 'data/meetings', randomUUID());
mkdirSync(output, { recursive: true });
console.log('\nFUSE · LIVE VISUAL EXPLANATION\n');
const d = command('demo', '--dir', join(output, 'repo'), '--merge', '--scenario', values.scenario);
const before = execFileSync('git', ['-C', d.repo, 'status', '--short'], {
  encoding: 'utf8',
}).trim();
assert.match(before, /^UU /);
console.log(`1. Real Git merge conflict\n   ${d.repo}\n   ${before}\n`);
const client = new Client({ name: 'fuse-meeting', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [cli, 'mcp', '--repo', d.repo],
  stderr: 'pipe',
});
const started = Date.now();
let review;
try {
  await client.connect(transport);
  console.log(`2. MCP → fuse_explain → OpenAI / ${process.env.FUSE_AI_MODEL || 'gpt-6-luna'}`);
  console.log('   Reading the codebase and designing a custom visual…');
  const timer = setInterval(
    () => console.log(`   Generating · ${Math.round((Date.now() - started) / 1000)}s`),
    10000,
  );
  let result;
  try {
    result = await client.callTool({ name: 'fuse_explain', arguments: {} }, undefined, {
      timeout: 300000,
    });
  } finally {
    clearInterval(timer);
  }
  if (result.isError)
    throw new Error(
      result.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n'),
    );
  review = JSON.parse(result.content.find((c) => c.type === 'text').text).data;
  const image = result.content.find((c) => c.type === 'image');
  assert.ok(image && image.mimeType === 'image/png', 'MCP must return an actual PNG image');
  const png = Buffer.from(image.data, 'base64');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(review.visual.origin, 'ai');
  assert.ok(review.visual.responseId, 'A real provider response must be recorded');
  assert.ok(review.merge, 'The review must come from the active Git conflict');
  assert.equal(
    execFileSync('git', ['-C', d.repo, 'status', '--short'], { encoding: 'utf8' }).trim(),
    before,
    'AI explanation must leave the source unchanged',
  );
  writeFileSync(join(output, 'visual.png'), png);
  writeFileSync(join(output, 'visual.json'), JSON.stringify(review.visual, null, 2) + '\n');
  writeFileSync(
    join(output, 'session.json'),
    JSON.stringify(
      {
        tool: 'fuse_explain',
        model: review.visual.model,
        responseId: review.visual.responseId,
        review: review.id,
        repository: d.repo,
        before,
        imageBytes: png.length,
        durationMs: Date.now() - started,
        generatedAt: review.visual.generatedAt,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `\n3. AI image received through MCP\n   ${review.visual.title}\n   ${review.visual.metaphor}\n   ${png.length} bytes · ${Math.round((Date.now() - started) / 1000)}s\n   Image: ${join(output, 'visual.png')}\n`,
  );
  if (values.verify) {
    const option =
      review.visual.options.find((o) => o.action === 'a-first') || review.visual.options[0];
    const action = option.action.endsWith('-first')
      ? ['--choice', 'both', '--order', option.action]
      : ['--choice', option.action];
    review = command(
      'decide',
      review.id,
      '--repo',
      d.repo,
      '--file',
      review.visual.path,
      '--conflict',
      review.visual.conflictId,
      ...action,
      '--note',
      `${option.label}. ${option.description}`,
    );
    review = command('preview', review.id, '--repo', d.repo);
    review = command('apply', review.id, '--repo', d.repo, '--approve', review.preview.token);
    assert.equal(review.status, 'applied');
    assert.ok(review.checks.length && review.checks.every((c) => c.status === 'passed'));
    assert.equal(
      execFileSync('git', ['-C', d.repo, 'ls-files', '--unmerged'], { encoding: 'utf8' }),
      '',
    );
    for (const [path, code] of Object.entries(review.preview.outputs))
      assert.equal(readFileSync(join(d.repo, path), 'utf8'), code);
    console.log(
      `PASS · real MCP → real AI image → chosen behavior → resolved file → checks passed.\nVerified in the disposable repository above.`,
    );
  }
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
if (review && !values.verify && !process.exitCode) {
  console.log(
    '4. Choose a behavior in the browser, then click Create this change.\n   Press Ctrl+C here when your walkthrough is finished.\n',
  );
  const serve = spawnSync(
    process.execPath,
    [
      cli,
      'review',
      review.id,
      '--repo',
      d.repo,
      '--serve',
      '--port',
      values.port,
      ...(values['no-open'] ? [] : ['--open']),
    ],
    { stdio: 'inherit' },
  );
  process.exitCode = serve.status || 0;
}
