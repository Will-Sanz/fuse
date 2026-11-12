import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildMap, diffMaps, impactCone, mapBranches } from '../server/map';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));

const run = (repo: string, ...args: string[]) =>
  execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
function write(repo: string, files: Record<string, string>) {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), body);
  }
}
function repoWith(files: Record<string, string>) {
  const repo = mkdtempSync(join(tmpdir(), 'fuse-map-'));
  dirs.push(repo);
  run(repo, 'init', '-q', '-b', 'main');
  run(repo, 'config', 'user.email', 'test@example.com');
  run(repo, 'config', 'user.name', 'Fuse test');
  write(repo, files);
  run(repo, 'add', '-A');
  run(repo, 'commit', '-qm', 'base');
  return repo;
}
function commitOn(repo: string, branch: string, from: string, files: Record<string, string>) {
  run(repo, 'switch', '-q', '-c', branch, from);
  write(repo, files);
  run(repo, 'add', '-A');
  run(repo, 'commit', '-qm', branch);
  run(repo, 'switch', '-q', 'main');
}

const checkout = {
  'package.json': JSON.stringify({
    name: 'shop',
    main: 'dist/index.js',
    bin: { shop: 'src/cli.js' },
  }),
  'tsconfig.json':
    '{ // comments are allowed\n "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }',
  'src/discount.ts': 'export function discount(total: number) { return total > 100 ? 10 : 0; }\n',
  'src/shipping.ts': 'export const shipping = (total: number) => (total > 50 ? 0 : 5);\n',
  'src/types.ts': 'export interface Order { items: number[] }\n',
  'src/total.ts':
    "import { discount } from './discount.js';\nimport { shipping } from '@/shipping';\nimport type { Order } from './types';\nexport function total(order: Order) { const sum = order.items.reduce((a, b) => a + b, 0); return sum - discount(sum) + shipping(sum); }\n",
  'src/cli.ts':
    "import { total } from './total';\nimport { z } from 'zod';\nimport './theme.css';\nexport function main() { return total({ items: [z ? 1 : 0] }); }\n",
  'src/theme.css': 'body { color: black; }\n',
  'src/lazy.ts': "export async function later() { return import('./total'); }\n",
  'src/broken.ts': "import { nothing } from './does-not-exist';\nexport const x = nothing;\n",
  'src/cycle-a.ts': "import { b } from './cycle-b';\nexport const a = () => b();\n",
  'src/cycle-b.ts': "import { a } from './cycle-a';\nexport const b = () => a;\n",
  'tests/total.test.ts': "import { total } from '../src/total';\ntotal({ items: [] });\n",
  'node_modules/zod/index.ts': 'export const z = 1;\n',
  'dist/index.js': 'console.log(1);\n',
};

describe('repository map', () => {
  it('builds file edges from a pinned commit, resolving tsconfig paths and .js specifiers', () => {
    const map = buildMap(repoWith(checkout));
    const edges = map.edges.map((e) => `${e.from} -> ${e.to} [${e.kinds}]`);
    expect(edges).toContain('src/total.ts -> src/discount.ts [value]');
    expect(edges).toContain('src/total.ts -> src/shipping.ts [value]');
    expect(edges).toContain('src/total.ts -> src/types.ts [type]');
    expect(edges).toContain('src/lazy.ts -> src/total.ts [dynamic]');
    expect(map.files.map((f) => f.path)).not.toContain('node_modules/zod/index.ts');
    expect(map.externals).toEqual([{ name: 'zod', importers: ['src/cli.ts'] }]);
    expect(map.unresolved).toEqual([{ from: 'src/broken.ts', specifier: './does-not-exist' }]);
    expect(map.notAnalyzed).toEqual([
      { from: 'src/cli.ts', specifier: './theme.css', target: 'src/theme.css' },
    ]);
  });

  it('resolves cross-file calls through imports and aliases', () => {
    const map = buildMap(repoWith(checkout));
    const calls = map.calls.map((c) => `${c.from} -> ${c.to}`);
    expect(calls).toContain('src/total.ts#total -> src/discount.ts#discount');
    expect(calls).toContain('src/total.ts#total -> src/shipping.ts#shipping');
    expect(calls).toContain('src/cli.ts#main -> src/total.ts#total');
    expect(map.calls.find((c) => c.to === 'src/discount.ts#discount')?.crossFile).toBe(true);
  });

  it('reports structure: cycles, fan-in, ranking and entry points', () => {
    const map = buildMap(repoWith(checkout));
    expect(map.cycles).toEqual([['src/cycle-a.ts', 'src/cycle-b.ts']]);
    expect(map.metrics['src/total.ts']).toMatchObject({ fanIn: 3, fanOut: 3 });
    expect(map.metrics['src/discount.ts'].rank).toBeGreaterThan(map.metrics['src/cli.ts'].rank);
    expect(map.entryPoints).toContain('src/cli.ts'); // declared in package.json bin
    expect(map.entryPoints).not.toContain('tests/total.test.ts');
    expect(map.files.find((f) => f.path === 'tests/total.test.ts')?.test).toBe(true);
  });

  it('is deterministic for the same commit and ignores uncommitted work', () => {
    const repo = repoWith(checkout);
    const first = buildMap(repo);
    write(repo, { 'src/extra.ts': "import { total } from './total';\n" });
    expect(buildMap(repo)).toEqual(first);
  });

  it('never executes repository code while mapping', () => {
    const marker = join(tmpdir(), `fuse-map-marker-${process.pid}`);
    const repo = repoWith({
      ...checkout,
      'vite.config.ts': `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'ran');\nexport default {};\n`,
    });
    const map = buildMap(repo);
    expect(map.files.map((f) => f.path)).toContain('vite.config.ts');
    expect(existsSync(marker)).toBe(false);
  });

  it('skips symlinks and oversized files with a reason, and flags hidden Unicode and secrets', () => {
    const repo = repoWith({
      ...checkout,
      'src/huge.ts': `export const big = "${'x'.repeat(110_000)}";\n`,
      'src/hidden.ts': 'export const ok = 1; // \u202Eevil\u202C and \u{E0049}\u{E0047}\n',
      'src/bom.ts': '\uFEFFexport const fine = 1;\n',
      'src/config.ts': `export const key = "AKIA${'A'.repeat(16)}";\n`,
    });
    symlinkSync('/etc/hostname', join(repo, 'src/link.ts'));
    run(repo, 'add', '-A');
    run(repo, 'commit', '-qm', 'more');
    const map = buildMap(repo);
    const skipped = Object.fromEntries(map.skipped.map((s) => [s.path, s.reason]));
    expect(skipped['src/huge.ts']).toMatch(/100 KB/);
    expect(skipped['src/link.ts']).toMatch(/Symlink/);
    expect(map.files.find((f) => f.path === 'src/hidden.ts')?.hiddenUnicode).toBe(true);
    expect(map.files.find((f) => f.path === 'src/bom.ts')?.hiddenUnicode).toBe(false);
    expect(map.files.find((f) => f.path === 'src/config.ts')?.aiExcluded).toMatch(/secret/);
    expect(map.warnings.join(' ')).toMatch(/invisible/);
  });

  it('rejects unsafe revisions', () => {
    expect(() => buildMap(repoWith(checkout), '--output=/tmp/x')).toThrow(/Invalid Git revision/);
  });
});

describe('branch overlays', () => {
  it('flags where two Git-clean changes in different files meet, with import paths as evidence', () => {
    const repo = repoWith(checkout);
    commitOn(repo, 'agent-a', 'main', {
      'src/discount.ts':
        'export function discount(total: number) { return total > 100 ? total * 0.1 : 0; }\n',
    });
    commitOn(repo, 'agent-b', 'main', {
      'src/shipping.ts': 'export const shipping = (total: number) => (total > 80 ? 0 : 5);\n',
    });
    run(repo, 'merge', '-q', '--no-edit', 'agent-a');
    run(repo, 'merge', '-q', '--no-edit', 'agent-b'); // Git merges both cleanly.
    const result = mapBranches(repo, 'main~2', 'agent-a', 'agent-b');
    expect(result.changedA).toEqual(['src/discount.ts']);
    expect(result.changedB).toEqual(['src/shipping.ts']);
    const atTotal = result.interactions.find((i) => i.file === 'src/total.ts')!;
    expect(atTotal.viaA).toEqual(['src/total.ts', 'src/discount.ts']);
    expect(atTotal.viaB).toEqual(['src/total.ts', 'src/shipping.ts']);
    expect(result.interactions.map((i) => i.file)).toContain('src/cli.ts');
  });

  it('does not flag independent changes whose impact never meets', () => {
    const repo = repoWith({
      ...checkout,
      'src/report.ts': 'export function report() { return "ok"; }\n',
      'src/admin.ts': "import { report } from './report';\nexport const admin = () => report();\n",
    });
    commitOn(repo, 'agent-a', 'main', {
      'src/discount.ts':
        'export function discount(total: number) { return total > 200 ? 10 : 0; }\n',
    });
    commitOn(repo, 'agent-b', 'main', {
      'src/report.ts': 'export function report() { return "done"; }\n',
    });
    expect(mapBranches(repo, 'main', 'agent-a', 'agent-b').interactions).toEqual([]);
  });

  it('reports new dependencies that cross top-level folders', () => {
    const repo = repoWith({
      ...checkout,
      'server/db.ts': 'export const db = 1;\n',
      'ui/view.ts': 'export const view = 1;\n',
    });
    commitOn(repo, 'agent-a', 'main', {
      'ui/view.ts': "import { db } from '../server/db';\nexport const view = db;\n",
    });
    const diff = diffMaps(buildMap(repo, 'main'), buildMap(repo, 'agent-a'));
    expect(diff.changed).toEqual(['ui/view.ts']);
    expect(diff.crossFolderAdded.map((e) => `${e.from} -> ${e.to}`)).toEqual([
      'ui/view.ts -> server/db.ts',
    ]);
  });

  it('builds an impact cone with one shortest path per dependent', () => {
    const cone = impactCone(buildMap(repoWith(checkout)), ['src/discount.ts']);
    expect(cone.get('src/cli.ts')).toEqual(['src/cli.ts', 'src/total.ts', 'src/discount.ts']);
    expect(cone.has('src/shipping.ts')).toBe(false);
  });
});

describe('review fixes', () => {
  it('flags a side that newly imports the other side’s change', () => {
    const repo = repoWith({
      'src/a.ts': 'export const a = () => 1;\n',
      'src/b.ts': 'export const b = () => 2;\n',
    });
    commitOn(repo, 'agent-a', 'main', { 'src/a.ts': 'export const a = () => 100;\n' });
    commitOn(repo, 'agent-b', 'main', {
      'src/b.ts': "import { a } from './a';\nexport const b = () => a() + 2;\n",
    });
    const result = mapBranches(repo, 'main', 'agent-a', 'agent-b');
    expect(result.interactions.map((i) => i.file)).toEqual(['src/b.ts']);
    expect(result.interactions[0].viaA).toEqual(['src/b.ts', 'src/a.ts']);
  });

  it('flags a side that imports a file the other side deleted', () => {
    const repo = repoWith({
      'src/util.ts': 'export const u = 1;\n',
      'src/x.ts': 'export const x = 1;\n',
    });
    run(repo, 'switch', '-q', '-c', 'agent-a');
    run(repo, 'rm', '-q', 'src/util.ts');
    run(repo, 'commit', '-qm', 'delete util');
    run(repo, 'switch', '-q', 'main');
    commitOn(repo, 'agent-b', 'main', {
      'src/x.ts': "import { u } from './util';\nexport const x = u;\n",
    });
    const result = mapBranches(repo, 'main', 'agent-a', 'agent-b');
    expect(result.changedA).toEqual(['src/util.ts']);
    expect(result.interactions.map((i) => i.file)).toEqual(['src/x.ts']);
  });

  it('skips file names with control characters instead of crashing', () => {
    const repo = repoWith({ 'src/a.ts': 'export const a = 1;\n' });
    write(repo, { 'src/we\nird.ts': "import { a } from './a';\nexport const w = a;\n" });
    run(repo, 'add', '-A');
    run(repo, 'commit', '-qm', 'odd name');
    const map = buildMap(repo);
    expect(map.skipped.map((s) => s.reason)).toContain('File name contains control characters.');
    expect(map.files.map((f) => f.path)).toEqual(['src/a.ts']);
  });

  it('resolves tsconfig references, workspace packages and alias misses correctly', () => {
    const map = buildMap(
      repoWith({
        'tsconfig.json': JSON.stringify({
          files: [],
          references: [{ path: './tsconfig.app.json' }],
        }),
        'tsconfig.app.json': JSON.stringify({
          compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
        }),
        'src/lib.ts': 'export const lib = 1;\n',
        'src/app.ts':
          "import { lib } from '@/lib';\nimport { core } from '@acme/core';\nimport { gone } from '@/missing';\nexport const app = [lib, core, gone];\n",
        'packages/core/package.json': JSON.stringify({ name: '@acme/core', main: 'dist/index.js' }),
        'packages/core/src/index.ts': 'export const core = 1;\n',
      }),
    );
    const edges = map.edges.map((e) => `${e.from} -> ${e.to}`);
    expect(edges).toContain('src/app.ts -> src/lib.ts');
    expect(edges).toContain('src/app.ts -> packages/core/src/index.ts');
    expect(map.externals).toEqual([]);
    expect(map.unresolved).toEqual([{ from: 'src/app.ts', specifier: '@/missing' }]);
  });

  it('finds import-equals, template-literal imports and namespace calls', () => {
    const map = buildMap(
      repoWith({
        'src/c.ts': 'export function c() { return 1; }\n',
        'src/d.ts': 'export const d = 1;\n',
        'src/use.ts':
          "import x = require('./c');\nimport * as ns from './c';\nexport async function go() { await import(`./d`); return ns.c() + x.c(); }\n",
      }),
    );
    const edges = map.edges.map((e) => `${e.to} [${e.kinds}]`);
    expect(edges).toContain('src/c.ts [require,value]');
    expect(edges).toContain('src/d.ts [dynamic]');
    expect(map.calls.map((c) => `${c.from} -> ${c.to}`)).toContain('src/use.ts#go -> src/c.ts#c');
  });
});
