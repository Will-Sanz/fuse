import { useId, useMemo, useRef, useState } from 'react';
import type { Review } from '../../shared/review';
import { Button } from '../untitledui/components/base/buttons/button';
import { GlassSurface } from '../liquidglass/GlassSurface';

export interface ReviewCardProps {
  review: Review;
  visualSvg?: string;
  pending?: boolean;
  error?: string;
  readOnly?: boolean;
  onOpenLegacy?: () => void;
  onExpandedChange?: (expanded: boolean) => void;
  onConfirmBehavior: (id: string) => void;
  onPreview: () => void;
  onApply: (token: string) => void;
  onRefresh: () => void;
}

export function ReviewCard({
  review,
  visualSvg,
  pending = false,
  error,
  readOnly = false,
  onOpenLegacy,
  onExpandedChange,
  onConfirmBehavior,
  onPreview,
  onApply,
  onRefresh,
}: ReviewCardProps) {
  const [expanded, setExpanded] = useState(false);
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
  const code = review.preview?.outputs[review.files[0]?.path];
  const visual = useMemo(
    () =>
      visualSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(visualSvg)}` : undefined,
    [visualSvg],
  );
  const collapse = () => {
    setExpanded(false);
    onExpandedChange?.(false);
    trigger.current?.focus();
  };
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
          <p>{summary}</p>
          <button
            ref={trigger}
            className="fuse-inline-trigger"
            type="button"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => {
              setExpanded(!expanded);
              onExpandedChange?.(!expanded);
            }}
          >
            {expanded ? 'Collapse review' : issue ? 'Review interaction' : 'View explanation'}
            <span aria-hidden="true">{expanded ? '−' : '+'}</span>
          </button>
        </header>
        {error && (
          <p className="fuse-inline-error" role="alert">
            {error}
          </p>
        )}
        {expanded && (
          <div className="fuse-inline-content" id={contentId}>
            {visual && (
              <figure className="fuse-inline-visual">
                <img
                  src={visual}
                  alt={
                    review.visual
                      ? `${review.visual.title}. ${review.visual.summary}`
                      : 'Source-grounded explanation'
                  }
                />
                <figcaption>
                  Illustrative explanation · executed checks appear separately below
                </figcaption>
              </figure>
            )}
            {!b && (
              <section className="fuse-inline-stage">
                <p>
                  This review uses the legacy resolution workflow. Its explanation stays here;
                  legacy code choices and application are available in the browser review.
                </p>
                {onOpenLegacy && (
                  <Button size="sm" color="secondary" isDisabled={pending} onClick={onOpenLegacy}>
                    Open legacy browser review
                  </Button>
                )}
              </section>
            )}
            {issue && (
              <details className="fuse-inline-details">
                <summary>Pinned source evidence</summary>
                {issue.evidence.map((index) => {
                  const evidence = review.files[0].evidence[index];
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
            {issue && !applied && (
              <section className="fuse-inline-stage" aria-label="Intended behavior">
                <div className="fuse-inline-step">01 · Intended behavior</div>
                <h2>What should happen?</h2>
                <p>
                  Your choice tells the coding agent what to preserve. It does not change a source
                  file.
                </p>
                <div className="fuse-inline-options">
                  {issue.options.map((option) => (
                    <button
                      key={option.id}
                      className="fuse-inline-option"
                      type="button"
                      disabled={pending || readOnly}
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
              </section>
            )}
            {selected && (
              <p className="fuse-inline-confirmation">
                Confirmed: <strong>{selected.label}</strong>.{' '}
                {b?.proposal
                  ? 'The agent has submitted a proposal.'
                  : 'Ask Codex to draft and verify a correction using this saved choice.'}
              </p>
            )}
            {verification && (
              <section className="fuse-inline-stage" aria-label="Executed checks">
                <div className="fuse-inline-step">02 · Isolated verification</div>
                <h2>
                  {verification.status === 'passed'
                    ? 'Candidate checks passed'
                    : verification.status === 'running'
                      ? 'Checks are running'
                      : 'Verification needs attention'}
                </h2>
                {verification.error && <p className="fuse-inline-error">{verification.error}</p>}
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
                <p>
                  Results come from configured checks executed by Fuse. Passing checks do not prove
                  every possible behavior.
                </p>
              </section>
            )}
            {b?.proposal && (
              <details className="fuse-inline-details">
                <summary>Agent's exact candidate</summary>
                <p>{b.proposal.rationale}</p>
                <pre>{b.proposal.source}</pre>
                <p className="fuse-inline-hash">SHA-256 {b.proposal.hash}</p>
              </details>
            )}
            {!applied && verification?.status === 'passed' && !review.preview && (
              <Button size="sm" isDisabled={pending || readOnly} onClick={onPreview}>
                Preview verified code
              </Button>
            )}
            {!applied && review.preview && (
              <details className="fuse-inline-details fuse-inline-approval">
                <summary>Review exact code and approve</summary>
                <div className="fuse-inline-step">03 · Final code approval</div>
                <h2>Apply these verified bytes?</h2>
                <p>
                  This is separate from choosing intended behavior. Fuse writes the exact preview
                  after your approval.
                </p>
                <pre aria-label="Exact verified source">{code ?? '// File deletion'}</pre>
                <p className="fuse-inline-hash">Preview {review.preview.token}</p>
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
                  The applied source matches the verified candidate. Your decisions and executed
                  checks remain in the saved review.
                </p>
                <p className="fuse-inline-hash">{b?.proposal?.hash}</p>
              </section>
            )}
            <footer className="fuse-inline-footer">
              <span>
                {review.files[0]?.path} · revision {review.revision}
              </span>
              <div>
                <Button
                  size="sm"
                  color="tertiary"
                  isDisabled={pending || readOnly}
                  onClick={onRefresh}
                >
                  Refresh
                </Button>
                <button type="button" className="fuse-inline-close" onClick={collapse}>
                  Collapse
                </button>
              </div>
            </footer>
          </div>
        )}
      </article>
    </GlassSurface>
  );
}
