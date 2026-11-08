import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createSemanticDemo } from '../../server/demo';
import {
  reportIssues,
  sourceVersion,
  configureVerification,
  combinedSource,
} from '../../server/proposals';
import { LocalStore } from '../../server/local-store';
import type { Review } from '../../shared/review';

let directory: string, lifecycleScript: string;
const cleanup: (() => void | Promise<void>)[] = [];
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'fuse-inline-browser-'));
  const output = join(directory, 'lifecycle');
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [react()],
    build: {
      outDir: output,
      lib: {
        entry: resolve('tests/fixtures/glass-lifecycle.tsx'),
        name: 'GlassLifecycle',
        formats: ['iife'],
        fileName: 'lifecycle',
      },
    },
  });
  lifecycleScript = readFileSync(join(output, 'lifecycle.iife.js'), 'utf8');
});
test.afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
test.afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function mountResource(
  page: Page,
  result: object,
  invoke: (params: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>,
  negotiatedVersion = '2026-01-26',
) {
  await page.exposeFunction('invokeFuse', invoke);
  await page.setContent(
    '<body style="margin:0;background:#0b1017"><iframe title="Simulated MCP App host" style="width:100%;height:1800px;border:0"></iframe></body>',
  );
  await page.evaluate(
    ({ html, result, negotiatedVersion }) => {
      const iframe = document.querySelector('iframe')!;
      Object.assign(window, { appCalls: [] as string[] });
      window.addEventListener('message', async (event) => {
        if (event.source !== iframe.contentWindow) return;
        const m = event.data;
        const reply = (result: unknown) =>
          iframe.contentWindow!.postMessage({ jsonrpc: '2.0', id: m.id, result }, '*');
        if (m.method === 'ui/initialize') {
          if (
            m.params.protocolVersion !== '2026-01-26' ||
            m.params.appInfo?.name !== 'Fuse' ||
            m.params.appInfo?.version !== '0.3.0' ||
            typeof m.params.appCapabilities !== 'object'
          ) {
            iframe.contentWindow!.postMessage(
              {
                jsonrpc: '2.0',
                id: m.id,
                error: { code: -32602, message: 'Invalid MCP App initialization' },
              },
              '*',
            );
            return;
          }
          reply({
            protocolVersion: negotiatedVersion,
            hostInfo: { name: 'Explicit test host', version: '1' },
            hostCapabilities: {},
            hostContext: { theme: 'dark' },
          });
        } else if (m.method === 'ui/notifications/initialized')
          iframe.contentWindow!.postMessage(
            { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result },
            '*',
          );
        else if (m.method === 'tools/call') {
          (window as unknown as { appCalls: string[] }).appCalls.push(
            m.params.name + ':' + (m.params.arguments.action || ''),
          );
          try {
            reply(
              await (
                window as unknown as { invokeFuse: (params: unknown) => Promise<unknown> }
              ).invokeFuse(m.params),
            );
          } catch (error) {
            reply({ isError: true, content: [{ type: 'text', text: (error as Error).message }] });
          }
        } else if (m.method === 'ui/open-link') {
          (window as unknown as { appCalls: string[] }).appCalls.push('open-link');
          reply({});
        }
      });
      iframe.srcdoc = html;
    },
    { html: readFileSync('dist/inline/review.html', 'utf8'), result, negotiatedVersion },
  );
  return page.frameLocator('iframe');
}
function fixture() {
  const d = createSemanticDemo(join(directory, `fixture-${Date.now()}`));
  const r = reportIssues(d.repo, d.review.id, 0, {
    sourceVersion: sourceVersion(d.review),
    assessment: 'suspected',
    explanation: 'Shipping consumes the merchandise function changed by coupons.',
    issue: {
      path: 'checkout.ts',
      summary: 'Coupons may revoke free shipping',
      rationale: 'Eligibility must use original subtotal.',
      evidence: d.review.files[0].evidence.map((_, index) => index),
      options: [
        {
          label: 'Original subtotal eligibility',
          description:
            'Preserve coupons and calculate shipping from original merchandise subtotal.',
        },
        { label: 'Discounted eligibility', description: 'Calculate shipping after coupons.' },
      ],
    },
  });
  return { ...d, review: r };
}
async function clientFor(repo: string) {
  const client = new Client({ name: 'codex-mcp-client', version: '0.166.0-alpha.5.1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve('cli/run.mjs'), 'mcp', '--repo', repo],
      stderr: 'pipe',
    }),
  );
  cleanup.push(() => client.close());
  return client;
}

// This explicitly simulates the verified client's identity and bridge; it is not native Codex evidence.
test('simulated host: real resource, WebGL card, human intent, real Docker checks and exact approval', async ({
  page,
}) => {
  test.skip(!process.env.FUSE_TEST_IMAGE, 'Prepared real Docker image required.');
  test.setTimeout(120000);
  const network: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  const d = fixture();
  configureVerification(d.repo, process.env.FUSE_TEST_IMAGE!);
  const client = await clientFor(d.repo);
  const call = async (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: { repo: d.repo, ...args } });
  const result = await call('fuse_present_review', { id: d.review.id });
  expect(result.isError).not.toBe(true);
  const before = readFileSync(join(d.repo, 'checkout.ts'));
  const frame = await mountResource(page, result, (params) => client.callTool(params));
  await expect(frame.locator('[data-glass-effect]')).toHaveAttribute('data-glass-effect', 'webgl');
  await expect(frame.getByRole('button', { name: 'Review interaction' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(await frame.locator('.fuse-glass-root').evaluate((el) => el.clientHeight)).toBeLessThan(
    340,
  );
  await page.screenshot({ path: 'test-results/inline-compact.png' });
  await frame.getByRole('button', { name: 'Review interaction' }).click();
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.evaluate(
    (result) =>
      document
        .querySelector('iframe')!
        .contentWindow!.postMessage(
          { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result },
          '*',
        ),
    result,
  );
  await frame.getByRole('button', { name: /Original subtotal eligibility/ }).click();
  await expect(frame.getByText(/Ask Codex to draft and verify/)).toBeVisible();
  let r = new LocalStore(d.repo).get(d.review.id);
  expect(r.behavioral!.intent!.origin).toBe('human-panel');
  await page.evaluate(
    (result) =>
      document
        .querySelector('iframe')!
        .contentWindow!.postMessage(
          { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result },
          '*',
        ),
    result,
  );
  await expect(frame.getByText(/Ask Codex to draft and verify/)).toBeVisible();
  expect(readFileSync(join(d.repo, 'checkout.ts'))).toEqual(before);
  const proposal = {
    sourceVersion: sourceVersion(r),
    issueId: r.behavioral!.intent!.issueId,
    behaviorId: r.behavioral!.intent!.behaviorId,
    path: 'checkout.ts',
    source: combinedSource(r).replace('merchandiseTotal(cart) >=', 'cart.subtotalCents >='),
    rationale: 'Deterministic test agent submission preserving both features.',
  };
  expect(
    (await call('fuse_submit_proposal', { id: r.id, revision: r.revision, proposal })).isError,
  ).not.toBe(true);
  r = new LocalStore(d.repo).get(r.id);
  expect((await call('fuse_verify', { id: r.id, revision: r.revision })).isError).not.toBe(true);
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Candidate checks passed' })).toBeVisible();
  await frame.getByRole('button', { name: 'Preview verified code' }).click();
  await expect(frame.getByRole('button', { name: 'Approve and apply verified code' })).toBeHidden();
  await frame.locator('summary', { hasText: 'Review exact code and approve' }).click();
  await expect(frame.getByLabel('Exact verified source')).toContainText('cart.subtotalCents >=');
  expect(readFileSync(join(d.repo, 'checkout.ts'))).toEqual(before);
  await frame.getByRole('button', { name: 'Approve and apply verified code' }).click();
  await expect(
    frame.getByRole('heading', { name: 'Applied to your local checkout' }),
  ).toBeVisible();
  r = new LocalStore(d.repo).get(r.id);
  expect(readFileSync(join(d.repo, 'checkout.ts'), 'utf8')).toBe(r.behavioral!.proposal!.source);
  await page.screenshot({ path: 'test-results/inline-applied.png' });
  expect(((await page.evaluate('appCalls')) as string[]).some((name) => name === 'open-link')).toBe(
    false,
  );
  const cap = (result as unknown as { _meta: { fuse: { capability: string } } })._meta.fuse
    .capability;
  expect(await frame.locator('body').innerHTML()).not.toContain(cap);
  expect(network).toEqual([]);
});

test('simulated host: reduced motion and missing capability retain a compact read-only card', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const d = fixture(),
    client = await clientFor(d.repo);
  const result = await client.callTool({
    name: 'fuse_present_review',
    arguments: { repo: d.repo, id: d.review.id },
  });
  delete (result as unknown as { _meta: { fuse: { capability?: string } } })._meta.fuse.capability;
  const long = (result.structuredContent as unknown as { data: Review }).data;
  long.behavioral!.issue!.summary = 'Long source interaction '.repeat(60);
  long.behavioral!.explanation = 'This interaction needs careful review. '.repeat(45);
  const frame = await mountResource(page, result, async () => {
    throw new Error('No mutation allowed.');
  });
  await expect(frame.getByRole('button', { name: 'Review interaction' })).toBeVisible();
  expect(await frame.locator('.fuse-glass-root').evaluate((el) => el.clientHeight)).toBeLessThan(
    370,
  );
  await frame.getByRole('button', { name: 'Review interaction' }).click();
  await expect(frame.locator('[data-glass-effect]')).toHaveAttribute('data-glass-effect', 'static');
  await expect(frame.getByRole('button', { name: /Original subtotal eligibility/ })).toBeDisabled();
  await expect(frame.getByRole('alert')).toContainText('private review session');
  await frame
    .locator('body')
    .evaluate(
      (_element, result) =>
        window.postMessage(
          { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result },
          '*',
        ),
      {
        structuredContent: {
          data: {
            ...d.review,
            revision: 999,
            behavioral: {
              ...d.review.behavioral,
              issue: { ...d.review.behavioral!.issue, summary: 'Forged self notification' },
            },
          },
        },
      },
    );
  await expect(frame.getByRole('heading', { name: 'Forged self notification' })).toHaveCount(0);

  await frame.getByRole('button', { name: 'Collapse review' }).focus();
  await page.keyboard.press('Escape');
  await expect(frame.getByRole('button', { name: 'Review interaction' })).toBeFocused();
  expect(await page.evaluate('appCalls')).toEqual([]);
});

test('simulated host: unsupported protocol negotiation stays read-only', async ({ page }) => {
  const frame = await mountResource(
    page,
    {},
    async () => {
      throw new Error('No tools allowed before initialization');
    },
    'unsupported-protocol',
  );
  await expect(frame.getByRole('alert')).toContainText('unsupported MCP App protocol');
  expect(await page.evaluate('appCalls')).toEqual([]);
});
test('simulated host: rejected human action disables stale controls until a new presentation', async ({
  page,
}) => {
  const d = fixture(),
    client = await clientFor(d.repo);
  const result = await client.callTool({
    name: 'fuse_present_review',
    arguments: { repo: d.repo, id: d.review.id },
  });
  const frame = await mountResource(page, result, async () => ({
    isError: true,
    content: [{ type: 'text', text: 'Inline review session expired or unavailable.' }],
  }));
  await frame.getByRole('button', { name: 'Review interaction' }).click();
  await frame.getByRole('button', { name: /Original subtotal eligibility/ }).click();
  await expect(frame.getByRole('alert')).toContainText('Ask Codex to present');
  await expect(frame.getByRole('button', { name: /Original subtotal eligibility/ })).toBeDisabled();
  await expect(frame.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
  expect(new LocalStore(d.repo).get(d.review.id).behavioral!.intent).toBeUndefined();
});

async function mountLifecycle(page: Page, noWebGL = false) {
  await page.setContent(
    '<style>body{margin:0}.fuse-glass-root{width:400px;position:relative}.fuse-glass-panel{position:relative;z-index:0;min-height:120px}.fuse-glass-ambient{position:absolute;inset:0;background:linear-gradient(45deg,#9070a0,#183443)}</style><div id="root"></div>',
  );
  if (noWebGL)
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.getContext as unknown as (
        this: HTMLCanvasElement,
        kind: string,
        options?: unknown,
      ) => RenderingContext | null;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        kind: string,
        options?: unknown,
      ) {
        return kind === 'webgl' ? null : original.call(this, kind, options);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
  await page.addScriptTag({ content: lifecycleScript });
}

test('glass lifecycle: unavailable WebGL uses a readable static card without canvases', async ({
  page,
}) => {
  await mountLifecycle(page, true);
  await page.evaluate('showGlass()');
  await expect(page.locator('[data-glass-effect]')).toHaveAttribute('data-glass-effect', 'static');
  await expect(page.getByText('Readable source and buttons stay in the DOM.')).toBeVisible();
  expect(await page.locator('body > canvas').count()).toBe(0);
});
test('glass lifecycle: unmount disposes a real renderer while image decoding is still pending', async ({
  page,
}) => {
  await mountLifecycle(page);
  await page.evaluate('delayFirstInit(false); showGlass()');
  await expect(page.locator('body > canvas')).toHaveCount(1);
  await page.evaluate('hideGlass()');
  await expect(page.locator('body > canvas')).toHaveCount(0);
});
test('glass lifecycle: an old rejected init cannot remove the newer active renderer', async ({
  page,
}) => {
  await mountLifecycle(page);
  await page.evaluate('delayFirstInit(true); showGlass()');
  await expect(page.locator('body > canvas')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('body > canvas')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('[data-glass-effect]')).toHaveAttribute('data-glass-effect', 'webgl');
  await expect(page.locator('.fuse-glass-panel > canvas')).toHaveCount(1);
  await page.evaluate('rejectFirstInit()');
  await page.waitForTimeout(100);
  await expect(page.locator('[data-glass-effect]')).toHaveAttribute('data-glass-effect', 'webgl');
  await expect(page.locator('.fuse-glass-panel > canvas')).toHaveCount(1);
  await page.evaluate('hideGlass()');
  await expect(page.locator('body > canvas')).toHaveCount(0);
});
