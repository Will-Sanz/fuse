import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { analyze, diagnostics, hash, InputError, previewDecision, resolve } from './engine';
import { Store } from './store';
import { checkoutExample } from '../shared/example';
import type { Input, Workspace } from '../shared/types';
import { githubSchema, importGitHub } from './github';
const source = z.string().max(100000, 'Each snapshot must be at most 100,000 characters.');
const inputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .regex(/^[\w./ -]+\.ts$/, 'Use a TypeScript .ts filename'),
    base: source,
    agentA: source,
    agentB: source,
    nameA: z.string().trim().min(1).max(100),
    nameB: z.string().trim().min(1).max(100),
  })
  .strict();
const revisionSchema = z.object({ revision: z.number().int().nonnegative() }).strict();
const decisionSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    conflictId: z.string().max(500),
    decision: z
      .object({
        choice: z.enum(['a', 'b', 'both', 'reviewed']),
        order: z.enum(['a-first', 'b-first']).optional(),
        note: z.string().trim().max(2000),
      })
      .strict(),
  })
  .strict();
export function createApp(
  store: Store,
  options: { githubToken?: string; request?: typeof fetch; reviewRouter?: express.Router } = {},
) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    // A local-only server must also reject DNS rebinding and cross-origin writes.
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname))
      return res.status(403).json({ error: 'Fuse MVP accepts localhost requests only.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.get('origin');
      if (
        origin &&
        ![
          `http://${req.get('host')}`,
          'http://127.0.0.1:5173',
          'http://localhost:5173',
          `http://127.0.0.1:${process.env.PORT || 3001}`,
          `http://localhost:${process.env.PORT || 3001}`,
        ].includes(origin)
      )
        return res.status(403).json({ error: 'Cross-origin writes are not allowed.' });
      if (!req.is('application/json'))
        return res.status(415).json({ error: 'Use application/json.' });
    }
    next();
  });
  app.use(express.json({ limit: '400kb' }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const get = (id: string) => {
    const w = store.get(id);
    if (!w) throw Object.assign(new Error('Workspace not found.'), { status: 404 });
    return w;
  };
  const current = (id: string, revision: number) => {
    const w = get(id);
    if (w.revision !== revision)
      throw Object.assign(
        new Error('This workspace changed in another tab. Reload it before saving.'),
        { status: 409 },
      );
    return w;
  };
  function save(w: Workspace, revision: number, action: string, detail: string) {
    w.revision = revision + 1;
    w.updatedAt = new Date().toISOString();
    w.events.push({ id: randomUUID(), at: w.updatedAt, action, detail });
    if (!store.update(w, revision))
      throw Object.assign(new Error('This workspace changed. Reload it before saving.'), {
        status: 409,
      });
    return w;
  }
  function create(input: Input) {
    const now = new Date().toISOString();
    const w: Workspace = {
      id: randomUUID(),
      input,
      analysis: analyze(input),
      decisions: {},
      revision: 0,
      createdAt: now,
      updatedAt: now,
      events: [
        {
          id: randomUUID(),
          at: now,
          action: 'Analysis created',
          detail: `Compared ${input.nameA} and ${input.nameB} against the common base.`,
        },
      ],
      output: null,
      outputHash: null,
      diagnostics: [],
    };
    store.create(w);
    return w;
  }
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) =>
    res.json({ githubConfigured: Boolean(options.githubToken) }),
  );
  app.get('/api/workspaces', (_req, res) => res.json(store.list()));
  app.post('/api/workspaces', (req, res) =>
    res.status(201).json(create(inputSchema.parse(req.body))),
  );
  app.post('/api/example', (_req, res) => res.status(201).json(create(checkoutExample)));
  app.post('/api/github/import', async (req, res) =>
    res
      .status(201)
      .json(
        create(
          await importGitHub(githubSchema.parse(req.body), options.githubToken, options.request),
        ),
      ),
  );
  app.get('/api/workspaces/:id', (req, res) => res.json(get(req.params.id)));
  app.post('/api/workspaces/:id/preview', (req, res) => {
    const body = decisionSchema.parse(req.body),
      w = current(req.params.id, body.revision);
    const conflict = w.analysis.conflicts.find((c) => c.id === body.conflictId);
    if (!conflict) throw new InputError('Unknown conflict.');
    res.json({ code: previewDecision(w.input, conflict, body.decision) });
  });
  app.patch('/api/workspaces/:id/decisions', (req, res) => {
    const body = decisionSchema.parse(req.body),
      w = current(req.params.id, body.revision);
    const conflict = w.analysis.conflicts.find((c) => c.id === body.conflictId);
    if (!conflict) throw new InputError('Unknown conflict.');
    previewDecision(w.input, conflict, body.decision);
    w.decisions[body.conflictId] = body.decision;
    w.output = null;
    w.outputHash = null;
    w.diagnostics = [];
    res.json(
      save(
        w,
        body.revision,
        'Decision saved',
        `${conflict.title}: ${body.decision.choice}${body.decision.order ? ` (${body.decision.order})` : ''}. ${body.decision.note}`,
      ),
    );
  });
  app.post('/api/workspaces/:id/finalize', (req, res) => {
    const body = revisionSchema.parse(req.body),
      w = current(req.params.id, body.revision);
    w.output = resolve(w.input, w.decisions, w.analysis);
    w.outputHash = hash(w.output);
    w.diagnostics = diagnostics(w.output);
    res.json(
      save(
        w,
        body.revision,
        'Resolution exported',
        `SHA-256 ${w.outputHash}. ${w.diagnostics.length} standalone TypeScript diagnostics. Source was not executed.`,
      ),
    );
  });
  app.get('/api/workspaces/:id/download', (req, res) => {
    const w = get(req.params.id);
    if (w.output === null)
      throw new InputError('Finish all decisions and generate the resolved file first.');
    const file = w.input.fileName
      .split('/')
      .pop()!
      .replace(/[^\w.-]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.type('text/plain').send(w.output);
  });
  app.get('/api/workspaces/:id/audit', (req, res) => {
    const w = get(req.params.id);
    res.setHeader('Content-Disposition', 'attachment; filename="fuse-review.json"');
    res.json(w);
  });
  if (options.reviewRouter) app.use('/api', options.reviewRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof z.ZodError)
        return res
          .status(400)
          .json({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      if (error instanceof InputError)
        return res
          .status((error as InputError & { status?: number }).status || 422)
          .json({ error: error.message });
      const e = error as { status?: number; type?: string; name?: string; message?: string };
      if (e.status === 413)
        return res
          .status(413)
          .json({ error: 'Input is too large. Keep each snapshot below 100 KB.' });
      if (e.status === 400) return res.status(400).json({ error: 'Malformed JSON request.' });
      if (e.status === 404 || e.status === 409)
        return res.status(e.status).json({ error: e.message });
      if (e.name === 'TimeoutError' || e.name === 'AbortError')
        return res.status(504).json({ error: 'GitHub took too long to respond. Try again.' });
      console.error(
        'Fuse request failed:',
        error instanceof Error ? error.message : 'Unknown error',
      );
      res
        .status(500)
        .json({ error: 'The request could not be completed. Check the server and try again.' });
    },
  );
  return app;
}
