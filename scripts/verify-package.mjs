import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const directory = mkdtempSync(join(tmpdir(), 'fuse-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args, cwd = directory) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000,
  });
try {
  const [pack] = JSON.parse(
    run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], resolve('.')),
  );
  const files = pack.files.map((f) => f.path);
  for (const required of [
    'dist/index.html',
    'cli/run.mjs',
    'server/mcp.ts',
    'scripts/meeting.mjs',
    'server/proposals.ts',
    'server/verification.ts',
    'verification/Dockerfile',
    'skills/fuse-review/SKILL.md',
    'docs/behavioral-review.md',
    'docs/verification.md',
    'examples/semantic-checkout/checkout.ts',
    'examples/semantic-checkout/README.md',
    'examples/semantic-checkout/branch.test.mjs',
    'examples/semantic-checkout/policy.test.mjs',
  ])
    assert.ok(files.includes(required), `${required} missing`);
  assert.ok(
    !files.some((p) => /(^|\/)(\.env|data\/|\.vercel\/|team-mcp)/.test(p)),
    'Private files must not be packaged',
  );
  run(npm, [
    'install',
    '--omit=dev',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    join(directory, pack.filename),
  ]);
  const executable = join(directory, 'node_modules/fuse/cli/run.mjs');
  assert.match(run(process.execPath, [executable, '--help']), /fuse mcp/);
  const demo = JSON.parse(
    run(process.execPath, [
      executable,
      'demo',
      '--dir',
      join(directory, 'fixture'),
      '--merge',
      '--json',
    ]),
  ).data;
  const semantic = JSON.parse(
    run(process.execPath, [
      executable,
      'semantic-demo',
      '--dir',
      join(directory, 'semantic'),
      '--json',
    ]),
  ).data;
  assert.equal(semantic.review.files[0].path, 'checkout.ts');
  assert.equal(semantic.review.sources.a.ref.kind, 'revision');
  const client = new Client({ name: 'fuse-package-check', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [executable, 'mcp'],
      cwd: directory,
      stderr: 'pipe',
    }),
  );
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of ['fuse_report_issues', 'fuse_submit_proposal', 'fuse_verify'])
      assert.ok(names.includes(name));
    const assessment = await client.callTool({
      name: 'fuse_report_issues',
      arguments: {
        repo: semantic.repo,
        id: semantic.review.id,
        revision: semantic.review.revision,
        report: {
          sourceVersion: semantic.review.sourceVersion,
          assessment: 'insufficient-evidence',
          explanation: 'Package smoke test only; no agent investigation performed.',
        },
      },
    });
    assert.ok(!assessment.isError, JSON.stringify(assessment));
    const result = await client.callTool({ name: 'fuse_inspect', arguments: { repo: demo.repo } });
    assert.ok(!result.isError);
    const review = JSON.parse(result.content[0].text).data;
    assert.ok(review.merge);
    const opened = await client.callTool({
      name: 'fuse_open_review',
      arguments: { repo: demo.repo, id: review.id },
    });
    assert.ok(!opened.isError);
    const { url } = JSON.parse(opened.content[0].text).data;
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(new URL(`/api/reviews/${review.id}`, url))).status, 200);
  } finally {
    await client.close();
  }
  console.log(
    `PASS: production-only package install, real Git conflict, MCP tools, and local review (${pack.size} bytes). No credentials packaged.`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
