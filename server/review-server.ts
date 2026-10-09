import express from 'express';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from './store';
import { createApp } from './app';
import { createDemo } from './demo';
import { LocalStore } from './local-store';
import {
  applyReview,
  decide,
  decisionSchema,
  intentSchema,
  linkCommit,
  preview,
  setIntent,
} from './local';
import { InputError } from './engine';
import { commonDir } from './git';
import { generateVisual } from './visual-ai';
import { renderVisual, visualPng } from './visual-renderer';

export function createReviewApp(options: { repo?: string; dataDir?: string } = {}) {
  const directory = resolve(options.dataDir || 'data/demos');
  if (!options.repo) mkdirSync(directory, { recursive: true });
  const router = express.Router();
  const stores = () =>
    options.repo
      ? [new LocalStore(options.repo)]
      : readdirSync(directory)
          .filter((p) => /^[a-f0-9-]{36}$/.test(p))
          .map((p) => new LocalStore(join(directory, p, 'checkout')));
  const find = (id: string) => {
    for (const store of stores()) {
      try {
        return { store, review: store.get(id) };
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
      }
    }
    throw Object.assign(new InputError('Review not found. Open the link from your Fuse command.'), {
      status: 404,
    });
  };
  router.get('/reviews', (_req, res) =>
    res.json(
      stores()
        .flatMap((s) => s.list())
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          updatedAt: r.updatedAt,
          commit: r.commit,
        })),
    ),
  );
  router.get('/mode', (_req, res) =>
    res.json({
      mode: options.repo ? 'local' : 'demo',
      repository: options.repo,
      node: process.execPath,
      cli: fileURLToPath(new URL('../cli/run.mjs', import.meta.url)),
      meetingScript: fileURLToPath(new URL('../scripts/meeting.mjs', import.meta.url)),
      aiConfigured: Boolean(process.env.OPENAI_API_KEY || process.env.FUSE_SERVICE_TOKEN),
      model: process.env.FUSE_AI_MODEL || 'gpt-6-luna',
    }),
  );
  router.post('/demo', (req, res) => {
    if (options.repo)
      throw new InputError(
        'Demo creation is available from npm start, not a repository review server.',
      );
    const { single, scenario } = z
      .object({
        single: z.boolean().optional(),
        scenario: z.enum(['checkout', 'shipping']).optional(),
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(
        createDemo(join(directory, randomUUID()), single, { scenario, presentation: true }).review,
      );
  });
  router.get('/reviews/:id', (req, res) => res.json(find(req.params.id).review));
  router.post('/reviews/:id/visual', async (req, res) => {
    const { regenerate } = z
      .object({ regenerate: z.boolean().optional() })
      .strict()
      .parse(req.body);
    const { store } = find(req.params.id);
    res.json(await generateVisual(store.repo, req.params.id, { regenerate }));
  });
  router.get('/reviews/:id/visual.svg', (req, res) => {
    const { review } = find(req.params.id);
    if (!review.visual) throw new InputError('Generate a visual first.');
    res
      .type('image/svg+xml')
      .set('Content-Security-Policy', "default-src 'none'; style-src 'none'; sandbox")
      .send(renderVisual(review.visual));
  });
  router.get('/reviews/:id/visual.png', (req, res) => {
    const { review } = find(req.params.id);
    if (!review.visual) throw new InputError('Generate a visual first.');
    res.type('image/png').send(visualPng(review.visual));
  });
  const version = z.object({ revision: z.number().int().nonnegative() });
  router.post('/reviews/:id/intent', (req, res) => {
    const b = version.extend({ intent: intentSchema }).strict().parse(req.body),
      { store } = find(req.params.id);
    res.json(setIntent(store.repo, req.params.id, b.revision, b.intent));
  });
  router.post('/reviews/:id/decide', (req, res) => {
    const b = version
        .extend({ path: z.string(), conflictId: z.string(), decision: decisionSchema })
        .strict()
        .parse(req.body),
      { store } = find(req.params.id);
    res.json(decide(store.repo, req.params.id, b.revision, b.path, b.conflictId, b.decision));
  });
  router.post('/reviews/:id/preview', (req, res) => {
    const b = version.strict().parse(req.body),
      { store } = find(req.params.id);
    res.json(preview(store.repo, req.params.id, b.revision));
  });
  router.post('/reviews/:id/apply', (req, res) => {
    const b = version
        .extend({ token: z.string().length(64) })
        .strict()
        .parse(req.body),
      { store } = find(req.params.id);
    res.json(applyReview(store.repo, req.params.id, b.revision, b.token));
  });
  router.post('/reviews/:id/link', (req, res) => {
    const b = version
        .extend({ commit: z.string().min(1) })
        .strict()
        .parse(req.body),
      { store } = find(req.params.id);
    res.json(linkCommit(store.repo, req.params.id, b.revision, b.commit));
  });
  router.get('/reviews/:id/audit', (req, res) => {
    res.attachment('fuse-decision.json').json(find(req.params.id).review);
  });
  const legacyStore = new Store(
    join(options.repo ? join(commonDir(options.repo), 'fuse') : directory, 'snapshots.sqlite'),
  );
  const app = createApp(legacyStore, {
    reviewRouter: router,
    githubToken: process.env.GITHUB_TOKEN,
  });
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  if (existsSync(join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
  }
  return { app, close: () => legacyStore.close() };
}
export async function startReview(repo: string, port = 0) {
  if (!Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535)))
    throw new InputError('Choose port 0 or a port from 1024 through 65535.');
  if (!existsSync(fileURLToPath(new URL('../dist/index.html', import.meta.url))))
    throw new InputError('Build the visual review first: npm run build in the Fuse installation.');
  const { app, close } = createReviewApp({ repo });
  return new Promise<{ url: string; close: () => void }>((accept, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      const listeningPort = (server.address() as { port: number }).port;
      accept({
        url: `http://127.0.0.1:${listeningPort}`,
        close: () => {
          server.close();
          server.closeAllConnections();
          close();
        },
      });
    });
    server.on('error', (error) => {
      close();
      reject(error);
    });
  });
}
export async function serveReview(repo: string, id: string, port = 3001, open = false) {
  const viewer = await startReview(repo, port);
  const url = `${viewer.url}/?review=${id}`;
  console.log(`Fuse visual review: ${url}`);
  if (open) {
    const command =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'explorer.exe'
          : 'xdg-open';
    const child = spawn(command, [url], { stdio: 'ignore' });
    child.on('error', () => console.error(`Open this link in your browser: ${url}`));
  }
  await new Promise<void>((accept) => {
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      viewer.close();
      accept();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
