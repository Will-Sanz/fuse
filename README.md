# Fuse

A local companion for understanding TypeScript changes. Inspect real Git work, see where explicitly registered sessions overlap, choose the intended behavior, and keep the evidence behind the result. The CLI and compact browser review use the same deterministic engine. No AI API keys are required.

## Start here

Use **Node.js 24** and Git. From a clean checkout:

```sh
git clone https://github.com/Will-Sanz/fuse.git
cd fuse
npm ci
npm run build
npm run fuse -- --help
```

`npm run fuse -- ...` works without installing a global command. Optionally run `npm link` to expose `fuse` on your PATH. The examples below use that shorter command; `node /absolute/path/to/fuse/cli/run.mjs ...` also works from any directory.

For the browser demo:

```sh
npm start
```

Open **http://127.0.0.1:3001** and choose **Explore checkout demo**. This creates a real temporary-style repository under `data/demos/`, two Git worktrees, and explicit session registrations. Edits are labeled as scripted. Analysis, resolution, file application, and checks are real. **See a single change** demonstrates an ordinary edit without an artificial conflict.

`npm run dev` starts the development interface at **http://127.0.0.1:5173**. Both interfaces bind to loopback. This is a local tool, not a hosted team service.

## Verify the entire acceptance workflow

```sh
npm run demo:verify
```

This invokes the actual CLI to create a fresh fixture, register both sessions, detect and deduplicate an overlap alert, record intent, choose a resolution, preview, approve, apply, run the configured checkout checks, create a normal Git commit, and verify its decision history. It also tests the actual review-server command and a separate single-developer change. The output includes the repository, review ID, commit, and a command to reopen the result. Fixtures remain available in your system temporary directory. Port 3211 must be available for this verification script.

For a hands-on walkthrough:

```sh
fuse demo --dir /tmp/my-fuse-demo
fuse watch --repo /tmp/my-fuse-demo/checkout --once
# Exit 2 means there is new review attention, not that the tool crashed.
# Copy the review ID printed by watch:
fuse review REVIEW_ID --repo /tmp/my-fuse-demo/checkout --serve --open
```

The visual review shows the common base, each session’s actual calls and function edits, an intent-guided recommendation, and supported choices. Save a rationale, preview the full result, then explicitly approve application. The configured fixture checks expect a friendly missing-fields error first. Choosing **B then A** produces a real failed expectation with a specific email error instead; both orders retain the schema validation. Checks execute only after approval.

Commit the result with your usual Git tools, then use **Link commit** in the review window or:

```sh
fuse link REVIEW_ID --repo /tmp/my-fuse-demo/checkout --commit HEAD
fuse history --repo /tmp/my-fuse-demo/checkout --json
```

Fuse verifies that the linked commit descends from the common base and contains the exact recorded output. The review service does not create commits, bypass hooks, push, or merge your changes. Only the demo generator and verification script create commits in their own fixture repositories.

## Inspect your own work

```sh
# Combined staged and unstaged working contents, including untracked files:
fuse inspect --repo /path/to/project

# One committed change:
fuse inspect --repo /path/to/project --base HEAD~1 --a HEAD

# Two revisions; their actual merge base is selected automatically:
fuse inspect --repo /path/to/project --a feature/request --b feature/schema --json
```

Working changes are labeled **unattributed**. Fuse never guesses which agent wrote a file. Source-linked observations explain changed guards, calls, error returns, additions, and deletions even when there is no overlap. Non-TypeScript, malformed, oversized, binary, symlink, and unsupported mode changes remain visible for manual review.

For two sessions, create separate worktrees through your usual Git workflow and register them explicitly. The first registration is A; the second is B. Updating an existing registration preserves its position.

```sh
fuse session add request --repo /path/to/project --name 'Request validation' --worktree /path/to/request-worktree
fuse session add schema --repo /path/to/project --name 'Schema validation' --worktree /path/to/schema-worktree
fuse session list --repo /path/to/project
fuse inspect --repo /path/to/project --sessions
fuse watch --repo /path/to/project
```

Watch polls the worktrees and emits a terminal alert with a review command and local URL when overlap evidence changes. Unchanged overlap does not alert again, including across restarts. Further edits update the saved analysis; unrelated function edits do not repeat an unchanged overlap alert. Start the linked visual server with the printed `fuse review ... --serve` command. Use `--once` for scripts or `--json` for JSONL events. Remove a registration with `fuse session remove ID`.

## Decisions, application, and checks

When intent is ambiguous, Fuse asks which side should come first at shared insertion points. Record an explicit preference and rationale; the recommendation remains labeled as static or intent-guided, never as a tested runtime fact.

```sh
fuse intent REVIEW_ID --first a --note 'Missing fields should get the friendly error first.' --repo /path/to/project
fuse decide REVIEW_ID --file checkout.ts --conflict overlap:validateBody --choice both --order a-first --note 'Preserve both validators with friendly errors first.' --repo /path/to/project
fuse preview REVIEW_ID --repo /path/to/project --json
fuse apply REVIEW_ID --approve EXACT_PREVIEW_TOKEN --repo /path/to/project --json
```

Use `a`, `b`, or supported `both` for differing function edits; `both` requires `a-first` or `b-first`. Possible dependency interactions use `reviewed`. Whole-file changes can require selecting a complete snapshot. Unsupported compositions remain blocked, with the reason and both sources available.

Application currently supports **one TypeScript file** into a **clean checkout at the common base**. It checks registration, both input worktrees, target HEAD, target contents, and the exact approval token. It refuses staged, unstaged, and untracked target work. For a dirty single-developer working copy, use the explanation as review feedback; commit or preserve the work before creating a separate base target for application.

Configure checks explicitly before previewing. Commands are argument arrays, run without a shell; package scripts are never discovered or executed automatically.

```sh
fuse check add typecheck --repo /path/to/project --command /absolute/path/to/tsc --arg=--noEmit --timeout 30000
fuse check list --repo /path/to/project
```

Only configure commands you intend to run locally. The preview lists the exact commands. Changing them invalidates approval. Results record actual exit status, stdout/stderr, timestamp, and duration. Failed checks leave the applied file available for inspection; they are never reported as passing. No configured checks means behavior is explicitly unverified.

## Coding-tool integration

Fuse includes a vendor-independent **stdio MCP server** and a verified **Codex integration**. It exposes inspection, watch refresh, history, intent, proposed decisions, and previews. Application and check execution remain explicit human CLI/browser actions; the MCP server has no apply tool.

```sh
codex mcp add fuse -- node /absolute/path/to/fuse/cli/run.mjs mcp --repo /absolute/path/to/project
```

Start a Codex session and ask it to invoke `fuse_inspect` with `sessions: true`, then read that review with `fuse_review`. See [the integration and JSON interface](docs/integration.md) for approval settings, the actual verification record, schemas, and exit codes.

## Validation and development

```sh
npm run format:check
npm run check                  # TypeScript, production build, engine/API/Git/CLI/MCP tests
npx playwright install chromium
npm run test:e2e                # Browser → real Git fixture → checks → commit link
npm run demo:verify             # Actual terminal acceptance walkthrough
```

GitHub Actions runs these checks on `main`, `feat/**`, and pull requests. Browser reports are uploaded on failure. Tests run controlled fixtures only. Arbitrary imported source is parsed, never automatically executed.

## Boundaries and storage

- Named top-level TypeScript functions, direct local calls, and constrained additive composition. Cross-file calls, callbacks, dynamic dispatch, and external effects are not modeled.
- Shared-function edits, possible call-path interactions, and observed check results are different evidence. Static reachability is not proof of runtime conflict or order.
- Analysis covers up to 80 changed files, 100 KB per snapshot, and 150 top-level statements per file. Multi-file changes are explained but require manual application. All graph nodes remain available in scrollable diagrams and JSON.
- State progresses through **proposed → applied → committed → merged**. `fuse merged ID --into MERGE_COMMIT` requires an actual Git merge commit integrating the resolution. Fast-forward/squash/remote-PR merge status is not inferred.
- Reviews, source snapshots, configuration, and watch state live in the repository’s common Git directory under `fuse/`, shared by its worktrees. They survive restarts but are local, not a tamper-proof or automatically shared audit. Store updates are atomic and Fuse mutations use a lock. Git identity is labeled local attribution, never verified authentication.
- Input checks happen immediately before writing, and the single output is replaced atomically. Other editors do not participate in Fuse’s lock; avoid simultaneous saves during application.
- Standard controls and tokens come from the real MIT-licensed [Untitled UI React source](src/untitledui/PROVENANCE.md). The free MCP connection was verified. Its dedicated Alerts component requires PRO; errors use plain accessible text and the free controls. No restricted source is included.
- The earlier snapshot/GitHub-import APIs remain available for safe manual review and exports. Exporting source does not mark a review merged. Their contract is covered by the retained tests.

See [architecture](docs/architecture.md), [release acceptance](docs/MVP.md), and [contributing](CONTRIBUTING.md).
