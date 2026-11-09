import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcp } from '../server/mcp';
import { createInlineReview } from '../server/inline-review';
import { createSemanticDemo } from '../server/demo';
import {
  combinedSource,
  configureVerification,
  reportIssues,
  sourceVersion,
  submitProposal,
  verifyProposal,
} from '../server/proposals';
import { configureCheck } from '../server/local';
import { LocalStore } from '../server/local-store';
import { INLINE_REVIEW_URI } from '../shared/inline';
import type { Review } from '../shared/review';

const directories: string[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'fuse-inline-'));
  directories.push(directory);
  const d = createSemanticDemo(join(directory, 'fixture'));
  const r = d.review;
  const review = reportIssues(d.repo, r.id, r.revision, {
    sourceVersion: sourceVersion(r),
    assessment: 'suspected',
    explanation: 'The changed merchandise total affects shipping eligibility.',
    issue: {
      path: 'checkout.ts',
      summary: 'Coupon changes shipping eligibility',
      rationale: 'Shipping calls the changed merchandise total.',
      evidence: r.files[0].evidence.map((_, i) => i),
      options: [
        {
          label: 'Original subtotal',
          description: 'Shipping eligibility uses original merchandise subtotal.',
        },
        {
          label: 'Discounted total',
          description: 'Shipping eligibility uses the discounted merchandise total.',
        },
      ],
    },
  });
  return { ...d, review, store: new LocalStore(d.repo) };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function input(r: Review, capability: string, action: 'refresh' | 'confirm' | 'preview' | 'apply') {
  return { repo: r.repository, id: r.id, revision: r.revision, capability, action };
}

describe('inline review authority', () => {
  it.each([
    ['unknown-client', '1', false],
    ['unknown-client', '1', true],
    ['codex-mcp-client', '0.166.0-alpha.5.2', true],
    ['codex-mcp-client', '0.167.0-alpha.3.3', true],
  ])('keeps unsupported client %s@%s read-only (UI declaration: %s)', async (name, version, ui) => {
    const d = fixture(),
      server = createMcp(d.repo),
      client = new Client(
        { name: String(name), version: String(version) },
        {
          capabilities: ui
            ? {
                extensions: {
                  'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] },
                },
              }
            : {},
        },
      );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: 'fuse_present_review',
        arguments: { id: d.review.id },
      });
      expect(result.isError).not.toBe(true);
      expect((result._meta as { fuse: { capability?: string } }).fuse.capability).toBeUndefined();
      const denied = await client.callTool({
        name: 'fuse_ui_action',
        arguments: {
          ...input(d.review, 'a'.repeat(64), 'confirm'),
          behaviorId: d.review.behavioral!.issue!.options[0].id,
        },
      });
      expect(denied.isError).toBe(true);
      expect(d.store.get(d.review.id).behavioral!.intent).toBeUndefined();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('keeps capability only in private metadata, bounds it to the connection/review/repository and rejects expired sessions', () => {
    const d = fixture(),
      second = fixture(),
      inline = createInlineReview();
    const result = inline.present(d.store, d.review, true),
      cap = result._meta.fuse.capability!;
    expect(cap).toMatch(/^[a-f0-9]{64}$/);
    expect(
      JSON.stringify({ content: result.content, structuredContent: result.structuredContent }),
    ).not.toContain(cap);
    expect(() => createInlineReview().act(d.store, input(d.review, cap, 'refresh'))).toThrow(
      /session expired/,
    );
    expect(() => inline.act(second.store, input(second.review, cap, 'refresh'))).toThrow(
      /session expired/,
    );
    const otherReview = { ...d.review, id: randomUUID() };
    d.store.save(otherReview);
    const reviewCap = inline.present(d.store, d.review, true)._meta.fuse.capability!;
    expect(() => inline.act(d.store, input(otherReview, reviewCap, 'refresh'))).toThrow(
      /session expired/,
    );
    const sourceCap = inline.present(d.store, d.review, true)._meta.fuse.capability!;
    const changed = structuredClone(d.review);
    changed.sources.a.ref.label = 'Changed source attribution';
    d.store.save(changed);
    expect(() => inline.act(d.store, input(changed, sourceCap, 'refresh'))).toThrow(
      /session expired/,
    );
    d.store.save(d.review);
    const connection = createInlineReview();
    const closedCap = connection.present(d.store, d.review, true)._meta.fuse.capability!;
    connection.close();
    expect(() => connection.act(d.store, input(d.review, closedCap, 'refresh'))).toThrow(
      /session expired/,
    );
    const expiringCap = inline.present(d.store, d.review, true)._meta.fuse.capability!;
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 15 * 60 * 1000 + 1);
    expect(() => inline.act(d.store, input(d.review, expiringCap, 'refresh'))).toThrow(
      /session expired/,
    );
  });
  it('requires current revisions and real verification even with a valid UI capability, and rotates capabilities after use', () => {
    const d = fixture(),
      inline = createInlineReview(),
      before = readFileSync(join(d.repo, 'checkout.ts'));
    const cap = inline.present(d.store, d.review, true)._meta.fuse.capability!;
    const confirm = {
      ...input(d.review, cap, 'confirm'),
      behaviorId: d.review.behavioral!.issue!.options[0].id,
    };
    expect(() => inline.act(d.store, { ...confirm, revision: d.review.revision - 1 })).toThrow(
      /changed/,
    );
    const result = inline.act(d.store, {
      ...confirm,
      capability: inline.present(d.store, d.review, true)._meta.fuse.capability!,
    });
    expect(result.structuredContent.data.behavioral!.intent!.origin).toBe('human-panel');
    expect(result._meta.fuse.capability).not.toBe(cap);
    expect(() => inline.act(d.store, confirm)).toThrow(/session expired/);
    expect(() =>
      inline.act(
        d.store,
        input(result.structuredContent.data, result._meta.fuse.capability!, 'preview'),
      ),
    ).toThrow(/verification/);
    expect(readFileSync(join(d.repo, 'checkout.ts'))).toEqual(before);
  });
  it.each(['0.166.0-alpha.5.1', '0.167.0-alpha.3.2'])(
    'grants reviewed client %s private actions; generic calls still require a capability',
    async (version) => {
      const d = fixture(),
        before = readFileSync(join(d.repo, 'checkout.ts'));
      const server = createMcp(d.repo),
        // Exact initialize identity captured from the installed CLI and app-server engine.
        client = new Client({ name: 'codex-mcp-client', version });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        const catalog = await client.listTools();
        const present = catalog.tools.find((t) => t.name === 'fuse_present_review')!;
        const action = catalog.tools.find((t) => t.name === 'fuse_ui_action')!;
        expect(present._meta?.ui).toEqual({ resourceUri: INLINE_REVIEW_URI });
        expect(action._meta?.ui).toEqual({ visibility: ['app'] });
        expect(catalog.tools.some((t) => ['fuse_apply', 'fuse_confirm'].includes(t.name))).toBe(
          false,
        );
        const result = await client.callTool({
          name: 'fuse_present_review',
          arguments: { id: d.review.id },
        });
        expect(result.isError).not.toBe(true);
        const capability = (result._meta as { fuse: { capability: string } }).fuse.capability;
        expect(capability).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(result.content)).not.toContain(capability);
        expect(JSON.stringify(result.structuredContent)).not.toContain(capability);
        const resource = await client.readResource({ uri: INLINE_REVIEW_URI });
        expect(resource.contents[0].mimeType).toBe('text/html;profile=mcp-app');
        expect(JSON.stringify(resource)).not.toContain(capability);
        expect(JSON.stringify(resource)).not.toContain(d.review.id);
        for (const args of [{}, { capability: 'a'.repeat(64) }]) {
          const denied = await client.callTool({
            name: 'fuse_ui_action',
            arguments: {
              repo: d.repo,
              id: d.review.id,
              revision: d.review.revision,
              action: 'confirm',
              behaviorId: d.review.behavioral!.issue!.options[0].id,
              ...args,
            },
          });
          expect(denied.isError).toBe(true);
          expect(JSON.stringify(denied)).not.toContain(capability);
        }
        expect(d.store.get(d.review.id).behavioral!.intent).toBeUndefined();
        expect(readFileSync(join(d.repo, 'checkout.ts'))).toEqual(before);
        const refreshed = await client.callTool({
          name: 'fuse_ui_action',
          arguments: input(d.review, capability, 'refresh'),
        });
        expect(refreshed.isError).not.toBe(true);
        const rotated = (refreshed._meta as { fuse: { capability: string } }).fuse.capability;
        expect(rotated).toMatch(/^[a-f0-9]{64}$/);
        expect(rotated).not.toBe(capability);
      } finally {
        await client.close();
        await server.close();
      }
    },
  );
});

it.skipIf(!process.env.FUSE_TEST_IMAGE)(
  'applies only exact verified bytes through the UI bridge and rejects stale checks/token/revision (real Docker)',
  async () => {
    const d = fixture(),
      inline = createInlineReview(),
      before = readFileSync(join(d.repo, 'checkout.ts'));
    configureVerification(d.repo, process.env.FUSE_TEST_IMAGE!);
    let result = inline.present(d.store, d.review, true),
      r = result.structuredContent.data;
    result = inline.act(d.store, {
      ...input(r, result._meta.fuse.capability!, 'confirm'),
      behaviorId: r.behavioral!.issue!.options[0].id,
    });
    r = result.structuredContent.data;
    r = submitProposal(d.repo, r.id, r.revision, {
      sourceVersion: sourceVersion(r),
      issueId: r.behavioral!.intent!.issueId,
      behaviorId: r.behavioral!.intent!.behaviorId,
      path: 'checkout.ts',
      source: combinedSource(r).replace('merchandiseTotal(cart) >=', 'cart.subtotalCents >='),
      rationale: 'Preserve both features using the human-confirmed shipping basis.',
    });
    r = await verifyProposal(d.repo, r.id, r.revision);
    expect(r.behavioral!.verification!.status).toBe('passed');
    result = inline.act(d.store, input(r, result._meta.fuse.capability!, 'refresh'));
    r = result.structuredContent.data;
    result = inline.act(d.store, input(r, result._meta.fuse.capability!, 'preview'));
    r = result.structuredContent.data;
    expect(readFileSync(join(d.repo, 'checkout.ts'))).toEqual(before);
    let approve = {
      ...input(r, result._meta.fuse.capability!, 'apply'),
      token: r.preview!.token,
    };
    expect(() => inline.act(d.store, { ...approve, token: 'a'.repeat(64) })).toThrow(/preview/);
    approve = { ...approve, capability: inline.present(d.store, r, true)._meta.fuse.capability! };
    expect(() => inline.act(d.store, { ...approve, revision: r.revision - 1 })).toThrow(
      /changed|stale/,
    );
    approve = { ...approve, capability: inline.present(d.store, r, true)._meta.fuse.capability! };
    const config = d.store.config();
    configureCheck(d.repo, {
      name: 'new check',
      command: 'node',
      args: ['-e', 'process.exit(1)'],
      timeoutMs: 1000,
    });
    expect(() => inline.act(d.store, approve)).toThrow(/checks changed|verification/);
    d.store.write('config.json', config);
    approve = { ...approve, capability: inline.present(d.store, r, true)._meta.fuse.capability! };
    result = inline.act(d.store, approve);
    r = result.structuredContent.data;
    expect(r.status).toBe('applied');
    expect(readFileSync(join(d.repo, 'checkout.ts'), 'utf8')).toBe(r.behavioral!.proposal!.source);
    expect(JSON.stringify(r)).not.toContain(approve.capability);
  },
  120000,
);
