import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InputError } from './engine';
import { commit } from './git';
import { LocalStore } from './local-store';
import {
  MAP_VERSION,
  buildMap,
  diffMaps,
  impactCone,
  possibleInteractions,
  type RepoMap,
} from './map';
import type { Review } from '../shared/review';

/** Maps are immutable per commit, so they are cached by SHA and analyzer version. */
export function cachedMap(repo: string, ref = 'HEAD'): RepoMap {
  const store = new LocalStore(repo);
  const sha = commit(store.repo, ref);
  mkdirSync(join(store.directory, 'maps'), { recursive: true });
  const name = `maps/${sha}.v${MAP_VERSION}.json`;
  if (existsSync(join(store.directory, name))) {
    try {
      const saved = JSON.parse(readFileSync(join(store.directory, name), 'utf8')) as RepoMap;
      if (saved.version === MAP_VERSION && saved.commit === sha) return saved;
    } catch {
      // A damaged cache entry is rebuilt below.
    }
  }
  const map = buildMap(store.repo, sha);
  store.write(name, map);
  return map;
}

export interface FolderNode {
  id: string;
  files: number;
  top: string;
  fanIn: number;
  fanOut: number;
}
export interface FolderEdge {
  from: string;
  to: string;
  imports: number;
}

/** Collapse files into folders so a whole repo fits one picture. */
export function folderKey(map: RepoMap) {
  const paths = map.files.map((f) => f.path);
  const at = (depth: number) => (p: string) => {
    const parts = p.split('/');
    return parts.length === 1
      ? '(root)'
      : parts.slice(0, Math.min(depth, parts.length - 1)).join('/');
  };
  const one = new Set(paths.map(at(1)));
  const counts = [...one].map((k) => paths.filter((p) => at(1)(p) === k).length);
  // A repo with nearly everything under one folder (src/) reads better one level deeper.
  return one.size < 3 || Math.max(...counts, 0) > paths.length * 0.6 ? at(2) : at(1);
}
export function folderGraph(map: RepoMap) {
  const key = folderKey(map);
  const nodes = new Map<string, FolderNode>();
  for (const f of map.files) {
    const id = key(f.path);
    const node = nodes.get(id) ?? { id, files: 0, top: f.path, fanIn: 0, fanOut: 0 };
    node.files++;
    if (map.metrics[f.path].rank > map.metrics[node.top].rank) node.top = f.path;
    nodes.set(id, node);
  }
  const edges = new Map<string, FolderEdge>();
  for (const e of map.edges) {
    const from = key(e.from),
      to = key(e.to);
    if (from === to) continue;
    const k = `${from}\n${to}`;
    edges.set(k, { from, to, imports: (edges.get(k)?.imports ?? 0) + 1 });
    nodes.get(from)!.fanOut++;
    nodes.get(to)!.fanIn++;
  }
  return {
    nodes: [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    edges: [...edges.values()].sort((a, b) => (a.from + a.to < b.from + b.to ? -1 : 1)),
    folderOf: key,
  };
}

/** A bounded overview for agents and people: never the whole map unless asked. */
export function mapSummary(map: RepoMap, limit = 12) {
  const tests = new Set(map.files.filter((f) => f.test).map((f) => f.path));
  const ranked = map.files
    .filter((f) => !tests.has(f.path))
    .sort(
      (a, b) => map.metrics[b.path].rank - map.metrics[a.path].rank || (a.path < b.path ? -1 : 1),
    );
  const graph = folderGraph(map);
  return {
    commit: map.commit,
    counts: {
      files: map.files.length,
      tests: tests.size,
      imports: map.edges.length,
      calls: map.calls.length,
      crossFileCalls: map.calls.filter((c) => c.crossFile).length,
      externals: map.externals.length,
      skipped: map.skipped.length,
      unresolved: map.unresolved.length,
    },
    startHere: ranked.slice(0, limit).map((f) => ({
      path: f.path,
      ...map.metrics[f.path],
      exports: f.exports.slice(0, 8),
    })),
    folders: graph.nodes,
    folderEdges: graph.edges,
    entryPoints: map.entryPoints,
    cycles: map.cycles,
    externals: map.externals.map((e) => e.name),
    hiddenUnicode: map.files.filter((f) => f.hiddenUnicode).map((f) => f.path),
    unresolved: map.unresolved,
    skipped: map.skipped,
    warnings: map.warnings,
  };
}

/** Everything about one file: what it uses, what uses it, and how far a change would reach. */
export function mapFocus(map: RepoMap, path: string) {
  const file = map.files.find((f) => f.path === path);
  if (!file) throw new InputError(`No analyzed file at ${path}. Use a repository-relative path.`);
  const cone = impactCone(map, [path]);
  cone.delete(path);
  return {
    file,
    metrics: map.metrics[path],
    imports: map.edges.filter((e) => e.from === path),
    importedBy: map.edges.filter((e) => e.to === path),
    callsOut: map.calls.filter((c) => c.from.startsWith(`${path}#`)),
    callsIn: map.calls.filter((c) => c.to.startsWith(`${path}#`) && c.crossFile),
    externals: map.externals.filter((e) => e.importers.includes(path)).map((e) => e.name),
    impact: {
      dependents: cone.size,
      paths: [...cone.values()]
        .sort((a, b) => a.length - b.length || (a[0] < b[0] ? -1 : 1))
        .slice(0, 20),
    },
    inCycle: map.cycles.find((c) => c.includes(path)) ?? null,
  };
}

/** The interactions nearest the changes: where the two sides first come together. */
export function firstMeetings<T extends { viaA: string[]; viaB: string[] }>(interactions: T[]) {
  const best = Math.min(...interactions.map((i) => i.viaA.length + i.viaB.length));
  return interactions.filter((i) => i.viaA.length + i.viaB.length === best);
}
export function branchOverlay(repo: string, base: string, a: string, b: string) {
  const maps = { base: cachedMap(repo, base), a: cachedMap(repo, a), b: cachedMap(repo, b) };
  return {
    commits: { base: maps.base.commit, a: maps.a.commit, b: maps.b.commit },
    ...possibleInteractions(maps.base, maps.a, maps.b),
    diffA: summarizeDiff(diffMaps(maps.base, maps.a)),
    diffB: summarizeDiff(diffMaps(maps.base, maps.b)),
    note: 'A possible interaction means a file depends on something each side changed. It is a review candidate with import paths as evidence, not proof of a behavioral conflict.',
    maps,
  };
}
function summarizeDiff(diff: ReturnType<typeof diffMaps>) {
  const edge = (e: { from: string; to: string }) => ({ from: e.from, to: e.to });
  return {
    changed: diff.changed,
    addedFiles: diff.addedFiles,
    removedFiles: diff.removedFiles,
    addedEdges: diff.addedEdges.map(edge),
    removedEdges: diff.removedEdges.map(edge),
    crossFolderAdded: diff.crossFolderAdded.map(edge),
  };
}

/**
 * The repository context around a saved review. Uses committed revisions only: worktree
 * sessions fall back to their HEAD commit, which the result says.
 */
export function reviewOverlay(review: Review) {
  const side = (s: Review['sources']['a']) => s.head;
  const notes: string[] = [];
  for (const [label, s] of [
    ['A', review.sources.a],
    ['B', review.sources.b],
  ] as const)
    if (s.ref.kind === 'worktree')
      notes.push(
        `Side ${label} is a worktree; its map uses the committed HEAD, not uncommitted edits.`,
      );
  const overlay = branchOverlay(
    review.repository,
    review.baseCommit,
    side(review.sources.a),
    side(review.sources.b),
  );
  return { ...overlay, notes };
}

export type { RepoMap };

export interface MapRequest {
  repo: string;
  ref?: string;
  focus?: string;
  base?: string;
  a?: string;
  b?: string;
  detail?: 'summary' | 'full';
}
/**
 * One entry point for the MCP tool, CLI and local HTTP API. Returns bounded data plus the
 * SVG of the folder-level picture. Never calls AI; labels already cached are attached.
 */
export async function mapView(request: MapRequest) {
  const { renderMap } = await import('./map-render');
  const { cachedLabels } = await import('./map-labels');
  const store = new LocalStore(request.repo);
  if (request.a || request.b) {
    if (!request.a || !request.b) throw new InputError('Pass both a and b to compare branches.');
    const a = commit(store.repo, request.a),
      b = commit(store.repo, request.b);
    const base = request.base
      ? commit(store.repo, request.base)
      : (await import('./git')).git(store.repo, ['merge-base', a, b]);
    const overlay = branchOverlay(store.repo, base, a, b);
    const { maps, ...rest } = overlay;
    const svg = renderMap(
      maps.base,
      {
        a: overlay.changedA,
        b: overlay.changedB,
        meet: firstMeetings(overlay.interactions).map((i) => i.file),
        labels: { meet: 'where both changes meet' },
      },
      'Where the two branches meet',
    );
    return {
      data: request.detail === 'full' ? overlay : { ...rest, summary: mapSummary(maps.base) },
      svg,
    };
  }
  const map = cachedMap(store.repo, request.ref || 'HEAD');
  const labels = cachedLabels(store.repo, map);
  if (request.focus) {
    const focus = mapFocus(map, request.focus);
    return {
      data: { commit: map.commit, ...focus, label: labels[request.focus] ?? null },
      svg: renderMap(
        map,
        {
          meet: [request.focus],
          a: focus.importedBy.map((e) => e.from),
          labels: { meet: 'this file', a: 'imports it' },
        },
        request.focus,
      ),
    };
  }
  return {
    data: request.detail === 'full' ? { ...map, labels } : { ...mapSummary(map), labels },
    svg: renderMap(map, {}),
  };
}
