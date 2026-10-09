import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('hosted choices create the correct downloadable source without a local API', async ({
  page,
}, info) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/');
  await expect(page.getByRole('img', { name: /first check decides/ })).toBeVisible();
  await page.getByRole('button', { name: /Show the specific error first/ }).click();
  await page.getByRole('button', { name: 'Create this change' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download checkout.ts' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('checkout.ts');
  const code = readFileSync((await file.path())!, 'utf8');
  expect(code.indexOf('const schema =')).toBeLessThan(code.indexOf('if (!order.email'));
  expect(code).toContain('Your order is incomplete');
  await page.reload();
  await expect(page.getByRole('link', { name: 'Download checkout.ts' })).toBeVisible();
  await expect(page.getByText('Change created. Checks passed.', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('hosted-created.png'), fullPage: true });
  await page.getByRole('button', { name: 'Shipping policy', exact: true }).click();
  await expect(page.getByRole('img', { name: /discount take away/ })).toBeVisible();
  await page.getByRole('button', { name: /Use the discounted subtotal/ }).click();
  await page.getByRole('button', { name: 'Create this change' }).click();
  const nextDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download shipping.ts' }).click();
  const shipping = readFileSync((await (await nextDownload).path())!, 'utf8');
  expect(shipping).toContain('const eligibleTotal = subtotal - discount');
  expect(requests.filter((url) => /\/api\/|api.openai.com/.test(url))).toEqual([]);
});

test('hosted setup includes the captured MCP image and usable teammate instructions', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The change', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('hosted-checkout.png'), fullPage: true });
  await page.getByRole('button', { name: 'Run live MCP' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('No API key or environment file is needed');
  await expect(page.getByLabel('MCP prompt')).toContainText('Use Fuse to explain');
  const image = page.getByRole('img', { name: /captured from a real fuse_explain/ });
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((e: HTMLImageElement) => e.naturalWidth))
    .toBeGreaterThan(0);
  await expect(dialog).not.toContainText('npm run build');
  await page.getByText('Show MCP configuration', { exact: true }).click();
  await expect(page.getByLabel('MCP configuration')).toContainText('github:Will-Sanz/fuse#main');
  await expect(dialog).not.toContainText('/Users/willsanz');
  await page.getByRole('button', { name: 'Close MCP setup' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/?review=another-session');
  await page.getByRole('button', { name: 'Open a new change' }).click();
  await expect(page.getByRole('heading', { name: 'The change', exact: true })).toBeVisible();
});
