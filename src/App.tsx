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
import { Badge } from './untitledui/components/base/badges/badges';
import { Tabs, TabList, Tab, TabPanel } from './untitledui/components/application/tabs/tabs';
import { Modal, ModalOverlay, Dialog } from './untitledui/components/application/modals/modal';
import { LoadingIndicator } from './untitledui/components/application/loading-indicator/loading-indicator';
import { Tooltip, TooltipTrigger } from './untitledui/components/base/tooltip/tooltip';
import { ChangeGraph } from './components/ChangeGraph';
import { CodexConnection, type Connection } from './components/CodexConnection';
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
              <span>
                {(line || ' ')
                  .split(
                    /(\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:export|function|const|let|return|if|else|type|interface|throw|new|import|from|true|false|null|undefined)\b|\b\d+\b)/g,
                  )
                  .map((part, token) => (
                    <span
                      key={token}
                      className={
                        part.startsWith('//')
                          ? 'syntax-comment'
                          : /^["']/.test(part)
                            ? 'syntax-string'
                            : /^(export|function|const|let|return|if|else|type|interface|throw|new|import|from|true|false|null|undefined)$/.test(
                                  part,
                                )
                              ? 'syntax-keyword'
                              : /^\d+$/.test(part)
                                ? 'syntax-number'
                                : undefined
                      }
                    >
                      {part}
                    </span>
                  ))}
              </span>
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
          <h2>Decision history</h2>
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
  const [connection, setConnection] = useState<Connection>();
  const [codexOpen, setCodexOpen] = useState(false);
  const [fullSource, setFullSource] = useState(false);
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
    Promise.all([api<Connection>('/mode'), api<typeof history>('/reviews')])
      .then(([m, h]) => {
        if (!active) return;
        setMode(m.mode);
        setConnection(m);
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
    await action(() => api<Review>('/demo', { single }), '');
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
        </a>
        <div className="topbar-actions">
          <Button
            size="sm"
            color="secondary"
            iconLeading={Terminal}
            onClick={() => setCodexOpen(true)}
          >
            Use with Codex
          </Button>
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
            <h1>Changes</h1>
            <p className="welcome-copy">
              Open a file review, or connect your repository with Codex.
            </p>
            {mode === 'demo' && (
              <div className="welcome-actions">
                <Button isLoading={busy} onClick={() => void demo(false)} iconLeading={Code02}>
                  Review checkout.ts
                </Button>
                <Button color="secondary" isDisabled={busy} onClick={() => void demo(true)}>
                  Review a single change
                </Button>
              </div>
            )}
            {history.length > 0 && (
              <section className="recent-reviews">
                <h2>Recent reviews</h2>
                <div className="history-list">
                  {history.slice(0, 5).map((r) => (
                    <Button
                      key={r.id}
                      color="secondary"
                      className="history-item"
                      onClick={() => void load(r.id)}
                    >
                      <span>{r.title}</span>
                      <Badge color="gray">{r.status}</Badge>
                    </Button>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <>
            <div className="review-breadcrumb">
              <GitBranch01 />
              <span title={review.repository}>{review.repository.split('/').at(-1)}</span>
              <span>/</span>
              <span>Changes</span>
            </div>
            <div className="review-heading">
              <div>
                <h1>{file?.path || 'Changes'}</h1>
                <p>{activeFunction ? `${activeFunction} · TypeScript` : 'Working changes'}</p>
              </div>
              <div className="heading-status">
                {review.status !== 'proposed' && <Badge color="success">{review.status}</Badge>}
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
            <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
              <TabList type="underline" aria-label="Review sections" className="review-tabs">
                <Tab id="change">Code</Tab>
                <Tab id="result">Result preview</Tab>
                <Tab id="record">Decision record</Tab>
              </TabList>
              <TabPanel id="change">
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
                    <section className="evidence-section">
                      <div className="section-title">
                        <div>
                          <h2>{activeFunction || file.path}</h2>
                        </div>
                        <Button
                          size="sm"
                          color="secondary"
                          onClick={() => setFullSource(!fullSource)}
                        >
                          {fullSource ? 'Changed function' : 'Full file'}
                        </Button>
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
                              <Source
                                code={
                                  fullSource
                                    ? file.input[side === 'a' ? 'agentA' : 'agentB']
                                    : (e?.code ?? base?.code ?? '')
                                }
                                start={fullSource ? 1 : sourceLine}
                                label={`${side.toUpperCase()} source for ${activeFunction}`}
                              />
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
                                {rec.action ? 'SUGGESTED RESOLUTION' : 'RESOLUTION'}
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
                          <p className="recommendation-copy">
                            {rec.reason.replace(/Fixture expectation:\s*/g, '')}
                          </p>
                          {rec.question && <p className="intent-question">{rec.question}</p>}
                          {c.canCombine && review.status === 'proposed' && (
                            <details className="intent-editor">
                              <summary>
                                {review.intent
                                  ? 'Change intended behavior'
                                  : 'Set intended behavior'}
                              </summary>
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
                            </details>
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
                                placeholder="Why should these changes be kept?"
                                value={note}
                                onChange={setNote}
                                rows={2}
                              />
                              <Button
                                isDisabled={
                                  !selected || !(note.trim() || selected.note?.trim()) || busy
                                }
                                isLoading={busy}
                                onClick={async () => {
                                  const updated = await action(
                                    () =>
                                      mutate('decide', {
                                        path: file.path,
                                        conflictId: c.id,
                                        decision: {
                                          ...selected,
                                          note: note.trim() || selected?.note,
                                        },
                                      }),
                                    'Decision saved.',
                                  );
                                  if (updated) {
                                    setChoice({});
                                    setNote('');
                                    if (
                                      updated.files.length === 1 &&
                                      !updated.unsupported.length &&
                                      updated.files.every((f) =>
                                        f.analysis.conflicts.every((c) => f.decisions[c.id]),
                                      )
                                    ) {
                                      const ready = await action(
                                        () =>
                                          api<Review>(`/reviews/${updated.id}/preview`, {
                                            revision: updated.revision,
                                          }),
                                        '',
                                      );
                                      if (ready) setTab('result');
                                    }
                                  }
                                }}
                                iconTrailing={ArrowRight}
                              >
                                {pending <= 1 &&
                                review.files.length === 1 &&
                                !review.unsupported.length
                                  ? 'Preview resolution'
                                  : 'Save selection'}
                              </Button>
                            </div>
                          ) : (
                            <p className="saved-rationale">{saved?.note}</p>
                          )}
                        </section>
                      );
                    })}
                    <details className="call-map">
                      <summary>Call relationships</summary>
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
                    </details>
                    {!file.analysis.conflicts.length && (
                      <section className="clean-change">
                        <CheckCircle />
                        <div>
                          <h2>No overlapping edits</h2>
                          <p>
                            {file.analysis.changedB.length
                              ? 'Independent or identical edits can be retained. Review the evidence and test the result.'
                              : 'This change stands on its own. Review the new guards, calls, and return values above.'}
                          </p>
                        </div>
                      </section>
                    )}
                    {review.status === 'proposed' && pending === 0 && (
                      <div className="next-step">
                        <div>
                          <strong>
                            {pending ? 'Save your selection to continue' : 'Ready to preview'}
                          </strong>
                          <p>Preview changes before applying.</p>
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
                  <summary>Repository details</summary>
                  <p>
                    <code>{review.repository}</code>
                  </p>
                  <p>
                    Base commit: <code>{review.baseCommit}</code>
                  </p>
                  {(['a', 'b'] as const).map((side) => (
                    <p key={side}>
                      {side.toUpperCase()} · {review.sources[side].ref.label}
                      {review.sources[side].ref.sessionId
                        ? ` · registered session ${review.sources[side].ref.sessionId}`
                        : ' · unattributed'}
                      <br />
                      <code>{review.sources[side].ref.value}</code>
                    </p>
                  ))}
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
                        <h2>
                          {review.status === 'proposed' ? 'Proposed changes' : 'Applied changes'}
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
        <Modal className="dialog-modal">
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
              <p>No reviews saved yet. Inspect a repository or open checkout.ts.</p>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
      <ModalOverlay isOpen={approveOpen} onOpenChange={setApproveOpen} isDismissable={!busy}>
        <Modal className="dialog-modal">
          <Dialog aria-label="Approve result" className="dialog-card">
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
      <CodexConnection
        open={codexOpen}
        onClose={() => setCodexOpen(false)}
        connection={connection}
        review={review}
      />
    </div>
  );
}
