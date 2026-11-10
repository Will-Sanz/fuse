import { useId, useMemo, useRef, useState } from 'react';
import type { Review } from '../../shared/review';
import { Button } from '../untitledui/components/base/buttons/button';
import { GlassSurface } from '../liquidglass/GlassSurface';

export interface ReviewCardProps {
  review: Review;
  visualPng?: string;
  visualSvg?: string;
  pending?: boolean;
  error?: string;
  continuation?: string;
  readOnly?: boolean;
  onOpenLegacy?: () => void;
  onConfirmBehavior: (id: string) => void;
  onPreview: () => void;
  onApply: (token: string) => void;
  onRefresh: () => void;
}

export function ReviewCard({
  review,
  visualPng,
  visualSvg,
  pending = false,
  error,
  continuation,
  readOnly = false,
  onOpenLegacy,
  onConfirmBehavior,
  onPreview,
  onApply,
  onRefresh,
}: ReviewCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [failedVisual, setFailedVisual] = useState<string>();
  const contentId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const b = review.behavioral,
    issue = b?.issue,
    verification = b?.verification;
  const applied = review.status !== 'proposed';
  const status = applied
    ? 'Applied'
    : verification?.status === 'running'
      ? 'Checking in isolation'
      : verification?.status === 'passed'
        ? 'Ready for code approval'
        : verification
          ? 'Correction needs attention'
          : b?.proposal
            ? 'Awaiting verification'
            : b?.intent
              ? 'Awaiting agent proposal'
              : issue
                ? 'Choose intended behavior'
                : 'Source explanation';
  const title = issue?.summary || review.visual?.title || review.files[0]?.path || review.title;
  const summary =
    b?.explanation || review.visual?.summary || 'Review the pinned source and intended behavior.';
  const selected = issue?.options.find((o) => o.id === b?.intent?.behaviorId);
  const file = review.files.find((file) => file.path === issue?.path) || review.files[0];
  const code = review.preview?.outputs[b?.proposal?.path || file?.path];
  const visual = useMemo(() => {
    if (visualPng) return `data:image/png;base64,${visualPng}`;
    if (visualSvg) {
      try {
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(visualSvg)}`;
      } catch {
        // An older server may send malformed Unicode; keep the controls usable.
      }
    }
  }, [visualPng, visualSvg]);
  const collapse = () => {
    setExpanded(false);
    trigger.current?.focus();
  };
  const behaviorChoices = issue && (
    <div className="fuse-inline-options">
      {issue.options.map((option) => (
        <button
          key={option.id}
          className="fuse-inline-option"
          type="button"
          disabled={pending || readOnly || selected?.id === option.id}
          aria-pressed={selected?.id === option.id}
          onClick={() => onConfirmBehavior(option.id)}
        >
          <strong>{option.label}</strong>
          <span>{option.description}</span>
          <span className="fuse-inline-option-state">
            {selected?.id === option.id ? 'Confirmed' : 'Choose behavior'}
          </span>
        </button>
      ))}
    </div>
  );
  return (
    <GlassSurface>
      <article
        className="fuse-inline-card"
        aria-label="Fuse review"
        data-expanded={expanded}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && expanded) {
            event.stopPropagation();
            collapse();
          }
        }}
      >
        <header className="fuse-inline-header">
          <div className="fuse-inline-brand">
            <span aria-hidden="true">f</span>
            <strong>Fuse</strong>
            <span className="fuse-inline-status" role="status">
              {status}
            </span>
          </div>
          <h1>{title}</h1>
          {!visual && !review.visual && <p>{summary}</p>}
        </header>
        {error && (
          <p className="fuse-inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="fuse-inline-main">
          {visual && failedVisual !== visual ? (
            <figure className="fuse-inline-visual">
              <img
                src={visual}
                width={1600}
                height={800}
                onError={() => setFailedVisual(visual)}
                alt={
                  review.visual
                    ? `${review.visual.title}. ${review.visual.summary}`
                    : 'Source-grounded explanation'
                }
              />
              <figcaption>Illustration · verification is separate</figcaption>
            </figure>
          ) : review.visual ? (
            <p className="fuse-inline-visual-fallback" role="status">
              Visual unavailable. {review.visual.summary}
            </p>
          ) : null}
          {!b && (
            <section className="fuse-inline-stage">
              <p>Code choices for this saved review are available in the legacy review.</p>
              {onOpenLegacy && (
                <Button size="sm" color="secondary" isDisabled={pending} onClick={onOpenLegacy}>
                  Open legacy browser review
                </Button>
              )}
            </section>
          )}
          {issue && !selected && !applied && (
            <section className="fuse-inline-stage" aria-label="Intended behavior">
              <h2>What should happen?</h2>
              <p>Choose behavior first. This does not change code.</p>
              {behaviorChoices}
            </section>
          )}
          {selected && !applied && !review.preview && (
            <p className="fuse-inline-confirmation">
              Confirmed: <strong>{selected.label}</strong>.
              {!b?.proposal && continuation && <span role="status"> {continuation}</span>}
            </p>
          )}
          {b?.proposal && !applied && (
            <p className="fuse-inline-fix">Fix: {b.proposal.rationale}</p>
          )}
          {!applied && verification && !review.preview && (
            <section className="fuse-inline-stage" aria-label="Executed checks">
              <h2>
                {verification.status === 'passed'
                  ? 'Candidate checks passed'
                  : verification.status === 'running'
                    ? 'Checks are running'
                    : 'Verification needs attention'}
              </h2>
              {verification.error && <p className="fuse-inline-error">{verification.error}</p>}
              {verification.status === 'passed' && (
                <Button size="sm" isDisabled={pending || readOnly} onClick={onPreview}>
                  Preview verified code
                </Button>
              )}
            </section>
          )}
          {!applied && review.preview && (
            <details className="fuse-inline-details fuse-inline-approval">
              <summary>Review exact code and approve</summary>
              <h2>Apply these verified bytes?</h2>
              <p>
                This is separate from choosing intended behavior. Fuse writes the exact preview
                after your approval.
              </p>
              <pre aria-label="Exact verified source">{code ?? '// File deletion'}</pre>
              <Button
                size="sm"
                isDisabled={pending || readOnly}
                onClick={() => onApply(review.preview!.token)}
              >
                Approve and apply verified code
              </Button>
            </details>
          )}
          {applied && b?.proposal && (
            <section className="fuse-inline-receipt" role="status">
              <h2>Applied to your local checkout</h2>
              <p>
                The applied source matches the verified candidate. The saved review keeps your
                choices and executed checks.
              </p>
            </section>
          )}
          <footer className="fuse-inline-footer">
            <button
              ref={trigger}
              className="fuse-inline-trigger"
              type="button"
              aria-expanded={expanded}
              aria-controls={contentId}
              onClick={() => {
                setExpanded(!expanded);
              }}
            >
              {expanded ? 'Hide details' : 'Review details'}
              <span aria-hidden="true">{expanded ? '−' : '+'}</span>
            </button>
            <Button size="sm" color="tertiary" isDisabled={pending || readOnly} onClick={onRefresh}>
              Refresh
            </Button>
          </footer>
        </div>
        {expanded && (
          <div className="fuse-inline-content" id={contentId}>
            <p>{summary}</p>
            {selected && (
              <section className="fuse-inline-stage" aria-label="Confirmed behavior">
                <h2>Confirmed behavior: {selected.label}</h2>
                {!applied && (
                  <details className="fuse-inline-details">
                    <summary>Change intended behavior</summary>
                    <p>A new choice requires a new proposal and verification.</p>
                    {behaviorChoices}
                  </details>
                )}
              </section>
            )}
            {issue && (
              <details className="fuse-inline-details">
                <summary>Pinned source evidence</summary>
                {issue.evidence.map((index) => {
                  const evidence = file?.evidence[index];
                  return evidence ? (
                    <section key={index}>
                      <h3>
                        {evidence.revision.toUpperCase()} · {evidence.function} · line{' '}
                        {evidence.line}
                      </h3>
                      <pre>{evidence.code}</pre>
                    </section>
                  ) : null;
                })}
              </details>
            )}
            {verification && (
              <details className="fuse-inline-details">
                <summary>Executed checks · {verification.status}</summary>
                {(['baseline', 'candidate'] as const).map((side) => (
                  <div className="fuse-inline-results" key={side}>
                    <h3>
                      {side === 'baseline' ? 'Clean combined baseline' : 'Proposed correction'}
                    </h3>
                    {verification[side].map((check, index) => (
                      <details className="fuse-inline-check" key={index}>
                        <summary>
                          <span>{check.name}</span>
                          <span data-status={check.status}>{check.status}</span>
                        </summary>
                        <pre>
                          {check.command} {check.args.join(' ')}
                          {'\n'}Exit: {check.exitCode ?? 'none'}
                          {'\n'}
                          {check.stdout}
                          {check.stderr}
                        </pre>
                      </details>
                    ))}
                  </div>
                ))}
                {verification.error && <p className="fuse-inline-error">{verification.error}</p>}
                <p>
                  These configured checks ran in isolation. Passing checks do not prove every
                  possible behavior.
                </p>
              </details>
            )}
            {b?.proposal && (
              <details className="fuse-inline-details">
                <summary>Agent's exact candidate</summary>
                <p>{b.proposal.rationale}</p>
                <pre>{b.proposal.source}</pre>
                <p className="fuse-inline-hash">SHA-256 {b.proposal.hash}</p>
              </details>
            )}
            <p className="fuse-inline-hash">
              {file?.path} · revision {review.revision}
            </p>
          </div>
        )}
      </article>
    </GlassSurface>
  );
}
