# Fuse local companion release

Fuse explains the current TypeScript change and helps a developer decide how explicitly registered worktree sessions should fit together. A terminal tool and a compact browser review share the deterministic ts-morph analysis, constrained reconciliation, and persistent decision service. The core workflow needs no paid API keys.

## Milestones

1. **Baseline and plan.** Inspect the clean checkout, remote branches, PRs, and CI; preserve existing changes. Record baseline build, engine/API and browser results. Work on `feat/local-companion` with reviewed, tested checkpoints before integrating into main.
2. **Local Git and CLI.** Inspect revisions or working changes, register named worktrees, attribute changes only through registration, explain ordinary edits, and detect shared-function edits separately from possible call-path interactions. Expose versioned JSON and meaningful exit codes. Watch changes with persistent alert deduplication.
3. **Review and application.** Persist pinned inputs, evidence, supported actions, intent, recommendations, previews, reviewer attribution, and real configured check results. Require preview approval; refuse stale reviews and dirty targets. Track proposed, applied, committed, and verified Git ancestry separately. Unsupported files remain visible and block application rather than disappearing.
4. **Compact visual review and reproducible demo.** Use actual open-source Untitled UI components and design tokens. Show before/after calls, exact attention points, source evidence, a targeted intent question, choices, result preview, checks, and Git-linked history. Generate the checkout fixture with real branches and worktrees; label scripted changes. Keep legacy snapshot/import APIs available for safe read-only review.
5. **Integration and acceptance.** Provide one documented Codex MCP integration over the vendor-independent engine and invoke it through the real coding tool. Exercise the CLI against temporary repositories, inspect the browser visually, run the full relevant suite, check GitHub CI, and deliver verified code on the shared main branch with accurate setup instructions.

## Acceptance criteria

- An ordinary local edit receives a useful source-linked explanation without an invented conflict.
- Two registered sessions show the functions they changed. Independent edits, identical/shared edits, differing edits in one function, and possible interactions have distinct evidence.
- Static calls never imply runtime order or a proven behavioral conflict. A recommendation uses explicit intent or controlled fixture expectations; otherwise Fuse asks a focused question.
- Keep A, Keep B, and supported additive composition with an explicit order are previewable. Tests demonstrate different checkout outcomes for the two orders.
- Deleted functions, comments, malformed inputs, unsupported files/constructs, revision selection, and missing worktrees are handled safely.
- A new overlap produces an alert and review link. Unchanged overlaps do not alert repeatedly; further edits refresh the analysis and alert evidence.
- Application requires explicit approval of the current preview and checks both source worktrees and target state. Newer or uncommitted target work is preserved.
- Only explicitly configured commands run, without a shell; imported code and repository scripts are never auto-discovered or executed. Results include actual status, output, duration, and command.
- Decisions survive restarts and include input/output hashes, rationale, local reviewer attribution, status, and a verified commit reference. An exported file is never described as merged.
- The browser has tested loading, error, empty, success, and narrow-screen states. CLI JSON, exit codes, and real MCP invocation are verified.
- From a clean checkout: create fixture → register two worktrees → detect overlap → open focused review → answer intent → preview → approve/apply → run configured tests → commit → revisit decision history. Also demonstrate one ordinary change.

## Boundaries

First language: TypeScript; direct local calls and named top-level functions. Composition remains deliberately constrained. Non-TypeScript/binary/mode changes and unsupported reconciliation require a safe manual path. No autonomous merges, CRDT, hosted team authentication, or broad service integrations. Git identity is local attribution, not verified authentication. The application binds to loopback.

## Verification record

The baseline passed 18 engine/API tests and four browser workflows. The release adds real Git, CLI, HTTP, MCP, browser, and executable checkout acceptance coverage. The actual Codex invocation is recorded in `docs/integration.md`; `npm run demo:verify` reproduces the terminal acceptance sequence from a clean fixture. Dedicated Untitled UI Alerts are PRO-only; the public implementation uses accessible plain error text and the MIT controls. See README for the explicit one-file application limit and local-only boundaries.
