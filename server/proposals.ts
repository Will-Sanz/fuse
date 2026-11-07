import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ts } from 'ts-morph';
import { LocalStore } from './local-store';
import { assertFresh } from './local';
import { blob, git, isClean, safePath } from './git';
import { hash, InputError } from './engine';
import { pinnedProject, projectHash, runIsolated, verificationImage } from './verification';
import type { LocalConfig, Review } from '../shared/review';

const text = z.string().trim().min(1).max(2000);
export const reportSchema = z
  .object({
    sourceVersion: z.string().length(64),
    assessment: z.enum(['suspected', 'no-issue', 'insufficient-evidence']),
    explanation: text,
    issue: z
      .object({
        summary: text,
        rationale: text,
        path: z.string().max(240),
        evidence: z.array(z.number().int().nonnegative()).min(1).max(20),
        options: z
          .array(
            z
              .object({
                label: z.string().trim().min(1).max(70),
                description: z.string().trim().min(1).max(240),
              })
              .strict(),
          )
          .min(2)
          .max(4),
      })
      .strict()
      .optional(),
  })
  .strict();
export const proposalSchema = z
  .object({
    sourceVersion: z.string().length(64),
    issueId: z.string().uuid(),
    behaviorId: z.string().uuid(),
    path: z.string().max(240),
    source: z.string().min(1).max(100000),
    rationale: text,
  })
  .strict();
export const sourceVersion = (r: Review) =>
  hash(JSON.stringify({ base: r.baseCommit, target: r.targetHead, sources: r.sources }));
function scope(r: Review) {
  assertFresh(r);
  if (
    r.status !== 'proposed' ||
    r.merge ||
    r.files.length !== 1 ||
    r.unsupported.length ||
    r.targetHead !== r.baseCommit ||
    !isClean(r.repository) ||
    Object.values(r.sources).some((s) => s.ref.kind !== 'revision')
  )
    throw new InputError(
      'Behavioral proposals require two committed revisions, one regular TypeScript file, and a clean target at the common base.',
    );
  const path = r.files[0].path;
  safePath(r.repository, path);
  if (
    /(^|\/)(__tests__|tests?|specs?|policy|config)(\/|\.)|\.(test|spec|config)\.ts$/i.test(path) ||
    !path.endsWith('.ts') ||
    path.endsWith('.d.ts') ||
    [r.baseCommit, r.sources.a.head, r.sources.b.head].some(
      (ref) => blob(r.repository, ref, path).mode !== '100644',
    )
  )
    throw new InputError(
      'Only an existing regular application TypeScript source file may be proposed.',
    );
}
export function combinedSource(r: Review) {
  const tree = git(r.repository, [
    'merge-tree',
    '--write-tree',
    r.sources.a.head,
    r.sources.b.head,
  ]);
  if (!/^[a-f0-9]{40,64}$/.test(tree)) throw new InputError('The branches must merge cleanly.');
  const output = blob(r.repository, tree, r.files[0].path);
  if (output.code === null || output.unsupported)
    throw new InputError('Unsupported combined source.');
  return output.code;
}
function mutate(
  repo: string,
  id: string,
  revision: number,
  action: string,
  update: (r: Review) => void,
) {
  const store = new LocalStore(repo);
  return store.lock(() => {
    const r = store.get(id);
    if (r.revision !== revision)
      throw Object.assign(new InputError('Review changed. Read it again.'), { status: 409 });
    scope(r);
    update(r);
    delete r.preview;
    r.revision++;
    r.updatedAt = new Date().toISOString();
    r.events.push({
      at: r.updatedAt,
      action,
      detail:
        action === 'Behavior confirmed'
          ? JSON.stringify(r.behavioral?.intent)
          : r.behavioral?.proposal?.hash || r.behavioral?.explanation || '',
      reviewer:
        action === 'Behavior confirmed'
          ? 'Human panel confirmation (local; not identity verified)'
          : 'Agent submission / backend validation',
    });
    store.save(r);
    return r;
  });
}
export function reportIssues(
  repo: string,
  id: string,
  revision: number,
  input: z.infer<typeof reportSchema>,
) {
  const data = reportSchema.parse(input);
  return mutate(repo, id, revision, 'Issue assessment saved', (r) => {
    if (data.sourceVersion !== sourceVersion(r)) throw new InputError('Source version changed.');
    if ((data.assessment === 'suspected') !== Boolean(data.issue))
      throw new InputError('Only a suspected issue has issue details.');
    if (r.behavioral?.intent)
      throw new InputError('Confirmed issue is immutable. Start a new review to replace it.');
    if (
      data.issue &&
      (data.issue.path !== r.files[0].path ||
        data.issue.evidence.some((i) => !r.files[0].evidence[i]))
    )
      throw new InputError('Reference the pinned file and evidence indexes.');
    combinedSource(r);
    r.behavioral = {
      ...data,
      issue: data.issue
        ? {
            ...data.issue,
            id: randomUUID(),
            options: data.issue.options.map((o) => ({ ...o, id: randomUUID() })),
          }
        : undefined,
    };
    delete r.visual;
  });
}
// Only the local panel route calls this. MCP never exposes confirmation.
export function confirmBehavior(repo: string, id: string, revision: number, behaviorId: string) {
  return mutate(repo, id, revision, 'Behavior confirmed', (r) => {
    const b = r.behavioral;
    if (!b?.issue?.options.some((o) => o.id === behaviorId))
      throw new InputError('Unknown behavior.');
    b.intent = {
      issueId: b.issue.id,
      behaviorId,
      confirmedAt: new Date().toISOString(),
      origin: 'human-panel',
    };
    delete b.proposal;
    delete b.verification;
  });
}
export function submitProposal(
  repo: string,
  id: string,
  revision: number,
  input: z.infer<typeof proposalSchema>,
) {
  const data = proposalSchema.parse(input);
  return mutate(repo, id, revision, 'Exact proposal saved', (r) => {
    const b = r.behavioral;
    if (
      !b?.intent ||
      data.sourceVersion !== sourceVersion(r) ||
      data.issueId !== b.intent.issueId ||
      data.behaviorId !== b.intent.behaviorId ||
      data.path !== r.files[0].path
    )
      throw new InputError(
        'Proposal must match the current source, issue, and panel-confirmed behavior.',
      );
    if (Buffer.byteLength(data.source) > 100000) throw new InputError('Proposal exceeds 100 KB.');
    const parsed = ts.createSourceFile(data.path, data.source, ts.ScriptTarget.Latest, true);
    if ((parsed as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length)
      throw new InputError('Proposal has invalid TypeScript syntax.');
    b.proposal = {
      path: data.path,
      source: data.source,
      hash: hash(data.source),
      rationale: data.rationale,
      submittedAt: new Date().toISOString(),
    };
    delete b.verification;
  });
}
function binding(r: Review, store: LocalStore, c: LocalConfig = store.config()) {
  return hash(
    JSON.stringify({
      source: sourceVersion(r),
      issue: r.behavioral?.issue,
      intent: r.behavioral?.intent,
      proposal: r.behavioral?.proposal,
      checks: c.checks,
      image: c.verificationImage,
    }),
  );
}
export function assertVerified(r: Review, store: LocalStore) {
  scope(r);
  const b = r.behavioral,
    v = b?.verification;
  if (
    !b?.intent ||
    !b.proposal ||
    !v ||
    v.status !== 'passed' ||
    v.binding !== binding(r, store) ||
    v.image !== store.config().verificationImage ||
    JSON.stringify(v.checks) !== JSON.stringify(store.config().checks) ||
    v.candidateHash !== hash(b.proposal.source) ||
    v.baseline.length !== v.checks.length ||
    v.baseline.some((c) => c.status !== 'passed' && c.status !== 'failed') ||
    v.candidate.length !== v.checks.length ||
    !v.candidate.length ||
    v.candidate.some((c) => c.status !== 'passed')
  )
    throw new InputError(
      'Passing isolated verification for the exact current proposal and confirmed behavior is required.',
    );
}
export async function verifyProposal(
  repo: string,
  id: string,
  revision: number,
  signal?: AbortSignal,
) {
  const store = new LocalStore(repo);
  const snapshot = store.get(id);
  if (snapshot.revision !== revision) throw new InputError('Review changed. Read it again.');
  scope(snapshot);
  if (!snapshot.behavioral?.intent || !snapshot.behavioral.proposal)
    throw new InputError('Confirm behavior and submit an exact proposal first.');
  const c = store.config(),
    expectedBinding = binding(snapshot, store, c);
  if (!c.checks.length || c.checks.length > 10)
    throw new InputError('Configure between one and ten trusted checks before verification.');
  const image = verificationImage(c.verificationImage);
  const baseline = combinedSource(snapshot),
    files = pinnedProject(snapshot);
  const r = mutate(repo, id, revision, 'Isolated verification started', (r) => {
    if (binding(r, store) !== expectedBinding)
      throw new InputError('Verification configuration changed during preparation.');
    r.behavioral!.verification = {
      id: randomUUID(),
      binding: binding(r, store),
      image,
      status: 'running',
      baselineHash: hash(baseline),
      candidateHash: r.behavioral!.proposal!.hash,
      projectHash: projectHash(files),
      checks: c.checks,
      baseline: [],
      candidate: [],
      startedAt: new Date().toISOString(),
    };
  });
  const v = r.behavioral!.verification!,
    proposal = r.behavioral!.proposal!;
  try {
    v.baseline = await runIsolated(files!, proposal.path, baseline, v.checks, v.image, signal);
    v.candidate = await runIsolated(
      files!,
      proposal.path,
      proposal.source,
      v.checks,
      v.image,
      signal,
    );
    v.status =
      v.baseline.every((c) => c.status === 'passed' || c.status === 'failed') &&
      v.candidate.every((c) => c.status === 'passed')
        ? 'passed'
        : 'failed';
  } catch (error) {
    v.status = signal?.aborted ? 'cancelled' : 'error';
    v.error = (error as Error).message;
  }
  v.completedAt = new Date().toISOString();
  return store.lock(() => {
    const current = store.get(id);
    scope(current);
    if (
      current.revision !== r.revision ||
      current.behavioral?.verification?.id !== v.id ||
      binding(current, store) !== v.binding
    )
      throw new InputError(
        'Review or verification inputs changed while checks ran. Results were discarded.',
      );
    current.behavioral!.verification = v;
    current.revision++;
    current.updatedAt = v.completedAt!;
    current.events.push({
      at: current.updatedAt,
      action: 'Isolated verification completed',
      detail: `${v.status}; baseline ${v.baselineHash}; candidate ${v.candidateHash}; image ${v.image}`,
      reviewer: 'Fuse backend execution',
    });
    store.save(current);
    return current;
  });
}

export function configureVerification(repo: string, image: string) {
  verificationImage(image);
  const store = new LocalStore(repo);
  return store.lock(() => {
    const c = store.config();
    c.verificationImage = image;
    store.write('config.json', c);
    return c;
  });
}
