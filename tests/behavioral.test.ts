import * as verification from '../server/verification';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createSemanticDemo } from '../server/demo';
import {
  combinedSource,
  reportIssues,
  sourceVersion,
  submitProposal,
  confirmBehavior,
  verifyProposal,
  configureVerification,
} from '../server/proposals';
import { applyReview, configureCheck, preview, decide, setIntent } from '../server/local';
import { LocalStore } from '../server/local-store';
import { git } from '../server/git';
import { pinnedProject, runIsolated } from '../server/verification';
import { createReviewApp } from '../server/review-server';
import type { Review } from '../shared/review';

const directories: string[] = [];
function fixture(compatible = false) {
  const dir = mkdtempSync(join(tmpdir(), 'fuse-behavioral-'));
  directories.push(dir);
  return createSemanticDemo(join(dir, 'fixture'), compatible);
}
export function issueReport(r: Review) {
  return {
    sourceVersion: sourceVersion(r),
    assessment: 'suspected' as const,
    explanation: 'Caller eligibility may change when the merchandise total includes coupons.',
    issue: {
      path: r.files[0].path,
      summary: 'Shipping uses discounted merchandise',
      rationale: 'The shipping function depends on the function changed by coupons.',
      evidence: r.files[0].evidence.map((_, i) => i),
      options: [
        {
          label: 'Original subtotal eligibility',
          description: 'Keep coupons and decide shipping from original merchandise subtotal.',
        },
        {
          label: 'Discounted subtotal eligibility',
          description: 'Decide shipping after applying the coupon.',
        },
      ],
    },
  };
}
function proposal(
  r: Review,
  source = combinedSource(r).replace('merchandiseTotal(cart) >=', 'cart.subtotalCents >='),
) {
  return {
    sourceVersion: sourceVersion(r),
    issueId: r.behavioral!.intent!.issueId,
    behaviorId: r.behavioral!.intent!.behaviorId,
    path: r.files[0].path,
    source,
    rationale: 'Preserve both features and use the confirmed eligibility basis.',
  };
}
function ready(d: ReturnType<typeof fixture>) {
  let r = reportIssues(d.repo, d.review.id, d.review.revision, issueReport(d.review));
  r = confirmBehavior(d.repo, r.id, r.revision, r.behavioral!.issue!.options[0].id);
  return submitProposal(d.repo, r.id, r.revision, proposal(r));
}
afterEach(() => directories.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));

describe('behavioral contracts (deterministic agent submissions and human confirmations)', () => {
  it('does not authorize a candidate when baseline execution timed out (simulated runner)', async () => {
    const d = fixture(),
      r = ready(d);
    const imageSpy = vi
      .spyOn(verification, 'verificationImage')
      .mockReturnValue('sha256:' + 'a'.repeat(64));
    let calls = 0;
    const runSpy = vi
      .spyOn(verification, 'runIsolated')
      .mockImplementation(async (_files, _path, _source, checks) => {
        const baseline = ++calls === 1;
        return checks.map((c) => ({
          ...c,
          status: baseline ? 'timed-out' : 'passed',
          exitCode: baseline ? null : 0,
          stdout: '',
          stderr: '',
          durationMs: 1,
          at: new Date().toISOString(),
        }));
      });
    try {
      const result = await verifyProposal(d.repo, r.id, r.revision);
      expect(result.behavioral!.verification!.status).toBe('failed');
      expect(() => preview(d.repo, r.id, result.revision)).toThrow(/verification/);
    } finally {
      imageSpy.mockRestore();
      runSpy.mockRestore();
    }
  });

  it('rejects a configuration swap between capture and preparation without executing checks', async () => {
    const d = fixture(),
      r = ready(d),
      store = new LocalStore(d.repo);
    const original = LocalStore.prototype.config;
    let reads = 0;
    const configSpy = vi.spyOn(LocalStore.prototype, 'config').mockImplementation(function (
      this: LocalStore,
    ) {
      const captured = original.call(this);
      if (++reads === 2)
        this.write('config.json', {
          ...captured,
          checks: [
            ...captured.checks,
            {
              name: 'new required policy',
              command: 'node',
              args: ['-e', 'process.exit(1)'],
              timeoutMs: 1000,
            },
          ],
        });
      return captured;
    });
    const imageSpy = vi
      .spyOn(verification, 'verificationImage')
      .mockReturnValue('sha256:' + 'a'.repeat(64));
    const runSpy = vi
      .spyOn(verification, 'runIsolated')
      .mockRejectedValue(new Error('Execution must not begin'));
    try {
      await expect(verifyProposal(d.repo, r.id, r.revision)).rejects.toThrow(
        /configuration changed/,
      );
      expect(runSpy).not.toHaveBeenCalled();
      expect(store.get(r.id).behavioral!.verification).toBeUndefined();
    } finally {
      configSpy.mockRestore();
      imageSpy.mockRestore();
      runSpy.mockRestore();
    }
  });

  it('clean-merges nonoverlapping changes; separates suspicion, human intent and backend results', () => {
    const d = fixture();
    const original = readFileSync(join(d.repo, 'checkout.ts'));
    expect(combinedSource(d.review)).toContain('cart.subtotalCents - cart.couponCents');
    expect(combinedSource(d.review)).toContain('merchandiseTotal(cart) >=');
    let r = reportIssues(d.repo, d.review.id, d.review.revision, issueReport(d.review));
    expect(r.behavioral?.verification).toBeUndefined();
    expect(() => preview(d.repo, r.id, r.revision)).toThrow(/verification/);
    expect(() =>
      setIntent(d.repo, r.id, r.revision, { first: 'a', rationale: 'model assertion' }),
    ).toThrow(/panel/);
    expect(() =>
      decide(d.repo, r.id, r.revision, 'checkout.ts', r.files[0].analysis.conflicts[0].id, {
        choice: 'reviewed',
        note: 'bypass',
      }),
    ).toThrow(/behavioral/);
    expect(() =>
      submitProposal(d.repo, r.id, r.revision, {
        sourceVersion: sourceVersion(r),
        issueId: r.behavioral!.issue!.id,
        behaviorId: r.behavioral!.issue!.options[0].id,
        path: 'checkout.ts',
        source: combinedSource(r),
        rationale: 'no confirmation',
      }),
    ).toThrow(/panel-confirmed/);
    r = confirmBehavior(d.repo, r.id, r.revision, r.behavioral!.issue!.options[0].id);
    for (const path of ['../checkout.ts', 'policy.test.mjs', '.git/config'])
      expect(() => submitProposal(d.repo, r.id, r.revision, { ...proposal(r), path })).toThrow();
    expect(() =>
      submitProposal(d.repo, r.id, r.revision, { ...proposal(r), source: 'function {' }),
    ).toThrow(/syntax/);
    expect(() =>
      submitProposal(d.repo, r.id, r.revision, {
        ...proposal(r),
        verification: { status: 'passed' },
      } as never),
    ).toThrow();
    r = submitProposal(d.repo, r.id, r.revision, proposal(r));
    expect(() => preview(d.repo, r.id, r.revision)).toThrow(/verification/);
    expect(readFileSync(join(d.repo, 'checkout.ts'))).toEqual(original);
    expect(git(d.repo, ['status', '--porcelain'])).toBe('');
  });
  it('supports no-issue and insufficient evidence, and exposes no model confirmation/application/configuration authority through actual MCP', async () => {
    const d = fixture(true);
    const client = new Client({ name: 'behavioral-transport-test', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve('cli/run.mjs'), 'mcp', '--repo', d.repo],
        stderr: 'pipe',
      }),
    );
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining(['fuse_report_issues', 'fuse_submit_proposal', 'fuse_verify']),
      );
      expect(names.some((n) => /apply|confirm|configure/.test(n))).toBe(false);
      let r = d.review;
      for (const assessment of ['no-issue', 'insufficient-evidence']) {
        const response = await client.callTool({
          name: 'fuse_report_issues',
          arguments: {
            id: r.id,
            revision: r.revision,
            report: {
              sourceVersion: sourceVersion(r),
              assessment,
              explanation: 'Independent original-subtotal shipping is compatible.',
            },
          },
        });
        expect(response.isError).not.toBe(true);
        r = JSON.parse((response.content as { text: string }[])[0].text).data;
        expect(r.behavioral!.assessment).toBe(assessment);
      }
      const response = await client.callTool({
        name: 'fuse_verify',
        arguments: { id: r.id, revision: r.revision, command: 'invented' },
      });
      expect(response.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
  it('requires explicit browser confirmation, rejects foreign origins, preserves old revisions and rejects dirty targets', async () => {
    const d = fixture();
    let r = reportIssues(d.repo, d.review.id, 0, issueReport(d.review));
    const server = createReviewApp({ repo: d.repo });
    try {
      const body = {
        revision: r.revision,
        behaviorId: r.behavioral!.issue!.options[0].id,
        confirmed: true,
      };
      await request(server.app)
        .post(`/api/reviews/${r.id}/behavior`)
        .send({ ...body, confirmed: false })
        .expect(400);
      await request(server.app)
        .post(`/api/reviews/${r.id}/behavior`)
        .set('Origin', 'https://bad.example')
        .send(body)
        .expect(403);
      r = (await request(server.app).post(`/api/reviews/${r.id}/behavior`).send(body).expect(200))
        .body;
      await request(server.app).post(`/api/reviews/${r.id}/behavior`).send(body).expect(409);
      expect(r.behavioral!.intent!.origin).toBe('human-panel');
      writeFileSync(join(d.repo, 'unrelated.txt'), 'preserve me');
      expect(() => submitProposal(d.repo, r.id, r.revision, proposal(r))).toThrow(/clean target/);
    } finally {
      server.close();
    }
  });
});

const image = process.env.FUSE_TEST_IMAGE;
describe.skipIf(!image)('real Docker acceptance', () => {
  it('proves independent branches, compiling clean merge, strict baseline failure, correction and true compatible negative', async () => {
    const d = fixture();
    configureVerification(d.repo, image!);
    const files = pinnedProject(d.review);
    const compile = new LocalStore(d.repo).config().checks[0];
    for (const [side, feature] of [
      ['a', 'coupon'],
      ['b', 'shipping'],
    ] as const) {
      const source = d.review.files[0].input[side === 'a' ? 'agentA' : 'agentB'];
      const results = await runIsolated(
        files,
        'checkout.ts',
        source,
        [
          compile,
          { name: feature, command: 'node', args: ['branch.test.mjs', feature], timeoutMs: 10000 },
        ],
        image!,
      );
      expect(results.map((c) => c.status)).toEqual(['passed', 'passed']);
    }
    const original = readFileSync(join(d.repo, 'checkout.ts'));
    let r = ready(d);
    r = submitProposal(d.repo, r.id, r.revision, proposal(r, combinedSource(r)));
    r = await verifyProposal(d.repo, r.id, r.revision);
    expect(r.behavioral!.verification!.status).toBe('failed');
    expect(() => preview(d.repo, r.id, r.revision)).toThrow();
    r = submitProposal(d.repo, r.id, r.revision, proposal(r));
    r = await verifyProposal(d.repo, r.id, r.revision);
    expect(r.behavioral!.verification!.baseline.map((c) => c.status)).toEqual(['passed', 'failed']);
    expect(r.behavioral!.verification!.candidate.map((c) => c.status)).toEqual([
      'passed',
      'passed',
    ]);
    r = preview(d.repo, r.id, r.revision);
    expect(readFileSync(join(d.repo, 'checkout.ts'))).toEqual(original);
    expect(() => applyReview(d.repo, r.id, r.revision, 'wrong')).toThrow();
    const approved = r.behavioral!.proposal!.source;
    r = applyReview(d.repo, r.id, r.revision, r.preview!.token);
    expect(readFileSync(join(d.repo, 'checkout.ts'), 'utf8')).toBe(approved);
    expect(r.status).toBe('applied');
    expect(r.checks.every((c) => c.status === 'passed')).toBe(true);
    const negative = fixture(true);
    const results = await runIsolated(
      pinnedProject(negative.review),
      'checkout.ts',
      combinedSource(negative.review),
      new LocalStore(negative.repo).config().checks,
      image!,
    );
    expect(results.every((c) => c.status === 'passed')).toBe(true);
  }, 120000);
  it('blocks mutation, timeout, cancellation, stale async state, changed checks and changed intent', async () => {
    const d = fixture();
    configureVerification(d.repo, image!);
    let r = ready(d);
    const files = pinnedProject(r);
    const checks = [
      {
        name: 'source mutation',
        command: 'node',
        args: ['-e', "require('node:fs').writeFileSync('checkout.ts','tampered')"],
        timeoutMs: 10000,
      },
      {
        name: 'test mutation',
        command: 'node',
        args: ['-e', "require('node:fs').writeFileSync('policy.test.mjs','tampered')"],
        timeoutMs: 10000,
      },
      {
        name: 'timeout',
        command: 'node',
        args: ['-e', 'setInterval(()=>{},1000)'],
        timeoutMs: 1000,
      },
    ];
    expect(
      (await runIsolated(files, 'checkout.ts', r.behavioral!.proposal!.source, checks, image!)).map(
        (c) => c.status,
      ),
    ).toEqual(['failed', 'failed', 'timed-out']);
    const isolation = await runIsolated(
      files,
      'checkout.ts',
      r.behavioral!.proposal!.source,
      [
        {
          name: 'container isolation',
          command: 'node',
          args: [
            '-e',
            "const a=require('node:assert/strict'),f=require('node:fs'); a.equal(process.getuid(),65534); a.equal(process.env.FUSE_SERVICE_TOKEN,undefined); a.equal(process.env.OPENAI_API_KEY,undefined); a.equal(f.existsSync('/project/.git'),false); a.equal(f.existsSync('/var/run/docker.sock'),false); a.throws(()=>f.writeFileSync('/root/escape','x')); a.throws(()=>f.writeFileSync('checkout.ts','x'));",
          ],
          timeoutMs: 10000,
        },
        {
          name: 'bounded output',
          command: 'node',
          args: [
            '-e',
            "let n=0;const t=setInterval(()=>{process.stdout.write('x'.repeat(1024));if(++n===200)clearInterval(t)},2)",
          ],
          timeoutMs: 10000,
        },
      ],
      image!,
    );
    expect(isolation.map((c) => c.status)).toEqual(['passed', 'timed-out']);
    expect(isolation[1].stdout.length).toBeLessThanOrEqual(64000);
    const aborted = new AbortController();
    aborted.abort();
    r = await verifyProposal(d.repo, r.id, r.revision, aborted.signal);
    expect(r.behavioral!.verification!.status).toBe('cancelled');
    expect(() => preview(d.repo, r.id, r.revision)).toThrow();
    const pending = verifyProposal(d.repo, r.id, r.revision);
    r = new LocalStore(d.repo).get(r.id);
    expect(r.behavioral!.verification!.status).toBe('running');
    expect(() => preview(d.repo, r.id, r.revision)).toThrow(/verification/);
    r = confirmBehavior(d.repo, r.id, r.revision, r.behavioral!.issue!.options[1].id);
    await expect(pending).rejects.toThrow(/changed/);
    expect(new LocalStore(d.repo).get(r.id).behavioral!.verification).toBeUndefined();
    r = submitProposal(d.repo, r.id, r.revision, proposal(r));
    r = await verifyProposal(d.repo, r.id, r.revision);
    configureCheck(d.repo, {
      name: 'new check',
      command: 'node',
      args: ['-e', 'process.exit(1)'],
      timeoutMs: 1000,
    });
    expect(() => preview(d.repo, r.id, r.revision)).toThrow(/verification/);
    expect(git(d.repo, ['status', '--porcelain'])).toBe('');
  }, 120000);
});
