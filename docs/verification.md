# Behavioral workflow verification — 2026-11-07

Implementation was completed locally on `feat/behavioral-proposals`; the follow-up
request authorizes publishing this branch and opening a review PR. Deployment, merge,
shared material edits and global client settings changes remain outside this work.

## Observed evidence

- Production build and typecheck passed (`npm run build`).
- Publication rerun of the full unit/API/real MCP/integration suite: **54 passed**
  with the prepared Docker image (`FUSE_TEST_IMAGE=... npm run check`).
- After the final baseline-timeout safety tightening, all **7 affected behavioral
  tests passed**, including real Docker execution
  (`FUSE_TEST_IMAGE=... vitest run tests/behavioral.test.ts`).
- Real Docker runs cover independent feature branches, clean merge compilation,
  baseline regression failure, candidate success, compatible negative, source/test
  mutation, time/output limits, cancellation, running-state gating and stale results.
- Browser: **9 passed** (`FUSE_TEST_IMAGE=... npm run test:e2e`).
- Prepared showcase: **2 passed** (`npm run test:showcase`).
- Production-only package install + actual MCP/open-review passed
  (`node scripts/verify-package.mjs`); required new docs, skill, fixture and verifier
  are included. No credentials packaged.
- Existing CLI acceptance passed (`node scripts/acceptance.mjs`).
- Formatting and whitespace checks passed (`npm run format:check`, `git diff --check`).

Earlier runs encountered local-network permission restrictions, two legacy test
timeouts under concurrent machine load, and an ambiguous browser receipt selector.
The final authorized runs and corrected selector passed. A test run started during
implementation observed the old configuration race; the independent reproducer,
focused regression and final stable-code full run all passed after correction.

Docker engine 27.4.0; prepared image
`sha256:021cd24f58f5414255e9e4b8be8ba443101596a3b1b2012c29253ada0b471c7e`.
The Dockerfile pins Node 24.3.0 by digest and TypeScript 7.0.2. Container tests use
actual Docker, never a mock pass. Ordinary `npm test` without `FUSE_TEST_IMAGE`
labels Docker cases skipped. CI builds the image and supplies its ID.

## Independent review

A separate review agent checked contracts, connected code, callers and final diff.
Four findings were fixed: cumulative output counting; snapshot preparation outside
the state lock; exact captured-configuration binding during preparation; and missing
packaged documentation. The reviewer independently reproduced the output overflow
and configuration race, confirmed both corrections, and found no unresolved material
in-scope defects. The configuration-swap regression passes without executing checks.

## Separate live host-agent proof

An independent agent used real stdio MCP to inspect committed branches and report
an interaction, reading only normal requirements and pinned source. It did not
receive test oracles, expected patches or a prewritten correction.

- Disposable repository: `/tmp/fuse-live-behavioral-20261107/checkout`
- Review: `f21acae5-c6e4-433a-b3a4-0096902df3c6`
- Source version: `aa103996e2e53bb39b6207452713b12f2f0a44cdc4bfb676646becc6f24467ab`
- Real visual model: `gpt-6-luna`
- Provider response: `resp_00bf24093bd46d27016aef940b845c87d28ddcccbb995e1a3f`
- Source SHA-256 before and after the panel confirmation:
  `65c48a02c7a3167d90dfab608d3ce8a13ed0bd3d8e7f6d466791ec19080f4463`
- Trace: `/tmp/fuse-live-behavioral-20261107/trace.jsonl`

Human clicks are explicitly simulated in this disposable fixture using the actual
MCP-opened browser panel. Agent investigation/proposal and real visual generation
are separate from the deterministic unit/browser simulations. No application to
another user repository is authorized by this proof. Proposal, verification and application results are recorded below.

The independently drafted candidate and exact applied source both hash to
`24ad33b22077a78820e4aefb55826d445c441fbd72d6b965f7f6d775a43e8a4f`.
The clean combined baseline hash is
`11016964d7c274298c305fbae9d2d3e58cee52a30b463ed1728f9b501774ddd3`.
Backend verification `e839aaa2-cabd-42aa-992e-fd301d80f63d` recorded compilation
passing for both, policy failing for baseline and passing for candidate. The final
panel receipt is revision 8, status `applied`; no commit was made. Source remained
unchanged through investigation, live visual generation, intent selection, submission,
verification and preview. Application changed it only to the verified candidate.

Retained local review artifacts are under `docs/evidence/semantic-checkout/`:
`trace.jsonl`, `review.json`, `visual.png` and `receipt.png`. The trace includes actual
MCP submissions/results and explicitly labeled disposable browser simulation events.
No credentials or oracle content was supplied to the investigating agent before its
proposal. Visual context was limited to source, README requirements and package type.

## Modified-file map

- Shared contracts: `shared/review.ts`, `shared/visual.ts`.
- Backend: `server/proposals.ts`, `server/verification.ts`, local preview/application,
  MCP tools, review routes, visual context/validation and fixture construction.
- Panel: `src/App.tsx`, `src/components/BehaviorReview.tsx`, `src/styles.css`.
- Verification: semantic fixture/oracles, unit/API/real transport/container/browser
  tests, pinned Dockerfile, CI and package assertions.
- Integration: CLI verifier/fixture commands, portable host skill, README,
  architecture/MVP/meeting/integration docs and live proof helpers/evidence.

This is a local result, not a hosted deployment. The installed MCP must be launched
from this checkout to use the new tools until the branch is separately released.

## Completion criteria

| Criterion                                                                | Result                                 |
| ------------------------------------------------------------------------ | -------------------------------------- |
| Local connected MCP → panel → proposal → verification → exact apply      | PASS                                   |
| Two distinct human decisions; no model confirmation/apply tool           | PASS                                   |
| Real clean-merge baseline fails; correction and compatible pair pass     | PASS                                   |
| Source unchanged until explicit final application                        | PASS                                   |
| Missing/failed/stale/invented/unauthorized results cannot approve source | PASS                                   |
| Isolation, trusted checks, bounded execution and cancellation            | PASS                                   |
| Applied bytes equal verified candidate; provenance and history retained  | PASS                                   |
| Independent review and corrections                                       | PASS — no unresolved material findings |
| Separate live investigative agent, real MCP and actual visual generation | PASS                                   |
| Legacy tests, demos, browser/showcase, package and CLI preserved         | PASS                                   |
| Remote CI/deployment/push                                                | See publication follow-up below        |

No remaining external dependency blocker. Limits remain explicit: one issue, two
committed inputs, one regular TypeScript file, clean target at common base; named
local functions/direct calls; configured checks rather than semantic proof; local
panel attribution rather than authenticated identity; no automatic agent resume.

## Publication follow-up

The container-only test command now requires `FUSE_TEST_IMAGE`; it fails clearly
instead of silently skipping real Docker acceptance. The installed-package check
also constructs the committed semantic fixture and exercises the new issue-report
tool through actual MCP transport. Fresh publication checks passed: build, all 54 tests with real Docker, nine browser
cases, two showcase cases, installed-package/MCP smoke checks, CLI acceptance and
formatting. The missing-image guard also passed its negative check.
Publication and remote CI results are linked from the accompanying pull request.

The publication check reproduced a legacy Git/TypeScript integration test completing
in 22 seconds against its old 20-second test-runner deadline. The integration test
deadline is now 60 seconds to tolerate busy developer machines; production check,
container, cancellation and output limits are unchanged.
