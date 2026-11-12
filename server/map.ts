import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, posix } from 'node:path';
import { Node, Project, SyntaxKind, ts, type SourceFile } from 'ts-morph';
import { InputError } from './engine';
import { commit, git, root } from './git';

/**
 * Deterministic repository map.
 *
 * Reads TypeScript sources from a pinned commit (never the working tree), parses them in an
 * in-memory project, and returns files, import edges, cross-file calls and structural metrics.
 * Nothing in the repository is executed, nothing is sent over the network, and the same commit
 * always produces the same map. AI labels, if any, are layered on later and never add edges.
 */

export const MAP_VERSION = 2;
export const mapLimits = {
  files: 2000,
  fileBytes: 100_000,
  totalBytes: 20_000_000,
  ms: 30_000,
};

export type EdgeKind = 'value' | 'type' | 'dynamic' | 'reexport' | 'require';
export interface MapFile {
  path: string;
  oid: string;
  bytes: number;
  test: boolean;
  exports: string[];
  functions: string[];
  /** A short hash of each top-level function's source, to tell which functions a change touched. */
  functionHashes: Record<string, string>;
  /** Every top-level declared name: functions, classes, interfaces, types, enums and variables. */
  declarations: string[];
  /** Invisible or bidirectional Unicode outside a leading BOM. A finding in its own right. */
  hiddenUnicode: boolean;
  /** Why this file must never be sent to an AI provider, if anything. */
  aiExcluded?: string;
}
export interface MapEdge {
  from: string;
  to: string;
  kinds: EdgeKind[];
}
export interface CallEdge {
  from: string; // path#function
  to: string; // path#function
  crossFile: boolean;
}
export interface FileMetrics {
  fanIn: number;
  fanOut: number;
  rank: number;
}
export interface RepoMap {
  version: number;
  commit: string;
  files: MapFile[];
  edges: MapEdge[];
  externals: { name: string; importers: string[] }[];
  unresolved: { from: string; specifier: string }[];
  /** Imports of tracked files the map does not analyze (styles, assets, JS without allowJs). */
  notAnalyzed: { from: string; specifier: string; target: string }[];
  calls: CallEdge[];
  folders: { path: string; files: string[] }[];
  metrics: Record<string, FileMetrics>;
  cycles: string[][];
  entryPoints: string[];
  skipped: { path: string; reason: string }[];
  warnings: string[];
}

const SOURCE = /\.(ts|tsx|mts|cts)$/;
const SCRIPT = /\.(js|jsx|mjs|cjs)$/;
const SKIP_DIR = /^(node_modules|dist|build|out|coverage|vendor|\.next|\.turbo|\.git)$/;
const SECRET_PATH =
  /(^|\/)(\.env[^/]*|\.npmrc|id_rsa[^/]*|credentials?[^/]*|secrets?[^/]*)$|\.(pem|key|p12|pfx)$/i;
// Known token formats and credential-shaped assignments. A file that matches is never sent to AI.
const SECRET_TOKENS = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/'"`]+:[^\s@/'"`]+@/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:password|passwd|secret|token|api_?key|access_?key|private_?key|client_?secret)['"]?\s*[:=]\s*['"`][^'"`\s]{8,}['"`]/i,
];
export const looksSecret = (text: string) => SECRET_TOKENS.some((r) => r.test(text));
/** Replace token-shaped text and long high-entropy string literals before anything leaves the machine. */
export function redactSecrets(text: string) {
  let out = text;
  for (const r of SECRET_TOKENS)
    out = out.replace(
      new RegExp(r.source, r.flags.includes('g') ? r.flags : r.flags + 'g'),
      '[redacted]',
    );
  return out.replace(/(['"`])([A-Za-z0-9+/=_-]{32,})\1/g, (whole, quote: string, body: string) =>
    entropy(body) > 4.2 ? `${quote}[redacted]${quote}` : whole,
  );
}
function entropy(text: string) {
  const counts = new Map<string, number>();
  for (const c of text) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.values()].reduce(
    (sum, n) => sum - (n / text.length) * Math.log2(n / text.length),
    0,
  );
}
// Invisible characters that can hide instructions or change how code reads: zero-width space, bidi
// marks and controls, word joiners (not ZWJ/ZWNJ, which emoji and many scripts need), soft hyphen, Mongolian vowel separator, Hangul filler, variation selectors,
// BOM (when not leading) and Unicode tag characters.
export const HIDDEN_SOURCE =
  '[\\u00AD\\u061C\\u180E\\u200B\\u200E\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\u3164\\uFEFF]|[\\u{E0000}-\\u{E007F}\\u{E0100}-\\u{E01EF}]';
const HIDDEN = new RegExp(HIDDEN_SOURCE, 'u');
/** Stripped before anything is sent to AI: the flagged set plus joiners and emoji variation selectors. */
export const STRIP_SOURCE = `${HIDDEN_SOURCE}|[\\u200C\\u200D\\uFE00-\\uFE0F]`;
const CONTROL = /[\u0000-\u001F\u007F]/;
const ROOT = '/repo';
const at = (path: string) => `${ROOT}/${path}`;
const rel = (abs: string) => (abs.startsWith(`${ROOT}/`) ? abs.slice(ROOT.length + 1) : null);
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Entry {
  path: string;
  mode: string;
  oid: string;
  size: number;
}
function run(repo: string, args: string[], input: string | undefined, maxBuffer: number) {
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', repo, ...args], {
      input,
      maxBuffer,
      timeout: 20000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new InputError(
      code === 'ENOBUFS'
        ? 'Git: the repository is too large to map.'
        : code === 'ETIMEDOUT'
          ? 'Git: reading the repository timed out.'
          : 'Git: unable to read the repository for the map.',
    );
  }
}
function listTree(repo: string, sha: string): Entry[] {
  return run(repo, ['ls-tree', '-r', '-z', '-l', '--full-tree', sha], undefined, 256_000_000)
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((row) => {
      const tab = row.indexOf('\t');
      const [mode, , oid, size] = row.slice(0, tab).trim().split(/\s+/);
      return { path: row.slice(tab + 1), mode, oid, size: Number(size) || 0 };
    });
}
export function readBlobs(repo: string, oids: string[]) {
  const out = new Map<string, string>();
  if (!oids.length) return out;
  const data = run(
    repo,
    ['cat-file', '--batch'],
    oids.join('\n') + '\n',
    mapLimits.totalBytes + oids.length * 128 + 1024,
  );
  let offset = 0;
  while (offset < data.length) {
    const newline = data.indexOf(0x0a, offset);
    const [oid, type, size] = data.subarray(offset, newline).toString('utf8').split(' ');
    const length = Number(size);
    if (type !== 'blob' || !Number.isFinite(length))
      throw new InputError('Git: unexpected object.');
    out.set(oid, data.subarray(newline + 1, newline + 1 + length).toString('utf8'));
    offset = newline + 1 + length + 1;
  }
  return out;
}

/** One tsconfig and the in-repo files it extends, outermost first, read as JSON data only. */
function configChain(tsconfig: Map<string, string>, start: string) {
  let path: string | undefined = start;
  const seen = new Set<string>();
  const chain: { dir: string; compilerOptions: Record<string, unknown> }[] = [];
  let references: string[] = [];
  while (path && tsconfig.has(path) && !seen.has(path) && seen.size < 5) {
    seen.add(path);
    const parsed = ts.parseConfigFileTextToJson(path, tsconfig.get(path) ?? '');
    const config = (parsed.config ?? {}) as {
      extends?: unknown;
      compilerOptions?: Record<string, unknown>;
      references?: unknown;
    };
    if (path === start && Array.isArray(config.references))
      references = config.references
        .map((r) => (r as { path?: unknown })?.path)
        .filter((r): r is string => typeof r === 'string')
        .map((r) => posix.normalize(posix.join(posix.dirname(start), r)))
        .map((r) => (r.endsWith('.json') ? r : `${r}/tsconfig.json`))
        .filter((r) => !r.startsWith('..'))
        .slice(0, 10);
    chain.unshift({ dir: posix.dirname(path), compilerOptions: config.compilerOptions ?? {} });
    path =
      typeof config.extends === 'string' && config.extends.startsWith('.')
        ? posix.normalize(
            posix.join(
              posix.dirname(path),
              config.extends.endsWith('.json') ? config.extends : `${config.extends}.json`,
            ),
          )
        : undefined;
    if (path?.startsWith('..')) path = undefined;
  }
  return { chain, references };
}

function compilerOptionsFrom(tsconfig: Map<string, string>) {
  // Data only: baseUrl, paths and allowJs. Plugins and anything executable are ignored.
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
  };
  // The root config plus the configs it references (Vite-style tsconfig.app.json, etc.).
  const root = configChain(tsconfig, 'tsconfig.json');
  const chain = [...root.chain, ...root.references.flatMap((r) => configChain(tsconfig, r).chain)];
  let baseUrl: string | undefined;
  const paths: Record<string, string[]> = {};
  for (const { dir, compilerOptions: c } of chain) {
    const base = typeof c.baseUrl === 'string' ? posix.normalize(posix.join(dir, c.baseUrl)) : dir;
    if (typeof c.baseUrl === 'string' && baseUrl === undefined) baseUrl = base;
    if (c.paths && typeof c.paths === 'object')
      for (const [k, v] of Object.entries(c.paths as Record<string, unknown>))
        if (Array.isArray(v))
          // Targets are stored relative to the repository root, then rebased below.
          paths[k] = v
            .filter((t): t is string => typeof t === 'string')
            .map((t) => posix.normalize(posix.join(base, t)));
    if (typeof c.allowJs === 'boolean') options.allowJs = c.allowJs;
  }
  if (baseUrl !== undefined)
    options.baseUrl = at(baseUrl === '.' ? '' : baseUrl).replace(/\/$/, '');
  if (Object.keys(paths).length) {
    const from = baseUrl ?? '.';
    options.paths = Object.fromEntries(
      Object.entries(paths).map(([k, v]) => [k, v.map((t) => `./${posix.relative(from, t)}`)]),
    );
    if (baseUrl === undefined) options.pathsBasePath = ROOT;
  }
  return options;
}

const isTest = (p: string) =>
  /(^|\/)(__tests__|tests?)\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);

function topLevelDeclarations(sf: SourceFile) {
  const names = new Set<string>();
  for (const s of sf.getStatements()) {
    if (Node.isVariableStatement(s)) s.getDeclarations().forEach((d) => names.add(d.getName()));
    else if (
      (Node.isFunctionDeclaration(s) ||
        Node.isClassDeclaration(s) ||
        Node.isInterfaceDeclaration(s) ||
        Node.isTypeAliasDeclaration(s) ||
        Node.isEnumDeclaration(s)) &&
      s.getName()
    )
      names.add(s.getName()!);
  }
  return [...names].sort(byString);
}
function functionHashes(sf: SourceFile) {
  const out: Record<string, string> = {};
  const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
  for (const statement of sf.getStatements()) {
    if (Node.isFunctionDeclaration(statement) && statement.getName())
      out[statement.getName()!] = hash(statement.getText());
    if (Node.isVariableStatement(statement))
      for (const d of statement.getDeclarations()) {
        const init = d.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init)))
          out[d.getName()] = hash(d.getText());
      }
  }
  return Object.fromEntries(Object.entries(out).sort(([x], [y]) => byString(x, y)));
}
function topLevelFunctions(sf: SourceFile) {
  const names: string[] = [];
  for (const statement of sf.getStatements()) {
    if (Node.isFunctionDeclaration(statement) && statement.getName())
      names.push(statement.getName()!);
    if (Node.isVariableStatement(statement))
      for (const d of statement.getDeclarations()) {
        const init = d.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init)))
          names.push(d.getName());
      }
  }
  return [...new Set(names)].sort(byString);
}
/** The top-level function a node belongs to, or undefined. Nested callbacks belong to their outer function. */
function ownerName(node: Node): string | undefined {
  let current: Node | undefined = node;
  let found: string | undefined;
  while (current && !Node.isSourceFile(current)) {
    const parent: Node | undefined = current.getParent();
    if (Node.isFunctionDeclaration(current) && parent && Node.isSourceFile(parent))
      found = current.getName();
    if (
      (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) &&
      parent &&
      Node.isVariableDeclaration(parent) &&
      Node.isVariableStatement(parent.getParent()?.getParent() ?? parent) &&
      Node.isSourceFile(parent.getParent()?.getParent()?.getParent() ?? parent)
    )
      found = parent.getName();
    current = parent;
  }
  return found;
}
function declarationName(node: Node): string | undefined {
  if (Node.isFunctionDeclaration(node)) return node.getName();
  if (Node.isVariableDeclaration(node)) return node.getName();
  return undefined;
}

export function buildMap(repo: string, ref = 'HEAD'): RepoMap {
  const started = Date.now();
  const top = root(repo);
  const sha = commit(top, ref);
  const entries = listTree(top, sha);
  const skipped: RepoMap['skipped'] = [];
  const warnings: string[] = [
    'Edges are static imports and statically resolvable calls at one commit. Callbacks, dynamic dispatch, conditions and runtime configuration are not modeled.',
  ];

  const tsconfigs = entries.filter(
    (e) => /(^|\/)tsconfig[^/]*\.json$/.test(e.path) && e.mode.startsWith('100'),
  );
  const packageJsons = entries.filter(
    (e) => /(^|\/)package\.json$/.test(e.path) && e.mode.startsWith('100'),
  );
  // Config files are data, read with their own bounds: shallowest first, at most 250 files and 4 MB.
  const depth = (p: string) => p.split('/').length;
  let configBytes = 0;
  const configs = [...tsconfigs.slice(0, 50), ...packageJsons]
    .filter(
      (e) => e.size <= mapLimits.fileBytes && !e.path.split('/').some((s) => SKIP_DIR.test(s)),
    )
    .sort((x, y) => depth(x.path) - depth(y.path) || byString(x.path, y.path))
    .slice(0, 250)
    .filter((e) => (configBytes += e.size) <= 4_000_000);
  const configText = readBlobs(
    top,
    configs.map((e) => e.oid),
  );
  const configByPath = new Map(configs.map((e) => [e.path, configText.get(e.oid) ?? '']));
  const options = compilerOptionsFrom(configByPath);

  const candidates: Entry[] = [];
  let total = 0;
  for (const e of entries.sort((a, b) => byString(a.path, b.path))) {
    const code = SOURCE.test(e.path) || (options.allowJs && SCRIPT.test(e.path));
    if (!code) continue;
    const reason = e.path.split('/').some((s) => SKIP_DIR.test(s))
      ? null // generated or vendored: ignored without noise
      : CONTROL.test(e.path)
        ? 'File name contains control characters.'
        : !['100644', '100755'].includes(e.mode)
          ? 'Symlinks and submodules are not analyzed.'
          : /\.d\.[cm]?ts$/.test(e.path)
            ? null
            : /\.min\.[cm]?js$/.test(e.path)
              ? null
              : e.size > mapLimits.fileBytes
                ? 'File exceeds the 100 KB analysis limit.'
                : candidates.length >= mapLimits.files
                  ? `Repository exceeds the ${mapLimits.files}-file map limit.`
                  : total + e.size > mapLimits.totalBytes
                    ? 'Repository exceeds the 20 MB map limit.'
                    : '';
    if (reason === null) continue;
    if (reason) {
      skipped.push({ path: e.path, reason });
      continue;
    }
    total += e.size;
    candidates.push(e);
  }
  const text = readBlobs(
    top,
    candidates.map((e) => e.oid),
  );

  const project = new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    compilerOptions: options,
  });
  const fs = project.getFileSystem();
  for (const [path, body] of configByPath)
    if (path.endsWith('package.json')) fs.writeFileSync(at(path), body);
  const sources = new Map<string, SourceFile>();
  for (const e of candidates)
    sources.set(
      e.path,
      project.createSourceFile(at(e.path), text.get(e.oid) ?? '', { overwrite: true }),
    );
  const known = new Set(sources.keys());

  const host: ts.ModuleResolutionHost = {
    fileExists: (p) => known.has(rel(p) ?? '') || configByPath.has(rel(p) ?? ''),
    readFile: (p) => {
      const r = rel(p);
      return r ? (configByPath.get(r) ?? (sources.get(r)?.getFullText() || undefined)) : undefined;
    },
    directoryExists: (d) => {
      const r = rel(d) ?? (d === ROOT ? '' : null);
      if (r === null) return false;
      return r === '' || [...known, ...configByPath.keys()].some((p) => p.startsWith(`${r}/`));
    },
    realpath: (p) => p,
    getCurrentDirectory: () => ROOT,
  };
  const cache = ts.createModuleResolutionCache(ROOT, (s) => s, options);
  const resolveSpecifier = (specifier: string, from: string) => {
    const result = ts.resolveModuleName(specifier, at(from), options, host, cache).resolvedModule;
    const target = result ? rel(result.resolvedFileName) : null;
    return target && known.has(target) ? target : null;
  };
  const packageName = (s: string) =>
    s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0];
  // Packages that live in this repository (workspaces) resolve to their source, not to npm.
  const workspaces = new Map<string, { dir: string; entries: string[] }>();
  for (const [path, body] of configByPath) {
    if (!path.endsWith('package.json') || path === 'package.json') continue;
    try {
      const pkg = JSON.parse(body) as Record<string, unknown>;
      if (typeof pkg.name !== 'string') continue;
      const dir = posix.dirname(path);
      const fields = [pkg.source, pkg.types, pkg.module, pkg.main].filter(
        (v): v is string => typeof v === 'string',
      );
      workspaces.set(pkg.name, {
        dir,
        entries: [
          ...fields.flatMap((f) => {
            const p = posix.normalize(posix.join(dir, f));
            return [
              p,
              p.replace(/\.[cm]?js$/, '.ts'),
              p.replace(/\.[cm]?js$/, '.tsx'),
              p.replace(/\.d\.ts$/, '.ts'),
            ];
          }),
          `${dir}/src/index.ts`,
          `${dir}/src/index.tsx`,
          `${dir}/index.ts`,
        ],
      });
    } catch {
      // Unparseable package.json files are reported below.
    }
  }
  const workspaceTarget = (specifier: string) => {
    const pkg = workspaces.get(packageName(specifier));
    if (!pkg) return null;
    const sub = specifier.slice(packageName(specifier).length + 1);
    const tries = sub
      ? [`${pkg.dir}/${sub}`, `${pkg.dir}/src/${sub}`].flatMap((b) => [
          `${b}.ts`,
          `${b}.tsx`,
          `${b}/index.ts`,
          b,
        ])
      : pkg.entries;
    return tries.find((t) => known.has(t)) ?? null;
  };
  const aliasPatterns = Object.keys(options.paths ?? {}).map(
    (k) => new RegExp(`^${k.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '.*')}$`),
  );

  const edges = new Map<string, Set<EdgeKind>>();
  const externals = new Map<string, Set<string>>();
  const unresolved = new Map<string, RepoMap['unresolved'][number]>();
  const notAnalyzed = new Map<string, RepoMap['notAnalyzed'][number]>();
  const tracked = new Set(entries.map((e) => e.path));
  const add = (from: string, specifier: string, kind: EdgeKind) => {
    const target = resolveSpecifier(specifier, from) ?? workspaceTarget(specifier);
    if (target) {
      if (target === from) return;
      const key = `${from}\0${target}`;
      edges.set(key, (edges.get(key) ?? new Set()).add(kind));
    } else if (
      !specifier.startsWith('.') &&
      !specifier.startsWith('/') &&
      !aliasPatterns.some((r) => r.test(specifier))
    ) {
      const name = specifier.startsWith('node:') ? specifier : packageName(specifier);
      externals.set(name, (externals.get(name) ?? new Set()).add(from));
    } else {
      const target = posix.normalize(posix.join(posix.dirname(from), specifier.replace(/^\//, '')));
      if (tracked.has(target))
        notAnalyzed.set(`${from}\0${specifier}`, { from, specifier, target });
      else unresolved.set(`${from}\0${specifier}`, { from, specifier });
    }
  };

  const files: MapFile[] = [];
  for (const [path, sf] of sources) {
    for (const d of sf.getImportDeclarations())
      add(path, d.getModuleSpecifierValue(), d.isTypeOnly() ? 'type' : 'value');
    for (const d of sf.getExportDeclarations()) {
      const s = d.getModuleSpecifierValue();
      if (s) add(path, s, d.isTypeOnly() ? 'type' : 'reexport');
    }
    for (const d of sf.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
      const ref = d.getModuleReference();
      if (Node.isExternalModuleReference(ref)) {
        const e = ref.getExpression();
        if (e && Node.isStringLiteral(e))
          add(path, e.getLiteralValue(), d.isTypeOnly() ? 'type' : 'require');
      }
    }
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const [arg] = call.getArguments();
      if (!arg || !(Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)))
        continue;
      const callee = call.getExpression();
      if (callee.getKind() === SyntaxKind.ImportKeyword)
        add(path, arg.getLiteralValue(), 'dynamic');
      else if (Node.isIdentifier(callee) && callee.getText() === 'require')
        add(path, arg.getLiteralValue(), 'require');
    }
    const body = sf.getFullText();
    files.push({
      path,
      oid: candidates.find((e) => e.path === path)!.oid,
      bytes: candidates.find((e) => e.path === path)!.size,
      test: isTest(path),
      exports: [...sf.getExportedDeclarations().keys()].sort(byString),
      functions: topLevelFunctions(sf),
      functionHashes: functionHashes(sf),
      declarations: topLevelDeclarations(sf),
      hiddenUnicode: HIDDEN.test(body.replace(/^\uFEFF/, '')),
      ...(SECRET_PATH.test(path)
        ? { aiExcluded: 'Path looks like a secret or credential file.' }
        : looksSecret(body)
          ? { aiExcluded: 'Content matches a known secret or token pattern.' }
          : {}),
    });
  }
  if (files.some((f) => f.hiddenUnicode))
    warnings.push(
      'Some files contain invisible or bidirectional Unicode characters. Review them before trusting what they appear to say.',
    );

  const calls = new Map<string, CallEdge>();
  if (Date.now() - started > mapLimits.ms)
    warnings.push('Time budget reached before call analysis; calls are omitted.');
  else
    for (const [path, sf] of sources) {
      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression();
        // Direct calls (f()) and calls through a namespace import (ns.f()).
        const name = Node.isIdentifier(callee)
          ? callee
          : Node.isPropertyAccessExpression(callee) && Node.isIdentifier(callee.getExpression())
            ? callee.getNameNode()
            : undefined;
        if (!name) continue;
        const owner = ownerName(call);
        if (!owner) continue;
        let symbol = name.getSymbol();
        if (symbol?.isAlias()) symbol = symbol.getAliasedSymbol() ?? symbol;
        const declaration = symbol?.getDeclarations().find((d) => declarationName(d));
        if (!declaration) continue;
        const targetPath = rel(declaration.getSourceFile().getFilePath());
        const targetName = declarationName(declaration);
        if (!targetPath || !known.has(targetPath) || !targetName) continue;
        const topLevel = Node.isFunctionDeclaration(declaration)
          ? Node.isSourceFile(declaration.getParent())
          : Node.isSourceFile(declaration.getParent()?.getParent()?.getParent());
        if (!topLevel || !topLevelFunctions(sources.get(targetPath)!).includes(targetName))
          continue;
        const from = `${path}#${owner}`,
          to = `${targetPath}#${targetName}`;
        if (from !== to) calls.set(`${from}\0${to}`, { from, to, crossFile: path !== targetPath });
      }
      if (Date.now() - started > mapLimits.ms) {
        warnings.push('Time budget reached during call analysis; calls are partial.');
        break;
      }
    }

  const edgeList: MapEdge[] = [...edges]
    .map(([key, kinds]) => {
      const [from, to] = key.split('\0');
      return { from, to, kinds: [...kinds].sort(byString) };
    })
    .sort((a, b) => byString(a.from, b.from) || byString(a.to, b.to));
  const paths = files.map((f) => f.path).sort(byString);
  const metrics = computeMetrics(paths, edgeList);
  const tests = new Set(files.filter((f) => f.test).map((f) => f.path));
  const declared = new Set<string>();
  for (const [path, body] of configByPath) {
    if (!path.endsWith('package.json')) continue;
    try {
      const pkg = JSON.parse(body) as { main?: unknown; bin?: unknown };
      const targets = [
        pkg.main,
        ...(typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {})),
      ];
      for (const t of targets)
        if (typeof t === 'string') {
          const p = posix.normalize(posix.join(posix.dirname(path), t));
          for (const c of [p, p.replace(/\.[cm]?js$/, '.ts'), p.replace(/\.[cm]?js$/, '.tsx')])
            if (known.has(c)) declared.add(c);
        }
    } catch {
      warnings.push(`Could not parse ${path}.`);
    }
  }
  const entryPoints = paths.filter(
    (p) => declared.has(p) || (metrics[p].fanIn === 0 && !tests.has(p)),
  );
  const folders = new Map<string, string[]>();
  for (const p of paths) {
    const d = dirname(p) === '.' ? '' : dirname(p);
    folders.set(d, [...(folders.get(d) ?? []), p]);
  }

  return {
    version: MAP_VERSION,
    commit: sha,
    files: files.sort((a, b) => byString(a.path, b.path)),
    edges: edgeList,
    externals: [...externals]
      .map(([name, importers]) => ({ name, importers: [...importers].sort(byString) }))
      .sort((a, b) => byString(a.name, b.name)),
    unresolved: [...unresolved.values()].sort(
      (a, b) => byString(a.from, b.from) || byString(a.specifier, b.specifier),
    ),
    notAnalyzed: [...notAnalyzed.values()].sort(
      (a, b) => byString(a.from, b.from) || byString(a.specifier, b.specifier),
    ),
    calls: [...calls.values()].sort((a, b) => byString(a.from, b.from) || byString(a.to, b.to)),
    folders: [...folders]
      .map(([path, fs]) => ({ path, files: fs }))
      .sort((a, b) => byString(a.path, b.path)),
    metrics,
    cycles: stronglyConnected(paths, edgeList),
    entryPoints,
    skipped,
    warnings,
  };
}

function computeMetrics(paths: string[], edges: MapEdge[]) {
  const out = new Map<string, string[]>(paths.map((p) => [p, []]));
  const fanIn = new Map<string, number>(paths.map((p) => [p, 0]));
  for (const e of edges) {
    out.get(e.from)!.push(e.to);
    fanIn.set(e.to, fanIn.get(e.to)! + 1);
  }
  // PageRank with importance flowing from importer to imported file.
  const n = paths.length || 1,
    d = 0.85;
  let rank = new Map(paths.map((p) => [p, 1 / n]));
  for (let i = 0; i < 40; i++) {
    const dangling = paths.filter((p) => !out.get(p)!.length).reduce((s, p) => s + rank.get(p)!, 0);
    const next = new Map(paths.map((p) => [p, (1 - d) / n + (d * dangling) / n]));
    for (const p of paths)
      for (const t of out.get(p)!)
        next.set(t, next.get(t)! + (d * rank.get(p)!) / out.get(p)!.length);
    rank = next;
  }
  return Object.fromEntries(
    paths.map((p) => [
      p,
      {
        fanIn: fanIn.get(p)!,
        fanOut: out.get(p)!.length,
        rank: Math.round(rank.get(p)! * 1e6) / 1e6,
      },
    ]),
  ) as Record<string, FileMetrics>;
}

function stronglyConnected(paths: string[], edges: MapEdge[]) {
  const next = new Map<string, string[]>(paths.map((p) => [p, []]));
  for (const e of edges) next.get(e.from)!.push(e.to);
  let index = 0;
  const idx = new Map<string, number>(),
    low = new Map<string, number>(),
    stack: string[] = [],
    on = new Set<string>(),
    out: string[][] = [];
  const visit = (v: string) => {
    // Iterative Tarjan to stay safe on deep import chains.
    const work: [string, number][] = [[v, 0]];
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    on.add(v);
    while (work.length) {
      const frame = work[work.length - 1];
      const [node, i] = frame;
      const targets = next.get(node)!;
      if (i < targets.length) {
        frame[1]++;
        const w = targets[i];
        if (!idx.has(w)) {
          idx.set(w, index);
          low.set(w, index++);
          stack.push(w);
          on.add(w);
          work.push([w, 0]);
        } else if (on.has(w)) low.set(node, Math.min(low.get(node)!, idx.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent)!, low.get(node)!));
      }
      if (low.get(node) === idx.get(node)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          on.delete(w);
          component.push(w);
        } while (w !== node);
        if (component.length > 1) out.push(component.sort(byString));
      }
    }
  };
  for (const p of paths) if (!idx.has(p)) visit(p);
  return out.sort((a, b) => byString(a[0], b[0]));
}

/** Files that changed between two maps, by blob identity. */
export function changedFiles(base: RepoMap, head: RepoMap) {
  const before = new Map(base.files.map((f) => [f.path, f.oid]));
  const after = new Map(head.files.map((f) => [f.path, f.oid]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((p) => before.get(p) !== after.get(p))
    .sort(byString);
}

export function diffMaps(base: RepoMap, head: RepoMap) {
  const key = (e: MapEdge) => `${e.from}\n${e.to}`;
  const b = new Set(base.edges.map(key)),
    h = new Set(head.edges.map(key));
  const top = (p: string) => p.split('/')[0];
  const addedEdges = head.edges.filter((e) => !b.has(key(e)));
  return {
    changed: changedFiles(base, head),
    addedFiles: head.files
      .filter((f) => !base.files.some((g) => g.path === f.path))
      .map((f) => f.path),
    removedFiles: base.files
      .filter((f) => !head.files.some((g) => g.path === f.path))
      .map((f) => f.path),
    addedEdges,
    removedEdges: base.edges.filter((e) => !h.has(key(e))),
    /** New dependencies between different top-level folders, e.g. UI code starting to import server code. */
    crossFolderAdded: addedEdges.filter(
      (e) => e.from.includes('/') && e.to.includes('/') && top(e.from) !== top(e.to),
    ),
  };
}

/**
 * Everything that transitively depends on the given files, with one shortest import path back
 * to a changed file as evidence for each.
 */
/** Breadth-first over importers: every file that transitively imports a seed, with one shortest path. */
function coneOver(edges: { from: string; to: string }[], seeds: string[]) {
  const importers = new Map<string, string[]>();
  for (const e of edges) importers.set(e.to, [...(importers.get(e.to) ?? []), e.from]);
  const path = new Map<string, string[]>();
  const queue = [...new Set(seeds)].sort(byString);
  for (const c of queue) path.set(c, [c]);
  for (let i = 0; i < queue.length; i++)
    for (const parent of [...new Set(importers.get(queue[i]) ?? [])].sort(byString))
      if (!path.has(parent)) {
        path.set(parent, [parent, ...path.get(queue[i])!]);
        queue.push(parent);
      }
  return path;
}

/**
 * Everything that transitively depends on the given files, with one shortest import path back
 * to a changed file as evidence for each.
 */
export function impactCone(map: RepoMap, changed: string[]) {
  return coneOver(
    map.edges,
    changed.filter((c) => map.files.some((f) => f.path === c)),
  );
}

/**
 * Where two branches' changes could meet: files that depend on something each side changed.
 * Cones are walked over the union of base, A and B imports, so a side that newly imports the
 * other side's change, or imports a file the other side deleted, is caught. Each result is a
 * review candidate with its import paths as evidence, not proof of a behavioral conflict.
 */
/**
 * Top-level functions a side added, removed or edited, as `path#name`. Uses per-function source
 * hashes, so a change elsewhere in the same file doesn't count against an untouched function.
 */
export function changedFunctions(base: RepoMap, head: RepoMap) {
  const before = new Map(base.files.map((f) => [f.path, f.functionHashes ?? {}]));
  const after = new Map(head.files.map((f) => [f.path, f.functionHashes ?? {}]));
  const out: string[] = [];
  for (const path of changedFiles(base, head)) {
    const x = before.get(path) ?? {},
      y = after.get(path) ?? {};
    for (const name of new Set([...Object.keys(x), ...Object.keys(y)]))
      if (x[name] !== y[name]) out.push(`${path}#${name}`);
  }
  return out.sort(byString);
}

export function possibleInteractions(base: RepoMap, a: RepoMap, b: RepoMap) {
  const changedA = changedFiles(base, a),
    changedB = changedFiles(base, b);
  // Function level first: callers that reach a function each side changed. Sharper than files,
  // and the union of all three call graphs catches a side that starts calling the other's change.
  const fnA = changedFunctions(base, a),
    fnB = changedFunctions(base, b);
  const calls = [...base.calls, ...a.calls, ...b.calls];
  const callConeA = coneOver(calls, fnA),
    callConeB = coneOver(calls, fnB);
  const live = new Set(
    [...a.files, ...b.files].flatMap((f) =>
      Object.keys(f.functionHashes ?? {}).map((n) => `${f.path}#${n}`),
    ),
  );
  const functionInteractions = [...callConeA.keys()]
    .filter((fn) => callConeB.has(fn) && live.has(fn))
    .map((fn) => ({ function: fn, viaA: callConeA.get(fn)!, viaB: callConeB.get(fn)! }))
    .sort(
      (x, y) =>
        x.viaA.length + x.viaB.length - (y.viaA.length + y.viaB.length) ||
        byString(x.function, y.function),
    );
  const union = [...base.edges, ...a.edges, ...b.edges];
  const coneA = coneOver(union, changedA),
    coneB = coneOver(union, changedB);
  const exists = new Set([...a.files, ...b.files].map((f) => f.path));
  return {
    changedA,
    changedB,
    changedFunctionsA: fnA,
    changedFunctionsB: fnB,
    functionInteractions,
    interactions: [...coneA.keys()]
      .filter((p) => coneB.has(p) && exists.has(p))
      .map((file) => ({ file, viaA: coneA.get(file)!, viaB: coneB.get(file)! }))
      // Closest meeting points first: where both changes first come together.
      .sort(
        (x, y) =>
          x.viaA.length + x.viaB.length - (y.viaA.length + y.viaB.length) ||
          byString(x.file, y.file),
      ),
  };
}

export function mapBranches(repo: string, base: string, a: string, b: string) {
  const maps = { base: buildMap(repo, base), a: buildMap(repo, a), b: buildMap(repo, b) };
  return {
    ...possibleInteractions(maps.base, maps.a, maps.b),
    diffA: diffMaps(maps.base, maps.a),
    diffB: diffMaps(maps.base, maps.b),
    maps,
  };
}
