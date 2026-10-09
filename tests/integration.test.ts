import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createReviewApp } from '../server/review-server';
import { createDemo } from '../server/demo';
import type { Review } from '../shared/review';

const cleanup: (() => void)[] = [];
function temp() {
  const p = mkdtempSync(join(tmpdir(), 'fuse-integration-'));
  cleanup.push(() => rmSync(p, { recursive: true, force: true }));
  return p;
}
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn()),
);
describe('shared review API and MCP transport', () => {
  it('uses the same real worktree review through HTTP, validates mutations, and rejects stale browser state', async () => {
    const d = createDemo(join(temp(), 'demo'));
    const server = createReviewApp({ repo: d.repo });
    cleanup.push(server.close);
    const api = request(server.app),
      id = d.review.id;
    expect((await api.get(`/api/reviews/${id}`)).body.sources).toEqual(d.review.sources);
    await api
      .post(`/api/reviews/${id}/preview`)
      .set('Origin', 'https://foreign.example')
      .send({ revision: d.review.revision })
      .expect(403);
    await api.post('/api/demo').send({}).expect(422);
    await api
      .post(`/api/reviews/${id}/decide`)
      .send({
        revision: d.review.revision,
        path: 'checkout.ts',
        conflictId: 'overlap:validateBody',
        decision: { choice: 'both', order: 'a-first', note: '' },
      })
      .expect(400);
    let r = (
      await api
        .post(`/api/reviews/${id}/decide`)
        .send({
          revision: d.review.revision,
          path: 'checkout.ts',
          conflictId: 'overlap:validateBody',
          decision: { choice: 'both', order: 'a-first', note: 'Both validations, friendly first.' },
        })
        .expect(200)
    ).body;
    await api.post(`/api/reviews/${id}/preview`).send({ revision: d.review.revision }).expect(409);
    r = (await api.post(`/api/reviews/${id}/preview`).send({ revision: r.revision }).expect(200))
      .body;
    r = (
      await api
        .post(`/api/reviews/${id}/apply`)
        .send({ revision: r.revision, token: r.preview.token })
        .expect(200)
    ).body;
    expect(r.status).toBe('applied');
    expect(r.checks[0].status).toBe('passed');
    expect((await api.get(`/api/reviews/${id}/audit`)).body.preview.hashes).toEqual(
      r.preview.hashes,
    );
    await api.get('/api/reviews/invalid').expect(422);
  });
  it('invokes the actual stdio MCP executable and can inspect, decide, and preview without an apply tool', async () => {
    const d = createDemo(join(temp(), 'demo'));
    const client = new Client({ name: 'fuse-test', version: '1' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('cli/run.mjs'), 'mcp', '--repo', d.repo],
      stderr: 'pipe',
    });
    await client.connect(transport);
    try {
      const catalog = await client.listTools();
      expect(catalog.tools.map((t) => t.name)).toContain('fuse_inspect');
      expect(catalog.tools.map((t) => t.name)).not.toContain('fuse_apply');
      async function call(name: string, args: Record<string, unknown>) {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError).not.toBe(true);
        return JSON.parse((response.content as { text: string }[])[0].text).data as Review;
      }
      let r = await call('fuse_inspect', { sessions: true });
      expect(r.sources.a.ref.sessionId).toBe('request');
      expect(r.files[0].recommendations[0].question).toContain('should A or B');
      r = await call('fuse_intent', {
        id: r.id,
        revision: r.revision,
        intent: { first: 'a', rationale: 'Friendly missing-fields errors first.' },
      });
      r = await call('fuse_decide', {
        id: r.id,
        revision: r.revision,
        path: 'checkout.ts',
        conflictId: 'overlap:validateBody',
        decision: {
          choice: 'both',
          order: 'a-first',
          note: 'Preserve the expected checkout behavior.',
        },
      });
      r = await call('fuse_preview', { id: r.id, revision: r.revision });
      expect(r.preview?.outputs['checkout.ts']).toContain('schemaCheck(order)');
      expect(r.status).toBe('proposed');
      const read = await call('fuse_review', { id: r.id });
      expect(read.preview?.token).toBe(r.preview?.token);
      writeFileSync(join(d.sessionA!, 'checkout.ts'), 'function {');
      const stale = await client.callTool({
        name: 'fuse_preview',
        arguments: { id: r.id, revision: r.revision },
      });
      expect(stale.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});
