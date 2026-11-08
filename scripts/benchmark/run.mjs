import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadDataset, prepareCase } from './dataset.mjs';
import { runAgent } from './agent.mjs';
import { scoreRuns } from './score.mjs';

export function armOrder(index, seed) {
  const offset = createHash('sha256').update(seed).digest()[0] % 2;
  return (index + offset) % 2 ? ['fuse', 'agent'] : ['agent', 'fuse'];
}

export function harnessHash(directory) {
  const hash = createHash('sha256');
  for (const name of readdirSync(directory)
    .filter((n) => n.endsWith('.mjs'))
    .sort()) {
    hash.update(name);
    hash.update(readFileSync(join(directory, name)));
  }
  return hash.digest('hex');
}

export function productSnapshot(fuseRoot) {
  const paths = ['cli', 'server', 'shared', 'tsconfig.json', 'package.json', 'package-lock.json'];
  const git = (...args) => execFileSync('git', ['-C', fuseRoot, ...args], { encoding: 'utf8' });
  git('diff', '--exit-code', 'HEAD', '--', ...paths);
  if (git('ls-files', '--others', '--exclude-standard', '--', ...paths).trim())
    throw new Error('Commit production inputs before freezing a benchmark run');
  const hash = createHash('sha256');
  for (const path of git('ls-files', '-z', '--', ...paths)
    .split('\0')
    .filter(Boolean)
    .sort()) {
    hash.update(path);
    hash.update(readFileSync(join(fuseRoot, path)));
  }
  return hash.digest('hex');
}

export async function main(argv = process.argv.slice(2)) {
  const { values: args } = parseArgs({
    args: argv,
    options: {
      upstream: { type: 'string' },
      out: { type: 'string' },
      model: { type: 'string', default: 'gpt-6-astra' },
      effort: { type: 'string', default: 'high' },
      'timeout-seconds': { type: 'string', default: '180' },
      concurrency: { type: 'string', default: '2' },
      seed: { type: 'string', default: 'fuse-realworld-baseline-v1' },
      case: { type: 'string', multiple: true },
      resume: { type: 'boolean', default: false },
    },
  });
  if (!args.upstream || !args.out) throw new Error('--upstream and --out are required');
  const concurrency = Number(args.concurrency),
    timeoutMs = Number(args['timeout-seconds']) * 1000;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
    throw new Error('--concurrency must be an integer from 1 to 4');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 900000)
    throw new Error('--timeout-seconds must be from 1 to 900');
  const directory = dirname(fileURLToPath(import.meta.url)),
    fuseRoot = resolve(directory, '../..');
  const dataset = loadDataset(resolve(args.upstream), {
    lock: JSON.parse(readFileSync(join(directory, 'dataset-lock.json'), 'utf8')),
  });
  const requested = new Set(args.case || dataset.cases.map((c) => c.id));
  if ([...requested].some((id) => !dataset.cases.some((c) => c.id === id)))
    throw new Error('Unknown case requested');
  const cases = dataset.cases
    .filter((c) => requested.has(c.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const out = resolve(args.out),
    manifestPath = join(out, 'manifest.json');
  const configuration = {
    schemaVersion: 1,
    study: 'source-only detection; one fresh real-agent run per arm and case',
    model: args.model,
    effort: args.effort,
    timeoutMs,
    concurrency,
    seed: args.seed,
    fuseCommit: execFileSync('git', ['-C', fuseRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    fuseSourceSha256: productSnapshot(fuseRoot),
    nodeVersion: process.version,
    harnessSha256: harnessHash(directory),
    dataset: dataset.manifest,
    schedule: cases.map((c, i) => ({ caseId: c.id, arms: armOrder(i, args.seed) })),
  };
  if (existsSync(manifestPath)) {
    if (!args.resume)
      throw new Error('Output already exists; use a new directory or explicit --resume');
    const previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (JSON.stringify(previous.configuration) !== JSON.stringify(configuration))
      throw new Error('Resume configuration/dataset/harness differs from the frozen manifest');
  } else {
    if (args.resume) throw new Error('No frozen manifest exists to resume');
    mkdirSync(out, { recursive: true });
    writeFileSync(
      manifestPath,
      JSON.stringify({ createdAt: new Date().toISOString(), configuration }, null, 2) + '\n',
      { flag: 'wx' },
    );
  }
  const rows = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= cases.length) return;
        const testCase = cases[index];
        for (const arm of armOrder(index, args.seed)) {
          const rowPath = join(out, 'rows', `${testCase.id}-${arm}.json`);
          if (args.resume && existsSync(rowPath)) {
            const saved = JSON.parse(readFileSync(rowPath, 'utf8'));
            if (saved.caseId !== testCase.id || saved.arm !== arm)
              throw new Error('Mismatched saved row');
            rows.push(saved);
            console.log(`${testCase.id} ${arm}: retained ${saved.status}`);
            continue;
          }
          const started = Date.now();
          let row, result, prepared;
          try {
            prepared = prepareCase({
              sourceRepo: resolve(args.upstream),
              case: testCase,
              root: join(out, 'work'),
            });
            result = await runAgent({
              ...prepared,
              arm,
              model: args.model,
              effort: args.effort,
              timeoutMs,
              outDir: join(out, 'traces', `${testCase.id}-${arm}`),
              fuseRoot,
              codexBinary: process.env.FUSE_CODEX_BINARY || 'codex',
            });
            if (
              productSnapshot(fuseRoot) !== configuration.fuseSourceSha256 ||
              harnessHash(directory) !== configuration.harnessSha256
            )
              throw new Error('Production or harness inputs changed during the frozen run');
            row = { ...result, caseId: testCase.id, arm, provenance: prepared.provenance };
          } catch (error) {
            row = result
              ? {
                  ...result,
                  caseId: testCase.id,
                  arm,
                  status: 'protocol_error',
                  error: `Frozen input violation: ${error.message}`,
                  provenance: prepared.provenance,
                }
              : {
                  caseId: testCase.id,
                  arm,
                  status: 'error',
                  error: `Harness failure: ${error.message}`,
                  durationMs: Date.now() - started,
                  tokens: null,
                  mcp: { status: 'not-started', inspectAttempts: 0, inspectSuccesses: 0 },
                };
          }
          mkdirSync(dirname(rowPath), { recursive: true });
          writeFileSync(rowPath, JSON.stringify(row, null, 2) + '\n', { flag: 'wx' });
          rows.push(row);
          console.log(
            `${testCase.id} ${arm}: ${row.status} ${row.assessment || ''} (${Math.round(row.durationMs / 1000)}s)`,
          );
        }
      }
    }),
  );
  rows.sort((a, b) => a.caseId.localeCompare(b.caseId) || a.arm.localeCompare(b.arm));
  const report = scoreRuns(cases, rows);
  writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2) + '\n');
  writeFileSync(join(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    `Paired baseline complete: ${cases.length} cases, ${rows.length} arm records. ${out}`,
  );
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
