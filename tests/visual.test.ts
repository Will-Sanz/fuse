import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { createDemo } from '../server/demo';
import { generateVisual, visualContext } from '../server/visual-ai';
import { runOpenAiVisual as runVisualModel } from '../server/visual-provider';
import { renderVisual, visualPng } from '../server/visual-renderer';
import { checkoutVisual, shippingVisual } from '../shared/demo-visuals';
import { actionDecision } from '../shared/visual';
import { applyReview, decide, inspect, preview } from '../server/local';
import { git } from '../server/git';
import { LocalStore } from '../server/local-store';
import { createReviewApp } from '../server/review-server';
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
const answer = (spec = checkoutVisual) => ({
  spec,
  model: 'test-model',
  responseId: 'test-response',
});
describe('custom visual explanations', () => {
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
    const model = vi.fn().mockResolvedValue(answer(checkoutVisual));
    await expect(generateVisual(d.repo, d.review.id, {}, model)).rejects.toThrow(
      'supported action',
    );
    expect(model).toHaveBeenCalledTimes(2);
    const repair = vi
      .fn()
      .mockResolvedValueOnce(answer(checkoutVisual))
      .mockResolvedValueOnce(answer(shippingVisual));
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
        return answer(shippingVisual);
      }),
    ).rejects.toThrow('Review changed');
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
