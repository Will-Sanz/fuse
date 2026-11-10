import { Resvg } from '@resvg/resvg-js';
import type { VisualSpec } from '../shared/visual';
import { InputError } from './engine';

const colors = {
  neutral: ['#f5f6f8', '#cfd4dc', '#344054'],
  a: ['#f2eeff', '#c7b3f4', '#6941c6'],
  b: ['#eaf5ff', '#a8d2f0', '#175cd3'],
  warning: ['#fff6e6', '#f5ce83', '#9a6700'],
  success: ['#eaf8f0', '#a8ddbf', '#067647'],
};
const escape = (text: string) =>
  text
    // JSON strings can contain characters that are illegal in XML.
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(
      /[<>&"']/g,
      (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
    );
function lines(text: string, width: number, size: number) {
  const rows: string[] = [];
  const limit = Math.max(8, Math.floor(width / (size * 0.57)));
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!rows.length || rows.at(-1)!.length + word.length + 1 > limit) rows.push(word);
    else rows[rows.length - 1] += ` ${word}`;
  }
  return rows;
}
function textBlock(
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  color: string,
  weight = 400,
) {
  return lines(text, width, size)
    .map(
      (line, i) =>
        `<text x="${x}" y="${y + i * (size + 7)}" font-size="${size}" font-weight="${weight}" fill="${color}">${escape(line)}</text>`,
    )
    .join('');
}
/** Only our shapes and escaped text enter SVG. Model output cannot contain markup or URLs. */
function renderLegacyVisual(spec: VisualSpec) {
  const shapes = spec.elements
    .map((e, index) => {
      const [fill, stroke, ink] = colors[e.tone];
      const { x, y, width: w, height: h } = e;
      if (
        x + w < 0 ||
        x + w > 1000 ||
        y + h < 0 ||
        y + h > 500 ||
        (e.type !== 'arrow' && (w < 20 || h < 20))
      )
        throw new InputError('Visual elements must fit inside the 1000 × 500 canvas.');
      if (e.type === 'arrow')
        return `<path d="M${x} ${y} L${x + w} ${y + h}" fill="none" stroke="${ink}" stroke-width="2.5" marker-end="url(#arrow-${e.tone})"/>${textBlock(e.text, (x + x + w) / 2 + 8, (y + y + h) / 2 - 8, 180, 13, ink)}`;
      if (e.type === 'text') {
        const titleLines = lines(e.text, w, 18).length,
          detailLines = lines(e.detail, w, 14).length,
          requiredHeight = titleLines * 25 + detailLines * 21 - 3;
        if (requiredHeight > h)
          throw new InputError(
            `Visual element ${index} (text at ${x},${y}, width ${w}, height ${h}) needs height >= ${requiredHeight} for ${titleLines} title lines and ${detailLines} detail lines. Shorten its text or enlarge and reposition it within the canvas.`,
          );
        return (
          textBlock(e.text, x, y + 20, w, 18, ink, 600) +
          textBlock(e.detail, x, y + 22 + titleLines * 25, w, 14, '#667085')
        );
      }
      if (e.type === 'bar')
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${ink}"/>`;
      const titleLines = lines(e.text, w - 36, 17).length,
        detailLines = lines(e.detail, w - 36, 14).length,
        requiredHeight = titleLines * 24 + detailLines * 21 + 32;
      if (requiredHeight > h)
        throw new InputError(
          `Visual element ${index} (${e.type} at ${x},${y}, width ${w}, height ${h}) needs height >= ${requiredHeight} for ${titleLines} title lines and ${detailLines} detail lines. Shorten its text or enlarge and reposition it within the canvas.`,
        );
      return (
        (e.type === 'circle'
          ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}"/>`
          : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" stroke="${stroke}"/>`) +
        textBlock(e.text, x + 18, y + 31, w - 36, 17, ink, 600) +
        textBlock(e.detail, x + 18, y + 37 + titleLines * 24, w - 36, 14, '#475467')
      );
    })
    .join('');
  return canvas(spec, shapes, 'Arial, Helvetica, sans-serif');
}
function canvas(
  spec: VisualSpec,
  shapes: string,
  font: string,
  orientation = 'auto-start-reverse',
) {
  const markers = Object.entries(colors)
    .map(
      ([tone, c]) =>
        `<marker id="arrow-${tone}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="${orientation}"><path d="M0 0 L10 5 L0 10 z" fill="${c[2]}"/></marker>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500" viewBox="0 0 1000 500" role="img"><title>${escape(spec.title)}</title><desc>${escape(spec.summary)}</desc><defs>${markers}</defs><rect width="1000" height="500" fill="#ffffff"/><g font-family="${font}">${shapes}</g></svg>`;
}
type Box = { x: number; y: number; width: number; height: number; index: number };
const textWidth = (text: string, size: number) => Array.from(text).length * size * 0.6;
function technicalLines(text: string, width: number, size: number) {
  if (!text) return [];
  const columns = Math.max(1, Math.floor(width / (size * 0.6))),
    rows: string[] = [];
  for (const paragraph of text.split(/\r\n?|\n/)) {
    let row = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const letters = Array.from(word);
      if (letters.length > columns) {
        if (row) rows.push(row);
        while (letters.length > columns) rows.push(letters.splice(0, columns).join(''));
        row = letters.join('');
      } else if (row && Array.from(row).length + letters.length + 1 > columns) {
        rows.push(row);
        row = word;
      } else row += `${row ? ' ' : ''}${word}`;
    }
    rows.push(row);
  }
  return rows;
}
function technicalText(
  rows: string[],
  x: number,
  y: number,
  size: number,
  step: number,
  color: string,
  weight = 400,
) {
  return rows
    .map((line, i) =>
      line
        ? `<text x="${x}" y="${y + i * step}" font-size="${size}" font-weight="${weight}" fill="${color}" textLength="${textWidth(line, size)}" lengthAdjust="spacingAndGlyphs">${escape(line)}</text>`
        : '',
    )
    .join('');
}
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
function crossesNode(arrow: Box, node: Box) {
  let first = 0,
    last = 1;
  for (const [start, delta, minimum, maximum] of [
    [arrow.x, arrow.width, node.x + 0.5, node.x + node.width - 0.5],
    [arrow.y, arrow.height, node.y + 0.5, node.y + node.height - 0.5],
  ]) {
    if (!delta) {
      if (start <= minimum || start >= maximum) return false;
      continue;
    }
    const a = (minimum - start) / delta,
      b = (maximum - start) / delta;
    first = Math.max(first, Math.min(a, b));
    last = Math.min(last, Math.max(a, b));
    if (first >= last) return false;
  }
  return first < last;
}
function technicalLayout(spec: VisualSpec) {
  const nodes: Box[] = [],
    labels: Box[] = [];
  const layout = spec.elements.map((e, index) => {
    const box = { x: e.x, y: e.y, width: e.width, height: e.height, index };
    const fail = (reason: string): never => {
      throw new InputError(
        `Visual element ${index} (${e.type} at ${e.x},${e.y}, width ${e.width}, height ${e.height}): ${reason}`,
      );
    };
    if (
      e.x + e.width < 0 ||
      e.x + e.width > 1000 ||
      e.y + e.height < 0 ||
      e.y + e.height > 500 ||
      e.x < 0 ||
      e.y < 0 ||
      (e.type !== 'arrow' && (e.width < 20 || e.height < 20))
    )
      fail('must fit inside the 1000 × 500 canvas.');
    if (e.type === 'arrow') {
      if (e.detail) fail('arrow detail is not rendered; move it to a separate text element.');
      if (!e.text) return { e, box };
      const horizontal = Math.abs(e.width) >= Math.abs(e.height),
        rows = e.text.split(/\r\n?|\n/).map((row) => row.trim()),
        width = Math.max(...rows.map((row) => textWidth(row, 18))),
        height = rows.length * 25,
        label = {
          x: horizontal ? e.x + e.width / 2 - width / 2 : e.x + e.width / 2 + 12,
          y: horizontal ? e.y + e.height / 2 - height - 10 : e.y + e.height / 2 - height / 2,
          width,
          height,
          index,
        };
      if (horizontal && width > Math.abs(e.width) - 16)
        fail(
          `connector needs width >= ${Math.ceil(width + 16)} for its label; leave arrow text empty or widen the gap and reposition the nodes.`,
        );
      if (label.x < 0 || label.y < 0 || label.x + width > 1000 || label.y + height > 500)
        fail(
          'arrow label falls outside the canvas; reposition the connector or use a separate text element.',
        );
      labels.push(label);
      return { e, box, label, rows };
    }
    nodes.push(box);
    if (e.type === 'bar') {
      if (e.text || e.detail) fail('bar text is not rendered; use a separate text element.');
      return { e, box };
    }
    if (e.type === 'circle' && (e.text || e.detail))
      fail(
        'use a panel for labeled technical nodes so the text fits inside its rectangular bounds.',
      );
    const panel = e.type !== 'text',
      title = technicalLines(e.text, e.width - (panel ? 36 : 0), panel ? 22 : 24),
      detail = technicalLines(e.detail, e.width - (panel ? 36 : 0), 20),
      gap = title.length && detail.length ? 8 : 0,
      requiredHeight =
        (panel ? 36 : 0) + title.length * (panel ? 29 : 31) + detail.length * 27 + gap;
    if (requiredHeight > e.height)
      fail(
        `needs height >= ${requiredHeight} for ${title.length} title lines and ${detail.length} detail lines; shorten text or enlarge and reposition the element.`,
      );
    return { e, box, title, detail, gap };
  });
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      if (intersects(nodes[i], nodes[j]))
        throw new InputError(
          `Visual elements ${nodes[i].index} and ${nodes[j].index} overlap; separate their boxes.`,
        );
  for (let i = 0; i < labels.length; i++)
    for (const other of [...nodes, ...labels.slice(i + 1)])
      if (intersects(labels[i], other))
        throw new InputError(
          `Visual element ${labels[i].index} arrow label overlaps element ${other.index}; widen the connector gap, reposition the elements, or use an unlabeled arrow.`,
        );
  for (const { e, box } of layout)
    if (e.type === 'arrow')
      for (const node of nodes)
        if (crossesNode(box, node))
          throw new InputError(
            `Visual element ${box.index} arrow crosses element ${node.index}; connect box borders and route the arrow through empty space.`,
          );
  return layout;
}
/** New generations must fit; legacy saved diagrams retain their original renderer. */
export function validateVisualLayout(spec: VisualSpec) {
  technicalLayout(spec);
}
export function renderVisual(spec: VisualSpec & { layoutVersion?: 2 }) {
  if (spec.layoutVersion !== 2) return renderLegacyVisual(spec);
  const shapes = technicalLayout(spec)
    .map(({ e, title, detail, gap, label, rows }) => {
      const [fill, stroke, ink] = colors[e.tone];
      if (e.type === 'arrow')
        return `<path d="M${e.x} ${e.y} L${e.x + e.width} ${e.y + e.height}" fill="none" stroke="${ink}" stroke-width="2.5" marker-end="url(#arrow-${e.tone})"/>${label ? technicalText(rows!, label.x, label.y + 18, 18, 25, ink) : ''}`;
      if (e.type === 'bar')
        return `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="5" fill="${ink}"/>`;
      const panel = e.type !== 'text',
        pad = panel ? 18 : 0,
        titleSize = panel ? 22 : 24,
        titleStep = panel ? 29 : 31;
      const background = !panel
        ? ''
        : e.type === 'circle'
          ? `<ellipse cx="${e.x + e.width / 2}" cy="${e.y + e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}" fill="${fill}" stroke="${stroke}"/>`
          : `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="10" fill="${fill}" stroke="${stroke}"/>`;
      return (
        background +
        technicalText(title!, e.x + pad, e.y + pad + titleSize, titleSize, titleStep, ink, 600) +
        technicalText(
          detail!,
          e.x + pad,
          e.y + pad + title!.length * titleStep + gap! + 20,
          20,
          27,
          '#475467',
        )
      );
    })
    .join('');
  return canvas(spec, shapes, 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', 'auto');
}
export const visualPng = (spec: VisualSpec & { layoutVersion?: 2 }) =>
  new Resvg(renderVisual(spec), { fitTo: { mode: 'width', value: 1600 } }).render().asPng();
