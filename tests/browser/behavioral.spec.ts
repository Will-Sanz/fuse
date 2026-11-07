import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createSemanticDemo } from '../../server/demo';
import {
  combinedSource,
  configureVerification,
  reportIssues,
  sourceVersion,
  submitProposal,
  verifyProposal,
} from '../../server/proposals';
import { LocalStore } from '../../server/local-store';

test('disposable simulation: two human decisions surround agent proposal and real isolated verification', async ({
  page,
}) => {
  test.skip(!process.env.FUSE_TEST_IMAGE, 'Real Docker image is required; no mocked pass.');
  test.setTimeout(90000);
  const d = createSemanticDemo(resolve('test-results/browser-demos', randomUUID()));
  configureVerification(d.repo, process.env.FUSE_TEST_IMAGE!);
  const before = readFileSync(join(d.repo, 'checkout.ts'));
  let r = reportIssues(d.repo, d.review.id, 0, {
    sourceVersion: sourceVersion(d.review),
    assessment: 'suspected',
    explanation: 'Coupon changes may alter shipping eligibility.',
    issue: {
      path: 'checkout.ts',
      summary: 'Shipping and coupons interact',
      rationale: 'Shipping consumes the changed merchandise total.',
      evidence: d.review.files[0].evidence.map((_, i) => i),
      options: [
        {
          label: 'Use original subtotal',
          description: 'Preserve coupon and use original merchandise subtotal for shipping.',
        },
        {
          label: 'Use discounted subtotal',
          description: 'Use merchandise total after coupons for shipping.',
        },
      ],
    },
  });
  await page.goto(`/?review=${r.id}`);
  await expect(page.getByRole('heading', { name: 'Shipping and coupons interact' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and apply verified code' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: /Use original subtotal/ }).click();
  await expect(page.getByRole('status')).toContainText('Return to your coding agent');
  r = new LocalStore(d.repo).get(r.id);
  expect(r.behavioral?.intent?.origin).toBe('human-panel');
  expect(readFileSync(join(d.repo, 'checkout.ts'))).toEqual(before);
  r = submitProposal(d.repo, r.id, r.revision, {
    sourceVersion: sourceVersion(r),
    issueId: r.behavioral!.intent!.issueId,
    behaviorId: r.behavioral!.intent!.behaviorId,
    path: 'checkout.ts',
    source: combinedSource(r).replace('merchandiseTotal(cart) >=', 'cart.subtotalCents >='),
    rationale: 'Simulated agent submission preserving both features.',
  });
  await page.getByRole('button', { name: 'Refresh agent progress' }).click();
  await expect(page.getByLabel('Exact candidate source')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview verified change' })).toHaveCount(0);
  r = await verifyProposal(d.repo, r.id, r.revision);
  await page.getByRole('button', { name: 'Refresh agent progress' }).click();
  await expect(
    page.getByRole('heading', { name: '3. Isolated verification: passed' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Preview verified change' }).click();
  await expect(page.getByLabel('Verified preview')).toContainText('cart.subtotalCents >=');
  expect(readFileSync(join(d.repo, 'checkout.ts'))).toEqual(before);
  await page.getByRole('button', { name: 'Approve and apply verified code' }).click();
  await expect(page.getByText(/^Applied verified candidate/)).toBeVisible();
  expect(readFileSync(join(d.repo, 'checkout.ts'), 'utf8')).toBe(r.behavioral!.proposal!.source);
  await page.screenshot({ path: 'test-results/behavioral-receipt.png', fullPage: true });
});
