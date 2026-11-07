import type { Review } from '../../shared/review';
import { Button } from '../untitledui/components/base/buttons/button';
import { api } from '../api';

export function BehaviorReview({
  review,
  busy,
  action,
}: {
  review: Review;
  busy: string;
  action: (label: string, fn: () => Promise<Review>) => Promise<unknown>;
}) {
  const b = review.behavioral!;
  const issue = b.issue,
    v = b.verification;
  const applied = review.status !== 'proposed';
  return (
    <section className="step-section behavior-review" aria-label="Behavioral review">
      <h2>{issue?.summary || b.assessment}</h2>
      <p>Agent assessment: {b.explanation}</p>
      {issue && (
        <>
          <p>{issue.rationale}</p>
          <details>
            <summary>Pinned evidence from affected functions</summary>
            {issue.evidence.map((i) => {
              const e = review.files[0].evidence[i];
              return (
                <article key={i}>
                  <h3>
                    {e.revision} · {e.function} · line {e.line}
                  </h3>
                  <pre>{e.code}</pre>
                </article>
              );
            })}
          </details>
          {!applied && (
            <>
              <h3>1. Confirm intended behavior</h3>
              <div className="behavior-choices">
                {issue.options.map((o) => (
                  <button
                    key={o.id}
                    className="behavior-choice"
                    disabled={!!busy}
                    aria-pressed={b.intent?.behaviorId === o.id}
                    onClick={() =>
                      void action('Confirming behavior…', () =>
                        api<Review>(`/reviews/${review.id}/behavior`, {
                          revision: review.revision,
                          behaviorId: o.id,
                          confirmed: true,
                        }),
                      )
                    }
                  >
                    <strong>{o.label}</strong>
                    <span>{o.description}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {b.intent && (
            <p role="status">
              Confirmed: {issue.options.find((o) => o.id === b.intent!.behaviorId)?.label}.{' '}
              {b.proposal
                ? 'Agent proposal received.'
                : 'Return to your coding agent. Ask it to read this review and submit a proposal.'}
            </p>
          )}
          {!applied && (
            <Button
              color="secondary"
              isDisabled={!!busy}
              onClick={() =>
                void action('Refreshing review…', () => api<Review>(`/reviews/${review.id}`))
              }
            >
              Refresh agent progress
            </Button>
          )}
          {b.proposal && (
            <>
              <h3>2. Exact candidate</h3>
              <p>{b.proposal.rationale}</p>
              <pre aria-label="Exact candidate source">{b.proposal.source}</pre>
              <p>Candidate SHA-256: {b.proposal.hash}</p>
            </>
          )}
          {v && (
            <>
              <h3>3. Isolated verification: {v.status}</h3>
              <p>Image: {v.image}</p>
              {v.error && <p role="alert">{v.error}</p>}
              {(['baseline', 'candidate'] as const).map((side) => (
                <div key={side}>
                  <h4>{side === 'baseline' ? 'Clean combined baseline' : 'Proposed correction'}</h4>
                  {v[side].map((c, i) => (
                    <details key={i}>
                      <summary>
                        {c.name}: {c.status} (exit {c.exitCode ?? 'none'})
                      </summary>
                      <pre>
                        {c.command} {c.args.join(' ')}
                        {'\n'}
                        {c.stdout}
                        {c.stderr}
                      </pre>
                    </details>
                  ))}
                </div>
              ))}
              <p>
                These are executed check results, not a proof of all possible behavior. A baseline
                failure is distinct from the agent’s suspicion.
              </p>
            </>
          )}
          {!applied && v?.status === 'passed' && (
            <Button
              isDisabled={!!busy}
              onClick={() =>
                void action('Preparing verified preview…', () =>
                  api<Review>(`/reviews/${review.id}/preview`, { revision: review.revision }),
                )
              }
            >
              Preview verified change
            </Button>
          )}
          {!applied && review.preview && (
            <>
              <h3>4. Approve exact verified code</h3>
              <pre aria-label="Verified preview">
                {review.preview.outputs[review.files[0].path]}
              </pre>
              <Button
                isDisabled={!!busy}
                onClick={() =>
                  void action('Applying approved bytes…', () =>
                    api<Review>(`/reviews/${review.id}/apply`, {
                      revision: review.revision,
                      token: review.preview!.token,
                    }),
                  )
                }
              >
                Approve and apply verified code
              </Button>
            </>
          )}
          {applied && (
            <p role="status">
              Applied verified candidate {b.proposal?.hash}. Changes are local and uncommitted.
              Execution evidence and both decisions are saved in history.
            </p>
          )}
        </>
      )}
    </section>
  );
}
