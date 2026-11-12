import { Resvg } from '@resvg/resvg-js';
import { folderGraph, type FolderNode } from './map-service';
import type { RepoMap } from './map';

const escape = (text: string) =>
  text
    // Characters that are illegal in XML.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF￾￿]/g, '')
    .replace(
      /[<>&"']/g,
      (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
    );
const clip = (text: string, max: number) =>
  text.length > max ? `…${text.slice(-(max - 1))}` : text;

export interface MapHighlight {
  a?: string[];
  b?: string[];
  meet?: string[];
  labels?: { a?: string; b?: string; meet?: string };
}
// Colors meet WCAG 1.4.11 (3:1) for graphics against the canvas.
const ink = '#182230',
  muted = '#475467',
  edge = '#667085',
  cycle = '#b54708',
  meetColor = '#dc6803';
const fills = {
  neutral: ['#ffffff', '#98a2b3'],
  a: ['#f4f0ff', '#9e77ed'],
  b: ['#eef7ff', '#53b1fd'],
  ab: ['#f6f4fb', '#7f8db0'],
};
const tag = { a: ['#ebe4ff', '#5925dc'], b: ['#dcefff', '#175cd3'] };

/** The map draws at most this many folders; deeper structure collapses into its top-level folder. */
export const MAX_FOLDERS = 40;
const MAX_SIDE = 8000;

/**
 * Columns left to right: importers sit left of what they import. Edges that point back against
 * that order (circular imports) are found by depth-first search and left out of the layering,
 * so layering always terminates with a compact, gap-free set of columns.
 */
function layout(nodes: FolderNode[], edges: { from: string; to: string }[]) {
  const out = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) out.get(e.from)!.push(e.to);
  const state = new Map<string, 1 | 2>();
  const back = new Set<string>();
  const order: string[] = [];
  for (const start of nodes.map((n) => n.id)) {
    if (state.has(start)) continue;
    const stack: [string, number][] = [[start, 0]];
    state.set(start, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const next = out.get(frame[0])![frame[1]++];
      if (next === undefined) {
        state.set(frame[0], 2);
        order.push(frame[0]);
        stack.pop();
      } else if (state.get(next) === 1) back.add(`${frame[0]}\n${next}`);
      else if (!state.has(next)) {
        state.set(next, 1);
        stack.push([next, 0]);
      }
    }
  }
  const layer = new Map(nodes.map((n) => [n.id, 0]));
  for (const id of order.reverse())
    for (const to of out.get(id)!)
      if (!back.has(`${id}\n${to}`)) layer.set(to, Math.max(layer.get(to)!, layer.get(id)! + 1));
  return { layer, back };
}

/** A deterministic folder-level picture of a map, with optional branch highlights by file path. */
export function renderMap(map: RepoMap, highlight: MapHighlight = {}) {
  const graph = folderGraph(map, MAX_FOLDERS);
  const toFolder = (paths: string[] = []) => new Set(paths.map(graph.folderOf));
  const a = toFolder(highlight.a),
    b = toFolder(highlight.b),
    meet = toFolder(highlight.meet);
  const fill = (id: string): keyof typeof fills =>
    a.has(id) && b.has(id) ? 'ab' : a.has(id) ? 'a' : b.has(id) ? 'b' : 'neutral';
  const { layer, back } = layout(graph.nodes, graph.edges);
  const columns = new Map<number, FolderNode[]>();
  for (const n of graph.nodes)
    columns.set(layer.get(n.id)!, [...(columns.get(layer.get(n.id)!) ?? []), n]);
  const lastColumn = Math.max(0, ...columns.keys());
  const W = 230,
    H = 64,
    gapX = 96,
    gapY = 20,
    left = 40;
  // Lanes above the boxes carry edges that skip a column, 10px apart so they stay distinct.
  const skipping = graph.edges.filter(
    (e) => !back.has(`${e.from}\n${e.to}`) && layer.get(e.to)! - layer.get(e.from)! > 1,
  ).length;
  const topY = 64 + Math.min(skipping, 12) * 10;
  const pos = new Map<string, { x: number; y: number }>();
  let rows = 0;
  for (const [col, nodes] of [...columns].sort((x, y) => x[0] - y[0])) {
    nodes.sort((x, y) => y.fanIn + y.fanOut - (x.fanIn + x.fanOut) || (x.id < y.id ? -1 : 1));
    nodes.forEach((n, i) =>
      pos.set(n.id, { x: left + col * (W + gapX), y: topY + i * (H + gapY) }),
    );
    rows = Math.max(rows, nodes.length);
  }
  const width = Math.min(MAX_SIDE, Math.max(720, left * 2 + (lastColumn + 1) * (W + gapX) - gapX));
  const legendItems = legend(
    graph.nodes.map((n) => fill(n.id)),
    meet.size > 0,
    back.size > 0,
    highlight,
  );
  const height = Math.min(
    MAX_SIDE,
    topY +
      Math.max(1, rows) * (H + gapY) +
      (back.size ? 40 : 12) +
      30 * legendItems.rows +
      (legendItems.rows ? 12 : 0),
  );
  // Spread several connectors across a box edge instead of stacking them on one point.
  const slot = (list: string[], id: string) =>
    H * (0.25 + (0.5 * (list.indexOf(id) + 1)) / (list.length + 1));
  const ins = new Map<string, string[]>(),
    outs = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (back.has(`${e.from}\n${e.to}`)) continue;
    ins.set(e.to, [...(ins.get(e.to) ?? []), e.from]);
    outs.set(e.from, [...(outs.get(e.from) ?? []), e.to]);
  }
  const byY = (list: string[]) =>
    list.sort((x, y) => pos.get(x)!.y - pos.get(y)!.y || pos.get(x)!.x - pos.get(y)!.x);
  ins.forEach(byY);
  outs.forEach(byY);
  let lane = 0;
  const edges = graph.edges
    .map((e) => {
      const s = pos.get(e.from)!,
        t = pos.get(e.to)!;
      const w = Math.min(4, 1.25 + Math.log2(e.imports) / 2);
      const label = `<title>${escape(`${e.from} imports ${e.to} (${e.imports} import${e.imports === 1 ? '' : 's'})`)}</title>`;
      if (back.has(`${e.from}\n${e.to}`)) {
        // Against the flow: part of a circular import. A dashed loop under the boxes.
        const x1 = s.x + W / 2 - 12,
          y1 = s.y + H,
          x2 = t.x + W / 2 + 12,
          y2 = t.y + H + 2,
          drop = Math.max(y1, y2) + 30;
        return `<path d="M${x1} ${y1} C${x1} ${drop} ${x2} ${drop} ${x2} ${y2}" fill="none" stroke="${cycle}" stroke-width="${w}" stroke-dasharray="6 5" marker-end="url(#arrow-cycle)">${label}</path>`;
      }
      const x1 = s.x + W,
        y1 = s.y + slot(outs.get(e.from)!, e.to),
        x2 = t.x - 2,
        y2 = t.y + slot(ins.get(e.to)!, e.from);
      if (t.x - s.x > W + gapX) {
        lane = Math.min(lane + 1, 12);
        const y = topY - 8 - lane * 10;
        return `<path d="M${x1} ${y1} C${x1 + 36} ${y1} ${x1 + 10} ${y} ${x1 + 46} ${y} L${x2 - 46} ${y} C${x2 - 10} ${y} ${x2 - 36} ${y2} ${x2} ${y2}" fill="none" stroke="${edge}" stroke-width="${w}" marker-end="url(#arrow)">${label}</path>`;
      }
      const mid = (x1 + x2) / 2;
      return `<path d="M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}" fill="none" stroke="${edge}" stroke-width="${w}" marker-end="url(#arrow)">${label}</path>`;
    })
    .join('');
  const parents = new Set(
    graph.nodes
      .filter((n) => graph.nodes.some((m) => m.id.startsWith(`${n.id}/`)))
      .map((n) => n.id),
  );
  const boxes = graph.nodes
    .map((n) => {
      const { x, y } = pos.get(n.id)!;
      const [bg, stroke] = fills[fill(n.id)];
      const isMeet = meet.has(n.id);
      const name =
        n.id === '(root)'
          ? 'Root files'
          : n.id === '(other)'
            ? 'Other folders'
            : `${clip(n.id, parents.has(n.id) ? 13 : 22)}/${parents.has(n.id) ? ' (top level)' : ''}`;
      const tags = (['a', 'b'] as const)
        .filter((k) => (k === 'a' ? a : b).has(n.id))
        .map((k, i) => {
          const [tagBg, tagInk] = tag[k];
          const tx = x + W - 14 - 22 * (a.has(n.id) && b.has(n.id) ? 2 - i : 1);
          return `<rect x="${tx}" y="${y + 10}" width="18" height="18" rx="4" fill="${tagBg}"/><text x="${tx + 9}" y="${y + 23}" text-anchor="middle" font-size="11" font-weight="700" fill="${tagInk}">${k.toUpperCase()}</text>`;
        })
        .join('');
      return `<g><rect x="${x}" y="${y}" width="${W}" height="${H}" rx="10" fill="${bg}" stroke="${isMeet ? meetColor : stroke}" stroke-width="${isMeet ? 3 : 1.5}"/><text x="${x + 14}" y="${y + 25}" font-size="15" font-weight="600" fill="${ink}">${escape(name)}</text><text x="${x + 14}" y="${y + 47}" font-size="13" fill="${muted}">${n.files} file${n.files === 1 ? '' : 's'}</text>${tags}<title>${escape(n.id)}</title></g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${edge}"/></marker><marker id="arrow-cycle" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${cycle}"/></marker></defs><rect width="100%" height="100%" fill="#fbfbfd"/><text x="${left}" y="34" font-size="13" fill="${muted}">Arrows point from a folder to the folders it imports. Thicker arrows carry more imports.</text>${edges}${boxes}${legendItems.svg(left, height - 30 * legendItems.rows - 4)}</svg>`;
}

function legend(
  used: (keyof typeof fills)[],
  hasMeet: boolean,
  hasCycle: boolean,
  highlight: MapHighlight,
) {
  const has = (k: keyof typeof fills) => used.includes(k);
  const swatchTag = (k: 'a' | 'b', label: string) => (x: number, y: number) =>
    `<rect x="${x}" y="${y}" width="18" height="18" rx="4" fill="${tag[k][0]}"/><text x="${x + 9}" y="${y + 13}" text-anchor="middle" font-size="11" font-weight="700" fill="${tag[k][1]}">${k.toUpperCase()}</text><text x="${x + 26}" y="${y + 13}" font-size="13" fill="${muted}">${escape(label)}</text>`;
  const entries: ((x: number, y: number) => string)[] = [];
  if (has('a') || has('ab')) entries.push(swatchTag('a', highlight.labels?.a ?? 'Changed by A'));
  if (has('b') || has('ab')) entries.push(swatchTag('b', highlight.labels?.b ?? 'Changed by B'));
  if (hasMeet)
    entries.push(
      (x, y) =>
        `<rect x="${x + 1}" y="${y + 1}" width="16" height="16" rx="4" fill="#ffffff" stroke="${meetColor}" stroke-width="3"/><text x="${x + 26}" y="${y + 13}" font-size="13" fill="${muted}">${escape(highlight.labels?.meet ?? 'Where the changes meet')}</text>`,
    );
  if (hasCycle)
    entries.push(
      (x, y) =>
        `<path d="M${x} ${y + 9} H${x + 18}" stroke="${cycle}" stroke-width="2" stroke-dasharray="5 4"/><text x="${x + 26}" y="${y + 13}" font-size="13" fill="${muted}">Circular import</text>`,
    );
  return {
    rows: Math.ceil(entries.length / 3),
    svg: (x: number, y: number) =>
      entries.map((e, i) => e(x + (i % 3) * 210, y + Math.floor(i / 3) * 30)).join(''),
  };
}

export const mapPng = (svg: string) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: 1600 } }).render().asPng();
