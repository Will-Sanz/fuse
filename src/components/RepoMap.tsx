import { Fragment, useEffect, useRef, useState } from 'react';
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
}
interface FolderEdge {
  from: string;
  to: string;
}
interface Summary {
  commit: string;
  counts: Record<string, number>;
  startHere: Ranked[];
  folderEdges: FolderEdge[];
  entryPoints: string[];
  cycles: string[][];
  hiddenUnicode: string[];
  unresolved: { from: string; specifier: string }[];
  skipped: { path: string; reason: string }[];
  totals: Record<string, number>;
  labels: Record<string, Label>;
}
interface Focus {
  file: { path: string };
  imports: { to: string }[];
  importedBy: { from: string }[];
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
interface FunctionInteraction {
  function: string;
  viaA: string[];
  viaB: string[];
}
type Overlay =
  | { unavailable: string }
  | {
      changedA: string[];
      changedB: string[];
      interactions: Interaction[];
      functionInteractions: FunctionInteraction[];
      notes: string[];
      summary: { folderEdges: FolderEdge[] };
      diffA: { crossFolderAdded: FolderEdge[] };
      diffB: { crossFolderAdded: FolderEdge[] };
    };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const folderName = (id: string) => (id === '(root)' ? 'root files' : `${id}/`);

/** A path that may break after each folder separator, never inside a name. */
const Path = ({ value }: { value: string }) => (
  <code className="map-path">
    {value.split('/').map((part, i, all) => (
      <Fragment key={i}>
        {part}
        {i < all.length - 1 && (
          <>
            /<wbr />
          </>
        )}
      </Fragment>
    ))}
  </code>
);
/** An import chain. The arrow always means "imports", here and in the folder picture. */
const Chain = ({ paths }: { paths: string[] }) => (
  <span className="map-chain">
    {paths.map((p, i) => (
      <span key={p + i}>
        {i > 0 && (
          <>
            <span className="map-arrow" aria-hidden="true" />
            <span className="sr-only"> imports </span>
          </>
        )}
        <Path value={p} />
      </span>
    ))}
  </span>
);
const More = ({ shown, total }: { shown: number; total: number }) =>
  total > shown ? <p className="map-hint">And {total - shown} more.</p> : null;
function Links({ paths, open }: { paths: string[]; open: (path: string) => void }) {
  return (
    <ul className="map-links">
      {paths.map((p) => (
        <li key={p}>
          <button type="button" onClick={() => open(p)}>
            <Path value={p} />
          </button>
        </li>
      ))}
    </ul>
  );
}
/** Screen-reader text for the folder picture, built from the same data. */
function describeFolders(edges: FolderEdge[]) {
  if (!edges.length) return 'No folder imports another.';
  return `${edges
    .slice(0, 30)
    .map((e) => `${folderName(e.from)} imports ${folderName(e.to)}`)
    .join('; ')}${edges.length > 30 ? `; and ${edges.length - 30} more` : ''}.`;
}

/** The whole-repository map: picture, most-imported files, and one file at a time. */
export function RepoMapView({ aiConfigured }: { aiConfigured: boolean }) {
  const [summary, setSummary] = useState<Summary>();
  const [focus, setFocus] = useState<Focus>();
  const [loadingPath, setLoadingPath] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const requested = useRef('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    api<Summary>('/map').then(setSummary, (e: Error) => setError(e.message));
  }, [version]);
  useEffect(() => {
    if (!focus) return;
    heading.current?.focus();
    if (window.matchMedia('(max-width: 860px)').matches)
      heading.current?.scrollIntoView({ block: 'start' });
  }, [focus]);
  async function open(path: string) {
    requested.current = path;
    setLoadingPath(path);
    setError('');
    try {
      const next = await api<Focus>(`/map?focus=${encodeURIComponent(path)}`);
      // Ignore a slower response for a file the reader has already moved on from.
      if (requested.current === path) setFocus(next);
    } catch (e) {
      if (requested.current === path) setError((e as Error).message);
    } finally {
      if (requested.current === path) setLoadingPath('');
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
  const hidden = summary.totals.skipped + summary.totals.unresolved;
  const openFile = (p: string) => void open(p);
  const deep = focus ? focus.impact.paths.filter((p) => p.length > 2) : [];
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
        {aiConfigured && (
          <div className="map-describe">
            <Button size="sm" color="secondary" isLoading={busy} onClick={() => void describe()}>
              {described ? 'Update descriptions' : 'Add file descriptions'}
            </Button>
            <p className="map-hint">
              Sends up to 30 central files to the Fuse AI service to write a one-line summary of
              each. Files that look like they hold secrets aren’t sent.
            </p>
          </div>
        )}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <strong>{error}</strong>
        </div>
      )}
      {(summary.totals.hiddenUnicode > 0 || summary.totals.cycles > 0) && (
        <div className="map-findings" role="note">
          <AlertTriangle aria-hidden="true" />
          <div>
            {summary.totals.hiddenUnicode > 0 && (
              <>
                <p>
                  <strong>
                    Hidden characters in {plural(summary.totals.hiddenUnicode, 'file')}.
                  </strong>{' '}
                  Invisible or right-to-left characters can make code read differently from how it
                  runs.
                </p>
                <Links paths={summary.hiddenUnicode} open={openFile} />
                <More shown={summary.hiddenUnicode.length} total={summary.totals.hiddenUnicode} />
              </>
            )}
            {summary.cycles.map((c) => (
              <p key={c.join()}>
                <strong>Circular import.</strong> <Chain paths={[...c, c[0]]} />
              </p>
            ))}
            <More shown={summary.cycles.length} total={summary.totals.cycles} />
          </div>
        </div>
      )}
      <figure
        className="map-figure"
        tabIndex={0}
        role="region"
        aria-label="Folder map. Scrolls sideways on small screens."
      >
        <img src={`/api/map.svg?ref=${summary.commit}`} alt="" />
        <figcaption className="sr-only">{describeFolders(summary.folderEdges)}</figcaption>
      </figure>
      <div className="map-columns">
        <section aria-labelledby="most-imported-heading">
          <h2 id="most-imported-heading">Most-imported files</h2>
          <p>Files that the most other files import. Start reading here.</p>
          {summary.startHere.length ? (
            <ol className="map-list">
              {summary.startHere.map((f) => {
                const current = focus?.file.path === f.path;
                return (
                  <li key={f.path}>
                    <button
                      type="button"
                      className={current ? 'map-row active' : 'map-row'}
                      aria-current={current || undefined}
                      onClick={() => openFile(f.path)}
                    >
                      <span className="map-row-text">
                        <Path value={f.path} />
                        {summary.labels[f.path] && (
                          <span className="map-label">{summary.labels[f.path].summary}</span>
                        )}
                      </span>
                      <span className="map-meta">
                        {loadingPath === f.path ? 'Opening…' : plural(f.fanIn, 'importer')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="map-hint">No file imports another file yet.</p>
          )}
          {described && (
            <p className="map-footnote">
              Summaries are AI-written from each file’s code. Check them before relying on them.
            </p>
          )}
          {summary.entryPoints.length > 0 && (
            <>
              <h3>Entry points</h3>
              <p className="map-hint">Files nothing else imports, such as commands and servers.</p>
              <Links paths={summary.entryPoints} open={openFile} />
              <More shown={summary.entryPoints.length} total={summary.totals.entryPoints} />
            </>
          )}
        </section>
        <section
          aria-labelledby="file-heading"
          className="map-focus"
          aria-busy={loadingPath !== '' || undefined}
        >
          {focus ? (
            <>
              <h2 id="file-heading" ref={heading} tabIndex={-1}>
                <Path value={focus.file.path} />
              </h2>
              {focus.label && (
                <p className="map-label">
                  {focus.label.summary} <span className="map-ai-note">AI-written summary</span>
                </p>
              )}
              <p className="map-impact">
                {focus.impact.dependents
                  ? `${plural(focus.impact.dependents, 'file')} depend on it, directly or through other files.`
                  : 'No other file depends on it.'}
              </p>
              {focus.inCycle && (
                <p className="map-warn">
                  Part of a circular import: <Chain paths={[...focus.inCycle, focus.inCycle[0]]} />
                </p>
              )}
              <h3>Imports</h3>
              {focus.imports.length ? (
                <Links paths={focus.imports.map((e) => e.to)} open={openFile} />
              ) : (
                <p className="map-hint">No files in this repository.</p>
              )}
              {focus.externals.length > 0 && (
                <p className="map-hint">Packages: {focus.externals.join(', ')}</p>
              )}
              <h3>Imported by</h3>
              {focus.importedBy.length ? (
                <Links paths={focus.importedBy.map((e) => e.from)} open={openFile} />
              ) : (
                <p className="map-hint">No other file imports this one.</p>
              )}
              {deep.length > 0 && (
                <>
                  <h3>Depend on it through other files</h3>
                  <ul className="map-paths">
                    {deep.slice(0, 6).map((p) => (
                      <li key={p.join()}>
                        <Chain paths={p} />
                      </li>
                    ))}
                  </ul>
                  <More shown={Math.min(6, deep.length)} total={deep.length} />
                </>
              )}
            </>
          ) : (
            <div className="map-empty">
              <h2 id="file-heading" ref={heading} tabIndex={-1}>
                Select a file
              </h2>
              <p>See what it imports, what imports it, and which files depend on it.</p>
            </div>
          )}
        </section>
      </div>
      {hidden > 0 && (
        <details className="map-limits">
          <summary>Not shown: {plural(hidden, 'file or import')}</summary>
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
          <More shown={summary.skipped.length + summary.unresolved.length} total={hidden} />
        </details>
      )}
      <p className="map-footnote">
        Shows imports and direct function calls. Callbacks and code loaded at runtime aren’t
        included.
      </p>
    </div>
  );
}

/** `path#name` call ids: the function name to show, and the file it lives in. */
const fnParts = (id: string) => {
  const at = id.lastIndexOf('#');
  return { file: id.slice(0, at), name: id.slice(at + 1) };
};
const Fn = ({ id, withFile = true }: { id: string; withFile?: boolean }) => {
  const { file, name } = fnParts(id);
  return (
    <>
      <code className="map-path">{name}()</code>
      {withFile && (
        <span className="map-fn-file">
          {' '}
          in <Path value={file} />
        </span>
      )}
    </>
  );
};
/** Nearest meetings only: everything at the shortest combined distance. */
function nearestOf<T extends { viaA: string[]; viaB: string[] }>(list: T[]) {
  if (!list.length) return { first: [] as T[], rest: [] as T[] };
  const best = Math.min(...list.map((i) => i.viaA.length + i.viaB.length));
  return {
    first: list.filter((i) => i.viaA.length + i.viaB.length === best),
    rest: list.filter((i) => i.viaA.length + i.viaB.length !== best),
  };
}

/** Where a reviewed change sits in the repository, and where both sides' changes meet. */
export function ReviewMap({
  reviewId,
  sides,
}: {
  reviewId: string;
  sides: { a: string; b: string };
}) {
  const [overlay, setOverlay] = useState<Overlay>();
  const [error, setError] = useState('');
  useEffect(() => {
    api<Overlay>(`/reviews/${reviewId}/map`).then(setOverlay, (e: Error) => setError(e.message));
  }, [reviewId]);
  if (error)
    return (
      <div className="inline-warning" role="status">
        Couldn’t load the repository map.
        <details>
          <summary>Details</summary>
          {error}
        </details>
      </div>
    );
  if (!overlay) return <LoadingIndicator size="sm" label="Reading the repository…" />;
  if ('unavailable' in overlay) return <p className="map-hint">{overlay.unavailable}</p>;
  const crossings = [...overlay.diffA.crossFolderAdded, ...overlay.diffB.crossFolderAdded];
  const nearest = overlay.interactions.length
    ? Math.min(...overlay.interactions.map((i) => i.viaA.length + i.viaB.length))
    : 0;
  const first = overlay.interactions.filter((i) => i.viaA.length + i.viaB.length === nearest);
  const further = overlay.interactions.filter((i) => !first.includes(i));
  const fnMeet = nearestOf(overlay.functionInteractions ?? []);
  /** How the meeting file reaches a side's change, in import order. */
  const route = (via: string[]) =>
    via.length === 1 ? (
      'changed in this file'
    ) : (
      <>
        imports <Path value={via[via.length - 1]} />
        {via.length > 2 && (
          <>
            {' '}
            through{' '}
            {via.slice(1, -1).map((p, i) => (
              <Fragment key={p}>
                {i > 0 && ', '}
                <Path value={p} />
              </Fragment>
            ))}
          </>
        )}
      </>
    );
  return (
    <div className="review-map">
      <figure
        className="map-figure"
        tabIndex={0}
        role="region"
        aria-label="Folder map. Scrolls sideways on small screens."
      >
        <img src={`/api/reviews/${reviewId}/map.svg`} alt="" />
        <figcaption className="sr-only">
          {describeFolders(overlay.summary.folderEdges)} Changed by A:{' '}
          {overlay.changedA.join(', ') || 'nothing'}. Changed by B:{' '}
          {overlay.changedB.join(', ') || 'nothing'}.
          {first.length ? ` The changes meet in ${first.map((i) => i.file).join(', ')}.` : ''}
        </figcaption>
      </figure>
      {fnMeet.first.length > 0 && (
        <div className="meet-list">
          {fnMeet.first.slice(0, 4).map((i) => (
            <div className="meet" key={i.function}>
              <p className="meet-file">
                <Fn id={i.function} />
              </p>
              {(['a', 'b'] as const).map((k) => {
                const via = k === 'a' ? i.viaA : i.viaB;
                return (
                  <p className="map-via" key={k}>
                    <span className="side-tag" data-side={k} title={sides[k]} aria-hidden="true">
                      {k.toUpperCase()}
                    </span>
                    <span>
                      <span className="sr-only">
                        Change {k.toUpperCase()} ({sides[k]}):{' '}
                      </span>
                      {via.length === 1 ? (
                        'changed this function'
                      ) : (
                        <>
                          calls <Fn id={via[via.length - 1]} />
                          {via.length > 2 && (
                            <>
                              {' '}
                              through{' '}
                              {via.slice(1, -1).map((f, n) => (
                                <Fragment key={f}>
                                  {n > 0 && ', '}
                                  <Fn id={f} withFile={false} />
                                </Fragment>
                              ))}
                            </>
                          )}
                          , which {k.toUpperCase()} changed
                        </>
                      )}
                    </span>
                  </p>
                );
              })}
            </div>
          ))}
          <More shown={Math.min(4, fnMeet.first.length)} total={fnMeet.first.length} />
          {fnMeet.rest.length > 0 && (
            <p className="map-hint">
              {plural(fnMeet.rest.length, 'more function')} further up the call chain also reach
              both changes.
            </p>
          )}
        </div>
      )}
      {fnMeet.first.length > 0 ? null : first.length ? (
        <div className="meet-list">
          {first.slice(0, 6).map((i) => (
            <div className="meet" key={i.file}>
              <p className="meet-file">
                <Path value={i.file} />
              </p>
              {(['a', 'b'] as const).map((k) => (
                <p className="map-via" key={k}>
                  <span className="side-tag" data-side={k} title={sides[k]} aria-hidden="true">
                    {k.toUpperCase()}
                  </span>
                  <span>
                    <span className="sr-only">
                      Change {k.toUpperCase()} ({sides[k]}):{' '}
                    </span>
                    {route(k === 'a' ? i.viaA : i.viaB)}
                  </span>
                </p>
              ))}
            </div>
          ))}
          <More shown={Math.min(6, first.length)} total={first.length} />
          {further.length > 0 && (
            <p className="map-hint">
              Further downstream:{' '}
              {further.slice(0, 5).map((i, n) => (
                <Fragment key={i.file}>
                  {n > 0 && ', '}
                  <Path value={i.file} />
                </Fragment>
              ))}
              {further.length > 5 ? `, and ${further.length - 5} more` : ''}.
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
      {overlay.notes.length > 0 && <p className="map-footnote">{overlay.notes.join(' ')}</p>}
    </div>
  );
}
