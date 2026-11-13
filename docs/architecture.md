# Fuse architecture

## MCP-first behavioral proposals

Fuse now supports **saved issue → human behavior confirmation → host-agent proposal
→ isolated baseline/candidate checks → exact preview → second human approval →
applied receipt**. This is separate from the preserved legacy A/B and active-merge
flows described below. See [the behavioral workflow](behavioral-review.md) for setup, tool contracts,
limits and a complete checkout walkthrough. Current verification evidence and
remaining blockers are in [verification](verification.md).

Fuse separates source evidence, AI explanation, human intent, and deterministic code application.

```mermaid
flowchart TD
  G[Git revisions, worktrees, or active merge] --> E[TypeScript analysis and source evidence]
  E --> C[Bounded codebase context]
  C --> AI[OpenAI Responses API: Luna]
  AI --> V[Validated scene specification]
  V --> I[SVG / PNG visual and supported choices]
  I --> U[Human chooses behavior]
  U --> R[Deterministic reconciler and exact preview]
  R --> A[Explicit Create this change]
  A --> F[Freshness, index, and target checks]
  F --> W[Atomic file application]
  W --> T[Configured checks and persistent result]
```

## Modules

- `server/git.ts`: reads real Git objects, worktree contents, and active merge state. Pins commits and content fingerprints; bounds ordinary source snapshots; rejects unsafe paths, symlinks, and unsupported modes. Active merge snapshots use HEAD, MERGE_HEAD, common base, and the unresolved index plus marker-file contents.
- `server/engine.ts`: deterministic ts-morph analysis and constrained reconciliation for named top-level TypeScript functions. Direct local calls produce possible-interaction evidence, never proof of runtime order.
- `server/local.ts`: inspection, explicit worktree registration, intent, decisions, preview, application, checks, Git linking, and watch deduplication. One-file application is bounded to a clean base checkout or the exact reviewed active merge with no unrelated changes.
- `server/local-store.ts`: atomic JSON records under the common Git directory's `fuse/` folder and a per-repository mutation lock.
- `server/visual-ai.ts`: bounded pinned context, OpenAI Responses API request, schema/action validation, one repair attempt, cache/provenance, and freshness checks before saving. `.env` loading belongs to the installation entry point. Errors are explicit; prepared visuals are never a silent AI fallback.
- `server/visual-renderer.ts`: escaped text and fixed drawing primitives, geometry/text-fit validation, SVG rendering, and resvg PNG output. No arbitrary model HTML or code execution.
- `server/mcp.ts`: vendor-independent stdio interface. AI tools return text data plus an actual PNG image. Model-callable tools cannot confirm behavior or apply source. A separate component-only bridge authenticates private review sessions before reusing existing human-action guards. Behavioral verification executes only configured container checks.
- `cli/`: executable, JSON and exit codes, inspection/watch tools, and the loopback review server. `scripts/meeting.mjs` is the portable live MCP client and disposable-conflict walkthrough.
- `server/review-server.ts`: repository-bound browser API; retains legacy snapshot/import routes. Mutations enforce local origin and Host restrictions.
- `server/inline-review.ts`: static MCP resource, private capability sessions, exact client privacy-compatibility gate and component-only action routing.
- `src/inline/`: compact expandable review, standard host bridge, executed results and exact code approval; the real liquidglass bundle renders only its own background. `vite.inline.config.ts` emits one self-contained resource.
- `server/map.ts`, `server/map-service.ts`, `server/map-render.ts`: the deterministic repository map: pinned-commit Git reads, in-memory TypeScript parsing, import and cross-file call edges, metrics, cycles, branch overlays, caching and a folder-level SVG/PNG. No AI and no execution.
- `server/map-labels.ts`, `server/map-label-provider.ts`, `api/map-labels.ts`: opt-in AI file descriptions with a strict schema, path and citation checks, Unicode and secret filtering, and per-file-version caching. Labels never alter the map.
- `src/components/RepoMap.tsx`: the repository map page and the review's "Where the changes meet" section.
- `src/`: the preserved browser source/visual/choice review. Standard buttons, dialogs, and loading indicators use the MIT Untitled UI implementation with provenance retained under `src/untitledui/`.

## Inline candidate and browser runtimes

Inline presentation is requested through MCP metadata on supported Codex engines.
The installed engine has passed actual serialization/privacy probes; native rendering
remains unverified because native-window automation is denied. Browser bridge tests
are explicitly simulated hosts. The browser remains an explicit legacy/fallback path.
See [inline acceptance and scope](inline-review.md).

## Browser runtimes

Local mode uses the real review API and filesystem. Browser examples create controlled Git repositories with prepared visuals. The meeting runner instead creates a true merge conflict and calls the real AI MCP before opening the same UI.

Vercel hosts a static build selected by Vite's `showcase` mode. `scripts/build-showcase.mjs` runs the shared analyzer and reconciler to produce both examples, supported output variants, and prepared SVGs. The browser adapter persists one example in session storage and creates downloadable files. It does not call OpenAI, expose local paths, write a Git repository, or claim checks ran. `.env`, local fixtures, and traces are excluded from deployment uploads. Public MCP imagery is explicitly captured from the controlled fixture.

## Application and provenance

The reconciler preserves unilateral edits and can select whole functions or combine additive edits around unchanged base statements. Replacements, signature changes, ambiguous anchors, reordered base statements, duplicate bindings, and unsupported comments disable composition. Imported source is parsed, never executed during inspection or preview.

Preview pins decisions, source fingerprints, output hashes, and configured check commands. Apply rechecks source, review revision, target HEAD, target contents, and token immediately before writing. An active merge additionally pins MERGE_HEAD, unresolved index entries, and marker-file contents. Unrelated staged, unstaged, or untracked work blocks merge application. The approved file is atomically replaced and staged for the unresolved merge; no merge commit is made. Another editor can still race outside Fuse's lock, so this is optimistic validation rather than a filesystem-wide transaction.

Legacy checks are explicitly configured executable/argument arrays, run without a shell after application, with time and output bounds. Actual failures remain recorded; no checks means unverified. The record preserves inputs, AI context/provenance, rationale, outputs, actual check results, and local Git identity. It is local attribution, not authenticated identity or a tamper-proof audit.

Statuses progress from proposed to applied to a verified descendant commit and then a verified merge commit. Git commit/merge linking requires the exact recorded output. A download is never a verified Git commit or merge. The review service does not commit or push; fixture construction and acceptance scripts commit only controlled disposable repositories.

## Limits

TypeScript named top-level functions, direct local calls, 80 changed files, 100 KB per snapshot, and 150 top-level statements per file. AI context includes at most ten files with 6,000 characters each plus selected change snapshots and a bounded tree listing. Context is pinned to the inspected target commit; it is not full cross-file semantic analysis. AI can make explanatory mistakes; tests remain the runtime evidence. The compact UI focuses on one conflict and one automatic file application. Broader edits require the structured CLI/manual workflow. No autonomous merge, CRDT, or hosted multi-user backend is included.
