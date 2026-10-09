import { expect, test } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

async function startDemo(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Review checkout.ts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'checkout.ts' })).toBeVisible();
}
async function previewResult(page: import('@playwright/test').Page) {
  await page
    .getByLabel('Decision rationale')
    .fill('Keep the friendly missing-fields error first; preserve schema validation too.');
  await page.getByRole('button', { name: 'Preview resolution', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Proposed changes' })).toBeVisible();
}
test('real checkout: evidence → preview → approval → checks → actual Git commit → persistent record', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startDemo(page);
  await expect(page.getByLabel('A source for validateBody')).toContainText('if (!order.email');
  await expect(page.getByLabel('B source for validateBody')).toContainText('schemaCheck(order)');
  await expect(page.getByRole('heading', { name: 'Merge both · A then B' })).toBeVisible();
  await expect(
    page.getByText(/Reproducible demo|decision needed|Scripted checkout scenario/),
  ).toHaveCount(0);
  await expect(page.locator('.call-map')).not.toHaveAttribute('open');
  const source = page.getByLabel('A source for validateBody');
  expect((await source.boundingBox())!.y).toBeLessThan(500);
  await page.getByRole('button', { name: 'Full file', exact: true }).click();
  await expect(source).toContainText('export function requestHandler');
  await page.getByRole('button', { name: 'Changed function', exact: true }).click();
  await page.screenshot({ path: info.outputPath('change.png'), fullPage: true });
  await previewResult(page);
  await expect(page.getByLabel('Proposed result for checkout.ts')).toContainText(
    'schemaCheck(order)',
  );
  const id = new URL(page.url()).searchParams.get('review');
  const before = await (await page.request.get(`/api/reviews/${id}`)).json();
  expect(readFileSync(join(before.repository, 'checkout.ts'), 'utf8')).toBe(
    before.files[0].input.base,
  );
  await page.getByRole('button', { name: 'Approve & apply' }).click();
  await expect(page.getByRole('dialog', { name: 'Approve result' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply approved preview' }).click();
  await expect(page.getByText('passed', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Finish in your Git workflow' })).toBeVisible();
  await page.locator('.check-result summary').click();
  await expect(
    page.getByText('PASS: empty order, valid order, and malformed email', { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('applied.png'), fullPage: true });
  execFileSync('git', ['-C', before.repository, 'add', 'checkout.ts']);
  execFileSync('git', [
    '-C',
    before.repository,
    'commit',
    '-m',
    'Resolve checkout with reviewed precedence',
  ]);
  await page.getByRole('button', { name: 'Link commit', exact: true }).click();
  await expect(page.getByText('Linked commit', { exact: false })).toBeVisible();
  await expect(page.getByText('committed', { exact: true }).first()).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Decision record' }).click();
  await expect(page.getByText('Linked commit', { exact: false })).toBeVisible();
  await expect(page.locator('.timeline')).toContainText('friendly missing-fields error first');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export decision JSON' }).click();
  expect((await download).suggestedFilename()).toBe('fuse-decision.json');
  await page.screenshot({ path: info.outputPath('record.png'), fullPage: true });
  expect(errors).toEqual([]);
});
test('ordinary change receives useful evidence without a fabricated conflict', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Review a single change', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'checkout.ts' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No overlapping edits' })).toBeVisible();
  await expect(
    page.getByText('Can return the error “Your order is incomplete”.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview resolution' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('single-change.png'), fullPage: true });
});
test('stale source refuses application and preserves newer work', async ({ page }) => {
  await startDemo(page);
  await previewResult(page);
  const id = new URL(page.url()).searchParams.get('review');
  const review = await (await page.request.get(`/api/reviews/${id}`)).json();
  const path = join(review.sources.a.ref.value, 'checkout.ts');
  writeFileSync(path, readFileSync(path, 'utf8') + '\n// New work must survive.\n');
  await page.getByRole('button', { name: 'Approve & apply' }).click();
  await page.getByRole('button', { name: 'Apply approved preview' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Input revisions or worktree contents changed',
  );
  expect(readFileSync(path, 'utf8')).toContain('New work must survive');
  expect(readFileSync(join(review.repository, 'checkout.ts'), 'utf8')).toBe(
    review.files[0].input.base,
  );
});
test('opposite order records a real failed expectation', async ({ page }) => {
  await startDemo(page);
  await page.getByRole('button', { name: 'Merge both · B then A', exact: true }).click();
  await previewResult(page);
  await page.getByRole('button', { name: 'Approve & apply' }).click();
  await page.getByRole('button', { name: 'Apply approved preview' }).click();
  await expect(page.getByText('failed', { exact: true })).toBeVisible();
  await expect(page.locator('.check-result pre')).toContainText(
    'email: enter a valid email address',
  );
});
test('loading, server error, missing review, and empty history states', async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/mode', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.getByText('Reading your review…')).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: 'Review checkout.ts' })).toBeVisible();
  await page.route('**/api/reviews', (route) => route.fulfill({ json: [] }));
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('No reviews saved yet');
  await page.getByRole('button', { name: 'Close history' }).click();
  await page.route('**/api/demo', (route) =>
    route.fulfill({
      status: 500,
      json: { error: 'Fixture could not be created. Retry with a writable directory.' },
    }),
  );
  await page.getByRole('button', { name: 'Review checkout.ts' }).click();
  await expect(page.getByRole('alert')).toContainText('Fixture could not be created');
  await page.goto('/?review=00000000-0000-0000-0000-000000000000');
  await expect(page.getByRole('alert')).toContainText('Review not found');
});
test('narrow viewport keeps review and approval controls usable', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startDemo(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
  await previewResult(page);
  await page.getByRole('button', { name: 'Approve & apply' }).click();
  await expect(page.getByRole('button', { name: 'Apply approved preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Codex setup targets the open repository and plays the captured MCP session', async ({
  page,
}, info) => {
  await startDemo(page);
  const id = new URL(page.url()).searchParams.get('review');
  const review = await (await page.request.get(`/api/reviews/${id}`)).json();
  await page.getByRole('button', { name: 'Use with Codex' }).click();
  const dialog = page.getByRole('dialog', { name: 'Use Fuse with Codex' });
  await expect(dialog).toBeVisible();
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.width).toBeLessThan(900);
  expect(Math.abs(bounds.x - (page.viewportSize()!.width - bounds.width) / 2)).toBeLessThan(2);
  await expect(page.getByLabel('Codex connection test command')).toContainText(review.repository);
  await expect(page.getByLabel('Codex connection test command')).toContainText('--sessions');
  await expect(page.getByLabel('Codex MCP setup command')).toContainText('codex mcp add fuse');
  await expect(page.getByLabel('Codex MCP setup command')).toContainText(review.repository);
  const video = page.getByLabel('Recorded Codex MCP session');
  await video.evaluate((el: HTMLVideoElement) => el.play());
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(0);
  expect(await video.evaluate((el: HTMLVideoElement) => el.error)).toBeNull();
  const recording = await (await page.request.get('/codex/session.json')).json();
  expect(
    recording.events.some((e: { text: string }) => e.text.startsWith('PASS fuse_inspect')),
  ).toBe(true);
  expect(
    recording.events.some((e: { text: string }) => e.text.startsWith('PASS fuse_review')),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath('codex.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close Codex setup' }).click();
  await expect(dialog).not.toBeVisible();
});

test('a fresh agent inspection asks for intent and accepts an explicit resolution', async ({
  page,
}) => {
  await startDemo(page);
  const id = new URL(page.url()).searchParams.get('review');
  const original = await (await page.request.get(`/api/reviews/${id}`)).json();
  const inspection = spawnSync(
    process.execPath,
    [resolve('cli/run.mjs'), 'inspect', '--repo', original.repository, '--sessions', '--json'],
    { encoding: 'utf8' },
  );
  expect(inspection.status).toBe(2);
  const review = JSON.parse(inspection.stdout).data;
  await page.goto(`/?review=${review.id}`);
  await expect(page.getByText(/should A or B run first/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview resolution' })).toBeDisabled();
  await page.getByRole('button', { name: 'Merge both · A then B', exact: true }).click();
  await previewResult(page);
  await expect(page.getByLabel('Proposed result for checkout.ts')).toContainText(
    'schemaCheck(order)',
  );
});
