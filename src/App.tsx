import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  CircleCheck,
  Clock3,
  Code2,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitMerge,
  History,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import { api } from './api';
import { FlowGraph } from './components/FlowGraph';
import { NewWorkspace } from './components/NewWorkspace';
import { Resolution } from './components/Resolution';
import type { Workspace, WorkspaceSummary } from '../shared/types';
type View = 'overview' | 'resolve' | 'history';
const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]),
    [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [view, setView] = useState<View>('overview'),
    [selected, setSelected] = useState('');
  const [showNew, setShowNew] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const loadCounter = useRef(0);
  async function refreshList() {
    const all = await api<WorkspaceSummary[]>('/workspaces');
    setWorkspaces(all);
    return all;
  }
  function accept(w: Workspace) {
    setWorkspace(w);
    setSelected((s) =>
      w.analysis.conflicts.some((c) => c.id === s) ? s : (w.analysis.conflicts[0]?.id ?? ''),
    );
    window.history.replaceState(null, '', `?review=${w.id}`);
  }
  async function load(id: string) {
    const request = ++loadCounter.current;
    setLoading(true);
    setError('');
    try {
      const w = await api<Workspace>(`/workspaces/${id}`);
      if (request === loadCounter.current) {
        accept(w);
        setNotice('');
      }
    } catch (e) {
      if (request === loadCounter.current) setError((e as Error).message);
    } finally {
      if (request === loadCounter.current) setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    api<WorkspaceSummary[]>('/workspaces')
      .then(async (all) => {
        if (!active) return;
        setWorkspaces(all);
        const id = new URLSearchParams(window.location.search).get('review') || all[0]?.id;
        if (id) {
          const w = await api<Workspace>(`/workspaces/${encodeURIComponent(id)}`);
          if (active) accept(w);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const conflict =
    workspace?.analysis.conflicts.find((c) => c.id === selected) ??
    workspace?.analysis.conflicts[0];
  const pending = workspace
    ? workspace.analysis.conflicts.filter((c) => !workspace.decisions[c.id]).length
    : 0;
  async function finalize() {
    if (!workspace) return;
    setBusy(true);
    setError('');
    try {
      accept(
        await api<Workspace>(`/workspaces/${workspace.id}/finalize`, 'POST', {
          revision: workspace.revision,
        }),
      );
      await refreshList();
      setView('history');
      setNotice('Resolved file and decision record saved.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function onSaved(w: Workspace) {
    accept(w);
    setNotice('Decision saved.');
    void refreshList().catch((e) => setError(e.message));
  }
  const nav: { key: View; label: string; icon: typeof Activity }[] = [
    { key: 'overview', label: 'Agent overview', icon: Layers3 },
    { key: 'resolve', label: 'Conflict resolution', icon: GitMerge },
    { key: 'history', label: 'Resolved summary', icon: History },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Fuse home">
          fuse<span>✳</span>
        </a>
        <div className="workspace-label">
          <span className="team-mark">F</span>
          <div>
            Senior Design<span>Agent oversight workspace</span>
          </div>
        </div>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav aria-label="Workspace views">
          {nav.map(({ key, label, icon: Icon }) => (
            <button
              className={view === key ? 'active' : ''}
              key={key}
              onClick={() => setView(key)}
              aria-current={view === key ? 'page' : undefined}
            >
              <Icon size={18} />
              {label}
              {key === 'resolve' && pending > 0 && <span className="nav-count">{pending}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-section-label recent-heading">
          REVIEWS
          <button className="icon-button" aria-label="New review" onClick={() => setShowNew(true)}>
            <Plus size={16} />
          </button>
        </div>
        <div className="recent-list">
          {workspaces.length === 0 ? (
            <p>Your reviews will appear here.</p>
          ) : (
            workspaces.map((w) => (
              <button
                key={w.id}
                className={workspace?.id === w.id ? 'selected' : ''}
                onClick={() => void load(w.id)}
              >
                <span className={`status-dot ${w.resolved ? 'done' : ''}`} />
                <span>
                  {w.title}
                  <small>{w.fileName}</small>
                </span>
              </button>
            ))
          )}
        </div>
        <div className="sidebar-bottom">
          <span className="connection-dot" />
          <div>
            Local workspace<span>Reviews saved on this machine</span>
          </div>
          <span className="version">0.1</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            <span className="muted">Workspace</span>
            <span className="breadcrumb-slash">/</span>
            {nav.find((n) => n.key === view)?.label}
          </span>
          <div className="topbar-actions">
            <span className="snapshot-label">
              <ShieldCheck size={14} />
              Snapshot review
            </span>
            <button className="button compact" onClick={() => setShowNew(true)}>
              <Plus size={15} />
              New review
            </button>
            <span className="user-avatar" aria-label="Local reviewer">
              F
            </span>
          </div>
        </header>
        <main id="main-content">
          {error && (
            <div role="alert" className="error page-alert">
              <span>{error}</span>
              <div>
                {workspace && (
                  <button className="text-button" onClick={() => void load(workspace.id)}>
                    Reload review
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => setError('')}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          )}
          {notice && (
            <div role="status" className="success-notice">
              <Check size={16} />
              {notice}
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice('')}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading">
              <LoaderCircle className="spin" size={24} />
              <p>Opening your workspace…</p>
            </div>
          ) : !workspace ? (
            <section className="welcome">
              <span className="eyebrow">A CLEARER VIEW OF PARALLEL WORK</span>
              <h1>
                Many agents.
                <br />
                One shared understanding.
              </h1>
              <p>
                See where code changes meet, understand the behavior behind a conflict, and make a
                decision your team can trace.
              </p>
              <button className="button primary" onClick={() => setShowNew(true)}>
                Start your first review
                <ArrowRight size={18} />
              </button>
              <div className="welcome-features">
                <span>
                  <GitBranch />
                  Compare TypeScript revisions
                </span>
                <span>
                  <GitMerge />
                  Resolve with a preview
                </span>
                <span>
                  <History />
                  Keep the decision record
                </span>
              </div>
            </section>
          ) : (
            <>
              <section className="page-heading">
                <div>
                  <span className="eyebrow">
                    {view === 'overview'
                      ? 'THE SHARED PICTURE'
                      : view === 'resolve'
                        ? 'UNDERSTAND. DECIDE. MOVE FORWARD.'
                        : 'A RECORD OF WHAT CHANGED'}
                  </span>
                  <h1>
                    {view === 'overview'
                      ? 'Parallel work, in focus.'
                      : view === 'resolve'
                        ? 'Resolve the behavior.'
                        : 'Decisions, made clear.'}
                  </h1>
                  <p>
                    {workspace.input.title}
                    <span className="heading-dot">·</span>
                    <FileCode2 size={14} />
                    {workspace.input.fileName}
                  </p>
                </div>
                <div className="heading-actions">
                  <span
                    className={`tag ${workspace.output !== null ? 'success' : pending ? 'gold' : 'neutral'}`}
                  >
                    {workspace.output !== null ? <CircleCheck size={14} /> : <Clock3 size={14} />}{' '}
                    {workspace.output !== null
                      ? 'Resolution saved'
                      : pending
                        ? `${pending} ${pending === 1 ? 'decision' : 'decisions'} needed`
                        : 'Ready to generate'}
                  </span>
                  <button
                    className="icon-button bordered"
                    aria-label="Refresh review"
                    onClick={() => void load(workspace.id)}
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
              </section>
              {view === 'overview' && (
                <>
                  <section className="metrics" aria-label="Review metrics">
                    <div>
                      <span>Agent revisions</span>
                      <strong>
                        02<small>against one common base</small>
                      </strong>
                    </div>
                    <div>
                      <span>Changed functions</span>
                      <strong>
                        {String(
                          new Set([...workspace.analysis.changedA, ...workspace.analysis.changedB])
                            .size,
                        ).padStart(2, '0')}
                        <small>across both revisions</small>
                      </strong>
                    </div>
                    <div>
                      <span>Needs your attention</span>
                      <strong className={pending ? 'gold-text' : ''}>
                        {String(pending).padStart(2, '0')}
                        <small>
                          {workspace.analysis.conflicts.some((c) => c.kind === 'dependency')
                            ? 'includes path review candidates'
                            : 'decisions remaining'}
                        </small>
                      </strong>
                    </div>
                    <div>
                      <span>Saved decisions</span>
                      <strong>
                        {String(Object.keys(workspace.decisions).length).padStart(2, '0')}
                        <small>recorded with your notes</small>
                      </strong>
                    </div>
                  </section>
                  <div className="overview-columns">
                    <section>
                      <div className="section-heading">
                        <h2>Agents in this review</h2>
                        <span className="muted small">Pinned snapshots</span>
                      </div>
                      <div className="agent-cards">
                        {(
                          [
                            {
                              key: 'a',
                              name: workspace.input.nameA,
                              changes: workspace.analysis.changedA,
                            },
                            {
                              key: 'b',
                              name: workspace.input.nameB,
                              changes: workspace.analysis.changedB,
                            },
                          ] as const
                        ).map((agent) => (
                          <article className="agent-card" key={agent.key}>
                            <div className="agent-card-head">
                              <span className={`avatar ${agent.key}`}>
                                {agent.key.toUpperCase()}
                              </span>
                              <span className="tag neutral">Analyzed</span>
                            </div>
                            <h3>{agent.name}</h3>
                            <p>Compared with the common base</p>
                            <div className="changed-functions">
                              {agent.changes.length ? (
                                agent.changes.map((name) => (
                                  <button
                                    className="function-chip"
                                    key={name}
                                    onClick={() => {
                                      const c = workspace.analysis.conflicts.find((c) =>
                                        c.functions.includes(name),
                                      );
                                      if (c) {
                                        setSelected(c.id);
                                        setView('resolve');
                                      }
                                    }}
                                  >
                                    <Code2 size={13} />
                                    {name}
                                  </button>
                                ))
                              ) : (
                                <span className="muted small">No named function changes</span>
                              )}
                            </div>
                            <div className="agent-card-footer">
                              <GitBranch size={14} />
                              {agent.changes.length} changed{' '}
                              {agent.changes.length === 1 ? 'function' : 'functions'}
                              <span>{workspace.analysis.hashes[agent.key].slice(0, 7)}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                    <section className="attention-card">
                      <span className="eyebrow">NEXT DECISION</span>
                      {pending ? (
                        <>
                          <div className="attention-icon">
                            <GitMerge size={24} />
                          </div>
                          <h2>
                            {
                              workspace.analysis.conflicts.find((c) => !workspace.decisions[c.id])
                                ?.title
                            }
                          </h2>
                          <p>
                            Follow the call relationships, compare both changes, and choose the
                            intended behavior.
                          </p>
                          <button
                            className="button primary"
                            onClick={() => {
                              setSelected(
                                workspace.analysis.conflicts.find(
                                  (c) => !workspace.decisions[c.id],
                                )!.id,
                              );
                              setView('resolve');
                            }}
                          >
                            Review conflict
                            <ArrowRight size={17} />
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="attention-icon">
                            <CircleCheck size={24} />
                          </div>
                          <h2>
                            {workspace.output !== null
                              ? 'This review is complete.'
                              : 'All decisions are ready.'}
                          </h2>
                          <p>
                            {workspace.output !== null
                              ? 'Your resolved TypeScript and review record are ready to download.'
                              : 'Generate the complete file and inspect its TypeScript diagnostics.'}
                          </p>
                          <button
                            className="button primary"
                            disabled={busy}
                            onClick={() =>
                              workspace.output !== null ? setView('history') : void finalize()
                            }
                          >
                            {workspace.output !== null
                              ? 'View resolution'
                              : 'Generate resolved file'}
                            <ArrowRight size={17} />
                          </button>
                        </>
                      )}
                    </section>
                  </div>
                  <section className="panel flow-panel">
                    <div className="section-heading">
                      <div>
                        <h2>Where the work meets</h2>
                        <p className="muted small">
                          Local function calls extracted from all three TypeScript snapshots
                        </p>
                      </div>
                      <span className="tag neutral">
                        <Code2 size={13} />
                        AST analysis
                      </span>
                    </div>
                    <FlowGraph
                      nodes={workspace.analysis.nodes}
                      selected={[]}
                      onSelect={(name) => {
                        const c = workspace.analysis.conflicts.find((c) =>
                          c.functions.includes(name),
                        );
                        if (c) {
                          setSelected(c.id);
                          setView('resolve');
                        } else
                          setNotice(
                            `${name} calls ${workspace.analysis.nodes.find((n) => n.id === name)?.calls.join(', ') || 'no statically resolved local functions'}.`,
                          );
                      }}
                    />
                    <div className="graph-legend">
                      <span>
                        <i className="legend-dot unchanged" />
                        Unchanged
                      </span>
                      <span>
                        <i className="legend-dot changed" />
                        One agent
                      </span>
                      <span>
                        <i className="legend-dot overlap" />
                        Both agents
                      </span>
                      <span className="muted">Arrows show calls, not execution order.</span>
                    </div>
                  </section>
                </>
              )}
              {view === 'resolve' && (
                <>
                  <section className="panel flow-panel">
                    <div className="section-heading">
                      <div>
                        <h2>The affected call flow</h2>
                        <p className="muted small">
                          Select a shared step to inspect the decision behind it
                        </p>
                      </div>
                      <span className="tag neutral">
                        {workspace.analysis.nodes.length} functions
                      </span>
                    </div>
                    <FlowGraph
                      nodes={workspace.analysis.nodes}
                      selected={conflict?.functions ?? []}
                      onSelect={(name) => {
                        const c = workspace.analysis.conflicts.find((c) =>
                          c.functions.includes(name),
                        );
                        if (c) setSelected(c.id);
                        else setNotice(`${name}: no individual decision required.`);
                      }}
                    />
                    <div className="graph-legend">
                      <span>
                        <i className="legend-dot overlap" />
                        Shared edit
                      </span>
                      <span className="muted">
                        Call relationships may include conditional paths.
                      </span>
                    </div>
                  </section>
                  {conflict ? (
                    <>
                      <div className="conflict-tabs" aria-label="Review decisions">
                        {workspace.analysis.conflicts.map((c, i) => (
                          <button
                            className={conflict.id === c.id ? 'active' : ''}
                            key={c.id}
                            onClick={() => setSelected(c.id)}
                          >
                            {workspace.decisions[c.id] ? (
                              <CircleCheck size={15} />
                            ) : (
                              <span className="step-number">{i + 1}</span>
                            )}
                            {c.kind === 'file' ? 'Whole file' : c.functions.join(' + ')}
                          </button>
                        ))}
                      </div>
                      <Resolution
                        key={`${workspace.id}:${conflict.id}:${workspace.revision}`}
                        workspace={workspace}
                        conflict={conflict}
                        onSaved={onSaved}
                        onError={setError}
                      />
                    </>
                  ) : (
                    <div className="panel no-conflicts">
                      <CircleCheck size={30} />
                      <h2>No overlapping function edits</h2>
                      <p>
                        The changes can be assembled without a reviewer choice. Generate the result
                        and run your project’s tests before adopting it.
                      </p>
                    </div>
                  )}
                  <div className="generate-bar">
                    <div>
                      <strong>
                        {pending
                          ? `${pending} ${pending === 1 ? 'decision remains' : 'decisions remain'}`
                          : 'Ready for the complete picture'}
                      </strong>
                      <p>
                        {pending
                          ? 'Save each decision above to generate a resolved file.'
                          : 'Generate the full TypeScript file and preserve this review.'}
                      </p>
                    </div>
                    <button
                      className="button primary"
                      disabled={pending > 0 || busy}
                      onClick={() => void finalize()}
                    >
                      {busy ? <LoaderCircle className="spin" size={17} /> : <GitMerge size={17} />}
                      Generate resolved file
                    </button>
                  </div>
                </>
              )}
              {view === 'history' && (
                <>
                  <section
                    className={`result-banner ${workspace.output !== null ? 'complete' : ''}`}
                  >
                    <div className="result-symbol">
                      {workspace.output !== null ? <CircleCheck size={28} /> : <Clock3 size={28} />}
                    </div>
                    <div>
                      <span className="eyebrow">
                        {workspace.output !== null ? 'RESOLUTION SAVED' : 'REVIEW IN PROGRESS'}
                      </span>
                      <h2>
                        {workspace.output !== null
                          ? 'One file. A traceable decision.'
                          : 'Your decisions will come together here.'}
                      </h2>
                      <p>
                        {workspace.output !== null
                          ? `${Object.keys(workspace.decisions).length} decisions recorded · ${workspace.diagnostics.length} standalone TypeScript diagnostics`
                          : `${pending} decisions remain before the resolved file can be generated.`}
                      </p>
                    </div>
                    <div className="result-actions">
                      {workspace.output !== null ? (
                        <a
                          className="button primary"
                          href={`/api/workspaces/${workspace.id}/download`}
                          download
                        >
                          <ArrowDownToLine size={16} />
                          Download TypeScript
                        </a>
                      ) : (
                        <button className="button primary" onClick={() => setView('resolve')}>
                          Continue review
                          <ArrowRight size={16} />
                        </button>
                      )}
                      <a className="button" href={`/api/workspaces/${workspace.id}/audit`} download>
                        <ArrowDownToLine size={16} />
                        Export review record
                      </a>
                    </div>
                  </section>
                  <div className="history-columns">
                    <section className="panel">
                      <div className="section-heading">
                        <h2>Decision timeline</h2>
                        <History size={18} />
                      </div>
                      <ol className="timeline">
                        {[...workspace.events].reverse().map((event) => (
                          <li key={event.id}>
                            <span className="timeline-dot" />
                            <div>
                              <time>{date(event.at)}</time>
                              <h3>{event.action}</h3>
                              <p>{event.detail}</p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </section>
                    <section className="panel provenance">
                      <div className="section-heading">
                        <h2>Review details</h2>
                        <ShieldCheck size={18} />
                      </div>
                      <dl>
                        <dt>Source</dt>
                        <dd>
                          {workspace.input.origin
                            ? 'GitHub commit snapshots'
                            : 'Local TypeScript snapshots'}
                        </dd>
                        <dt>File</dt>
                        <dd>{workspace.input.fileName}</dd>
                        <dt>Created</dt>
                        <dd>{date(workspace.createdAt)}</dd>
                        <dt>Input hashes · SHA-256</dt>
                        <dd className="hashes">
                          Base {workspace.analysis.hashes.base.slice(0, 16)}
                          <br />A {workspace.analysis.hashes.a.slice(0, 16)}
                          <br />B {workspace.analysis.hashes.b.slice(0, 16)}
                        </dd>
                        {workspace.outputHash && (
                          <>
                            <dt>Output hash · SHA-256</dt>
                            <dd className="hashes">{workspace.outputHash}</dd>
                          </>
                        )}
                      </dl>
                      {workspace.input.origin && <pre>{workspace.input.origin}</pre>}
                      <p className="muted small">
                        Full source snapshots, hashes, notes, and timestamps are included in the
                        review record.
                      </p>
                    </section>
                  </div>
                  {workspace.output !== null && (
                    <section className="panel output-panel">
                      <div className="section-heading">
                        <h2>Resolved TypeScript</h2>
                        <span
                          className={`tag ${workspace.diagnostics.length ? 'gold' : 'success'}`}
                        >
                          {workspace.diagnostics.length ? (
                            <TriangleAlert size={13} />
                          ) : (
                            <Check size={13} />
                          )}{' '}
                          {workspace.diagnostics.length
                            ? 'Review diagnostics'
                            : 'Standalone type check passed'}
                        </span>
                      </div>
                      {workspace.diagnostics.length > 0 && (
                        <div className="diagnostics">
                          {workspace.diagnostics.map((d, i) => (
                            <p key={i}>
                              Line {d.line} · TS{d.code}: {d.message}
                            </p>
                          ))}
                        </div>
                      )}
                      <p className="muted small">
                        Run the result in your project’s test suite. Standalone analysis cannot
                        validate external dependencies or application behavior.
                      </p>
                      <pre>
                        <code>{workspace.output}</code>
                      </pre>
                    </section>
                  )}
                </>
              )}
              <details className="analysis-notes">
                <summary>
                  <TriangleAlert size={14} />
                  Analysis scope and limitations
                </summary>
                {workspace.analysis.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
                <p>
                  Snapshots remain fixed until you start a new review. Live agent telemetry and
                  messaging integrations are not connected in this MVP.
                </p>
              </details>
            </>
          )}
        </main>
        <footer className="page-footer">
          <span>
            FUSE <span>·</span> Built for a shared understanding
          </span>
          <a href="https://github.com/Will-Sanz/fuse" target="_blank" rel="noreferrer">
            Project on GitHub
            <ExternalLink size={12} />
          </a>
        </footer>
      </div>
      {showNew && (
        <NewWorkspace
          onClose={() => setShowNew(false)}
          onCreated={(w) => {
            accept(w);
            setShowNew(false);
            setLoading(false);
            setView('overview');
            setNotice('Review created. All snapshots are saved.');
            window.scrollTo({ top: 0 });
            void refreshList().catch((e) => setError(e.message));
          }}
        />
      )}
    </div>
  );
}
