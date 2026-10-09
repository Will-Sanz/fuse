import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDemo } from '../../server/demo';
import { LocalStore } from '../../server/local-store';
import { exampleVisual } from '../../shared/demo-visuals';

async function current(page: import('@playwright/test').Page) {
  return (
    await page.request.get(`/api/reviews/${new URL(page.url()).searchParams.get('review')}`)
  ).json();
}
async function openCheckout(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The change', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /first check decides/ })).toBeVisible();
}
async function choose(
  page: import('@playwright/test').Page,
  label = 'Show the friendly message first',
) {
  await page.getByRole('button', { name: new RegExp(label) }).click();
  await expect(page.getByText('Your proposed change')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create this change' })).toBeEnabled();
}

test('original code → highlighted conflict → custom visual → chosen behavior → real file and checks', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openCheckout(page);
  await expect(page.getByLabel('Original code')).toContainText('return { ok: true }');
  await expect(page.getByLabel('Change A')).toContainText('Your order is incomplete');
  await expect(page.getByLabel('Change B')).toContainText('schemaCheck(order)');
  await expect(
    page.getByText(/Reproducible demo|decision needed|Scripted checkout scenario/),
  ).toHaveCount(0);
  const before = await current(page);
  expect(
    await page
      .getByRole('img', { name: /first check decides/ })
      .evaluate((e: HTMLImageElement) => e.naturalWidth),
  ).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('visual-checkout.png'), fullPage: true });
  await choose(page);
  await expect(page.getByLabel('Resolved checkout.ts')).toContainText('schemaCheck(order)');
  expect(readFileSync(join(before.repository, 'checkout.ts'), 'utf8')).toBe(
    before.files[0].input.base,
  );
  await page.getByRole('button', { name: 'Create this change' }).click();
  await expect(page.getByText('Change created. Checks passed.', { exact: true })).toBeVisible();
  const after = await current(page);
  expect(readFileSync(join(after.repository, 'checkout.ts'), 'utf8')).toBe(
    after.preview.outputs['checkout.ts'],
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Change created', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('created-change.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('the alternative choice creates the alternative behavior and remains verified', async ({
  page,
}) => {
  await openCheckout(page);
  await choose(page, 'Show the specific error first');
  await page.getByRole('button', { name: 'Create this change' }).click();
  await expect(page.getByText('Change created. Checks passed.', { exact: true })).toBeVisible();
  const r = await current(page);
  const source = r.preview.outputs['checkout.ts'];
  expect(source.indexOf('const schema =')).toBeLessThan(source.indexOf('if (!order.email'));
});

test('shipping gets a threshold visual and the selected pricing policy', async ({ page }, info) => {
  await openCheckout(page);
  await page.getByRole('button', { name: 'Shipping policy', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Does the discount take away free shipping?' }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: /discount take away/ })).toBeVisible();
  const r = await current(page);
  expect(r.visual.elements.some((e: { type: string }) => e.type === 'bar')).toBe(true);
  await page.screenshot({ path: info.outputPath('visual-shipping.png'), fullPage: true });
  await choose(page, 'Use the discounted subtotal');
  await choose(page, 'Keep free shipping after discounts');
  await page.getByRole('button', { name: 'Create this change' }).click();
  await expect(page.getByText('Change created. Checks passed.', { exact: true })).toBeVisible();
  const result = await current(page);
  expect(result.checks[0].stdout).toContain('total = $90');
});

test('stale worktrees cannot be overwritten after choosing a behavior', async ({ page }) => {
  await openCheckout(page);
  await choose(page);
  const r = await current(page);
  writeFileSync(
    join(r.sources.a.ref.value, 'checkout.ts'),
    r.files[0].input.agentA + '\n// newer work\n',
  );
  await page.getByRole('button', { name: 'Create this change' }).click();
  await expect(page.getByRole('alert')).toContainText('changed');
  expect(readFileSync(join(r.repository, 'checkout.ts'), 'utf8')).toBe(r.files[0].input.base);
});

test('meeting setup is portable and exposes no API key', async ({ page }, info) => {
  await openCheckout(page);
  await page.getByRole('button', { name: 'Run live MCP' }).click();
  const dialog = page.getByRole('dialog', { name: 'Run Fuse with MCP' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Meeting command')).toContainText('scripts/meeting.mjs');
  await expect(dialog).toContainText('OpenAI API directly');
  await page.getByText('Show MCP configuration', { exact: true }).click();
  await expect(page.getByLabel('MCP configuration')).toContainText('cli/run.mjs');
  await expect(dialog).not.toContainText('codex exec');
  await page.screenshot({ path: info.outputPath('meeting-setup.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close MCP setup' }).click();
  await expect(dialog).not.toBeVisible();
});

test('loading and API errors are visible and actionable', async ({ page }) => {
  let release!: () => void;
  const hold = new Promise<void>((accept) => {
    release = accept;
  });
  await page.route('**/api/mode', async (route) => {
    await hold;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.getByText('Opening the change…')).toBeVisible();
  release();
  await expect(page.getByRole('heading', { name: 'The change', exact: true })).toBeVisible();
  await page.route('**/api/demo', (route) =>
    route.fulfill({ status: 422, json: { error: 'Repository is not writable.' } }),
  );
  await page.getByRole('button', { name: 'Shipping policy', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Repository is not writable');
  await page.goto('/?review=00000000-0000-0000-0000-000000000000');
  await expect(page.getByRole('alert')).toContainText('Review not found');
});

test('narrow viewport retains the code, visual and behavior choices', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCheckout(page);
  await choose(page);
  await expect(page.getByRole('button', { name: 'Create this change' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
});

test('a real Git merge conflict is resolved and staged through the same web flow', async ({
  page,
}) => {
  const d = createDemo(resolve('test-results/browser-demos', randomUUID()), false, {
    merge: true,
    presentation: true,
  });
  d.review.visual = exampleVisual(
    'checkout',
    'checkout.ts',
    d.review.files[0].analysis.conflicts[0].id,
  );
  new LocalStore(d.repo).save(d.review);
  await page.goto(`/?review=${d.review.id}`);
  await choose(page);
  await page.getByRole('button', { name: 'Create this change' }).click();
  await expect(page.getByText('Change created. Checks passed.', { exact: true })).toBeVisible();
  await expect(
    page.getByText('The conflict is resolved and staged in your repository.'),
  ).toBeVisible();
  expect(execFileSync('git', ['-C', d.repo, 'ls-files', '--unmerged'], { encoding: 'utf8' })).toBe(
    '',
  );
  expect(readFileSync(join(d.repo, 'checkout.ts'), 'utf8')).not.toContain('<<<<<<<');
});
