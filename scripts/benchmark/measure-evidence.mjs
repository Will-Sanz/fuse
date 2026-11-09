import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadDataset, prepareCase } from './dataset.mjs';
import { sourceState } from './agent.mjs';
import { harnessHash, productSnapshot } from './run.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const git = (repo, ...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const directory = dirname(fileURLToPath(import.meta.url));
const fuseRoot = resolve(directory, '../..');

/** Rehydrate only the documented omissions, then require exact equality everywhere else. */
function assertPreserved(full, compact) {
  assert.equal(compact.detail, 'compact');
  const restored = structuredClone(compact);
  delete restored.detail;
  for (const side of ['a', 'b']) {
    for (const [path, file] of Object.entries(restored.sources[side].files)) {
      if (!Object.hasOwn(file, 'code')) {
        const input = compact.files.find((item) => item.path === path)?.input;
        assert.ok(input, 'Omitted snapshot source must have a complete file input');
        file.code = input[side === 'a' ? 'agentA' : 'agentB'];
      }
    }
  }
  restored.files.forEach((file, index) => {
    assert.deepEqual(file.input, full.files[index].input);
    file.evidence.forEach((evidence, i) => {
      assert.ok(!Object.hasOwn(evidence, 'code'));
      evidence.code = full.files[index].evidence[i].code;
    });
    file.analysis.conflicts.forEach((conflict, i) => {
      for (const side of ['base', 'a', 'b']) {
        assert.ok(!Object.hasOwn(conflict, side));
        conflict[side] = full.files[index].analysis.conflicts[i][side];
      }
    });
  });
  assert.deepEqual(restored, full);
}

async function main() {
  const { values } = parseArgs({
    options: { upstream: { type: 'string' }, out: { type: 'string' } },
  });
  if (!values.upstream || !values.out) throw new Error('--upstream and --out are required');
  const out = resolve(values.out);
  if (existsSync(out))
    throw new Error('Use a new output directory; measurements are not overwritten');
  const dataset = loadDataset(resolve(values.upstream), {
    lock: JSON.parse(readFileSync(join(directory, 'dataset-lock.json'), 'utf8')),
  });
  const productHash = productSnapshot(fuseRoot),
    harness = harnessHash(directory);
  mkdirSync(out, { recursive: true });
  const rows = [];
  for (const testCase of dataset.cases) {
    const prepared = prepareCase({
      sourceRepo: resolve(values.upstream),
      case: testCase,
      root: join(out, 'work'),
    });
    const before = sourceState(prepared.repo);
    const client = new Client({ name: 'fuse-evidence-measurement', version: '1' });
    const code =
      `const {register}=await import(${JSON.stringify(import.meta.resolve('tsx/esm/api'))});` +
      `register({tsconfig:${JSON.stringify(join(fuseRoot, 'tsconfig.json'))}});` +
      `const {serveMcp}=await import(${JSON.stringify(pathToFileURL(join(fuseRoot, 'server/mcp.ts')).href)});` +
      `await serveMcp(${JSON.stringify(prepared.repo)});`;
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--input-type=module', '-e', code],
        stderr: 'pipe',
      }),
    );
    try {
      const call = async (name, args) => {
        const result = await client.callTool({ name, arguments: args }, undefined, {
          timeout: 120000,
        });
        assert.notEqual(result.isError, true);
        assert.equal(result.content.length, 1);
        assert.equal(result.content[0].type, 'text');
        const text = result.content[0].text;
        const envelope = JSON.parse(text);
        assert.equal(envelope.schemaVersion, 1);
        return { text, data: envelope.data, bytes: Buffer.byteLength(text), sha256: sha256(text) };
      };
      const request = {
        repo: prepared.repo,
        base: prepared.base,
        a: prepared.a,
        b: prepared.b,
        detail: 'full',
      };
      const full = await call('fuse_inspect', request);
      assert.equal(realpathSync(full.data.repository), realpathSync(prepared.repo));
      assert.equal(full.data.baseCommit, request.base);
      assert.equal(full.data.sources.a.head, request.a);
      assert.equal(full.data.sources.b.head, request.b);
      const savedPath = join(prepared.repo, '.git/fuse/reviews', `${full.data.id}.json`);
      const saved = readFileSync(savedPath);
      const compact = await call('fuse_review', {
        repo: prepared.repo,
        id: full.data.id,
        detail: 'compact',
      });
      assertPreserved(full.data, compact.data);
      const again = await call('fuse_review', { repo: prepared.repo, id: full.data.id });
      assert.equal(again.text, full.text, 'Default/full response must remain identical');
      assert.deepEqual(
        readFileSync(savedPath),
        saved,
        'Compact retrieval must not alter persistence',
      );
      const after = sourceState(prepared.repo);
      assert.equal(after, before, 'Inspection must preserve source, refs, and index');
      const row = {
        caseId: testCase.id,
        request: {
          repo: '[PREPARED_SOURCE_REPOSITORY]',
          base: request.base,
          a: request.a,
          b: request.b,
          detail: request.detail,
        },
        provenance: prepared.provenance,
        reconstructedTrees: Object.fromEntries(
          ['base', 'a', 'b'].map((side) => [
            side,
            git(prepared.repo, 'rev-parse', `${prepared[side]}^{tree}`),
          ]),
        ),
        sourceBefore: before,
        sourceAfter: after,
        full: { bytes: full.bytes, responseSha256: full.sha256 },
        compact: { bytes: compact.bytes, responseSha256: compact.sha256 },
        fullAgainSha256: again.sha256,
        savedReviewSha256: sha256(saved),
        preserved: true,
        unsupported: full.data.unsupported,
      };
      assert.deepEqual(row.reconstructedTrees, prepared.provenance.originalTrees);
      rows.push(row);
      writeFileSync(join(out, `${testCase.id}.json`), JSON.stringify(row, null, 2) + '\n', {
        flag: 'wx',
      });
      console.log(`${testCase.id}: ${full.bytes} -> ${compact.bytes} bytes; preservation verified`);
    } finally {
      await client.close();
    }
  }
  assert.equal(productSnapshot(fuseRoot), productHash);
  assert.equal(harnessHash(directory), harness);
  const median = (values) => {
    const ordered = values.toSorted((a, b) => a - b);
    return (
      (ordered[Math.floor((ordered.length - 1) / 2)] +
        ordered[Math.ceil((ordered.length - 1) / 2)]) /
      2
    );
  };
  const totals = {
    cases: rows.length,
    fullBytes: rows.reduce((sum, row) => sum + row.full.bytes, 0),
    compactBytes: rows.reduce((sum, row) => sum + row.compact.bytes, 0),
    fullMedianBytes: median(rows.map((row) => row.full.bytes)),
    compactMedianBytes: median(rows.map((row) => row.compact.bytes)),
  };
  const result = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    method:
      'Actual production MCP stdio, full inspect then compact and default/full reads of the same saved review. UTF-8 JSON text response bytes, not model tokens, efficacy, transport overhead or billing. All preservation assertions must pass.',
    fuseCommit: git(fuseRoot, 'rev-parse', 'HEAD'),
    fuseSourceSha256: productHash,
    harnessSha256: harness,
    scriptSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    nodeVersion: process.version,
    dataset: dataset.manifest,
    totals,
    reduction: 1 - totals.compactBytes / totals.fullBytes,
    rows,
  };
  writeFileSync(join(out, 'measurements.json'), JSON.stringify(result, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(JSON.stringify({ totals, reduction: result.reduction }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
