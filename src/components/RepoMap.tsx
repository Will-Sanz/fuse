import { useEffect, useState } from 'react';
import { AlertTriangle, Stars02 } from '@untitledui/icons';
import { Button } from '../untitledui/components/base/buttons/button';
import { LoadingIndicator } from '../untitledui/components/application/loading-indicator/loading-indicator';
import { api } from '../api';

interface Label {
  summary: string;
  cites: string[];
  model: string;
}
interface Ranked {
  path: string;
  fanIn: number;
  fanOut: number;
  rank: number;
  exports: string[];
}
interface Summary {
  commit: string;
  counts: Record<string, number>;
  startHere: Ranked[];
  entryPoints: string[];
  cycles: string[][];
  externals: string[];
  hiddenUnicode: string[];
  unresolved: { from: string; specifier: string }[];
  skipped: { path: string; reason: string }[];
  warnings: string[];
  labels: Record<string, Label>;
}
interface Focus {
  file: { path: string; exports: string[]; test: boolean };
  metrics: { fanIn: number; fanOut: number };
  imports: { to: string; kinds: string[] }[];
  importedBy: { from: string }[];
  callsIn: { from: string; to: string }[];
  externals: string[];
  impact: { dependents: number; paths: string[][] };
  inCycle: string[] | null;
  label: Label | null;
}
interface Interaction {
  file: string;
  viaA: string[];
  viaB: string[];
}
interface Overlay {
  changedA: string[];
  changedB: string[];
  interactions: Interaction[];
  note: string;
  notes: string[];
  diffA: { crossFolderAdded: { from: string; to: string }[] };
  diffB: { crossFolderAdded: { from: string; to: string }[] };
}

const Path = ({ value }: { value: string }) => <code className="map-path">{value}</code>;
const Chain = ({ paths }: { paths: string[] }) => (
  <span className="map-chain">
    {paths.map((p, i) => (
      <span key={p}>
        {i > 0 && <span aria-hidden="true"> → </span>}
        <Path value={p} />
      </span>
    ))}
  </span>
);
function AiLabel({ label }: { label?: Label | null }) {
  if (!label) return null;
  return (
    <p
      className="map-label"
      title={`AI-written by ${label.model}; based on ${label.cites.join(', ')}`}
    >
      <Stars02 aria-hidden="true" />
      {label.summary}
      <span className="map-ai-tag">AI</span>
    </p>
  );
}

/** The whole-repository map: picture, where to start, and one file at a time. */
export function RepoMapView() {
  const [summary, setSummary] = useState<Summary>();
  const [focus, setFocus] = useState<Focus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    api<Summary>('/map').then(setSummary, (e: Error) => setError(e.message));
  }, [version]);
  async function open(path: string) {
    setError('');
    try {
      setFocus(await api<Focus>(`/map?focus=${encodeURIComponent(path)}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function describe() {
    setBusy('Writing file descriptions…');
    setError('');
    try {
      await api('/map/labels', {});
      setVersion((v) => v + 1);
      if (focus) await open(focus.file.path);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  if (!summary)
    return error ? (
      <div className="error-banner" role="alert">
        <strong>{error}</strong>
      </div>
    ) : (
      <div className="loading-state">
        <LoadingIndicator label="Mapping the repository…" />
      </div>
    );
  const labelled = Object.keys(summary.labels).length;
  return (
    <div className="repo-map">
      <div className="page-heading">
        <div>
          <p className="breadcrumb">Repository map · commit {summary.commit.slice(0, 7)}</p>
          <h1>How this codebase fits together</h1>
          <p>
            {summary.counts.files} files · {summary.counts.imports} imports ·{' '}
            {summary.counts.crossFileCalls} cross-file calls. Built from source, no AI.
          </p>
        </div>
        <Button
          size="sm"
          color="secondary"
          iconLeading={Stars02}
          isDisabled={!!busy}
          onClick={() => void describe()}
        >
          {labelled ? 'Refresh AI descriptions' : 'Describe files with AI'}
        </Button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <strong>{error}</strong>
        </div>
      )}
      {(summary.hiddenUnicode.length > 0 || summary.cycles.length > 0) && (
        <div className="map-findings" role="note">
          <AlertTriangle aria-hidden="true" />
          <div>
            {summary.hiddenUnicode.length > 0 && (
              <p>
                <strong>Hidden characters.</strong> These files contain invisible or bidirectional
                Unicode, which can make code or comments say something other than what you see:{' '}
                {summary.hiddenUnicode.map((p) => (
                  <Path key={p} value={p} />
                ))}
              </p>
            )}
            {summary.cycles.map((c) => (
              <p key={c.join()}>
                <strong>Import cycle.</strong> <Chain paths={[...c, c[0]]} />
              </p>
            ))}
          </div>
        </div>
      )}
      <figure className="map-figure">
        <img
          src={`/api/map.svg?ref=${summary.commit}`}
          alt="Folder-level map of imports between parts of the repository"
        />
      </figure>
      <div className="map-columns">
        <section aria-labelledby="start-heading">
          <h2 id="start-heading">Start here</h2>
          <p>The files the rest of the code depends on most.</p>
          <ol className="map-list">
            {summary.startHere.map((f) => (
              <li key={f.path}>
                <button
                  className={focus?.file.path === f.path ? 'map-row active' : 'map-row'}
                  onClick={() => void open(f.path)}
                >
                  <Path value={f.path} />
                  <span className="map-meta">used by {f.fanIn}</span>
                </button>
                <AiLabel label={summary.labels[f.path]} />
              </li>
            ))}
          </ol>
          {summary.entryPoints.length > 0 && (
            <>
              <h3>Entry points</h3>
              <p className="map-wrap">
                {summary.entryPoints.slice(0, 12).map((p) => (
                  <button key={p} className="map-chip" onClick={() => void open(p)}>
                    {p}
                  </button>
                ))}
              </p>
            </>
          )}
        </section>
        <section aria-labelledby="focus-heading" className="map-focus">
          {focus ? (
            <>
              <h2 id="focus-heading">
                <Path value={focus.file.path} />
              </h2>
              <AiLabel label={focus.label} />
              <p>
                A change here can reach <strong>{focus.impact.dependents}</strong> other file
                {focus.impact.dependents === 1 ? '' : 's'}.
              </p>
              {focus.inCycle && (
                <p className="map-warn">
                  Part of an import cycle: <Chain paths={[...focus.inCycle, focus.inCycle[0]]} />
                </p>
              )}
              <h3>Uses</h3>
              <p className="map-wrap">
                {focus.imports.length
                  ? focus.imports.map((e) => (
                      <button key={e.to} className="map-chip" onClick={() => void open(e.to)}>
                        {e.to}
                        {e.kinds.includes('type') && e.kinds.length === 1 ? ' (types)' : ''}
                      </button>
                    ))
                  : 'No local imports.'}
                {focus.externals.map((x) => (
                  <span key={x} className="map-chip external">
                    {x}
                  </span>
                ))}
              </p>
              <h3>Used by</h3>
              <p className="map-wrap">
                {focus.importedBy.length
                  ? focus.importedBy.map((e) => (
                      <button key={e.from} className="map-chip" onClick={() => void open(e.from)}>
                        {e.from}
                      </button>
                    ))
                  : 'Nothing imports this file.'}
              </p>
              {focus.impact.paths.length > 0 && (
                <>
                  <h3>How a change travels</h3>
                  <ul className="map-paths">
                    {focus.impact.paths.slice(0, 6).map((p) => (
                      <li key={p.join()}>
                        <Chain paths={[...p].reverse()} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <div className="map-empty">
              <h2 id="focus-heading">Pick a file</h2>
              <p>See what it uses, what uses it, and how far a change to it would reach.</p>
            </div>
          )}
        </section>
      </div>
      {(summary.skipped.length > 0 || summary.unresolved.length > 0) && (
        <details className="map-limits">
          <summary>
            What the map could not see ({summary.skipped.length + summary.unresolved.length})
          </summary>
          <ul>
            {summary.skipped.map((s) => (
              <li key={s.path}>
                <Path value={s.path} /> {s.reason}
              </li>
            ))}
            {summary.unresolved.map((u) => (
              <li key={u.from + u.specifier}>
                <Path value={u.from} /> imports <code>{u.specifier}</code>, which was not found.
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="map-footnote">{summary.warnings[0]}</p>
      {busy && (
        <div className="work-status" role="status">
          <LoadingIndicator size="sm" />
          {busy}
        </div>
      )}
    </div>
  );
}

/** Where a reviewed change sits in the wider repository, and where both sides' changes meet. */
export function ReviewMap({ reviewId }: { reviewId: string }) {
  const [overlay, setOverlay] = useState<Overlay>();
  const [error, setError] = useState('');
  useEffect(() => {
    api<Overlay>(`/reviews/${reviewId}/map`).then(setOverlay, (e: Error) => setError(e.message));
  }, [reviewId]);
  if (error) return <p className="map-footnote">Repository map unavailable: {error}</p>;
  if (!overlay) return <LoadingIndicator size="sm" label="Mapping the repository…" />;
  const crossings = [...overlay.diffA.crossFolderAdded, ...overlay.diffB.crossFolderAdded];
  const nearest = overlay.interactions.length
    ? Math.min(...overlay.interactions.map((i) => i.viaA.length + i.viaB.length))
    : 0;
  const first = overlay.interactions.filter((i) => i.viaA.length + i.viaB.length === nearest);
  const downstream = overlay.interactions.filter((i) => !first.includes(i));
  return (
    <div className="review-map">
      <figure className="map-figure">
        <img
          src={`/api/reviews/${reviewId}/map.svg`}
          alt="Repository folders with each side's changes and where they meet highlighted"
        />
      </figure>
      {first.length ? (
        <ul className="map-paths">
          {first.slice(0, 6).map((i) => (
            <li key={i.file}>
              <strong>Both changes meet in</strong> <Path value={i.file} />
              <div className="map-via">
                <span className="side-tag a">A</span>
                <Chain paths={i.viaA} />
              </div>
              <div className="map-via">
                <span className="side-tag b">B</span>
                <Chain paths={i.viaB} />
              </div>
            </li>
          ))}
          {downstream.length > 0 && (
            <li>
              {downstream.length} more file{downstream.length === 1 ? '' : 's'} depend on these
              through it:{' '}
              {downstream.slice(0, 5).map((i, n) => (
                <span key={i.file}>
                  {n > 0 && ', '}
                  <Path value={i.file} />
                </span>
              ))}
              {downstream.length > 5 ? ' …' : ''}
            </li>
          )}
        </ul>
      ) : (
        <p>No file outside the changed ones depends on both sides.</p>
      )}
      {crossings.length > 0 && (
        <p className="map-warn">
          New dependency across top-level folders:{' '}
          {crossings.map((e) => (
            <Chain key={e.from + e.to} paths={[e.from, e.to]} />
          ))}
        </p>
      )}
      <p className="map-footnote">{[overlay.note, ...overlay.notes].join(' ')}</p>
    </div>
  );
}
