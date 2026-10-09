import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle,
  Code02,
  GitBranch01,
  LayersTwo01,
  Terminal,
  XClose,
  ArrowUpRight,
  RefreshCw01,
} from '@untitledui/icons';
import { Button } from './untitledui/components/base/buttons/button';
import { Input } from './untitledui/components/base/input/input';
import { TextArea } from './untitledui/components/base/textarea/textarea';
import { Badge, BadgeWithDot } from './untitledui/components/base/badges/badges';
import { Tabs, TabList, Tab, TabPanel } from './untitledui/components/application/tabs/tabs';
import { Modal, ModalOverlay, Dialog } from './untitledui/components/application/modals/modal';
import { LoadingIndicator } from './untitledui/components/application/loading-indicator/loading-indicator';
import { Tooltip, TooltipTrigger } from './untitledui/components/base/tooltip/tooltip';
import { ChangeGraph } from './components/ChangeGraph';
import type { Review, ReviewFile } from '../shared/review';
import type { Decision } from '../shared/types';
import { shellQuote } from '../shared/shell';

async function api<T>(path: string, data?: unknown): Promise<T> {
  const result = await fetch(
    `/api${path}`,
    data === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
  );
  const body = await result.json();
  if (!result.ok) throw new Error(body.error || 'The request failed. Try again.');
  return body;
}
const short = (s: string) => s.slice(0, 10);
function Source({ code, start = 1, label }: { code: string; start?: number; label: string }) {
  return (
    <pre className="source" aria-label={label}>
      <code>
        {code ? (
          code.split('\n').map((line, i) => (
            <span className="source-line" key={i}>
              <span className="line-number">{i + start}</span>
              <span>{line || ' '}</span>
            </span>
          ))
        ) : (
          <span className="empty-code">File or function removed</span>
        )}
      </code>
    </pre>
  );
}
function Summary({ review }: { review: Review }) {
  return (
    <section className="record-section">
      <div className="section-title">
        <div>
          <span className="eyebrow">DECISION RECORD</span>
          <h2>A result you can retrace.</h2>
        </div>
        <Badge color={review.status === 'proposed' ? 'gray' : 'success'}>{review.status}</Badge>
      </div>
      <dl className="record-grid">
        <div>
          <dt>Common base</dt>
          <dd>
            <code>{short(review.baseCommit)}</code>
          </dd>
        </div>
        <div>
          <dt>Review</dt>
          <dd>
            <code>{short(review.id)}</code>
          </dd>
        </div>
        <div>
          <dt>Reviewer</dt>
          <dd>{review.attribution.name}</dd>
        </div>
        <div>
          <dt>Identity</dt>
          <dd>Local Git attribution · unverified</dd>
        </div>
      </dl>
      {review.commit && (
        <div className="commit-reference">
          <CheckCircle />
          <span>
            Linked commit <code>{review.commit}</code>
          </span>
        </div>
      )}
      <ol className="timeline">
        {[...review.events].reverse().map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <div>
              <strong>{e.action}</strong>
              <time>{new Date(e.at).toLocaleString()}</time>
            </div>
            <p>{e.detail}</p>
            <small>{e.reviewer}</small>
          </li>
        ))}
      </ol>
      <Button
        href={`/api/reviews/${review.id}/audit`}
        color="secondary"
        iconTrailing={ArrowUpRight}
      >
        Export decision JSON
      </Button>
    </section>
  );
}
export default function App() {
  const [review, setReview] = useState<Review>();
  const [history, setHistory] = useState<{ id: string; title: string; status: string }[]>([]);
  const [mode, setMode] = useState('demo');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [notice, setNotice] = useState(''),
    [historyOpen, setHistoryOpen] = useState(false),
    [approveOpen, setApproveOpen] = useState(false);
  const [fileIndex, setFileIndex] = useState(0),
    [functionName, setFunctionName] = useState(''),
    [tab, setTab] = useState('change');
  const [note, setNote] = useState(''),
    [intentNote, setIntentNote] = useState(''),
    [commitRef, setCommitRef] = useState('HEAD');
  const [choice, setChoice] = useState<Record<string, Decision>>({});
  const file: ReviewFile | undefined = review?.files[fileIndex];
  const pending =
    review?.files.reduce(
      (sum, f) => sum + f.analysis.conflicts.filter((c) => !f.decisions[c.id]).length,
      0,
    ) || 0;
  const loadHistory = () => api<typeof history>('/reviews').then(setHistory);
  const accept = (r: Review) => {
    setReview(r);
    window.history.replaceState({}, '', `?review=${r.id}`);
  };
  async function load(id: string) {
    setLoading(true);
    setError('');
    try {
      accept(await api<Review>(`/reviews/${id}`));
      setFileIndex(0);
      setChoice({});
      setFunctionName('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    Promise.all([api<{ mode: string }>('/mode'), api<typeof history>('/reviews')])
      .then(([m, h]) => {
        if (!active) return;
        setMode(m.mode);
        setHistory(h);
        const id = new URLSearchParams(location.search).get('review');
        if (id) void load(id);
        else setLoading(false);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  async function action(run: () => Promise<Review>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await run();
      accept(r);
      setNotice(message);
      await loadHistory();
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const mutate = (endpoint: string, data: object = {}) =>
    api<Review>(`/reviews/${review!.id}/${endpoint}`, { revision: review!.revision, ...data });
  async function demo(single: boolean) {
    setFileIndex(0);
    setTab('change');
    setChoice({});
    setFunctionName('');
    setNote('');
    setIntentNote('');
    await action(
      () => api<Review>('/demo', { single }),
      'Real Git fixture created. The session edits are scripted; the analysis is generated from their worktrees.',
    );
  }
  const activeFunction =
    functionName ||
    file?.analysis.conflicts[0]?.functions[0] ||
    file?.analysis.changedA[0] ||
    file?.analysis.changedB[0];
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Fuse home">
          <span className="fuse-symbol">f</span>fuse
          <span className="wordmark-divider" />{' '}
          <span className="wordmark-caption">A little clarity for your code.</span>
        </a>
        <div className="topbar-actions">
          <BadgeWithDot color="success">Local companion</BadgeWithDot>
          <Button
            size="sm"
            color="tertiary"
            onClick={() => {
              setHistoryOpen(true);
              void loadHistory().catch((e) => setError(e.message));
            }}
          >
            History
          </Button>
        </div>
      </header>
      <main>
        {error && (
          <div className="message-error" role="alert">
            <strong>Couldn’t complete that step.</strong>
            <p>{error}</p>
            <Button
              color="secondary"
              size="sm"
              onClick={() => (review ? void load(review.id) : location.reload())}
              iconLeading={RefreshCw01}
            >
              Reload
            </Button>
          </div>
        )}
        {loading ? (
          <div className="loading-state" role="status">
            <LoadingIndicator label="Reading your review…" />
          </div>
        ) : !review ? (
          <div className="welcome">
            <div className="welcome-label">
              <span className="tiny-line" /> YOUR NEXT CHANGE, UNDERSTOOD
            </div>
            <h1>
              Keep the momentum.
              <br />
              <span>See where changes meet.</span>
            </h1>
            <p className="welcome-copy">
              A focused second look at your code. Understand what changed, work through the overlap,
              and keep the reason behind the result.
            </p>
            {mode === 'demo' && (
              <div className="welcome-actions">
                <Button
                  size="lg"
                  isLoading={busy}
                  onClick={() => void demo(false)}
                  iconTrailing={ArrowRight}
                >
                  Explore checkout demo
                </Button>
                <Button
                  size="lg"
                  color="secondary"
                  isDisabled={busy}
                  onClick={() => void demo(true)}
                >
                  See a single change
                </Button>
              </div>
            )}
            <p className="demo-caption">
              Scripted edits. Real Git worktrees, analysis, and test results. No API keys.
            </p>
            <div className="terminal-intro">
              <div className="terminal-bar">
                <Terminal />
                <span>Or start in your own repository</span>
                <Badge color="gray">TypeScript</Badge>
              </div>
              <pre>
                <span>$</span> fuse inspect{`\n`}
                <span>$</span> fuse session add request --name "Request validation" --worktree
                ../request{`\n`}
                <span>$</span> fuse watch
              </pre>
              <p>The CLI and this review window use the same engine.</p>
            </div>
            <div className="welcome-steps">
              <div>
                <span>01</span>
                <h3>Notice the change</h3>
                <p>Actual functions and local calls, with explicit session attribution.</p>
              </div>
              <div>
                <span>02</span>
                <h3>Make the decision</h3>
                <p>Source evidence, a behavior question, and a preview you can inspect.</p>
              </div>
              <div>
                <span>03</span>
                <h3>Keep the context</h3>
                <p>Recorded choices, real checks, and a link to the resulting commit.</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="review-breadcrumb">
              <GitBranch01 />
              <span title={review.repository}>{review.repository.split('/').at(-1)}</span>
              <span>/</span>
              <code>{file?.path || 'Current changes'}</code>
              <Badge color="gray">{review.demo ? 'Reproducible demo' : 'Local Git'}</Badge>
            </div>
            <div className="review-heading">
              <div>
                <h1>
                  {pending
                    ? 'Two changes. One decision.'
                    : review.status !== 'proposed'
                      ? 'The decision has a history.'
                      : file
                        ? 'Your change, in focus.'
                        : 'Nothing needs your attention.'}
                </h1>
                <p>
                  {pending
                    ? 'Follow the evidence, choose the behavior, and preview the result.'
                    : review.status !== 'proposed'
                      ? 'Review the applied result, check outcomes, and the reasoning that led here.'
                      : 'A useful explanation doesn’t need a conflict.'}
                </p>
              </div>
              <div className="heading-status">
                <BadgeWithDot color={pending ? 'warning' : 'success'}>
                  {review.status !== 'proposed'
                    ? review.status
                    : pending
                      ? `${pending} decision${pending === 1 ? '' : 's'} needed`
                      : 'No differing overlap'}
                </BadgeWithDot>
                <span>
                  Base <code>{short(review.baseCommit)}</code>
                </span>
              </div>
            </div>
            {notice && (
              <p className="notice" role="status">
                <CheckCircle />
                {notice}
              </p>
            )}
            {review.demo && (
              <div className="demo-note">
                <Terminal />
                <p>
                  <strong>Scripted checkout scenario.</strong> Fuse created a real repository and{' '}
                  {review.sources.a.ref.sessionId
                    ? 'two registered worktrees'
                    : 'an ordinary working change'}
                  .{' '}
                  {review.sources.a.ref.sessionId &&
                    'The configured checks expect a friendly message for missing fields, and a specific error for malformed email.'}
                </p>
              </div>
            )}
            <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
              <TabList type="underline" aria-label="Review sections" className="review-tabs">
                <Tab id="change">Change & decision</Tab>
                <Tab id="result">Result preview {review.preview ? '· ready' : ''}</Tab>
                <Tab id="record">Decision record</Tab>
              </TabList>
              <TabPanel id="change">
                <div className="session-strip">
                  {(['a', 'b'] as const).map((side) => (
                    <div className={`session-summary session-${side}`} key={side}>
                      <span className="session-avatar">{side.toUpperCase()}</span>
                      <div>
                        <strong>{review.sources[side].ref.label}</strong>
                        <p>
                          {review.sources[side].ref.sessionId
                            ? `Registered session · ${review.sources[side].ref.sessionId}`
                            : 'Revision / working copy · no agent inferred'}
                        </p>
                      </div>
                      <code>{short(review.sources[side].head)}</code>
                    </div>
                  ))}
                </div>
                {review.unsupported.length > 0 && (
                  <section className="manual-review">
                    <h2>These changes need manual review</h2>
                    {review.unsupported.map((u) => (
                      <p key={u.path}>
                        <code>{u.path}</code> — {u.reason}
                      </p>
                    ))}
                    <p>All changes remain in their worktrees. Automatic application is blocked.</p>
                  </section>
                )}
                {review.files.length > 1 && (
                  <div className="file-choices" aria-label="Changed files">
                    {review.files.map((f, i) => (
                      <Button
                        key={f.path}
                        color={i === fileIndex ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => {
                          setFileIndex(i);
                          setFunctionName('');
                        }}
                      >
                        {f.path}
                      </Button>
                    ))}
                    <p>
                      Multi-file analysis is available; this release applies one TypeScript file at
                      a time.
                    </p>
                  </div>
                )}
                {file ? (
                  <>
                    <section className="graph-section">
                      <div className="section-title">
                        <div>
                          <span className="eyebrow">THE SHAPE OF THE CHANGE</span>
                          <h2>
                            {file.analysis.conflicts[0]?.kind === 'overlap'
                              ? `The work meets at ${file.analysis.conflicts[0].functions[0]}.`
                              : file.analysis.conflicts[0]?.kind === 'dependency'
                                ? 'Connected functions need a closer look.'
                                : 'Here’s what changed.'}
                          </h2>
                        </div>
                        <Tooltip
                          title="Static evidence"
                          description="Arrows show resolved local calls. They do not prove runtime execution order or a behavioral conflict."
                        >
                          <TooltipTrigger>
                            <Badge color="gray">Static call relationships</Badge>
                          </TooltipTrigger>
                        </Tooltip>
                      </div>
                      <div className="graph-comparison">
                        {(['base', 'a', 'b'] as const).map((side) => (
                          <div className={`graph-snapshot snapshot-${side}`} key={side}>
                            <div className="graph-snapshot-label">
                              <span>
                                {side === 'base' ? 'Before' : `Change ${side.toUpperCase()}`}
                              </span>
                              <small>
                                {side === 'base'
                                  ? short(review.baseCommit)
                                  : review.sources[side].ref.label}
                              </small>
                            </div>
                            <ChangeGraph
                              nodes={file.graphs[side]}
                              changed={
                                side === 'base'
                                  ? []
                                  : file.analysis[side === 'a' ? 'changedA' : 'changedB']
                              }
                              focus={[activeFunction || '']}
                              onSelect={setFunctionName}
                              label={`${side === 'base' ? 'Before' : `Change ${side.toUpperCase()}`} call graph`}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="graph-footnote">
                        <span>
                          <i className="legend-focus" />
                          Attention point
                        </span>
                        <span>
                          <i className="legend-change" />
                          Changed function
                        </span>
                        <span>
                          Calls show relationships, not execution order. Select a function for its
                          source.
                        </span>
                      </div>
                    </section>
                    <section className="evidence-section">
                      <div className="section-title">
                        <div>
                          <span className="eyebrow">SOURCE EVIDENCE</span>
                          <h2>{activeFunction || file.path}</h2>
                        </div>
                        <Badge color="gray">
                          {file.analysis.conflicts.some((c) => c.kind === 'overlap')
                            ? 'Shared code · behavior unverified'
                            : 'Generated from TypeScript'}
                        </Badge>
                      </div>
                      <div className="evidence-columns">
                        {(['a', 'b'] as const).map((side) => {
                          const e = file.evidence.find(
                              (e) => e.revision === side && e.function === activeFunction,
                            ),
                            base = file.evidence.find(
                              (e) => e.revision === 'base' && e.function === activeFunction,
                            ),
                            sourceLine =
                              e?.line ??
                              file.graphs[side].find((n) => n.id === activeFunction)?.line ??
                              base?.line;
                          return (
                            <article className={`evidence-card evidence-${side}`} key={side}>
                              <div className="evidence-title">
                                <span>{side.toUpperCase()}</span>
                                <h3>{review.sources[side].ref.label}</h3>
                              </div>
                              {e ? (
                                <ul>
                                  {e.observations.map((o) => (
                                    <li key={o}>{o}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="unchanged-copy">
                                  {base
                                    ? 'This function is unchanged from the common base.'
                                    : 'This function is not present in this snapshot.'}
                                </p>
                              )}
                              <div className="source-ref">
                                <Code02 />
                                <code>
                                  {file.path}:{sourceLine || 1}
                                </code>
                                <span>
                                  {e?.code === '' ? 'removed · base location' : 'source snapshot'}
                                </span>
                              </div>
                              <Source
                                code={e?.code ?? base?.code ?? ''}
                                start={sourceLine}
                                label={`${side.toUpperCase()} source for ${activeFunction}`}
                              />
                            </article>
                          );
                        })}
                      </div>
                    </section>
                    {file.recommendations.map((rec) => {
                      const c = file.analysis.conflicts.find((c) => c.id === rec.conflictId)!,
                        saved = file.decisions[c.id],
                        selected = choice[c.id] || saved || rec.action;
                      return (
                        <section className="decision-section" key={rec.conflictId}>
                          <div className="decision-heading">
                            <span className="decision-icon">
                              <LayersTwo01 />
                            </span>
                            <div>
                              <span className="eyebrow">
                                {rec.action ? 'RECOMMENDED NEXT STEP' : 'A BEHAVIOR QUESTION'}
                              </span>
                              <h2>
                                {rec.action
                                  ? rec.actions.find(
                                      (a) =>
                                        a.decision.choice === rec.action?.choice &&
                                        a.decision.order === rec.action?.order,
                                    )?.label
                                  : c.title}
                              </h2>
                            </div>
                            {saved && <Badge color="success">Decision saved</Badge>}
                          </div>
                          <p className="recommendation-copy">{rec.reason}</p>
                          {rec.question && <p className="intent-question">{rec.question}</p>}
                          {c.canCombine && review.status === 'proposed' && (
                            <div className="intent-controls">
                              <Input
                                label="Desired behavior"
                                placeholder="e.g. Missing fields should get the friendly error first"
                                value={intentNote}
                                onChange={setIntentNote}
                              />
                              <div>
                                <Button
                                  size="sm"
                                  color="secondary"
                                  isDisabled={busy || !intentNote.trim()}
                                  onClick={() =>
                                    void action(
                                      () =>
                                        mutate('intent', {
                                          intent: { first: 'a', rationale: intentNote },
                                        }),
                                      'Intent recorded. Recommendation updated.',
                                    )
                                  }
                                >
                                  A checks first
                                </Button>
                                <Button
                                  size="sm"
                                  color="secondary"
                                  isDisabled={busy || !intentNote.trim()}
                                  onClick={() =>
                                    void action(
                                      () =>
                                        mutate('intent', {
                                          intent: { first: 'b', rationale: intentNote },
                                        }),
                                      'Intent recorded. Recommendation updated.',
                                    )
                                  }
                                >
                                  B checks first
                                </Button>
                              </div>
                            </div>
                          )}
                          <div className="resolution-choices" aria-label={`Choices for ${c.id}`}>
                            {rec.actions.map((a) => (
                              <Button
                                key={a.label}
                                color={
                                  selected?.choice === a.decision.choice &&
                                  selected?.order === a.decision.order
                                    ? 'primary'
                                    : 'secondary'
                                }
                                isDisabled={busy || review.status !== 'proposed'}
                                onClick={() => setChoice({ ...choice, [c.id]: a.decision })}
                                aria-pressed={
                                  selected?.choice === a.decision.choice &&
                                  selected?.order === a.decision.order
                                }
                              >
                                {a.label}
                              </Button>
                            ))}
                          </div>
                          {review.status === 'proposed' ? (
                            <div className="decision-save">
                              <TextArea
                                label="Decision rationale"
                                placeholder="Why does this choice match the desired behavior?"
                                value={note}
                                onChange={setNote}
                                rows={2}
                              />
                              <Button
                                isDisabled={
                                  !selected || !(note.trim() || selected.note?.trim()) || busy
                                }
                                isLoading={busy}
                                onClick={() =>
                                  void action(
                                    () =>
                                      mutate('decide', {
                                        path: file.path,
                                        conflictId: c.id,
                                        decision: {
                                          ...selected,
                                          note: note.trim() || selected?.note,
                                        },
                                      }),
                                    'Decision saved. Preview the complete result next.',
                                  ).then((r) => {
                                    if (r) {
                                      setChoice({});
                                      setNote('');
                                    }
                                  })
                                }
                                iconTrailing={CheckCircle}
                              >
                                Save decision
                              </Button>
                            </div>
                          ) : (
                            <p className="saved-rationale">{saved?.note}</p>
                          )}
                        </section>
                      );
                    })}
                    {!file.analysis.conflicts.length && (
                      <section className="clean-change">
                        <CheckCircle />
                        <div>
                          <h2>No differing overlap to resolve.</h2>
                          <p>
                            {file.analysis.changedB.length
                              ? 'Independent or identical edits can be retained. Review the evidence and test the result.'
                              : 'This change stands on its own. Review the new guards, calls, and return values above.'}
                          </p>
                        </div>
                      </section>
                    )}
                    {review.status === 'proposed' && (
                      <div className="next-step">
                        <div>
                          <strong>
                            {pending
                              ? `${pending} decision${pending === 1 ? '' : 's'} to save`
                              : 'Ready to see the complete result'}
                          </strong>
                          <p>A preview leaves your source files untouched.</p>
                        </div>
                        <Button
                          isDisabled={
                            pending > 0 ||
                            busy ||
                            review.unsupported.length > 0 ||
                            review.files.length > 1
                          }
                          isLoading={busy}
                          iconTrailing={ArrowRight}
                          onClick={() =>
                            void action(
                              () => mutate('preview'),
                              'Result preview generated. Source files are unchanged.',
                            ).then((r) => {
                              if (r) setTab('result');
                            })
                          }
                        >
                          Preview result
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="empty-review">
                    <CheckCircle />
                    <h2>No changed TypeScript functions</h2>
                    <p>Make a change, then run Fuse inspect again to capture it.</p>
                  </div>
                )}
                <details className="limitations">
                  <summary>Analysis scope and source references</summary>
                  <p>
                    TypeScript named top-level functions; direct local calls only. Callbacks,
                    external calls, dynamic dispatch, and cross-file relationships are not modeled.
                    Shared code and possible interactions are review evidence, not proven runtime
                    conflicts.
                  </p>
                  <p>
                    Inputs are pinned snapshots. Run inspect or watch again to capture further work.
                    Unsupported files require manual review.
                  </p>
                  {file?.analysis.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </details>
              </TabPanel>
              <TabPanel id="result">
                {review.preview ? (
                  <section className="result-section">
                    <div className="section-title">
                      <div>
                        <span className="eyebrow">
                          {review.status === 'proposed' ? 'BEFORE YOU APPLY' : 'APPLIED RESULT'}
                        </span>
                        <h2>
                          {review.status === 'proposed'
                            ? 'Read the result. Then make it real.'
                            : 'The code and its check results.'}
                        </h2>
                      </div>
                      <Badge color={review.status === 'proposed' ? 'gray' : 'success'}>
                        {review.status}
                      </Badge>
                    </div>
                    <p>
                      Preview <code>{short(review.preview.token)}</code> · exact output hashes are
                      saved in the decision record.
                    </p>
                    {Object.entries(review.preview.outputs).map(([path, code]) => (
                      <div className="output-file" key={path}>
                        <div className="source-ref">
                          <Code02 />
                          <code>{path}</code>
                          <Badge color="gray">
                            {code === null ? 'delete file' : 'proposed contents'}
                          </Badge>
                        </div>
                        <Source code={code ?? ''} label={`Proposed result for ${path}`} />
                      </div>
                    ))}
                    <section className="checks">
                      <h3>Configured checks</h3>
                      {review.preview.checks.length ? (
                        review.preview.checks.map((c) => (
                          <div className="check-row" key={c.name}>
                            <Terminal />
                            <div>
                              <strong>{c.name}</strong>
                              <code>{[c.command, ...c.args].join(' ')}</code>
                            </div>
                            <Badge color="gray">{c.timeoutMs / 1000}s limit</Badge>
                          </div>
                        ))
                      ) : (
                        <p>
                          No checks configured. Behavior remains unverified. Configure a check
                          explicitly from the CLI.
                        </p>
                      )}
                      {review.checks.map((c) => (
                        <details className="check-result" key={c.name} open={c.status !== 'passed'}>
                          <summary>
                            <Badge color={c.status === 'passed' ? 'success' : 'error'}>
                              {c.status}
                            </Badge>
                            <strong>{c.name}</strong>
                            <span>
                              {c.durationMs} ms · exit {c.exitCode ?? 'none'}
                            </span>
                          </summary>
                          <pre>
                            {c.stdout}
                            {c.stderr}
                          </pre>
                        </details>
                      ))}
                    </section>
                    {review.status === 'proposed' ? (
                      <div className="next-step">
                        <div>
                          <strong>Apply this exact preview</strong>
                          <p>
                            Fuse will verify the inputs and target, then run the commands listed
                            above.
                          </p>
                        </div>
                        <Button
                          isDisabled={busy}
                          onClick={() => setApproveOpen(true)}
                          iconTrailing={ArrowRight}
                        >
                          Approve & apply
                        </Button>
                      </div>
                    ) : (
                      <div className="commit-link">
                        <h3>{review.commit ? 'Commit linked' : 'Finish in your Git workflow'}</h3>
                        <p>
                          {review.commit
                            ? 'Fuse verified that this commit contains the recorded output.'
                            : 'Commit the reviewed change with your usual Git tools, then link it here. Applied work is not yet committed or merged.'}
                        </p>
                        {!review.commit && (
                          <>
                            <pre>
                              git -C {shellQuote(review.repository)} add --{' '}
                              {Object.keys(review.preview.outputs).map(shellQuote).join(' ')}
                              {`\n`}git -C {shellQuote(review.repository)} commit -m "Resolve
                              checkout review"
                            </pre>
                            <div className="link-form">
                              <Input
                                label="Resulting Git commit"
                                value={commitRef}
                                onChange={setCommitRef}
                              />
                              <Button
                                color="secondary"
                                isDisabled={busy || !commitRef.trim()}
                                onClick={() =>
                                  void action(
                                    () => mutate('link', { commit: commitRef }),
                                    'Git commit verified and linked.',
                                  ).then((r) => {
                                    if (r) setTab('record');
                                  })
                                }
                              >
                                Link commit
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </section>
                ) : (
                  <div className="empty-review">
                    <Code02 />
                    <h2>No result preview yet</h2>
                    <p>Review the change and save any required decisions first.</p>
                    <Button color="secondary" onClick={() => setTab('change')}>
                      Return to the change
                    </Button>
                  </div>
                )}
              </TabPanel>
              <TabPanel id="record">
                <Summary review={review} />
              </TabPanel>
            </Tabs>
            {mode === 'demo' && (
              <div className="demo-reset">
                <Button
                  color="tertiary"
                  size="sm"
                  isDisabled={busy}
                  onClick={() => void demo(false)}
                >
                  New checkout demo
                </Button>
                <Button
                  color="tertiary"
                  size="sm"
                  isDisabled={busy}
                  onClick={() => void demo(true)}
                >
                  Explore a single change
                </Button>
              </div>
            )}
          </>
        )}
      </main>
      <footer>
        <span>
          fuse <span>·</span> Understand the change. Keep the context.
        </span>
        <a href="https://github.com/Will-Sanz/fuse" target="_blank" rel="noreferrer">
          Source & setup <ArrowUpRight />
        </a>
      </footer>
      <ModalOverlay isOpen={historyOpen} onOpenChange={setHistoryOpen} isDismissable>
        <Modal>
          <Dialog aria-label="Decision history" className="dialog-card">
            <div className="dialog-heading">
              <h2>Decision history</h2>
              <Button
                color="tertiary"
                aria-label="Close history"
                iconLeading={XClose}
                onClick={() => setHistoryOpen(false)}
              />
            </div>
            <p>Saved locally with input evidence, rationale, and real status.</p>
            {history.length ? (
              <div className="history-list">
                {history.map((r) => (
                  <Button
                    key={r.id}
                    color="secondary"
                    className="history-item"
                    onClick={() => {
                      setHistoryOpen(false);
                      setTab('record');
                      void load(r.id);
                    }}
                  >
                    <span>{r.title}</span>
                    <Badge color="gray">{r.status}</Badge>
                  </Button>
                ))}
              </div>
            ) : (
              <p>No reviews saved yet. Inspect a change or try the checkout demo.</p>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
      <ModalOverlay isOpen={approveOpen} onOpenChange={setApproveOpen} isDismissable={!busy}>
        <Modal>
          <Dialog aria-label="Approve result" className="dialog-card">
            <span className="eyebrow">EXPLICIT APPROVAL</span>
            <h2>Apply this preview?</h2>
            <p>
              Write the previewed file to <code>{review?.repository}</code> and run{' '}
              {review?.preview?.checks.length || 0} explicitly configured checks. Fuse will refuse
              stale inputs or a target with uncommitted work.
            </p>
            <p>This creates local changes. Commit them with your normal Git tools.</p>
            <div className="dialog-actions">
              <Button color="secondary" isDisabled={busy} onClick={() => setApproveOpen(false)}>
                Cancel
              </Button>
              <Button
                isLoading={busy}
                onClick={() =>
                  void action(
                    () => mutate('apply', { token: review!.preview!.token }),
                    'Applied. Actual check results are recorded below.',
                  ).then(() => setApproveOpen(false))
                }
              >
                Apply approved preview
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}
