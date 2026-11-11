import { useEffect, useState } from 'react';
import { AlertTriangle } from '@untitledui/icons';
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
  notes: string[];
  diffA: { crossFolderAdded: { from: string; to: string }[] };
  diffB: { crossFolderAdded: { from: string; to: string }[] };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const Path = ({ value }: { value: string }) => <code className="map-path">{value}</code>;
const Chain = ({ paths }: { paths: string[] }) => (
  <span className="map-chain">
    {paths.map((p, i) => (
      <span key={p}>
        {i > 0 && <span className="map-arrow" aria-label="reaches" />}
        <Path value={p} />
      </span>
    ))}
  </span>
);
function List({ paths, open }: { paths: string[]; open: (path: string) => void }) {
  return (
    <ul className="map-links">
      {paths.map((p) => (
        <li key={p}>
          <button onClick={() => open(p)}>
            <Path value={p} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Chains read in the direction a change travels: from the changed file to the files it reaches. */
const outward = (importPath: string[]) => [...importPath].reverse();

/** The whole-repository map: picture, most-used files, and one file at a time. */
export function RepoMapView() {
  const [summary, setSummary] = useState<Summary>();
  const [focus, setFocus] = useState<Focus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    setError('');
    try {
      await api('/map/labels', {});
      setVersion((v) => v + 1);
      if (focus) await open(focus.file.path);
    } catch (e) {
      setError(`File descriptions weren’t added. ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  if (!summary)
    return error ? (
      <div className="error-banner" role="alert">
        <strong>{error}</strong>
      </div>
    ) : (
      <div className="loading-state">
        <LoadingIndicator label="Reading the repository…" />
      </div>
    );
  const described = Object.keys(summary.labels).length > 0;
  const hidden = summary.skipped.length + summary.unresolved.length;
  return (
    <div className="repo-map">
      <div className="page-heading">
        <div>
          <h1>Repository map</h1>
          <p>
            {plural(summary.counts.files, 'file')} and {plural(summary.counts.imports, 'import')} at
            commit <code>{summary.commit.slice(0, 7)}</code>
          </p>
        </div>
        <Button size="sm" color="secondary" isLoading={busy} onClick={() => void describe()}>
          {described ? 'Update descriptions' : 'Add file descriptions'}
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
                <strong>
                  Hidden characters in {plural(summary.hiddenUnicode.length, 'file')}.
                </strong>{' '}
                Invisible or right-to-left characters can make code read differently from how it
                runs.
              </p>
            )}
            {summary.hiddenUnicode.length > 0 && (
              <List paths={summary.hiddenUnicode} open={(p) => void open(p)} />
            )}
            {summary.cycles.map((c) => (
              <p key={c.join()}>
                <strong>Circular import.</strong> <Chain paths={[...c, c[0]]} />
              </p>
            ))}
          </div>
        </div>
      )}
      <figure className="map-figure">
        <img
          src={`/api/map.svg?ref=${summary.commit}`}
          alt="Folders in the repository, with arrows from each folder to the folders it imports"
        />
      </figure>
      <div className="map-columns">
        <section aria-labelledby="most-used-heading">
          <h2 id="most-used-heading">Most-used files</h2>
          <p>
            Imported by the most other files. Reading these first explains most of the codebase.
          </p>
          <ol className="map-list">
            {summary.startHere.map((f) => (
              <li key={f.path}>
                <button
                  className={focus?.file.path === f.path ? 'map-row active' : 'map-row'}
                  aria-current={focus?.file.path === f.path || undefined}
                  onClick={() => void open(f.path)}
                >
                  <span className="map-row-text">
                    <Path value={f.path} />
                    {summary.labels[f.path] && (
                      <span className="map-label">{summary.labels[f.path].summary}</span>
                    )}
                  </span>
                  <span className="map-meta">{plural(f.fanIn, 'importer')}</span>
                </button>
              </li>
            ))}
          </ol>
          {described && (
            <p className="map-footnote">
              Descriptions are written by AI from each file’s code and may be wrong.
            </p>
          )}
          {summary.entryPoints.length > 0 && (
            <>
              <h3>Entry points</h3>
              <p className="map-hint">Files nothing else imports, such as commands and servers.</p>
              <List paths={summary.entryPoints.slice(0, 12)} open={(p) => void open(p)} />
            </>
          )}
        </section>
        <section aria-labelledby="file-heading" className="map-focus">
          {focus ? (
            <>
              <h2 id="file-heading">
                <Path value={focus.file.path} />
              </h2>
              {focus.label && <p className="map-label">{focus.label.summary}</p>}
              <dl className="map-facts">
                <div>
                  <dt>Imports</dt>
                  <dd>{focus.imports.length}</dd>
                </div>
                <div>
                  <dt>Imported by</dt>
                  <dd>{focus.importedBy.length}</dd>
                </div>
                <div>
                  <dt>Affected by a change</dt>
                  <dd>{focus.impact.dependents}</dd>
                </div>
              </dl>
              {focus.inCycle && (
                <p className="map-warn">
                  Part of a circular import: <Chain paths={[...focus.inCycle, focus.inCycle[0]]} />
                </p>
              )}
              <h3>Imports</h3>
              {focus.imports.length || focus.externals.length ? (
                <>
                  <List paths={focus.imports.map((e) => e.to)} open={(p) => void open(p)} />
                  {focus.externals.length > 0 && (
                    <p className="map-hint">Packages: {focus.externals.join(', ')}</p>
                  )}
                </>
              ) : (
                <p className="map-hint">No imports.</p>
              )}
              <h3>Imported by</h3>
              {focus.importedBy.length ? (
                <List paths={focus.importedBy.map((e) => e.from)} open={(p) => void open(p)} />
              ) : (
                <p className="map-hint">No other file imports this one.</p>
              )}
              {focus.impact.paths.length > 0 && (
                <>
                  <h3>Affected by a change</h3>
                  <ul className="map-paths">
                    {focus.impact.paths.slice(0, 6).map((p) => (
                      <li key={p.join()}>
                        <Chain paths={outward(p)} />
                      </li>
                    ))}
                  </ul>
                  {focus.impact.paths.length > 6 && (
                    <p className="map-hint">And {focus.impact.paths.length - 6} more.</p>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="map-empty">
              <h2 id="file-heading">Select a file</h2>
              <p>See what it imports, what imports it, and which files a change to it affects.</p>
            </div>
          )}
        </section>
      </div>
      {hidden > 0 && (
        <details className="map-limits">
          <summary>{plural(hidden, 'file or import')} not shown</summary>
          <ul>
            {summary.skipped.map((s) => (
              <li key={s.path}>
                <Path value={s.path} /> {s.reason}
              </li>
            ))}
            {summary.unresolved.map((u) => (
              <li key={u.from + u.specifier}>
                <Path value={u.from} /> imports <code>{u.specifier}</code>, which doesn’t exist.
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="map-footnote">
        Shows imports and direct function calls. Callbacks and code loaded at runtime aren’t
        included.
      </p>
    </div>
  );
}

/** Where a reviewed change sits in the repository, and where both sides' changes meet. */
export function ReviewMap({ reviewId }: { reviewId: string }) {
  const [overlay, setOverlay] = useState<Overlay>();
  const [error, setError] = useState('');
  useEffect(() => {
    api<Overlay>(`/reviews/${reviewId}/map`).then(setOverlay, (e: Error) => setError(e.message));
  }, [reviewId]);
  if (error) return <p className="map-hint">The repository map couldn’t be loaded. {error}</p>;
  if (!overlay) return <LoadingIndicator size="sm" label="Reading the repository…" />;
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
          alt="Folders in the repository, highlighting each side's changes and the folder where they meet"
        />
      </figure>
      {first.length ? (
        <div className="meet-list">
          {first.slice(0, 6).map((i) => (
            <div className="meet" key={i.file}>
              <p className="meet-file">
                <Path value={i.file} />
              </p>
              <p className="map-via">
                <span className="side-tag a">A</span>
                <Chain paths={outward(i.viaA)} />
              </p>
              <p className="map-via">
                <span className="side-tag b">B</span>
                <Chain paths={outward(i.viaB)} />
              </p>
            </div>
          ))}
          {downstream.length > 0 && (
            <p className="map-hint">
              Also affected:{' '}
              {downstream.slice(0, 5).map((i, n) => (
                <span key={i.file}>
                  {n > 0 && ', '}
                  <Path value={i.file} />
                </span>
              ))}
              {downstream.length > 5 ? `, and ${downstream.length - 5} more` : ''}.
            </p>
          )}
        </div>
      ) : (
        <p className="map-hint">No file imports code changed on both sides.</p>
      )}
      {crossings.length > 0 && (
        <p className="map-warn">
          New import between top-level folders:{' '}
          {crossings.map((e) => (
            <Chain key={e.from + e.to} paths={[e.from, e.to]} />
          ))}
        </p>
      )}
      <p className="map-footnote">
        Shared imports show where to look, not that the code is broken.
        {overlay.notes.length ? ` ${overlay.notes.join(' ')}` : ''}
      </p>
    </div>
  );
}
