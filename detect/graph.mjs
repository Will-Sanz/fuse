// Code graph for the LLM stage (llm.mjs). It loads the merged code (A and B
// merged in memory, no worktree) with ts-morph, finds the top-level
// declarations each side changed, and reports how A's changes connect to B's:
// one uses the other, or both use the same declaration or database table.
//
// Nodes are top-level statements in .ts files under src/, minus tests. Unnamed
// statements (e.g. router.put(...)) are named by their first line. Database
// tables are nodes too: `prisma.<table>` links a statement to db:<table>.
//
// depth 1 links changes that use each other or share a neighbor. depth 2 also
// links changes whose neighbors' neighbors meet, skipping widely used
// declarations (used by more than HUB_LIMIT others) as stepping stones.

import { spawnSync } from 'node:child_process';
import { Node, Project, SyntaxKind } from 'ts-morph';

const ROOT = 'src/';
const MAX_LINKS = 40;
const MAX_DECL_CHARS = 3_000;
const HUB_LIMIT = 10;

function git(repo, args, input) {
  const res = spawnSync('git', args, {
    cwd: repo,
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  return res;
}

function gitText(repo, args) {
  const res = git(repo, args);
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${res.stderr}`);
  return res.stdout.toString('utf8');
}

const isSource = (p) =>
  p.startsWith(ROOT) && p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.includes('/test/');

// Reads every source file in a tree with one `git cat-file --batch`.
function readTree(repo, tree, include = isSource) {
  const paths = gitText(repo, ['ls-tree', '-r', '--name-only', tree, '--', ROOT])
    .split('\n')
    .filter((p) => p && include(p));
  const res = git(repo, ['cat-file', '--batch'], paths.map((p) => `${tree}:${p}\n`).join(''));
  const out = res.stdout;
  const files = new Map();
  let at = 0;
  for (const p of paths) {
    const nl = out.indexOf(10, at);
    const size = Number(out.subarray(at, nl).toString().split(' ')[2]);
    files.set(p, out.subarray(nl + 1, nl + 1 + size).toString('utf8'));
    at = nl + 1 + size + 1;
  }
  return files;
}

function load(files) {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      target: 6,
      module: 1,
      moduleResolution: 2,
      esModuleInterop: true,
      strict: true,
    },
  });
  for (const [p, text] of files) project.createSourceFile(`/${p}`, text);
  return project;
}

const pathOf = (sf) => sf.getFilePath().slice(1);

function statementName(st) {
  if (Node.isVariableStatement(st))
    return st
      .getDeclarations()
      .map((d) => d.getName())
      .join(', ');
  if (Node.isExportAssignment(st)) return 'export default';
  if (st.getName?.()) return st.getName();
  return st.getText().split('\n')[0].slice(0, 80);
}

// Top-level statements worth tracking. Imports are not tracked themselves; a
// changed import counts as a change to the statements that use its names.
// Unnamed statements that share a first line (say two `router.get(` calls) are
// told apart by their order among those in the file: `#router.get( (2)`.
function statements(sf) {
  const seen = new Map();
  return sf
    .getStatements()
    .filter((st) => !Node.isImportDeclaration(st))
    .map((st) => {
      const name = statementName(st);
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      return {
        key: `${pathOf(sf)}#${name}${n > 1 ? ` (${n})` : ''}`,
        st,
        start: st.getStartLineNumber(),
        end: st.getEndLineNumber(),
      };
    });
}

// Changed line ranges per file from a zero-context diff: added lines in the
// new file and removed lines in the old one.
function changedRanges(repo, base, branch) {
  const diff = gitText(repo, ['diff', '-U0', `${base}...${branch}`, '--', ROOT]);
  const files = new Map();
  let oldPath, newPath;
  const entry = (p) => {
    if (!files.has(p)) files.set(p, { added: [], removed: [] });
    return files.get(p);
  };
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- ')) oldPath = line.slice(4).replace(/^a\//, '');
    else if (line.startsWith('+++ ')) newPath = line.slice(4).replace(/^b\//, '');
    else if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      const [os, oc, ns, nc] = [m[1], m[2] ?? '1', m[3], m[4] ?? '1'].map(Number);
      if (newPath !== '/dev/null')
        // A pure removal touches the statement around where it was.
        entry(newPath).added.push(nc ? [ns, ns + nc - 1] : [ns, ns + 1]);
      if (oc && oldPath !== '/dev/null') entry(oldPath).removed.push([os, os + oc - 1]);
    }
  }
  return files;
}

const overlaps = (s, ranges) => ranges.some(([from, to]) => s.start <= to && from <= s.end);

// Statements that use a name brought in by an import the ranges touch: an
// import redirected to another module changes what those statements call.
function importUsers(sf, ranges) {
  const names = new Set();
  for (const imp of sf.getImportDeclarations()) {
    const at = { start: imp.getStartLineNumber(), end: imp.getEndLineNumber() };
    if (!overlaps(at, ranges)) continue;
    const clause = imp.getImportClause();
    if (!clause) continue;
    if (clause.getDefaultImport()) names.add(clause.getDefaultImport().getText());
    const bindings = clause.getNamedBindings();
    if (bindings && Node.isNamespaceImport(bindings)) names.add(bindings.getName());
    // The local name, which is what the code uses: `b` in `import { a as b }`.
    else if (bindings)
      for (const n of bindings.getElements())
        names.add((n.getAliasNode() ?? n.getNameNode()).getText());
  }
  if (!names.size) return [];
  return statements(sf).filter((s) =>
    s.st.getDescendantsOfKind(SyntaxKind.Identifier).some((id) => names.has(id.getText())),
  );
}

// Keys of the top-level statements a side changed, including ones it deleted.
function changedKeys(repo, base, branch, baseProject, sideProject) {
  const keys = new Set();
  const sideKeys = new Set();
  for (const sf of sideProject.getSourceFiles())
    for (const s of statements(sf)) sideKeys.add(s.key);
  for (const [p, { added, removed }] of changedRanges(repo, base, branch)) {
    if (!isSource(p)) continue;
    const sf = sideProject.getSourceFile(`/${p}`);
    if (sf) {
      for (const s of statements(sf)) if (overlaps(s, added)) keys.add(s.key);
      for (const s of importUsers(sf, added)) keys.add(s.key);
    }
    const old = baseProject.getSourceFile(`/${p}`);
    if (old)
      for (const s of statements(old))
        if (overlaps(s, removed) && !sideKeys.has(s.key)) keys.add(s.key);
  }
  return keys;
}

// Edges between top-level statements of the merged code: N uses M when an
// identifier in N resolves to a declaration in M.
function edges(project) {
  const byNode = new Map();
  for (const sf of project.getSourceFiles()) for (const s of statements(sf)) byNode.set(s.st, s);
  const uses = new Map();
  const add = (from, to) => {
    if (from === to) return;
    if (!uses.has(from)) uses.set(from, new Set());
    uses.get(from).add(to);
  };
  const ownerOf = (node) => {
    let n = node;
    while (n && !byNode.has(n)) n = n.getParent();
    return n && byNode.get(n);
  };
  for (const s of byNode.values()) {
    for (const id of s.st.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const parent = id.getParent();
      // The prisma client itself would link every query to every other; the
      // table it is used on is the link.
      if (
        Node.isPropertyAccessExpression(parent) &&
        parent.getExpression() === id &&
        id.getText() === 'prisma'
      )
        continue;
      if (
        Node.isPropertyAccessExpression(parent) &&
        parent.getNameNode() === id &&
        parent.getExpression().getText() === 'prisma'
      ) {
        add(s.key, `db:${id.getText()}`);
        continue;
      }
      let symbol = id.getSymbol();
      if (!symbol) continue;
      if (symbol.isAlias()) symbol = symbol.getAliasedSymbol() ?? symbol;
      for (const decl of symbol.getDeclarations()) {
        const owner = ownerOf(decl);
        if (owner) add(s.key, owner.key);
      }
    }
  }
  return { uses, byKey: new Map([...byNode.values()].map((s) => [s.key, s])) };
}

function mergedTreeOf(repo, base, a, b) {
  const merge = git(repo, ['merge-tree', '--write-tree', `--merge-base=${base}`, a, b]);
  if (merge.status !== 0) throw new Error(`A and B do not merge cleanly:\n${merge.stdout}`);
  return merge.stdout.toString().split('\n')[0];
}

const changedFiles = (repo, base, branch) =>
  gitText(repo, ['diff', '--name-only', `${base}...${branch}`, '--'])
    .split('\n')
    .filter(Boolean);

// Ranks the files each side changed by how related they are to the other
// side's changes: 0 if the other side changed the same file, 1 if it imports
// or is imported by a file the other side changed, 2 otherwise. Imports are
// read from the merged code (tests included), looking through index.ts files
// that only re-export.
export function fileRanks({ repo, base, a, b }) {
  const project = load(readTree(repo, mergedTreeOf(repo, base, a, b), (p) => p.endsWith('.ts')));
  // imports: file -> files it imports or re-exports; importers: the reverse.
  const imports = new Map();
  const importers = new Map();
  const add = (map, from, to) => {
    if (!map.has(from)) map.set(from, new Set());
    map.get(from).add(to);
  };
  const barrels = new Set();
  for (const sf of project.getSourceFiles()) {
    const decls = [...sf.getImportDeclarations(), ...sf.getExportDeclarations()];
    for (const d of decls) {
      const target = d.getModuleSpecifierSourceFile();
      if (!target) continue;
      add(imports, pathOf(sf), pathOf(target));
      add(importers, pathOf(target), pathOf(sf));
    }
    const sts = sf.getStatements();
    if (sts.length && sts.every((st) => Node.isExportDeclaration(st))) barrels.add(pathOf(sf));
  }
  // A barrel passes an import through: importing it counts as importing what
  // it re-exports. Two files re-exported by the same barrel are not linked.
  const neighbors = (p) => {
    const out = new Set();
    for (const n of imports.get(p) ?? []) {
      out.add(n);
      if (barrels.has(n)) for (const m of imports.get(n) ?? []) out.add(m);
    }
    for (const n of importers.get(p) ?? []) {
      out.add(n);
      if (barrels.has(n)) for (const m of importers.get(n) ?? []) out.add(m);
    }
    out.delete(p);
    return out;
  };
  const rank = (mine, theirs) => {
    const theirSet = new Set(theirs);
    return new Map(
      mine.map((p) => [
        p,
        theirSet.has(p) ? 0 : [...neighbors(p)].some((n) => theirSet.has(n)) ? 1 : 2,
      ]),
    );
  };
  const filesA = changedFiles(repo, base, a);
  const filesB = changedFiles(repo, base, b);
  return { a: rank(filesA, filesB), b: rank(filesB, filesA) };
}

function cut(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n// [${text.length - max} more characters not shown]`;
}

// Builds the <related_code> text for a case. Returns plain text; the caller
// caps its total size.
export function buildGraph({ repo, base, a, b, depth = 1 }) {
  const mergedTree = mergedTreeOf(repo, base, a, b);

  const baseProject = load(readTree(repo, base));
  const changedA = changedKeys(repo, base, a, baseProject, load(readTree(repo, a)));
  const changedB = changedKeys(repo, base, b, baseProject, load(readTree(repo, b)));
  const { uses, byKey } = edges(load(readTree(repo, mergedTree)));

  const usedBy = new Map();
  for (const [from, tos] of uses)
    for (const to of tos) {
      if (!usedBy.has(to)) usedBy.set(to, new Set());
      usedBy.get(to).add(from);
    }
  const neighbors = (k) => new Set([...(uses.get(k) ?? []), ...(usedBy.get(k) ?? [])]);

  const links = [];
  const shown = new Set();
  for (const ka of changedA) {
    if (changedB.has(ka)) {
      links.push(`- both A and B changed ${ka}`);
      shown.add(ka);
    }
    for (const kb of changedB) {
      if (ka === kb) continue;
      if (uses.get(ka)?.has(kb)) links.push(`- A's ${ka} uses B's ${kb}`);
      else if (uses.get(kb)?.has(ka)) links.push(`- B's ${kb} uses A's ${ka}`);
      else continue;
      shown.add(ka).add(kb);
    }
  }
  const shared = new Map();
  for (const ka of changedA)
    for (const m of neighbors(ka)) {
      if (changedA.has(m) || changedB.has(m)) continue;
      for (const kb of changedB)
        if (kb !== ka && neighbors(kb).has(m)) {
          if (!shared.has(m)) shared.set(m, { a: new Set(), b: new Set() });
          shared.get(m).a.add(ka);
          shared.get(m).b.add(kb);
        }
    }
  for (const [m, { a: as, b: bs }] of shared) {
    links.push(`- A's ${[...as].join(', ')} and B's ${[...bs].join(', ')} both touch ${m}`);
    for (const k of [...as, ...bs]) shown.add(k);
    shown.add(m);
  }
  if (depth >= 2) {
    const isHub = (k) => (usedBy.get(k)?.size ?? 0) > HUB_LIMIT;
    // Declarations within two steps of k, each with the one it was reached
    // through (null when it is one step away).
    const reach = (k) => {
      const out = new Map();
      for (const n of neighbors(k)) out.set(n, null);
      for (const [n] of [...out]) {
        if (isHub(n)) continue;
        for (const m of neighbors(n)) if (m !== k && !out.has(m) && !isHub(m)) out.set(m, n);
      }
      return out;
    };
    const reachB = new Map([...changedB].map((kb) => [kb, reach(kb)]));
    const met = new Map();
    for (const ka of changedA) {
      const ra = reach(ka);
      for (const [kb, rb] of reachB) {
        if (kb === ka) continue;
        for (const [m, viaA] of ra) {
          if (!rb.has(m)) continue;
          const viaB = rb.get(m);
          // Both one step away was already reported above.
          if (viaA === null && viaB === null) continue;
          if (changedA.has(m) || changedB.has(m)) continue;
          if (!met.has(m)) met.set(m, { a: new Set(), b: new Set(), via: new Set() });
          const entry = met.get(m);
          entry.a.add(ka);
          entry.b.add(kb);
          for (const v of [viaA, viaB]) if (v) entry.via.add(v);
        }
        const viaA = ra.get(kb);
        if (viaA) {
          links.push(`- A's ${ka} reaches B's ${kb} through ${viaA}`);
          shown.add(ka).add(viaA).add(kb);
        }
      }
    }
    for (const [m, { a: as, b: bs, via }] of met) {
      links.push(
        `- A's ${[...as].join(', ')} and B's ${[...bs].join(
          ', ',
        )} meet at ${m} within two steps (through ${[...via].join(', ')})`,
      );
      for (const k of [...as, ...bs, ...via]) shown.add(k);
      shown.add(m);
    }
  }

  const lines = [
    'Top-level declarations each side changed, and how they connect in the merged code (from ts-morph; db:<table> means prisma.<table>).',
    '',
    `Changed by A: ${[...changedA].join('; ') || 'none'}`,
    `Changed by B: ${[...changedB].join('; ') || 'none'}`,
    '',
  ];
  if (!links.length) lines.push("No links found between A's and B's changes.");
  else {
    lines.push('Links:');
    lines.push(...links.slice(0, MAX_LINKS));
    if (links.length > MAX_LINKS)
      lines.push(`- [${links.length - MAX_LINKS} more links not shown]`);
    lines.push('', 'Linked declarations as they are in the merged code:');
    for (const k of shown) {
      const s = byKey.get(k);
      if (!s) continue;
      lines.push('', `// ${k}`, cut(s.st.getText(), MAX_DECL_CHARS));
    }
  }
  return lines.join('\n') + '\n';
}
