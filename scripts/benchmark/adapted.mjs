import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { CASE_TYPES } from './dataset.mjs';

const SHA = /^[a-f0-9]{40}$/;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Developer',
  GIT_AUTHOR_EMAIL: 'developer@example.invalid',
  GIT_COMMITTER_NAME: 'Developer',
  GIT_COMMITTER_EMAIL: 'developer@example.invalid',
  GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
};
function git(repo, args, input, encoding = 'utf8') {
  return execFileSync('git', ['-C', repo, ...args], {
    input,
    encoding,
    env: gitEnv,
    timeout: 30000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
const targets = {
  click: {
    url: 'https://github.com/pallets/click',
    commit: '874ca2bc1c30d93a4ac6e36a15ed685eafe89097',
    tree: '2a2e0a47bf878494db3dd5436114080dd2812dcc',
    version: '8.1.7',
    language: 'Python',
    license: 'BSD-3-Clause',
    licensePath: 'LICENSE.rst',
  },
  ms: {
    url: 'https://github.com/vercel/ms',
    commit: '1c6264b795492e8fdecbc82cb8802fcfbfc08d26',
    tree: '81dabc398c2c19cedbb3cc79152ed73b407ef081',
    version: '2.1.3',
    language: 'JavaScript',
    license: 'MIT',
    licensePath: 'license.md',
  },
};
function replace(repo, path, before, after) {
  const file = join(repo, path),
    source = readFileSync(file, 'utf8');
  if (!source.includes(before)) throw new Error(`Pinned source anchor missing: ${path}`);
  writeFileSync(file, source.replaceAll(before, after));
}
const groups = [
  {
    target: 'click',
    name: 'date-parser',
    failure: '_try_to_convert_date',
    task: 'Rename the private date parser while keeping DateTime conversion behavior.',
    changeA(repo) {
      replace(repo, 'src/click/types.py', '_try_to_convert_date', '_parse_date');
    },
    fileB: 'src/click/iso_date.py',
    positive:
      'from .types import DateTime\n\ndef parse_iso(value):\n    return DateTime()._try_to_convert_date(value, "%Y-%m-%d")\n',
    negative:
      'from .types import DateTime\n\ndef parse_iso(value):\n    return DateTime(formats=["%Y-%m-%d"]).convert(value, None, None)\n',
    messageB: 'Add an ISO date parsing helper.',
    aCheck:
      'from click import DateTime\nassert DateTime().convert("2024-02-29",None,None).day == 29',
    bCheck: 'from click.iso_date import parse_iso\nassert parse_iso("2024-02-29").day == 29',
  },
  {
    target: 'click',
    name: 'filename-labels',
    failure: "cannot import name 'make_str'",
    task: 'Rename the internal make_str helper and update existing callers without changing command dispatch.',
    changeA(repo) {
      for (const path of ['src/click/utils.py', 'src/click/core.py'])
        replace(repo, path, 'make_str', '_stringify');
    },
    fileB: 'src/click/filename_labels.py',
    positive:
      'from .utils import make_str\n\ndef filename_labels(values):\n    return [make_str(value) for value in values]\n',
    negative:
      'from .utils import format_filename\n\ndef filename_labels(values):\n    return [format_filename(value) for value in values]\n',
    messageB: 'Add display labels for filenames.',
    aCheck:
      'import click\nfrom click.testing import CliRunner\ng = click.Group()\ng.add_command(click.Command("hello",callback=lambda: click.echo("ok")))\nr = CliRunner().invoke(g,["hello"])\nassert r.exit_code == 0 and r.output == "ok\\n", (r.exit_code,r.output)',
    bCheck:
      'from click.filename_labels import filename_labels\nassert filename_labels(["report.txt",b"notes.txt"]) == ["report.txt","notes.txt"]',
  },
  {
    target: 'ms',
    name: 'parse-shape',
    failure: 'NaN',
    task: 'Refactor the internal duration parser to return an object while preserving the exported conversion API.',
    changeA(repo) {
      replace(
        repo,
        'index.js',
        'return parse(val);',
        'var parsed = parse(val);\n    return parsed && parsed.milliseconds;',
      );
      const file = join(repo, 'index.js');
      let source = readFileSync(file, 'utf8');
      source = source
        .replace(/return n \* ([ymwdhs]);/g, 'return { milliseconds: n * $1 };')
        .replace('return n;', 'return { milliseconds: n };');
      writeFileSync(file, source);
    },
    fileB: 'index.js',
    append: true,
    positive: '\nmodule.exports.seconds = function(text) { return parse(text) / 1000; };\n',
    negative:
      '\nmodule.exports.seconds = function(text) { return module.exports(text) / 1000; };\n',
    messageB: 'Add a seconds conversion helper.',
    aCheck:
      'const ms=require("./"); for(const [x,y] of [["2h",7200000],["10ms",10],["1w",604800000]]) require("node:assert/strict").equal(ms(x),y);',
    bCheck: 'require("node:assert/strict").equal(require("./").seconds("2h"),7200);',
  },
  {
    target: 'ms',
    name: 'verbose-format',
    failure: 'fmtLong is not defined',
    task: 'Rename the internal long formatter without changing the public duration formatting API.',
    changeA(repo) {
      replace(repo, 'index.js', 'fmtLong', 'formatLong');
    },
    fileB: 'index.js',
    append: true,
    positive: '\nmodule.exports.verbose = function(value) { return fmtLong(value); };\n',
    negative:
      '\nmodule.exports.verbose = function(value) { return module.exports(value, { long: true }); };\n',
    messageB: 'Add a verbose formatting helper.',
    aCheck:
      'const ms=require("./"); require("node:assert/strict").equal(ms(7200000,{long:true}),"2 hours"); require("node:assert/strict").equal(ms("2h"),7200000);',
    bCheck: 'require("node:assert/strict").equal(require("./").verbose(7200000),"2 hours");',
  },
];
function check(repo, target, code) {
  const result =
    target === 'click'
      ? spawnSync('python3', ['-B', '-c', code], {
          cwd: repo,
          env: { ...process.env, PYTHONPATH: join(repo, 'src'), PYTHONDONTWRITEBYTECODE: '1' },
          encoding: 'utf8',
          timeout: 10000,
        })
      : spawnSync(process.execPath, ['-e', code], { cwd: repo, encoding: 'utf8', timeout: 10000 });
  return {
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
function save(repo, base, message) {
  git(repo, ['add', '-f', '.']);
  const tree = git(repo, ['write-tree']).trim();
  return git(repo, ['commit-tree', tree, ...(base ? ['-p', base] : [])], message + '\n').trim();
}

/** Build eight authored probes on exact upstream trees; no oracle is written into source stores. */
export function buildAdaptedDataset({ click, ms, out }) {
  out = resolve(out);
  mkdirSync(out, { recursive: true });
  const sources = { click: resolve(click), ms: resolve(ms) },
    metadata = {},
    cases = [],
    validations = [];
  const scratch = mkdtempSync(join(tmpdir(), 'fuse-adapted-validation-'));
  try {
    for (const [id, target] of Object.entries(targets)) {
      const source = sources[id];
      if (git(source, ['rev-parse', 'HEAD']).trim() !== target.commit)
        throw new Error(`Wrong pinned ${id} source`);
      const repo = join(out, id);
      mkdirSync(repo);
      git(repo, ['init', '-q', '--initial-branch=base']);
      const tree = git(source, ['rev-parse', `${target.commit}^{tree}`]).trim();
      git(
        repo,
        ['unpack-objects', '-r'],
        git(source, ['pack-objects', '--stdout', '--revs'], tree + '\n', null),
      );
      const base = git(repo, ['commit-tree', tree], 'Initial application snapshot\n').trim();
      git(repo, ['update-ref', 'refs/heads/base', base]);
      git(repo, ['reset', '--hard', '-q', base]);
      const license = git(source, ['show', `${target.commit}:${target.licensePath}`]);
      writeFileSync(join(out, `${id}-LICENSE`), license);
      metadata[id] = { ...target, tree, baseCommit: base, licenseSha256: digest(license) };
    }
    for (const [index, group] of groups.entries()) {
      const repo = join(out, group.target),
        base = metadata[group.target].baseCommit;
      git(repo, ['reset', '--hard', '-q', base]);
      git(repo, ['clean', '-fdq']);
      group.changeA(repo);
      const a = save(repo, base, group.task);
      git(repo, ['update-ref', `refs/heads/feature-${index}-a`, a]);
      for (const positive of [true, false]) {
        git(repo, ['reset', '--hard', '-q', base]);
        git(repo, ['clean', '-fdq']);
        const file = join(repo, group.fileB),
          addition = positive ? group.positive : group.negative;
        writeFileSync(file, (group.append ? readFileSync(file, 'utf8') : '') + addition);
        const b = save(repo, base, group.messageB),
          id = `bx-${String(cases.length + 1).padStart(3, '0')}`;
        git(repo, ['update-ref', `refs/heads/feature-${index}-${positive ? 'p' : 'n'}`, b]);
        const merge = git(repo, ['merge-tree', '--write-tree', a, b]).trim();
        if (!SHA.test(merge)) throw new Error(`Authored case must merge cleanly: ${id}`);
        const checkRepo = join(scratch, id);
        mkdirSync(checkRepo);
        git(checkRepo, ['init', '-q']);
        git(
          checkRepo,
          ['unpack-objects', '-r'],
          git(repo, ['pack-objects', '--stdout', '--revs'], `${a}\n${b}\n${merge}\n`, null),
        );
        const results = {};
        for (const [side, ref, code] of [
          ['base', base, group.aCheck],
          ['a', a, group.aCheck],
          ['b', b, group.aCheck + '\n' + group.bCheck],
          ['mergedPublic', merge, group.aCheck],
          ['merged', merge, group.bCheck],
        ]) {
          git(checkRepo, ['read-tree', '--reset', '-u', ref]);
          git(checkRepo, ['clean', '-fdq']);
          results[side] = check(checkRepo, group.target, code);
        }
        if (
          ['base', 'a', 'b', 'mergedPublic'].some((s) => results[s].exitCode !== 0) ||
          results.merged.exitCode !== (positive ? 1 : 0) ||
          (positive && !results.merged.stderr.includes(group.failure))
        )
          throw new Error(`Oracle validation failed ${id}: ${JSON.stringify(results)}`);
        const refs = { baseCommit: base, aCommit: a, bCommit: b };
        cases.push({
          id,
          type: positive ? 'runtime' : 'negative',
          label: positive ? 'conflict' : 'no_conflict',
          intent_a: group.task,
          target: group.target,
          scenario: group.name,
          ...refs,
          ...Object.fromEntries(
            Object.entries(refs).map(([k, v]) => [
              k.replace('Commit', 'Tree'),
              git(repo, ['rev-parse', `${v}^{tree}`]).trim(),
            ]),
          ),
        });
        validations.push({
          caseId: id,
          label: positive ? 'conflict' : 'no_conflict',
          cleanMergeTree: merge,
          checks: results,
          oracleSha256: digest(group.aCheck + '\n' + group.bCheck),
        });
      }
    }
    const lock = {
      schemaVersion: 1,
      study: 'authored adapted source-only interaction probes; not historical production conflicts',
      targets: metadata,
      cases,
    };
    writeFileSync(join(out, 'dataset-lock.json'), JSON.stringify(lock, null, 2) + '\n');
    writeFileSync(
      join(out, 'oracle-results.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          nodeVersion: process.version,
          pythonVersion: execFileSync('python3', ['--version'], { encoding: 'utf8' }).trim(),
          validations,
        },
        null,
        2,
      ) + '\n',
    );
    return lock;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Validate pinned metadata before using any path or Git revision from the lock. */
export function validateAdaptedLock(lock) {
  if (
    lock?.schemaVersion !== 1 ||
    !Array.isArray(lock.cases) ||
    lock.cases.length !== 8 ||
    !lock.targets ||
    typeof lock.study !== 'string'
  )
    throw new Error('Invalid adapted dataset lock');
  const ids = new Set();
  for (const c of lock.cases) {
    if (
      !/^bx-\d{3}$/.test(c.id) ||
      ids.has(c.id) ||
      !CASE_TYPES.includes(c.type) ||
      c.label !== (c.type === 'negative' ? 'no_conflict' : 'conflict') ||
      !Object.hasOwn(targets, c.target) ||
      typeof c.intent_a !== 'string' ||
      !c.intent_a.trim()
    )
      throw new Error('Invalid adapted case');
    ids.add(c.id);
    for (const side of ['base', 'a', 'b'])
      if (!SHA.test(c[`${side}Commit`]) || !SHA.test(c[`${side}Tree`]))
        throw new Error('Invalid adapted commit/tree');
    const target = lock.targets[c.target],
      pinned = targets[c.target];
    if (
      !target ||
      Object.entries(pinned).some(([key, value]) => target[key] !== value) ||
      target.tree !== c.baseTree ||
      target.baseCommit !== c.baseCommit
    )
      throw new Error('Adapted upstream provenance mismatch');
  }
}

/** Verify every commit AND tree; labels/oracles remain in the controller only. */
export function loadAdaptedDataset(sourceRoot, lockPath) {
  const content = readFileSync(lockPath, 'utf8'),
    lock = JSON.parse(content);
  validateAdaptedLock(lock);
  const cases = [];
  for (const c of lock.cases) {
    const sourceRepo = join(resolve(sourceRoot), c.target);
    for (const side of ['base', 'a', 'b']) {
      const commit = c[`${side}Commit`],
        tree = c[`${side}Tree`];
      if (git(sourceRepo, ['rev-parse', `${commit}^{tree}`]).trim() !== tree)
        throw new Error(`Adapted source changed: ${c.id}/${side}`);
      git(sourceRepo, ['merge-base', '--is-ancestor', c.baseCommit, commit]);
    }
    cases.push({ ...c, sourceRepo });
  }
  return { cases, manifest: { ...lock, definitionSha256: digest(content) } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: { click: { type: 'string' }, ms: { type: 'string' }, out: { type: 'string' } },
  });
  if (!values.click || !values.ms || !values.out)
    throw new Error('--click, --ms and --out are required');
  buildAdaptedDataset(values);
  console.log(`Built and independently executed all 8 adapted cases in ${resolve(values.out)}`);
}
