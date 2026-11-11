import { Resvg } from '@resvg/resvg-js';
import { folderGraph, type FolderNode } from './map-service';
import type { RepoMap } from './map';

const escape = (text: string) =>
  text
    // Characters that are illegal in XML.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/g, '')
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
const tones = {
  neutral: ['#ffffff', '#cfd4dc', '#344054'],
  a: ['#f2eeff', '#c7b3f4', '#6941c6'],
  b: ['#eaf5ff', '#a8d2f0', '#175cd3'],
  meet: ['#fff6e6', '#f5ce83', '#9a6700'],
  ab: ['#f2eeff', '#84adea', '#3e4784'],
};

/** Importers sit left of what they import, so a reader scans from entry points toward the core. */
function layers(nodes: FolderNode[], edges: { from: string; to: string }[]) {
  const layer = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const e of edges) {
      const next = layer.get(e.from)! + 1;
      if (next > layer.get(e.to)! && next < nodes.length) {
        layer.set(e.to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return layer;
}

/** A deterministic folder-level picture of a map, with optional branch highlights by file path. */
export function renderMap(map: RepoMap, highlight: MapHighlight = {}, title = '') {
  const graph = folderGraph(map);
  const toFolder = (paths: string[] = []) => new Set(paths.map(graph.folderOf));
  const a = toFolder(highlight.a),
    b = toFolder(highlight.b),
    meet = toFolder(highlight.meet);
  const tone = (id: string): keyof typeof tones =>
    meet.has(id)
      ? 'meet'
      : a.has(id) && b.has(id)
        ? 'ab'
        : a.has(id)
          ? 'a'
          : b.has(id)
            ? 'b'
            : 'neutral';
  const layer = layers(graph.nodes, graph.edges);
  const columns = new Map<number, FolderNode[]>();
  for (const n of graph.nodes)
    columns.set(layer.get(n.id)!, [...(columns.get(layer.get(n.id)!) ?? []), n]);
  const W = 230,
    H = 64,
    gapX = 90,
    gapY = 18,
    left = 40,
    topY = title ? 120 : 84;
  const pos = new Map<string, { x: number; y: number }>();
  let rows = 0;
  for (const [col, nodes] of [...columns].sort((x, y) => x[0] - y[0])) {
    nodes.sort((x, y) => y.fanIn + y.fanOut - (x.fanIn + x.fanOut) || (x.id < y.id ? -1 : 1));
    nodes.forEach((n, i) =>
      pos.set(n.id, { x: left + col * (W + gapX), y: topY + i * (H + gapY) }),
    );
    rows = Math.max(rows, nodes.length);
  }
  const width = Math.max(720, left * 2 + columns.size * W + (columns.size - 1) * gapX);
  const highlighted = graph.nodes.some((n) => tone(n.id) !== 'neutral');
  const height = topY + Math.max(1, rows) * (H + gapY) + (highlighted ? 64 : 40);
  // Spread several connectors across a box edge instead of stacking them on one point.
  const slot = (list: string[], id: string) =>
    H * (0.3 + (0.4 * (list.indexOf(id) + 1)) / (list.length + 1));
  const ins = new Map<string, string[]>(),
    outs = new Map<string, string[]>();
  for (const e of graph.edges) {
    ins.set(e.to, [...(ins.get(e.to) ?? []), e.from]);
    outs.set(e.from, [...(outs.get(e.from) ?? []), e.to]);
  }
  const byY = (list: string[]) =>
    list.sort((x, y) => pos.get(x)!.y - pos.get(y)!.y || (x < y ? -1 : 1));
  ins.forEach(byY);
  outs.forEach(byY);
  let lane = 0;
  const edges = graph.edges
    .map((e) => {
      const s = pos.get(e.from)!,
        t = pos.get(e.to)!;
      const w = Math.min(4, 1 + Math.log2(e.imports) / 2);
      if (t.x > s.x) {
        const x1 = s.x + W,
          y1 = s.y + slot(outs.get(e.from)!, e.to),
          x2 = t.x - 2,
          y2 = t.y + slot(ins.get(e.to)!, e.from),
          mid = (x1 + x2) / 2;
        if (t.x - s.x > W + gapX) {
          // Skips a column: travel in a lane above the boxes so it never hides behind one.
          lane -= 5;
          const y = topY - 14 + lane;
          return `<path d="M${x1} ${y1} C${x1 + 36} ${y1} ${x1 + 10} ${y} ${x1 + 46} ${y} L${x2 - 46} ${y} C${x2 - 10} ${y} ${x2 - 36} ${y2} ${x2} ${y2}" fill="none" stroke="#98a2b3" stroke-opacity="0.6" stroke-width="${w}" marker-end="url(#arrow)"><title>${escape(`${e.from}/ imports ${e.to}/ (${e.imports})`)}</title></path>`;
        }
        return `<path d="M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}" fill="none" stroke="#98a2b3" stroke-opacity="0.85" stroke-width="${w}" marker-end="url(#arrow)"><title>${escape(`${e.from}/ imports ${e.to}/ (${e.imports})`)}</title></path>`;
      }
      // Same column or backwards (part of a cycle): a dashed loop under the boxes.
      const x1 = s.x + W / 2,
        y1 = s.y + H,
        x2 = t.x + W / 2 + 12,
        y2 = t.y + H + 4,
        drop = Math.max(y1, y2) + 28;
      return `<path d="M${x1} ${y1} C${x1} ${drop} ${x2} ${drop} ${x2} ${y2}" fill="none" stroke="#f79009" stroke-width="${w}" stroke-dasharray="6 5" marker-end="url(#arrow-warn)"/>`;
    })
    .join('');
  const boxes = graph.nodes
    .map((n) => {
      const { x, y } = pos.get(n.id)!;
      const [fill, stroke, ink] = tones[tone(n.id)];
      const name = n.id === '(root)' ? 'repository root' : n.id;
      return `<rect x="${x}" y="${y}" width="${W}" height="${H}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><text x="${x + 14}" y="${y + 25}" font-size="16" font-weight="600" fill="${ink}">${escape(clip(name, 24))}/</text><text x="${x + 14}" y="${y + 47}" font-size="13" fill="#667085">${n.files} file${n.files === 1 ? '' : 's'}</text>`;
    })
    .join('');
  const used = new Set(graph.nodes.map((n) => tone(n.id)));
  const legend = (
    [
      ['a', highlight.labels?.a ?? 'changed by A'],
      ['b', highlight.labels?.b ?? 'changed by B'],
      ['ab', 'changed by A and B'],
      ['meet', highlight.labels?.meet ?? 'both sides reach here'],
    ] as const
  )
    .filter(([k]) => used.has(k))
    .map(([k, label], i) => {
      const [fill, stroke] = tones[k];
      return `<rect x="${left + i * 190}" y="${height - 38}" width="14" height="14" rx="3" fill="${fill}" stroke="${stroke}"/><text x="${left + i * 190 + 22}" y="${height - 26}" font-size="13" fill="#475467">${label}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#98a2b3"/></marker><marker id="arrow-warn" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#f79009"/></marker></defs><rect width="100%" height="100%" fill="#fbfbfd"/>${title ? `<text x="${left}" y="44" font-size="22" font-weight="600" fill="#182230">${escape(title)}</text>` : ''}<text x="${left}" y="${title ? 70 : 30}" font-size="13" fill="#667085">Arrows point from a folder to the folders it imports.</text>${edges}${boxes}${legend}</svg>`;
}

export const mapPng = (svg: string) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: 1600 } }).render().asPng();
