import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle, Code02, RefreshCw01, Terminal } from '@untitledui/icons';
import { Button } from './untitledui/components/base/buttons/button';
import { LoadingIndicator } from './untitledui/components/application/loading-indicator/loading-indicator';
import { MeetingSetup, type Connection } from './components/MeetingSetup';
import type { Review } from '../shared/review';
import { actionDecision, type VisualSpec } from '../shared/visual';
import { api, isShowcase } from './api';
import './styles.css';
function Code({
  code,
  label,
  tone,
  start = 1,
}: {
  code: string;
  label: string;
  tone?: string;
  start?: number;
}) {
  return (
    <pre className={`code-source ${tone || ''}`} aria-label={label}>
      <code>
        {code.split('\n').map((line, index) => (
          <span className="code-line" key={index}>
            <span className="line-number">{start + index}</span>
            <span>
              {(line || ' ')
                .split(
                  /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:export|function|const|return|if|else|type|true|false|number)\b)/g,
                )
                .map((part, i) => (
                  <span
                    key={i}
                    className={
                      /^["']/.test(part)
                        ? 'token-string'
                        : /^(export|function|const|return|if|else|type|true|false|number)$/.test(
                              part,
                            )
                          ? 'token-keyword'
                          : undefined
                    }
                  >
                    {part}
                  </span>
                ))}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}
export default function App() {
  const [review, setReview] = useState<Review>();
  const [connection, setConnection] = useState<Connection>();
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const [setupOpen, setSetupOpen] = useState(false),
    [scenario, setScenario] = useState<'checkout' | 'shipping'>('checkout');
  const [selected, setSelected] = useState<VisualSpec['options'][number]>();
  const accept = (r: Review) => {
    setReview(r);
    window.history.replaceState({}, '', `?review=${r.id}`);
  };
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const mode = await api<Connection>('/mode');
        if (!active) return;
        setConnection(mode);
        const id = new URLSearchParams(location.search).get('review');
        const r = id
          ? await api<Review>(`/reviews/${id}`)
          : mode.mode === 'demo' || mode.mode === 'showcase'
            ? await api<Review>('/demo', { scenario: 'checkout' })
            : undefined;
        if (active && r) {
          accept(r);
          setScenario(r.files[0]?.path === 'shipping.ts' ? 'shipping' : 'checkout');
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);
  async function action(label: string, fn: () => Promise<Review>) {
    setBusy(label);
    setError('');
    try {
      const r = await fn();
      accept(r);
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function switchScenario(next: 'checkout' | 'shipping') {
    const r = await action('Opening change…', () => api<Review>('/demo', { scenario: next }));
    if (r) {
      setScenario(next);
      setSelected(undefined);
    }
  }
  async function choose(option: VisualSpec['options'][number]) {
    if (!review?.visual) return;
    setSelected(option);
    await action('Creating the proposed change…', async () => {
      let r = review;
      if (r.visual!.conflictId) {
        r = await api<Review>(`/reviews/${r.id}/decide`, {
          revision: r.revision,
          path: r.visual!.path,
          conflictId: r.visual!.conflictId,
          decision: {
            ...actionDecision(option.action),
            note: `${option.label}. ${option.description}`,
          },
        });
        accept(r);
      }
      return api<Review>(`/reviews/${r.id}/preview`, { revision: r.revision });
    });
  }
  const file = review?.files.find((f) => f.path === review.visual?.path) || review?.files[0];
  const conflict =
    file?.analysis.conflicts.find((c) => c.id === review?.visual?.conflictId) ||
    file?.analysis.conflicts[0];
  const focus = conflict?.functions[0] || file?.analysis.changedA[0] || file?.analysis.changedB[0];
  const source = (side: 'base' | 'a' | 'b') =>
    file?.evidence.find((e) => e.revision === side && e.function === focus);
  const code = (side: 'base' | 'a' | 'b') =>
    source(side)?.code ??
    (side === 'base' ? file?.input.base : side === 'a' ? file?.input.agentA : file?.input.agentB) ??
    '';
  const visual = review?.visual;
  const applied = review && review.status !== 'proposed';
  return (
    <div className="app-shell">
      <header className="topbar">
        <a href="/" className="wordmark" aria-label="Fuse home">
          <span className="fuse-symbol">f</span>fuse
        </a>
        <Button
          size="sm"
          color="secondary"
          iconLeading={Terminal}
          onClick={() => setSetupOpen(true)}
        >
          Run live MCP
        </Button>
      </header>
      <main>
        {error && (
          <div className="error-banner" role="alert">
            <strong>{error}</strong>
            <Button
              color="secondary"
              size="sm"
              onClick={() => (isShowcase ? location.assign('/') : location.reload())}
            >
              {isShowcase ? 'Open a new change' : 'Reload review'}
            </Button>
          </div>
        )}
        {loading ? (
          <div className="loading-state">
            <LoadingIndicator label="Opening the change…" />
          </div>
        ) : !review ? (
          <div className="empty-state">
            <h1>Open a change with Fuse</h1>
            <p>Call fuse_explain from your MCP client, then open its saved review.</p>
            <Button onClick={() => setSetupOpen(true)}>Set up MCP</Button>
          </div>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <p className="breadcrumb">
                  {review.repository.split('/').at(-1)} / {file?.path || 'Changes'}
                </p>
                <h1>
                  {scenario === 'shipping' && review.demo
                    ? 'Free shipping after discounts'
                    : review.demo
                      ? 'Two checks. Which runs first?'
                      : file?.path || 'Your change'}
                </h1>
              </div>
              {(connection?.mode === 'demo' || isShowcase) && (
                <div className="scenario-switch" aria-label="Change examples">
                  <Button
                    size="sm"
                    color={scenario === 'checkout' ? 'primary' : 'secondary'}
                    isDisabled={!!busy}
                    onClick={() => void switchScenario('checkout')}
                  >
                    Validation order
                  </Button>
                  <Button
                    size="sm"
                    color={scenario === 'shipping' ? 'primary' : 'secondary'}
                    isDisabled={!!busy}
                    onClick={() => void switchScenario('shipping')}
                  >
                    Shipping policy
                  </Button>
                </div>
              )}
            </div>
            <section className="step-section" aria-labelledby="code-heading">
              <div className="section-heading">
                <span className="step-number">01</span>
                <div>
                  <h2 id="code-heading">The change</h2>
                  <p>
                    {conflict
                      ? `Both edits meet in ${focus || file?.path}.`
                      : 'Compare the original code with your change.'}
                  </p>
                </div>
                <span className="file-label">
                  <Code02 />
                  {file?.path}
                </span>
              </div>
              {file ? (
                <div className="code-comparison">
                  <article className="code-card">
                    <div className="code-title">
                      Original code <span>common base</span>
                    </div>
                    <Code code={code('base')} start={source('base')?.line} label="Original code" />
                  </article>
                  <article className="code-card conflict-card">
                    <div className="code-title">
                      {conflict ? 'Conflicting changes' : 'Your change'}
                      <span>{focus}</span>
                    </div>
                    <div className="conflict-side side-a">
                      <span className="branch-label">A · {review.sources.a.ref.label}</span>
                      <Code
                        code={code('a')}
                        start={source('a')?.line}
                        label="Change A"
                        tone="highlight-a"
                      />
                    </div>
                    {conflict && (
                      <div className="conflict-side side-b">
                        <span className="branch-label">B · {review.sources.b.ref.label}</span>
                        <Code
                          code={code('b')}
                          start={source('b')?.line}
                          label="Change B"
                          tone="highlight-b"
                        />
                      </div>
                    )}
                  </article>
                </div>
              ) : (
                <p>No supported changed functions were found.</p>
              )}
              {!!review.unsupported.length && (
                <p className="inline-warning">
                  These files need manual review: {review.unsupported.map((f) => f.path).join(', ')}
                  .
                </p>
              )}
            </section>
            <section className="step-section" aria-labelledby="visual-heading">
              <div className="section-heading">
                <span className="step-number">02</span>
                <div>
                  <h2 id="visual-heading">{visual?.title || 'See what changes'}</h2>
                  <p>{visual?.summary || 'Generate a visual explanation tailored to this code.'}</p>
                </div>
              </div>
              {visual ? (
                <figure className="visual-canvas">
                  <img
                    src={
                      isShowcase
                        ? `/showcase/${scenario}.svg`
                        : `/api/reviews/${review.id}/visual.svg?v=${visual.generationId}`
                    }
                    alt={`${visual.title}. ${visual.summary}`}
                  />
                  <figcaption>
                    {visual.origin === 'ai' ? (
                      <>
                        <span className="ai-dot" />
                        Generated with {visual.model}
                        <a
                          href={`/api/reviews/${review.id}/visual.png`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open image
                        </a>
                      </>
                    ) : (
                      <span>{visual.metaphor}</span>
                    )}
                  </figcaption>
                </figure>
              ) : (
                <div className="generate-panel">
                  <p>
                    Luna reads the change and relevant codebase context, then designs the
                    explanation.
                  </p>
                  <Button
                    isLoading={!!busy}
                    onClick={() =>
                      void action('Luna is designing the explanation…', () =>
                        api<Review>(`/reviews/${review.id}/visual`, {}),
                      )
                    }
                  >
                    Generate visual explanation
                  </Button>
                </div>
              )}
              {visual?.origin === 'ai' && !applied && (
                <Button
                  size="sm"
                  color="tertiary"
                  iconLeading={RefreshCw01}
                  isDisabled={!!busy}
                  onClick={() =>
                    void action('Luna is creating a new explanation…', () =>
                      api<Review>(`/reviews/${review.id}/visual`, { regenerate: true }),
                    )
                  }
                >
                  Generate another visual
                </Button>
              )}
            </section>
            {visual && (
              <section className="step-section decision-section" aria-labelledby="choice-heading">
                <div className="section-heading">
                  <span className="step-number">03</span>
                  <div>
                    <h2 id="choice-heading">
                      {applied ? 'Change created' : 'What should happen?'}
                    </h2>
                    <p>
                      {applied
                        ? isShowcase
                          ? 'Your resolved file is ready to download.'
                          : review.merge
                            ? 'The conflict is resolved and staged in your repository.'
                            : 'Your choice is now written to the file.'
                        : 'Choose the behavior you want. Fuse creates the matching code.'}
                    </p>
                  </div>
                  {applied && <CheckCircle className="success-icon" />}
                </div>
                {!applied && (
                  <div className="behavior-choices">
                    {visual.options.map((option, i) => (
                      <button
                        type="button"
                        className={`behavior-choice ${selected?.action === option.action ? 'selected' : ''} option-${i}`}
                        aria-pressed={selected?.action === option.action}
                        disabled={!!busy}
                        onClick={() => void choose(option)}
                        key={option.action}
                      >
                        <span className="choice-dot" />
                        <span>
                          <strong>{option.label}</strong>
                          <span>{option.description}</span>
                        </span>
                        <ArrowRight />
                      </button>
                    ))}
                  </div>
                )}
                {review.preview && (
                  <div className="created-change">
                    <div className="code-title">
                      {applied ? 'Resolved code' : 'Your proposed change'}
                      <span>{file?.path}</span>
                    </div>
                    {Object.entries(review.preview.outputs).map(([path, output]) => (
                      <Code
                        key={path}
                        code={output ?? '// File will be deleted'}
                        label={`Resolved ${path}`}
                      />
                    ))}
                    {!applied && (
                      <div className="create-action">
                        <p>
                          {isShowcase ? 'Creates a downloadable ' : 'Writes '}
                          {Object.keys(review.preview.outputs).join(', ')}
                          {review.preview.checks.length ? ' and runs the configured checks' : ''}.
                          {review.merge ? ' Stages the resolved file for your merge.' : ''}
                        </p>
                        <Button
                          iconTrailing={ArrowRight}
                          isLoading={!!busy}
                          isDisabled={!!busy}
                          onClick={() =>
                            void action(
                              isShowcase
                                ? 'Creating the resolved file…'
                                : 'Writing the change and checking it…',
                              () =>
                                api<Review>(`/reviews/${review.id}/apply`, {
                                  revision: review.revision,
                                  token: review.preview!.token,
                                }),
                            )
                          }
                        >
                          Create this change
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {applied && (
                  <div className="result-note" role="status">
                    <CheckCircle />
                    <div>
                      <strong>
                        {isShowcase
                          ? 'Change created. Download your resolved file.'
                          : review.checks.some((c) => c.status !== 'passed')
                            ? 'Change created. A check needs attention.'
                            : review.checks.length
                              ? 'Change created. Checks passed.'
                              : 'Change created.'}
                      </strong>
                      {isShowcase && review.preview ? (
                        Object.entries(review.preview.outputs).map(([path, output]) => (
                          <a
                            className="download-link"
                            key={path}
                            download={path}
                            href={`data:text/plain;charset=utf-8,${encodeURIComponent(output || '')}`}
                          >
                            Download {path}
                          </a>
                        ))
                      ) : (
                        <p>{review.repository}</p>
                      )}
                      {review.checks
                        .filter((c) => c.status !== 'passed')
                        .map((c) => (
                          <pre key={c.name}>
                            {c.name}: {c.stderr || c.stdout}
                          </pre>
                        ))}
                    </div>
                  </div>
                )}
              </section>
            )}
          </>
        )}
        {busy && (
          <div className="work-status" role="status">
            <LoadingIndicator size="sm" />
            {busy}
          </div>
        )}
      </main>
      <MeetingSetup
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        connection={connection}
        review={review}
      />
    </div>
  );
}
