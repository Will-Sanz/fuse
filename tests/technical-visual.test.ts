import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSemanticDemo } from '../server/demo';
import { reportIssues, sourceVersion } from '../server/proposals';
import { generateVisual } from '../server/visual-ai';
import { LocalStore } from '../server/local-store';
import { renderVisual } from '../server/visual-renderer';
import { visualSchema } from '../shared/visual';
import { technicalVisual as diagram } from './fixtures/technical-visual';

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);
function fixture(assessment: 'suspected' | 'no-issue' = 'suspected') {
  const dir = mkdtempSync(join(tmpdir(), 'fuse-technical-visual-'));
  directories.push(dir);
  const d = createSemanticDemo(join(dir, 'checkout'), assessment === 'no-issue');
  const review = reportIssues(d.repo, d.review.id, d.review.revision, {
    sourceVersion: sourceVersion(d.review),
    assessment,
    explanation:
      assessment === 'suspected'
        ? 'Shipping consumes merchandiseTotal after the coupon changes it.'
        : 'Shipping uses the original subtotal independently of discounted merchandise.',
    issue:
      assessment === 'suspected'
        ? {
            path: 'checkout.ts',
            summary: 'Coupon affects shipping eligibility',
            rationale: 'Eligibility must use the original subtotal.',
            evidence: [3, 4],
            options: [
              {
                label: 'Original subtotal',
                description: 'Use the original subtotal for shipping.',
              },
              {
                label: 'Discounted subtotal',
                description: 'Use the discounted subtotal for shipping.',
              },
            ],
          }
        : undefined,
  });
  return { ...d, review };
}

const answer = (spec = diagram) => ({ spec, model: 'test-model', responseId: 'test-response' });

it('persists local layout version without changing hosted schema and refreshes legacy cache once', async () => {
  const d = fixture();
  const model = vi.fn().mockResolvedValue(answer());
  const source = readFileSync(join(d.repo, 'checkout.ts'), 'utf8');
  const first = await generateVisual(d.repo, d.review.id, {}, model);
  expect(first.visual?.layoutVersion).toBe(2);
  expect(first.visual?.options.map((o) => o.action)).toEqual(
    d.review.behavioral!.issue!.options.map((o) => o.id),
  );
  expect(first.visual?.elements[0].detail).toBe('12000 - 3000\n= 9000 cents');
  expect(renderVisual(first.visual!)).toContain('font-size="22"');
  expect(visualSchema.safeParse({ ...diagram, layoutVersion: 2 }).success).toBe(false);
  await generateVisual(d.repo, first.id, {}, model);
  expect(model).toHaveBeenCalledTimes(1);
  const store = new LocalStore(d.repo),
    legacy = store.get(first.id);
  delete legacy.visual!.layoutVersion;
  store.save(legacy);
  const upgraded = await generateVisual(d.repo, first.id, {}, model);
  expect(upgraded.visual?.layoutVersion).toBe(2);
  expect(upgraded.revision).toBe(first.revision + 1);
  await generateVisual(d.repo, first.id, {}, model);
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[0][0]).toContain('real function/module identifiers');
  expect(model.mock.calls[0][0]).toContain('never invent services');
  expect(readFileSync(join(d.repo, 'checkout.ts'), 'utf8')).toBe(source);
});

it('rejects overlapping technical nodes before save and repairs within the existing two attempts', async () => {
  const d = fixture();
  const invalid = structuredClone(diagram);
  invalid.elements[0].x = 550;
  const model = vi.fn().mockResolvedValueOnce(answer(invalid)).mockResolvedValueOnce(answer());
  const saved = await generateVisual(d.repo, d.review.id, {}, model);
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[1][0]).toMatch(/overlap/i);
  expect(saved.visual?.layoutVersion).toBe(2);
  const before = new LocalStore(d.repo).get(saved.id);
  const rejected = vi.fn().mockResolvedValue(answer(invalid));
  await expect(generateVisual(d.repo, saved.id, { regenerate: true }, rejected)).rejects.toThrow(
    /Generated visual was invalid:.*overlap/i,
  );
  expect(rejected).toHaveBeenCalledTimes(2);
  expect(new LocalStore(d.repo).get(saved.id)).toEqual(before);
});

it('supplies a no-issue assessment without requiring an invented correction', async () => {
  const d = fixture('no-issue');
  const compatible = structuredClone(diagram);
  compatible.title = 'Coupons and original-subtotal shipping remain compatible';
  compatible.summary = 'No correction is proposed.';
  compatible.elements = [
    { ...diagram.elements[0], y: 100 },
    { ...diagram.elements[1], y: 100, detail: '12000 >= 10000\nshipping = 0' },
  ];
  compatible.options = [
    { action: 'reviewed', label: 'Review complete', description: 'No issue found.' },
  ];
  const model = vi.fn().mockResolvedValue(answer(compatible));
  const saved = await generateVisual(d.repo, d.review.id, {}, model);
  const prompt = model.mock.calls[0][0];
  const context = JSON.parse(prompt.split('CODEBASE DATA:\n')[1]);
  expect(context.assessment).toBe('no-issue');
  expect(context.issue).toBeNull();
  expect(context.change.b).toContain('cart.subtotalCents >= 10000');
  expect(prompt).toContain('do not invent a defect or a correction');
  expect(saved.behavioral?.issue).toBeUndefined();
  expect(saved.visual?.options[0].action).toBe('reviewed');
  expect(model).toHaveBeenCalledTimes(1);
});
