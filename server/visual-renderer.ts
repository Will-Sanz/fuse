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
  text.replace(
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
export function renderVisual(spec: VisualSpec) {
  const shapes = spec.elements
    .map((e) => {
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
        if (lines(e.text, w, 18).length * 25 + lines(e.detail, w, 14).length * 21 > h + 3)
          throw new InputError('A visual text block is too small for its text.');
        return (
          textBlock(e.text, x, y + 20, w, 18, ink, 600) +
          textBlock(e.detail, x, y + 22 + lines(e.text, w, 18).length * 25, w, 14, '#667085')
        );
      }
      if (e.type === 'bar')
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${ink}"/>`;
      const titleLines = lines(e.text, w - 36, 17).length;
      if (titleLines * 24 + lines(e.detail, w - 36, 14).length * 21 + 32 > h)
        throw new InputError('A visual panel is too small for its text.');
      return (
        (e.type === 'circle'
          ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}"/>`
          : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" stroke="${stroke}"/>`) +
        textBlock(e.text, x + 18, y + 31, w - 36, 17, ink, 600) +
        textBlock(e.detail, x + 18, y + 37 + titleLines * 24, w - 36, 14, '#475467')
      );
    })
    .join('');
  const markers = Object.entries(colors)
    .map(
      ([tone, c]) =>
        `<marker id="arrow-${tone}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${c[2]}"/></marker>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500" viewBox="0 0 1000 500" role="img"><title>${escape(spec.title)}</title><desc>${escape(spec.summary)}</desc><defs>${markers}</defs><rect width="1000" height="500" fill="#ffffff"/><g font-family="Arial, Helvetica, sans-serif">${shapes}</g></svg>`;
}
export const visualPng = (spec: VisualSpec) =>
  new Resvg(renderVisual(spec), { fitTo: { mode: 'width', value: 1600 } }).render().asPng();
