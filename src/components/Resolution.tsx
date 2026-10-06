import { useEffect, useState } from 'react';
import { Check, CheckCheck, ChevronDown, GitMerge, LoaderCircle } from 'lucide-react';
import type { Conflict, Decision, Workspace } from '../../shared/types';
import { api } from '../api';
export function Resolution({
  workspace,
  conflict,
  onSaved,
  onError,
}: {
  workspace: Workspace;
  conflict: Conflict;
  onSaved: (w: Workspace) => void;
  onError: (message: string) => void;
}) {
  const saved = workspace.decisions[conflict.id];
  const [choice, setChoice] = useState<Decision['choice']>(
    saved?.choice ??
      (conflict.kind === 'dependency' ? 'reviewed' : conflict.canCombine ? 'both' : 'a'),
  );
  const [order, setOrder] = useState<'a-first' | 'b-first'>(saved?.order ?? 'a-first');
  const [note, setNote] = useState(saved?.note ?? '');
  const [preview, setPreview] = useState(''),
    [previewError, setPreviewError] = useState('');
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setPreviewError('');
    api<{ code: string }>(`/workspaces/${workspace.id}/preview`, 'POST', {
      revision: workspace.revision,
      conflictId: conflict.id,
      decision: { choice, order, note: '' },
    })
      .then((r) => {
        if (active) setPreview(r.code);
      })
      .catch((e) => {
        if (active) setPreviewError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspace.id, workspace.revision, conflict.id, choice, order]);
  async function save() {
    setBusy(true);
    try {
      onSaved(
        await api<Workspace>(`/workspaces/${workspace.id}/decisions`, 'PATCH', {
          revision: workspace.revision,
          conflictId: conflict.id,
          decision: { choice, ...(choice === 'both' ? { order } : {}), note },
        }),
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="resolution-detail">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {conflict.kind === 'dependency' ? 'REVIEW CANDIDATE' : 'A DECISION IS NEEDED'}
          </span>
          <h2>{conflict.title}</h2>
        </div>
        {saved && (
          <span className="tag success">
            <Check size={13} />
            Decision saved
          </span>
        )}
      </div>
      <p className="explanation">{conflict.explanation}</p>
      <div className="agent-comparison">
        {(
          [
            {
              key: 'a',
              name: workspace.input.nameA,
              code: conflict.a,
              facts: conflict.observationsA,
            },
            {
              key: 'b',
              name: workspace.input.nameB,
              code: conflict.b,
              facts: conflict.observationsB,
            },
          ] as const
        ).map((agent) => (
          <div className={`agent-version ${agent.key}`} key={agent.key}>
            <div className="version-title">
              <span className={`avatar ${agent.key}`}>{agent.key.toUpperCase()}</span>
              <div>
                <span className="eyebrow">AGENT {agent.key.toUpperCase()}</span>
                <h3>{agent.name}</h3>
              </div>
            </div>
            {agent.facts && (
              <ul className="behavior-facts">
                {agent.facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            )}
            <details className="agent-source">
              <summary>
                Inspect TypeScript changes <ChevronDown size={13} />
              </summary>
              <pre>
                <code>{agent.code || '// Function deleted in this revision'}</code>
              </pre>
            </details>
          </div>
        ))}
      </div>
      <details className="base-details">
        <summary>
          Compare with the common base <ChevronDown size={14} />
        </summary>
        <pre>
          <code>{conflict.base || '// Not present in the base'}</code>
        </pre>
      </details>
      <div className="decision-panel">
        <div className="section-heading">
          <h3>
            {conflict.kind === 'dependency'
              ? 'Have these changes been reviewed together?'
              : 'How should this step behave?'}
          </h3>
          <GitMerge size={18} />
        </div>
        {conflict.kind !== 'dependency' && (
          <div className="choice-grid" role="group" aria-label="Resolution choice">
            {(
              [
                { key: 'a', title: 'Keep A', detail: workspace.input.nameA },
                { key: 'b', title: 'Keep B', detail: workspace.input.nameB },
                { key: 'both', title: 'Merge both', detail: 'Combine additive changes' },
              ] as const
            ).map((option) => (
              <button
                key={option.key}
                className={`choice ${choice === option.key ? 'active' : ''}`}
                aria-pressed={choice === option.key}
                disabled={option.key === 'both' && !conflict.canCombine}
                onClick={() => setChoice(option.key)}
              >
                <span>
                  <strong>{option.title}</strong>
                  {choice === option.key && <Check size={16} />}
                </span>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
        )}
        {choice === 'both' && (
          <label className="order-label">
            Validation order
            <select value={order} onChange={(e) => setOrder(e.target.value as typeof order)}>
              <option value="a-first">A first, then B</option>
              <option value="b-first">B first, then A</option>
            </select>
            <span className="muted small">
              Early returns can prevent later checks from running. Choose the error or side effect
              that should take priority.
            </span>
          </label>
        )}
        <p className="muted small">{conflict.combineReason}</p>
        <label className="note-label">
          Decision note <span className="muted">(optional)</span>
          <textarea
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why is this the right behavior?"
            rows={2}
          />
        </label>
        <div className="preview-heading">
          <span className="eyebrow">
            {conflict.kind === 'dependency' ? 'CHANGES RETAINED' : 'RESULT PREVIEW'}
          </span>
          {loading && <span className="muted small">Updating…</span>}
        </div>
        {previewError ? (
          <div className="error" role="alert">
            {previewError}
          </div>
        ) : (
          <pre className="result-preview">
            <code>{preview || '// Empty result'}</code>
          </pre>
        )}
        <div className="decision-footer">
          <span className="muted small">
            {conflict.kind === 'dependency'
              ? 'Both edits will remain in the result.'
              : 'The complete file is generated after all decisions are saved.'}
          </span>
          <button
            className="button primary"
            disabled={busy || loading || Boolean(previewError)}
            onClick={() => void save()}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <CheckCheck size={17} />}{' '}
            {conflict.kind === 'dependency'
              ? 'Mark reviewed'
              : saved
                ? 'Update decision'
                : 'Save decision'}
          </button>
        </div>
      </div>
    </section>
  );
}
