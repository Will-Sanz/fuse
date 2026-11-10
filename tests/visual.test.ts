import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { createDemo } from '../server/demo';
import { generateVisual, visualContext } from '../server/visual-ai';
import { runOpenAiVisual as runVisualModel } from '../server/visual-provider';
import { renderVisual, validateVisualLayout, visualPng } from '../server/visual-renderer';
import { checkoutVisual, shippingVisual } from '../shared/demo-visuals';
import { actionDecision } from '../shared/visual';
import { applyReview, decide, inspect, preview } from '../server/local';
import { git } from '../server/git';
import { LocalStore } from '../server/local-store';
import { createReviewApp } from '../server/review-server';
import type { VisualSpec } from '../shared/visual';
import { Resvg } from '@resvg/resvg-js';
const dirs: string[] = [];
function fixture(scenario: 'checkout' | 'shipping' = 'checkout', merge = false) {
  const dir = mkdtempSync(join(tmpdir(), 'fuse-visual-test-'));
  dirs.push(dir);
  return createDemo(join(dir, 'fixture'), false, { scenario, merge, presentation: true });
}
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const generatedVisual = (spec: VisualSpec): VisualSpec => ({
  ...spec,
  elements: [
    {
      type: 'panel',
      x: 40,
      y: 40,
      width: 400,
      height: 160,
      text: 'Changed function',
      detail: 'Input → output',
      tone: 'a',
    },
    {
      type: 'panel',
      x: 550,
      y: 40,
      width: 400,
      height: 160,
      text: 'Caller',
      detail: 'Review the shared value',
      tone: 'b',
    },
  ],
});
const answer = (spec = generatedVisual(checkoutVisual)) => ({
  spec,
  model: 'test-model',
  responseId: 'test-response',
});
describe('custom visual explanations', () => {
  it('keeps legacy rendering and rejects the short combined-arrow label instead of crossing a box', () => {
    const spec = generatedVisual(checkoutVisual);
    spec.elements = [
      { type: 'panel', x: 40, y: 100, width: 400, height: 160, text: 'A', detail: '', tone: 'a' },
      { type: 'panel', x: 480, y: 100, width: 400, height: 160, text: 'B', detail: '', tone: 'b' },
      {
        type: 'arrow',
        x: 440,
        y: 180,
        width: 40,
        height: 0,
        text: 'combined',
        detail: '',
        tone: 'neutral',
      },
    ];
    const legacy = renderVisual(spec);
    expect(legacy).toContain('<text x="468" y="172" font-size="13"');
    expect(() => validateVisualLayout(spec)).toThrow('connector needs width >= 103');
    expect(renderVisual(spec)).toBe(legacy);
    spec.elements[2].text = '';
    expect(() => validateVisualLayout(spec)).not.toThrow();
    spec.elements[1].x = 600;
    spec.elements[2].width = 160;
    spec.elements[2].text = 'combined';
    const svg = renderVisual({ ...spec, layoutVersion: 2 });
    expect(svg).toContain('x="476.8" y="163" font-size="18"');
    spec.elements.push({
      type: 'panel',
      x: 480,
      y: 170,
      width: 60,
      height: 60,
      text: '',
      detail: '',
      tone: 'neutral',
    });
    expect(() => validateVisualLayout(spec)).toThrow('arrow crosses element 3');
    spec.elements = [
      {
        type: 'circle',
        x: 40,
        y: 40,
        width: 400,
        height: 160,
        text: 'shippingFee',
        detail: 'subtotalCents',
        tone: 'b',
      },
    ];
    expect(renderVisual(spec)).toContain('<ellipse');
    expect(() => validateVisualLayout(spec)).toThrow('use a panel for labeled technical nodes');
  });
  it('preserves code line breaks and renders long identifiers inside their declared pixel bounds', () => {
    const spec = generatedVisual(checkoutVisual);
    spec.elements = [
      {
        type: 'text',
        x: 40,
        y: 40,
        width: 300,
        height: 120,
        text: 'shippingFee',
        detail: 'subtotalCents\ncouponCents',
        tone: 'neutral',
      },
    ];
    const svg = renderVisual({ ...spec, layoutVersion: 2 });
    expect(svg).toContain('y="99" font-size="20"');
    expect(svg).toContain('y="126" font-size="20"');
    expect(svg).toContain('>subtotalCents</text>');
    expect(svg).toContain('>couponCents</text>');
    expect(renderVisual(spec)).toContain('subtotalCents couponCents');
    spec.elements = [
      {
        type: 'text',
        x: 40,
        y: 40,
        width: 144,
        height: 200,
        text: 'merchandiseTotal(cart)',
        detail: 'originalSubtotal\ncouponCents',
        tone: 'neutral',
      },
    ];
    const image = new Resvg(renderVisual({ ...spec, layoutVersion: 2 })).render();
    const pixels = image.pixels;
    let ink = 0,
      minimumX = image.width,
      minimumY = image.height,
      maximumX = 0,
      maximumY = 0;
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        const pixel = (y * image.width + x) * 4;
        if (pixels[pixel] < 220 && pixels[pixel + 1] < 220 && pixels[pixel + 2] < 220) {
          ink++;
          minimumX = Math.min(minimumX, x);
          maximumX = Math.max(maximumX, x);
          minimumY = Math.min(minimumY, y);
          maximumY = Math.max(maximumY, y);
        }
      }
    expect(ink).toBeGreaterThan(200);
    expect(minimumX).toBeGreaterThanOrEqual(40);
    expect(maximumX).toBeLessThanOrEqual(184);
    expect(minimumY).toBeGreaterThanOrEqual(40);
    expect(maximumY).toBeLessThanOrEqual(240);
    expect(image.asPng().subarray(1, 4).toString()).toBe('PNG');
  });
  it('rasterizes technical arrowheads in all four connector directions', () => {
    const spec = generatedVisual(checkoutVisual);
    spec.elements = [
      { type: 'arrow', x: 50, y: 50, width: 0, height: 120, text: '', detail: '', tone: 'neutral' },
      {
        type: 'arrow',
        x: 400,
        y: 300,
        width: -120,
        height: 0,
        text: '',
        detail: '',
        tone: 'neutral',
      },
      {
        type: 'arrow',
        x: 600,
        y: 50,
        width: 120,
        height: 0,
        text: '',
        detail: '',
        tone: 'neutral',
      },
      {
        type: 'arrow',
        x: 900,
        y: 300,
        width: 0,
        height: -120,
        text: '',
        detail: '',
        tone: 'neutral',
      },
    ];
    const image = new Resvg(renderVisual({ ...spec, layoutVersion: 2 })).render(),
      pixels = image.pixels;
    const red = (x: number, y: number) => pixels[(y * image.width + x) * 4];
    for (const [baseX, baseY, tipSideX, tipSideY] of [
      [45, 157, 45, 170],
      [292, 295, 280, 295],
      [707, 45, 720, 45],
      [895, 192, 895, 180],
    ]) {
      expect(red(baseX, baseY)).toBeLessThan(100);
      expect(red(tipSideX, tipSideY)).toBe(255);
    }
    expect(renderVisual(spec)).toContain('orient="auto-start-reverse"');
  });
  it('renders distinct path and threshold diagrams as safe SVG and real PNG', () => {
    for (const spec of [checkoutVisual, shippingVisual]) {
      expect(renderVisual(spec)).toContain(spec.elements[0].text.replaceAll('&', '&amp;'));
      expect(visualPng(spec).subarray(1, 4).toString()).toBe('PNG');
    }
    const injected = structuredClone(checkoutVisual);
    injected.title = '<script>bad</script>';
    injected.elements[0].text = '<script>';
    const svg = renderVisual(injected);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    injected.elements[0].width = 1000;
    expect(() => renderVisual(injected)).toThrow('fit inside');
  });
  it('removes XML-invalid characters from model text while preserving Unicode and safe markup', () => {
    const spec = structuredClone(checkoutVisual);
    spec.title = 'Coupon\u0001\ud800\ufffe & shipping 🚚';
    spec.elements[0].text = 'Safe\u0000 <text>';
    const svg = renderVisual(spec);
    expect(svg).toContain('Coupon &amp; shipping 🚚');
    expect(svg).toContain('Safe &lt;text&gt;');
    expect(svg).not.toMatch(/[\u0000\u0001\ud800\ufffe]/);
    expect(visualPng(spec).subarray(1, 4).toString()).toBe('PNG');
  });
  it('sends the selected model and strict schema to the API and handles provider failures', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('FUSE_AI_MODEL', 'gpt-6-luna');
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          id: 'response-1',
          model: 'gpt-6-luna',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(checkoutVisual) }],
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await runVisualModel('Explain this code');
    expect(result.spec).toEqual(checkoutVisual);
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent.model).toBe('gpt-6-luna');
    expect(sent.store).toBe(false);
    expect(sent.text.format.strict).toBe(true);
    expect(sent.tools).toBeUndefined();
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 }),
    );
    await expect(runVisualModel('test')).rejects.toThrow('OpenAI 401');
    vi.stubEnv('OPENAI_API_KEY', '');
    await expect(runVisualModel('test')).rejects.toThrow('OPENAI_API_KEY');
  });
  it('grounds the visual in codebase context, persists provenance, caches, and regenerates', async () => {
    const d = fixture();
    const model = vi.fn().mockResolvedValue(answer());
    const context = visualContext(d.review, d.review.files[0]);
    expect(context.context.some((c) => c.path === 'README.md')).toBe(true);
    expect(context.change.original).toContain('validateBody');
    let r = await generateVisual(d.repo, d.review.id, {}, model);
    expect(r.visual?.origin).toBe('ai');
    expect(r.visual?.responseId).toBe('test-response');
    expect(r.visual?.contextFiles).toContain('checkout.test.mjs');
    expect(model.mock.calls[0][0]).toContain('Your order is incomplete');
    r = await generateVisual(d.repo, r.id, {}, model);
    expect(model).toHaveBeenCalledTimes(1);
    await generateVisual(d.repo, r.id, { regenerate: true }, model);
    expect(model).toHaveBeenCalledTimes(2);
  });
  it('repairs invalid layout once, refuses unsupported choices and concurrent review changes', async () => {
    const d = fixture('shipping');
    const model = vi.fn().mockResolvedValue(answer(generatedVisual(checkoutVisual)));
    await expect(generateVisual(d.repo, d.review.id, {}, model)).rejects.toThrow(
      'supported action',
    );
    expect(model).toHaveBeenCalledTimes(2);
    const repair = vi
      .fn()
      .mockResolvedValueOnce(answer(generatedVisual(checkoutVisual)))
      .mockResolvedValueOnce(answer(generatedVisual(shippingVisual)));
    await expect(generateVisual(d.repo, d.review.id, {}, repair)).resolves.toHaveProperty(
      'visual.metaphor',
      shippingVisual.metaphor,
    );
    const r = new LocalStore(d.repo).get(d.review.id);
    await expect(
      generateVisual(d.repo, r.id, { regenerate: true }, async () => {
        decide(d.repo, r.id, r.revision, 'shipping.ts', r.files[0].analysis.conflicts[0].id, {
          choice: 'a',
          note: 'Use net basket value.',
        });
        return answer(generatedVisual(shippingVisual));
      }),
    ).rejects.toThrow('Review changed');
  });
  it('repairs undersized text from measured feedback and never saves an invalid final layout', async () => {
    const d = fixture();
    const invalid = generatedVisual(checkoutVisual);
    invalid.elements[0] = {
      type: 'text',
      x: 24,
      y: 24,
      width: 240,
      height: 20,
      text: 'A useful heading',
      detail: 'A short explanation',
      tone: 'neutral',
    };
    const model = vi.fn(async (prompt: string) => {
      const fixed = structuredClone(invalid);
      const minimum = prompt.match(
        /Visual element 0 \(text at 24,24, width 240, height 20\): needs height >= (\d+)/,
      );
      if (minimum) fixed.elements[0].height = Number(minimum[1]);
      return answer(fixed);
    });
    const r = await generateVisual(d.repo, d.review.id, {}, model);
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[0][0]).toContain('0.6');
    expect(model.mock.calls[1][0]).toContain(
      'needs height >= 66 for 1 title lines and 1 detail lines',
    );
    expect(r.visual?.elements[0].height).toBe(66);
    expect(() => renderVisual(r.visual!)).not.toThrow();
    const saved = new LocalStore(d.repo).get(r.id);
    const rejected = vi.fn().mockResolvedValue(answer(invalid));
    await expect(generateVisual(d.repo, r.id, { regenerate: true }, rejected)).rejects.toThrow(
      'Generated visual was invalid: Visual element 0',
    );
    expect(rejected).toHaveBeenCalledTimes(2);
    expect(new LocalStore(d.repo).get(r.id)).toEqual(saved);
  });
  it('serves the saved image, reports API readiness without secrets, and rejects foreign generation requests', async () => {
    const d = fixture();
    const server = createReviewApp({ repo: d.repo });
    try {
      const api = request(server.app);
      const mode = (await api.get('/api/mode')).body;
      expect(mode).toHaveProperty('model');
      expect(mode).not.toHaveProperty('OPENAI_API_KEY');
      await api
        .get(`/api/reviews/${d.review.id}/visual.svg`)
        .expect('Content-Type', /image\/svg\+xml/)
        .expect(200);
      await api
        .get(`/api/reviews/${d.review.id}/visual.png`)
        .expect('Content-Type', /image\/png/)
        .expect(200);
      await api
        .post(`/api/reviews/${d.review.id}/visual`)
        .set('Origin', 'https://foreign.example')
        .send({})
        .expect(403);
    } finally {
      server.close();
    }
  });
});
describe('actual merge conflict resolution', () => {
  for (const scenario of ['checkout', 'shipping'] as const)
    it(`resolves and stages the chosen ${scenario} behavior with passing real checks`, () => {
      const d = fixture(scenario, true);
      expect(git(d.repo, ['status', '--short'])).toMatch(/^UU /);
      let r = inspect({ repo: d.repo });
      expect(r.merge).toBeDefined();
      expect(r.unsupported).toEqual([]);
      const file = r.files[0];
      const choice = scenario === 'checkout' ? 'a-first' : 'b';
      r = decide(d.repo, r.id, r.revision, file.path, file.analysis.conflicts[0].id, {
        ...actionDecision(choice),
        note: 'The user selected this behavior.',
      });
      r = preview(d.repo, r.id, r.revision);
      expect(readFileSync(join(d.repo, file.path), 'utf8')).toContain('<<<<<<<');
      r = applyReview(d.repo, r.id, r.revision, r.preview!.token);
      expect(r.checks.every((c) => c.status === 'passed')).toBe(true);
      expect(git(d.repo, ['ls-files', '--unmerged'])).toBe('');
      expect(readFileSync(join(d.repo, file.path), 'utf8')).toBe(r.preview!.outputs[file.path]);
      expect(git(d.repo, ['show', `:${file.path}`])).toBe(r.preview!.outputs[file.path]!.trimEnd());
      expect(r.status).toBe('applied');
    });
  it('preserves edited conflict markers and refuses unrelated work', () => {
    const d = fixture('checkout', true);
    let r = d.review;
    r = decide(d.repo, r.id, r.revision, 'checkout.ts', r.files[0].analysis.conflicts[0].id, {
      choice: 'both',
      order: 'a-first',
      note: 'Keep both checks.',
    });
    r = preview(d.repo, r.id, r.revision);
    const original = readFileSync(join(d.repo, 'checkout.ts'), 'utf8');
    writeFileSync(join(d.repo, 'notes.txt'), 'work in progress');
    expect(() => applyReview(d.repo, r.id, r.revision, r.preview!.token)).toThrow(
      'additional changes',
    );
    expect(readFileSync(join(d.repo, 'checkout.ts'), 'utf8')).toBe(original);
    writeFileSync(join(d.repo, 'checkout.ts'), original + '// newer edit\n');
    expect(() => applyReview(d.repo, r.id, r.revision, r.preview!.token)).toThrow(
      'Merge conflict or index changed',
    );
    expect(readFileSync(join(d.repo, 'checkout.ts'), 'utf8')).toContain('newer edit');
  });
});
