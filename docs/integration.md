# MCP and structured interfaces

## MCP-first behavioral proposals

Fuse now supports **saved issue → human behavior confirmation → host-agent proposal
→ isolated baseline/candidate checks → exact preview → second human approval →
applied receipt**. This is separate from the preserved legacy A/B and active-merge
flows described below. See [the behavioral workflow](behavioral-review.md) for setup, tool contracts,
limits and a complete checkout walkthrough. Current verification evidence and
remaining blockers are in [verification](verification.md).

Fuse's stdio server uses the official MCP SDK and a repository selected per tool call (or an optional launch restriction). It has no dependency on Codex CLI. The hosted AI layer calls OpenAI's Responses API, defaulting to `gpt-6-luna`, with structured JSON output and `store: false`. Core inspection and reconciliation are deterministic and do not need an API key.

## Configuration

Requires Node 24 and Git. Add a stdio server using command `npx` and arguments:

```json
["--yes", "--prefer-online", "github:Will-Sanz/fuse#main", "mcp"]
```

The private team connection includes `FUSE_SERVICE_TOKEN` in its environment. No OpenAI key or `.env` is needed on teammate machines. The package comes from this public GitHub repository; restarting the MCP resolves the latest `main` commit. Allow a 180-second startup timeout for automatic installation/updates and a 300-second tool timeout for AI generation and a possible layout repair.

### Codex

Use `codex mcp add fuse --env FUSE_SERVICE_TOKEN=TEAM_VALUE -- npx --yes --prefer-online github:Will-Sanz/fuse#main mcp`. Keep the real team value private. In the resulting `[mcp_servers.fuse]` section of `~/.codex/config.toml`, set `startup_timeout_sec = 180` and `tool_timeout_sec = 300`. Start a new Codex session in the repository, run `/mcp` to see the connection, and ask it to use `fuse_explain` with the current project's absolute path. Call `fuse_present_review` on the saved review for the inline card on a compatible client. Browser fallback through `fuse_open_review` is explicit only. Native rendering acceptance for this candidate is tracked in [inline review](inline-review.md).

The maintainer may instead launch `node /absolute/path/to/fuse/cli/run.mjs mcp` from a development checkout. This loads that installation's `.env`, never the target repository's environment file. A direct `OPENAI_API_KEY` is optional for development; a team token or `FUSE_AI_URL` selects the shared service instead. `--repo /absolute/path/to/project` restricts a connection to one repository. Without it, each tool must receive `repo`.

## Verified live path

`npm run meeting` launches a real stdio MCP client, creates a controlled repository with committed branches and a true Git merge conflict, calls `fuse_explain`, verifies the returned PNG and provider response ID, saves the artifacts, and opens the browser review. `npm run meeting:verify` additionally chooses, previews, applies, and checks the result. Both checkout and shipping scenarios passed live with `gpt-6-luna` on 2026-10-09. The screenshot in `public/mcp/checkout.png` came directly from the MCP image response.

The runner requires Node, Git, and shared service access (or a direct key for development). It does not install or change global client configuration. Its disposable artifacts stay in the temporary directory printed by the runner. CI tests real stdio transport without paid model requests; visual model tests inject bounded responses to test failures, unsupported choices, caching, and stale-input protection. Specific coding-client image presentation is not guaranteed by the transport tests.

## AI contract

`fuse_explain` inspects current working changes, an active merge, selected revisions, or registered worktrees. The generator reads pinned before/A/B source, static observations, intent if provided, a bounded tree listing, and up to ten README/package/test/direct-import context files from the pinned target commit. Common secret/config paths, vendor folders, and oversized source are excluded. Context selection is bounded and is not whole-repository semantic analysis.

The model designs a technical box-and-arrow diagram with source-supported identifiers,
values and dependencies in a strict scene schema. It can draw panels, text, arrows,
bars, and circles on a 1000×500 canvas. New locally versioned layouts use larger
monospace labels, preserve line breaks and wrap long identifiers. Text, canvas bounds
and label/node collisions are validated before persistence; legacy saved scenes keep
their original renderer. Raw HTML/SVG, scripts, URLs, tools, and executable code are
not accepted. A malformed design gets one repair attempt, then a visible error.
Legal action IDs come from the deterministic reconciler; invented actions are rejected.

Fuse renders the validated scene to SVG and PNG with resvg. This is AI-designed vector imagery, not a separate raster-image-model call. Responses include model name, actual response ID, generation time, context file names, and a source fingerprint. Only matching AI results can be reused from cache; `regenerate: true` makes a fresh request. Source changes during generation prevent the result from being saved as current. Provider failure never becomes a prepared-image success.

AI text remains an explanation, not evidence that tests ran. Source is sent through the hosted Fuse service to OpenAI only when a live generation tool/action is invoked. The renderer and reconciliation engine never execute model output.

## Tools

Every tool also accepts `repo`, the absolute local repository path. It is required unless the connection is restricted with `--repo`.

Successful text content is `{ "schemaVersion": 1, "data": ... }`. `fuse_explain` and `fuse_visualize` additionally return an MCP `image` block with base64 PNG data. Failures are MCP error results. See `shared/review.ts` and `shared/visual.ts` for types.

| Tool              | Arguments                                          | Effect                                                           |
| ----------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| `fuse_explain`    | optional `base`, `a`, `b`, `sessions`              | Inspect and generate a new source-grounded image; persist review |
| `fuse_visualize`  | `id`, optional `regenerate`                        | Generate/reuse a visual for a saved review                       |
| `fuse_inspect`    | optional `base`, `a`, `b`, `sessions`, `detail`    | Read Git and save deterministic analysis without AI              |
| `fuse_watch_once` | none                                               | Refresh registered worktrees and return overlap attention        |
| `fuse_review`     | `id`, optional `detail`                            | Read saved evidence, image specification, decisions, and checks  |
| `fuse_history`    | none                                               | List reviews and verified Git references                         |
| `fuse_intent`     | `id`, `revision`, `intent: {first, rationale}`     | Record developer-stated precedence                               |
| `fuse_decide`     | `id`, `revision`, `path`, `conflictId`, `decision` | Save a supported proposed choice and rationale                   |
| `fuse_preview`    | `id`, `revision`                                   | Save exact output, hashes, checks, and approval token            |

`fuse_open_review` accepts `repo` and `id` and returns a loopback URL where the human can select and apply the resolution. The viewer stays available while the MCP connection runs.

### Compact source evidence

For agent source review, pass `detail: "compact"` to `fuse_inspect` or `fuse_review`.
Omitting `detail` or passing `"full"` returns the unchanged complete `Review`.
Compact responses keep the same versioned envelope and mark `data.detail` as
`"compact"`; they are a projection, not a complete `Review` object.

Compact keeps exact complete `files[].input.base`, `agentA`, and `agentB` source,
all evidence entries in their original order (including locations and observations),
analysis metadata, per-revision graphs, recommendations, decisions and checks.
Repository/base/A/B provenance, hashes, sourceVersion, revisions, lifecycle and
unsupported-file reasons remain present. It omits repeated `evidence[].code` and
`analysis.conflicts[].base/a/b`; use the corresponding complete file input to trace
the source. Evidence revision `base`, `a`, or `b` selects input `base`, `agentA`,
or `agentB`; deletion evidence explicitly refers to the common base in its
observations. Snapshot `sources.a/b.files[path].code` is omitted only when the
identical text is already present in that side's file input. Unsupported or other
unique snapshot source, including `null` for a deleted file, is retained.

Retrieve every original field with `fuse_review({repo, id, detail: "full"})`.
Compact does not change the saved review, evidence indexes, permissions or approval
requirements, and does not truncate source. CLI, HTTP, visual and mutation results
continue returning complete reviews. Smaller serialized payloads alone do not prove
lower agent token usage or equal detection quality; those require a new real run.

Model-callable tools cannot confirm behavior or apply code. The component-only `fuse_ui_action` bridge requires a private, review-bound capability on an exact reviewed client version. There is no arbitrary-command tool. `fuse_verify` runs only preconfigured isolated checks for behavioral proposals. Use the local browser or CLI to explicitly apply a preview and run configured checks. Inspection writes a saved record and generation calls a paid API, so these are not marked read-only.

## CLI and HTTP

```sh
npm run fuse -- inspect --repo /path/to/project --json
npm run fuse -- visualize REVIEW_ID --repo /path/to/project --regenerate --json
npm run fuse -- review REVIEW_ID --repo /path/to/project --serve --open
```

CLI commands emit one versioned JSON object with `--json`; watch emits JSONL. `mcp` uses protocol messages on stdout. The review server prints a loopback URL and stays running until stopped.

| Exit | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| 0    | Successful command or no new watch alert                        |
| 1    | Invalid input, unsupported action, provider/operational failure |
| 2    | Unresolved review attention or new overlap alert                |
| 3    | Stale input/revision, dirty target, wrong preview token         |
| 4    | A configured check failed, timed out, or could not start        |

Mutations accept `--revision N`. Apply always requires the exact preview token. Normal working edits cannot be overwritten; an active merge may be resolved only when its conflict/index fingerprint still matches and no unrelated work is present.

The local server binds to loopback and the launch-selected repository. Demo mode allows only its controlled fixture registry. Unexpected Host headers and cross-origin mutations are rejected. JSON is required for mutations.

| Method | Endpoint                                | Body                                         |
| ------ | --------------------------------------- | -------------------------------------------- |
| GET    | `/api/reviews/:id`                      | —                                            |
| POST   | `/api/demo`                             | optional `scenario: checkout` or `shipping`  |
| POST   | `/api/reviews/:id/visual`               | optional `regenerate`                        |
| GET    | `/api/reviews/:id/visual.svg` or `.png` | —                                            |
| POST   | `/api/reviews/:id/intent`               | `revision`, `intent`                         |
| POST   | `/api/reviews/:id/decide`               | `revision`, `path`, `conflictId`, `decision` |
| POST   | `/api/reviews/:id/preview`              | `revision`                                   |
| POST   | `/api/reviews/:id/apply`                | `revision`, `token`                          |
| POST   | `/api/reviews/:id/link`                 | `revision`, `commit`                         |
| GET    | `/api/reviews/:id/audit`                | —                                            |

These endpoints are local-only. The Vercel website has a browser adapter for prepared examples and downloadable engine outputs. Its `/api/visual` backend is separate from local review endpoints: it authorizes the team token, bounds the request, calls the fixed server-side model, and returns the scene and provider provenance. It cannot read or change a local repository. The shared OpenAI key remains a Vercel secret; team access is not a spending cap.

## Behavioral tool additions

- `fuse_report_issues`: `id`, `revision`, `report` with `sourceVersion`, assessment,
  explanation and optional issue (path, summary, rationale, evidence indexes and
  behavior labels/descriptions). The backend assigns IDs; it never accepts test claims.
- `fuse_submit_proposal`: `id`, `revision`, `proposal` with sourceVersion, issueId,
  behaviorId, exact path/source and rationale. Requires panel-confirmed intent.
- `fuse_verify`: `id`, `revision` only. Uses configured checks and image; no commands
  or trusted results can be supplied. MCP cancellation aborts the current run.

Behavioral reviews cannot use legacy intent/decision tools to bypass these gates.
Visual generation preserves the saved issue and registers final scene actions
against backend behavior IDs. Wire action slots keep the existing hosted service
compatible; they are mapped and validated before persistence. The agent returns
to `fuse_review` after each human interaction. The packaged
`skills/fuse-review/SKILL.md` supplies portable host instructions.

## Inline presentation candidate

`fuse_present_review(repo, id)` reads the existing saved review and attaches the
static `ui://fuse/review.html` resource. The resource is self-contained HTML with
`text/html;profile=mcp-app`; its descriptor requests inline presentation. It does
not inspect again or start another browser. Public review data stays in content
and structuredContent; private `_meta.fuse` supplies component-only state.

The registered `fuse_ui_action` is app-only. A known tool name alone confers no
permission. Its private session is scoped to one connection/repository/review and
computed source version, expires after 15 minutes per capability, and rotates on
use; rejected recognized capabilities are burned and require re-presentation.
Current revision, isolated verification and exact preview token are still checked.
Unknown client versions get a read-only result. Compatibility is deliberately
narrow, based on the exact installed Codex metadata-projection tests; it is not
caller authentication. See [the full support/acceptance record](inline-review.md).

The card initializes the standard MCP UI bridge, uses parent-window-only messages,
negotiates the explicitly supported protocol versions, and becomes read-only on
unsupported negotiation or failed actions. Only an explicit legacy-browser action
can open a link. After a validated human behavior choice, compatible Codex hosts
receive a continuation request in the same chat. Other hosts or failed/uncertain
delivery retain the saved choice without an automatic retry; see
[the continuation contract](inline-review.md#same-chat-continuation-checkpoint).
