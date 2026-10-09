// Render verified Codex event output as a short, captioned terminal replay.
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const session = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.ok(session.events.some((e) => e.text.startsWith('PASS fuse_inspect')));
assert.ok(session.events.some((e) => e.text.startsWith('PASS fuse_review')));
assert.ok(session.events.at(-1).text.startsWith('PASS ·'));
const output = resolve('public/codex');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: resolve('data/video'), size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const captions = ['WEBVTT\n'];
let position = 0;
const time = (ms) => new Date(ms).toISOString().slice(11, 23);
try {
  await page.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box}body{margin:0;background:#11151d;color:#edf0f7;font-family:monospace}
    header{padding:28px 44px;border-bottom:1px solid #303745;display:flex;justify-content:space-between;font:20px system-ui;color:#b9a1f9}
    main{padding:28px 44px}h1{font:500 25px system-ui;margin:0 0 10px}p{font:16px system-ui;color:#9ca8be;margin:0 0 22px}
    pre{font:18px/1.8 monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;max-height:560px;overflow:hidden}
    footer{position:fixed;bottom:0;padding:16px 44px;background:#1b212c;width:100%;font:14px system-ui;color:#aab4c8}
    </style></head><body><header><strong>fuse / Codex</strong><span>Recorded MCP session</span></header>
    <main><h1>Inspect code from your coding session</h1><p id="date"></p><pre id="output"></pre></main>
    <footer>Actual Codex tool events · terminal formatting simplified · pauses shortened · no source applied</footer></body></html>`);
  await page.locator('#date').evaluate((el, date) => {
    el.textContent = `Captured ${date}`;
  }, session.recordedAt);
  const visible = [];
  for (const event of session.events) {
    const text = `${(event.atMs / 1000).toFixed(1).padStart(5)}s  ${event.text}`;
    visible.push(text);
    await page.locator('#output').evaluate((el, content) => {
      el.textContent = content;
      el.scrollTop = el.scrollHeight;
    }, visible.join('\n'));
    const duration = event.text.length > 100 ? 4800 : 2400;
    captions.push(`${time(position)} --> ${time(position + duration)}\n${event.text}\n`);
    position += duration;
    await new Promise((accept) => setTimeout(accept, duration));
  }
  await page.screenshot({ path: join(output, 'poster.png') });
  await context.close();
  await page.video().saveAs(join(output, 'session.webm'));
  writeFileSync(join(output, 'session.json'), JSON.stringify(session, null, 2) + '\n');
  writeFileSync(join(output, 'session.vtt'), captions.join('\n'));
  console.log(`Recorded ${session.events.length} actual events to ${output}`);
} finally {
  await browser.close();
}
