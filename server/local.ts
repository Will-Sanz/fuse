import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  analyze,
  explain,
  hash,
  InputError,
  previewDecision,
  resolve as reconcile,
} from './engine';
import { blob, commit, commonDir, git, isClean, root, safePath, snapshot, worktrees } from './git';
import { LocalStore } from './local-store';
import type { Decision } from '../shared/types';
import type {
  CheckCommand,
  InspectOptions,
  Intent,
  Recommendation,
  Review,
  ReviewFile,
  SourceRef,
} from '../shared/review';

const stale = (
  message = 'Review is stale. Inspect the current changes and approve a new preview.',
) => Object.assign(new InputError(message), { status: 409 });
export const decisionSchema = z
  .object({
    choice: z.enum(['a', 'b', 'both', 'reviewed']),
    order: z.enum(['a-first', 'b-first']).optional(),
    note: z.string().trim().min(1, 'Record a decision rationale.').max(2000),
  })
  .strict();
const checkSchema = z
  .object({
    name: z.string().min(1).max(100),
    command: z.string().min(1).max(1000),
    args: z.array(z.string().max(4000)).max(50),
    timeoutMs: z.number().int().min(100).max(120000),
  })
  .strict();
export const intentSchema = z
  .object({ first: z.enum(['a', 'b']), rationale: z.string().trim().min(1).max(2000) })
  .strict();
const localIdentity = (repo: string) => {
  const value = (key: string) => {
    try {
      return git(repo, ['config', '--get', key]);
    } catch {
      return '';
    }
  };
  return {
    kind: 'local-git' as const,
    name: value('user.name') || 'Unconfigured local user',
    email: value('user.email'),
    verified: false as const,
  };
};
function recommendations(file: ReviewFile, intent?: Intent): Recommendation[] {
  return file.analysis.conflicts.map((c) => {
    const actions: Recommendation['actions'] =
      c.kind === 'dependency'
        ? [
            {
              label: 'Acknowledge possible interaction',
              decision: { choice: 'reviewed', note: '' },
            },
          ]
        : [
            { label: 'Keep A', decision: { choice: 'a', note: '' } },
            { label: 'Keep B', decision: { choice: 'b', note: '' } },
            ...(c.canCombine
              ? [
                  {
                    label: 'Merge both · A then B',
                    decision: { choice: 'both' as const, order: 'a-first' as const, note: '' },
                  },
                  {
                    label: 'Merge both · B then A',
                    decision: { choice: 'both' as const, order: 'b-first' as const, note: '' },
                  },
                ]
              : []),
          ];
    if (c.canCombine && intent)
      return {
        conflictId: c.id,
        actions,
        action: {
          choice: 'both',
          order: intent.first === 'a' ? 'a-first' : 'b-first',
          note: intent.rationale,
        },
        confidence: 'intent-guided',
        reason: `Keep both additions, with ${intent.first.toUpperCase()} first where they meet. ${intent.rationale.replace(/[.!?]+$/, '')}. Run the configured checks to verify the behavior.`,
      };
    return {
      conflictId: c.id,
      actions,
      confidence: 'static',
      reason:
        c.kind === 'dependency'
          ? 'Both edits can be retained, but a shared possible call path needs review. This is not proof of a runtime conflict.'
          : c.canCombine
            ? 'Both bodies add statements to unchanged anchors. Either order is supported, but the desired behavior is not known.'
            : c.combineReason,
      question: c.canCombine
        ? `When both changes in ${c.functions.join(', ')} can affect the result, should A or B run first at their shared insertion points?`
        : c.kind === 'dependency'
          ? 'Are the changed return values and caller assumptions compatible?'
          : 'Which complete version matches the intended behavior? Keep the other work for manual reconciliation if needed.',
    };
  });
}
export function registerSession(repo: string, id: string, name: string, worktree: string) {
  if (!/^[\w-]{1,64}$/.test(id) || !name.trim() || name.length > 100)
    throw new InputError('Use a short session ID and a non-empty display name.');
  const store = new LocalStore(repo),
    path = root(worktree);
  if (commonDir(path) !== commonDir(store.repo) || !worktrees(store.repo).includes(path))
    throw new InputError('Register a Git worktree belonging to this repository.');
  return store.lock(() => {
    const config = store.config();
    if (config.sessions.some((s) => s.id !== id && s.worktree === path))
      throw new InputError('This worktree already has a registered session.');
    const session = {
      id,
      name: name.trim(),
      worktree: path,
      registeredAt: new Date().toISOString(),
    };
    config.sessions = config.sessions.some((s) => s.id === id)
      ? config.sessions.map((s) => (s.id === id ? session : s))
      : [...config.sessions, session];
    if (config.sessions.length > 2)
      throw new InputError(
        'This release supports two registered sessions. Remove a session first.',
      );
    store.write('config.json', config);
    return session;
  });
}
export function removeSession(repo: string, id: string) {
  const store = new LocalStore(repo);
  return store.lock(() => {
    const c = store.config();
    c.sessions = c.sessions.filter((s) => s.id !== id);
    store.write('config.json', c);
    return c.sessions;
  });
}
export function configureCheck(repo: string, check: CheckCommand) {
  check = checkSchema.parse(check);
  const store = new LocalStore(repo);
  return store.lock(() => {
    const c = store.config();
    c.checks = [...c.checks.filter((x) => x.name !== check.name), check];
    store.write('config.json', c);
    return c.checks;
  });
}
export function inspect(options: InspectOptions, persist = true): Review {
  const store = new LocalStore(options.repo),
    repo = store.repo;
  let refs: SourceRef[];
  if (options.sessions) {
    if (options.a || options.b)
      throw new InputError('Choose registered sessions or revision flags.');
    const sessions = store.config().sessions;
    if (sessions.length !== 2) throw new InputError('Register exactly two sessions first.');
    refs = sessions.map((s) => ({
      kind: 'worktree',
      value: s.worktree,
      label: s.name,
      sessionId: s.id,
    }));
  } else
    refs = [
      options.a
        ? { kind: 'revision', value: commit(repo, options.a), label: options.a }
        : { kind: 'worktree', value: repo, label: 'Working changes (unattributed)' },
      {
        kind: 'revision',
        value: commit(repo, options.b || options.base || (options.a ? `${options.a}^` : 'HEAD')),
        label: options.b || 'Common base',
      },
    ];
  const heads = refs.map((ref) =>
    commit(
      ref.kind === 'worktree' ? ref.value : repo,
      ref.kind === 'worktree' ? 'HEAD' : ref.value,
    ),
  );
  const base = options.base ? commit(repo, options.base) : git(repo, ['merge-base', ...heads]);
  for (const head of heads)
    if (git(repo, ['merge-base', base, head]) !== base)
      throw new InputError('The selected base must be an ancestor of both inputs.');
  const [a, b] = refs.map((ref) => snapshot(repo, base, ref));
  const files: ReviewFile[] = [],
    unsupported: Review['unsupported'] = [];
  const paths = [...new Set([...Object.keys(a.files), ...Object.keys(b.files)])].sort();
  for (const path of paths) {
    const original = blob(repo, base, path),
      left = a.files[path] || original,
      right = b.files[path] || original;
    const reason =
      !path.endsWith('.ts') || path.endsWith('.d.ts')
        ? 'Only TypeScript source (.ts) is analyzed. This change is retained for manual review.'
        : [original, left, right].find((s) => s.unsupported)?.unsupported ||
          ([original, left, right].some((s) => !['100644', 'absent'].includes(s.mode))
            ? 'Executable, symlink, submodule, or mode changes require manual review.'
            : left.mode !== right.mode &&
                left.hash !== original.hash &&
                right.hash !== original.hash &&
                !left.code &&
                !right.code
              ? 'One side deletes this file and the other keeps an empty file. Reconcile the file presence manually.'
              : undefined);
    if (reason) {
      unsupported.push({ path, reason });
      continue;
    }
    const input = {
      title: path,
      fileName: path,
      base: original.code || '',
      agentA: left.code || '',
      agentB: right.code || '',
      nameA: a.ref.label,
      nameB: b.ref.label,
    };
    try {
      const file: ReviewFile = {
        path,
        input,
        analysis: analyze(input),
        ...explain(input),
        decisions: {},
        recommendations: [],
      };
      file.recommendations = recommendations(file);
      files.push(file);
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      unsupported.push({ path, reason: error.message });
    }
  }
  const now = new Date().toISOString();
  const review: Review = {
    schemaVersion: 1,
    id: randomUUID(),
    revision: 0,
    title: options.sessions
      ? 'Registered session review'
      : options.b
        ? 'Revision review'
        : 'Your current change',
    repository: repo,
    commonDir: commonDir(repo),
    baseCommit: base,
    targetHead: commit(repo, 'HEAD'),
    sources: { a, b },
    files,
    unsupported,
    status: 'proposed',
    createdAt: now,
    updatedAt: now,
    checks: [],
    events: [],
    attribution: localIdentity(repo),
  };
  event(
    review,
    'Inspected',
    `${paths.length} changed files; ${files.reduce((n, f) => n + f.analysis.conflicts.length, 0)} review decisions. Explicit registration is the only source of session attribution.`,
  );
  if (persist) store.lock(() => store.save(review));
  return review;
}
function event(review: Review, action: string, detail: string) {
  review.updatedAt = new Date().toISOString();
  review.events.push({
    at: review.updatedAt,
    action,
    detail,
    reviewer: `${localIdentity(review.repository).name} (local Git attribution; unverified)`,
  });
}
function current(store: LocalStore, id: string, revision: number) {
  const review = store.get(id);
  if (review.revision !== revision) throw stale();
  return review;
}
export function assertFresh(review: Review) {
  const registered = new LocalStore(review.repository).config().sessions;
  for (const source of Object.values(review.sources))
    if (
      source.ref.sessionId &&
      !registered.some(
        (s) =>
          s.id === source.ref.sessionId &&
          s.name === source.ref.label &&
          s.worktree === source.ref.value,
      )
    )
      throw stale(
        'Session registration changed. Inspect again to capture the current attribution.',
      );
  for (const source of Object.values(review.sources))
    if (
      snapshot(review.repository, review.baseCommit, source.ref).fingerprint !== source.fingerprint
    )
      throw stale('Input revisions or worktree contents changed. Inspect again before applying.');
  if (commit(review.repository, 'HEAD') !== review.targetHead)
    throw stale('Target HEAD changed. Inspect again before applying.');
}
export function decide(
  repo: string,
  id: string,
  revision: number,
  path: string,
  conflictId: string,
  decision: Decision,
) {
  decision = decisionSchema.parse(decision);
  const store = new LocalStore(repo);
  return store.lock(() => {
    const r = current(store, id, revision);
    if (r.status !== 'proposed')
      throw new InputError('Applied reviews are immutable. Start a new review.');
    assertFresh(r);
    const file = r.files.find((f) => f.path === path),
      conflict = file?.analysis.conflicts.find((c) => c.id === conflictId);
    if (!file || !conflict) throw new InputError('Unknown file or decision.');
    previewDecision(file.input, conflict, decision);
    file.decisions[conflictId] = decision;
    delete r.preview;
    r.revision++;
    event(
      r,
      'Decision saved',
      `${path} · ${conflictId}: ${decision.choice} ${decision.order || ''}. ${decision.note}`,
    );
    store.save(r);
    return r;
  });
}
export function setIntent(repo: string, id: string, revision: number, intent: Intent) {
  intent = intentSchema.parse(intent);
  const store = new LocalStore(repo);
  return store.lock(() => {
    const r = current(store, id, revision);
    if (r.status !== 'proposed') throw new InputError('Applied reviews are immutable.');
    assertFresh(r);
    r.intent = intent;
    delete r.preview;
    r.revision++;
    for (const file of r.files) file.recommendations = recommendations(file, intent);
    event(r, 'Intent recorded', intent.rationale);
    store.save(r);
    return r;
  });
}
export function preview(repo: string, id: string, revision: number) {
  const store = new LocalStore(repo);
  return store.lock(() => {
    const r = current(store, id, revision);
    if (r.status !== 'proposed') throw new InputError('This review was already applied.');
    assertFresh(r);
    if (r.unsupported.length)
      throw new InputError(
        'Unsupported changes require manual review; application is blocked so no work is silently discarded.',
      );
    if (!r.files.length) throw new InputError('There are no changed TypeScript files.');
    if (r.files.length > 1)
      throw new InputError(
        'Automatic application supports one TypeScript file per review. Review all files in the evidence, then reconcile this multi-file change manually.',
      );
    const outputs: Record<string, string | null> = {},
      hashes: Record<string, string> = {};
    for (const f of r.files) {
      const output = reconcile(f.input, f.decisions, f.analysis);
      // An empty source is distinct from deletion: use the selected source's presence.
      const side = f.decisions.file?.choice;
      const deleted =
        output === '' &&
        (side === 'a'
          ? r.sources.a.files[f.path]?.mode === 'absent'
          : side === 'b'
            ? r.sources.b.files[f.path]?.mode === 'absent'
            : [r.sources.a, r.sources.b].some((s) => s.files[f.path]?.mode === 'absent'));
      outputs[f.path] = deleted ? null : output;
      hashes[f.path] = hash(JSON.stringify(outputs[f.path]));
    }
    const checks = store.config().checks;
    r.preview = {
      token: hash(
        JSON.stringify({
          outputs,
          checks,
          sources: r.sources,
          decisions: r.files.map((f) => f.decisions),
          revision: r.revision,
        }),
      ),
      outputs,
      hashes,
      checks,
      createdAt: new Date().toISOString(),
    };
    r.revision++;
    event(
      r,
      'Result previewed',
      `Preview ${r.preview.token}; ${checks.length} explicitly configured checks.`,
    );
    store.save(r);
    return r;
  });
}
function readTarget(repo: string, path: string) {
  const p = safePath(repo, path);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}
export function applyReview(repo: string, id: string, revision: number, token: string) {
  const store = new LocalStore(repo);
  return store.lock(() => {
    const r = current(store, id, revision);
    if (r.status !== 'proposed' || !r.preview || token !== r.preview.token)
      throw stale('Approve the exact current preview token before applying.');
    assertFresh(r);
    if (!isClean(r.repository))
      throw stale(
        'Target has uncommitted or untracked work. Commit or preserve it before applying; Fuse will not overwrite it.',
      );
    if (r.targetHead !== r.baseCommit)
      throw new InputError(
        'Apply from a clean target checkout at the common base. Create a base worktree and inspect there.',
      );
    if (JSON.stringify(store.config().checks) !== JSON.stringify(r.preview.checks))
      throw stale('Configured checks changed. Generate and approve a new preview.');
    const changes = Object.entries(r.preview.outputs);
    for (const [path] of changes)
      if (readTarget(r.repository, path) !== blob(r.repository, r.baseCommit, path).code)
        throw stale('Target content differs from the common base.');
    const staged: {
      path: string;
      full: string;
      temporary?: string;
      before: string | null;
      output: string | null;
    }[] = [];
    try {
      for (const [path, output] of changes) {
        const full = safePath(r.repository, path),
          before = readTarget(r.repository, path);
        const temporary =
          output === null ? undefined : join(dirname(full), `.fuse-${randomUUID()}.tmp`);
        mkdirSync(dirname(full), { recursive: true });
        if (temporary) writeFileSync(temporary, output!, { flag: 'wx', mode: 0o644 });
        staged.push({ path, full, temporary, before, output });
      }
      assertFresh(r);
      for (const edit of staged) {
        if (readTarget(r.repository, edit.path) !== edit.before)
          throw stale('Target changed during application. Newer work was preserved.');
        if (edit.temporary) renameSync(edit.temporary, edit.full);
        else if (existsSync(edit.full)) unlinkSync(edit.full);
      }
    } finally {
      for (const edit of staged)
        if (edit.temporary && existsSync(edit.temporary)) unlinkSync(edit.temporary);
    }
    r.status = 'applied';
    r.revision++;
    event(r, 'Applied', `Approved preview ${token}; changes are local and uncommitted.`);
    store.save(r);
    r.checks = r.preview.checks.map((check) => {
      const start = Date.now();
      const result = spawnSync(check.command, check.args, {
        cwd: r.repository,
        shell: false,
        timeout: check.timeoutMs,
        maxBuffer: 1024 * 1024,
        encoding: 'utf8',
        env: { ...process.env, FUSE_REVIEW_ID: r.id },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return {
        ...check,
        at: new Date(start).toISOString(),
        durationMs: Date.now() - start,
        exitCode: result.status,
        status: result.error
          ? (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
            ? ('timed-out' as const)
            : ('error' as const)
          : result.status === 0
            ? ('passed' as const)
            : ('failed' as const),
        stdout: (result.stdout || '').slice(0, 50000),
        stderr: (result.stderr || result.error?.message || '').slice(0, 50000),
      };
    });
    event(
      r,
      'Checks finished',
      r.checks.length
        ? r.checks.map((c) => `${c.name}: ${c.status} (exit ${c.exitCode})`).join('; ')
        : 'No checks configured. Behavior is unverified.',
    );
    if (changes.some(([p, output]) => readTarget(r.repository, p) !== output))
      event(
        r,
        'Output changed',
        'A configured check or another process changed the applied output. Commit linking is blocked until the recorded output is restored.',
      );
    store.save(r);
    return r;
  });
}
export function linkCommit(repo: string, id: string, revision: number, ref: string) {
  const store = new LocalStore(repo);
  return store.lock(() => {
    const r = current(store, id, revision);
    if (!r.preview || !['applied', 'committed'].includes(r.status))
      throw new InputError('Apply a review before linking a commit.');
    const sha = commit(repo, ref);
    if (sha === r.baseCommit || git(repo, ['merge-base', r.baseCommit, sha]) !== r.baseCommit)
      throw new InputError('Commit must descend from the reviewed base.');
    for (const [path, code] of Object.entries(r.preview.outputs)) {
      const output = blob(repo, sha, path);
      if (
        code === null
          ? output.mode !== 'absent'
          : output.code !== code || output.mode !== '100644' || output.unsupported
      )
        throw new InputError(`Commit does not contain the reviewed result: ${path}`);
    }
    r.commit = sha;
    r.status = 'committed';
    r.revision++;
    event(r, 'Commit linked', sha);
    store.save(r);
    return r;
  });
}
export function markMerged(repo: string, id: string, revision: number, ref: string) {
  const store = new LocalStore(repo);
  return store.lock(() => {
    const r = current(store, id, revision);
    if (r.status !== 'committed' || !r.commit)
      throw new InputError('Link the actual resolution commit first.');
    const sha = commit(repo, ref);
    const parents = git(repo, ['rev-list', '--parents', '-n', '1', sha]).split(' ').slice(1);
    if (
      parents.length < 2 ||
      git(repo, ['merge-base', r.commit, sha]) !== r.commit ||
      git(repo, ['merge-base', r.commit, parents[0]]) === r.commit
    )
      throw new InputError(
        'Merged status requires an actual merge commit that brings the resolution into its first-parent history. A later ordinary commit is not merge evidence.',
      );
    r.status = 'merged';
    r.mergedInto = sha;
    r.revision++;
    event(
      r,
      'Integration ancestry verified',
      `${r.commit} was integrated by merge commit ${sha} (${ref}). Local Git evidence; no remote PR status is inferred.`,
    );
    store.save(r);
    return r;
  });
}
export function watchOnce(options: InspectOptions) {
  const review = inspect({ ...options, sessions: true }, false),
    store = new LocalStore(options.repo);
  return store.lock(() => {
    const signature = hash(
      JSON.stringify({
        conflicts: review.files.flatMap((f) =>
          f.analysis.conflicts.map((c) => ({
            file: f.path,
            id: c.id,
            base: c.base,
            a: c.a,
            b: c.b,
          })),
        ),
        unsupported: review.unsupported,
      }),
    );
    const previous = store.read<{ signature?: string; reviewId?: string; fingerprint?: string }>(
      'watch.json',
      {},
    );
    const fingerprint = hash(JSON.stringify(review.sources));
    const attention =
      review.files.some((f) => f.analysis.conflicts.length) || review.unsupported.length > 0;
    const alert = attention && previous.signature !== signature;
    if (previous.fingerprint !== fingerprint || !previous.reviewId) store.save(review);
    const reviewId =
      previous.fingerprint === fingerprint && previous.reviewId ? previous.reviewId : review.id;
    store.write('watch.json', { signature, fingerprint, reviewId });
    return {
      schemaVersion: 1,
      alert,
      updated: previous.fingerprint !== fingerprint,
      review: store.get(reviewId),
    };
  });
}
