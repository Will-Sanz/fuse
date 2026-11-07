# Behavioral conflict review

The first supported proposal workflow handles one suspected issue between two
committed branches, one existing regular application TypeScript file, and a clean
application target at their reviewed common base. The host coding agent investigates
and drafts code. Fuse validates and records its submissions, runs configured checks
in containers, and applies only the human-approved exact verified candidate.

## Two decisions

1. `fuse_inspect` pins source and exposes `sourceVersion`. The agent reports a
   suspicion with `fuse_report_issues`, referencing evidence indexes and supplying
   behavior alternatives. `no-issue` and `insufficient-evidence` are valid outcomes.
2. `fuse_visualize` explains that saved issue. The panel shows evidence from both
   affected functions. The visual is illustrative; executed results are separate.
3. `fuse_open_review` returns a local panel link. The developer confirms a registered
   behavior there and returns to chat. This records `human-panel` intent; a model
   statement or legacy `fuse_intent` call cannot substitute for it.
4. The agent reads `fuse_review`, drafts a correction, and calls
   `fuse_submit_proposal` with the exact entire replacement file as data. It never
   writes the working file. Submission includes the source version, issue ID and
   confirmed behavior ID. Tests, commands, policy and unrelated paths are rejected.
5. `fuse_verify` runs the pinned clean combined baseline and candidate against the
   same configured checks in separate fresh containers. Failed, missing, cancelled,
   interrupted or stale runs cannot authorize application. An interrupted run may
   remain marked `running`; resubmit/reverify to recover. It is never a success.
6. `fuse_preview` requires passing current verification. The panel shows exact
   source, hashes, commands, exits and bounded output. The developer explicitly
   approves that code with **Approve and apply verified code**. Application writes
   those bytes atomically, retains execution evidence and decision history, and
   makes no commit or push. It does not rerun candidate code on the host.

The MCP has no human-confirmation, application, check-configuration or arbitrary
command tool. An unrestricted local process can still invoke HTTP or change local
records. Panel confirmation is an explicit local interaction, not authenticated
identity or a security boundary against the user's other tools. Follow the portable
[host skill](../skills/fuse-review/SKILL.md). Install/copy it only in a client scope
chosen by the developer; this release does not change global client settings.
There is no automatic chat resume, standalone agent platform or embedded MCP App.

## Prepare the verifier

From the Fuse installation, with Docker running:

```sh
docker build -t fuse-verifier:local verification
IMAGE=$(docker image inspect --format '{{.Id}}' fuse-verifier:local)
node cli/run.mjs verifier "$IMAGE" --repo /absolute/path/to/target
node cli/run.mjs check add Compile --command tsc --arg=--noEmit --arg=--strict --arg=checkout.ts --repo /absolute/path/to/target
node cli/run.mjs check add Policy --command node --arg=--test --arg=policy.test.mjs --repo /absolute/path/to/target
```

The prepared image uses Node 24.3.0 pinned by base-image digest and TypeScript 7.0.2.
Dependencies are prepared with installation scripts disabled, before verification.
Each review binds the exact local image SHA-256 and check configuration. No image
pull or package install occurs during verification. No host execution fallback exists.
Use container command names such as `node` and `tsc`, not a host executable path.
Projects needing additional libraries must prepare a trusted image themselves.

Containers receive only a materialized pinned Git base plus the selected source.
The repository, `.git`, host home, sockets and service credentials are not mounted.
Root and project mounts are read-only; execution uses UID/GID 65534, no network,
no capabilities, no-new-privileges, 1 CPU, 256 MB memory, 64 processes, 256 open
files and a 32 MB temporary filesystem. Time is bounded both by the host and an
in-container timeout. Combined stdout/stderr is capped at 128 KB per check with
64 KB retained per stream. Every check uses a fresh container, removed on completion
or cancellation. On host termination, the in-container deadline still bounds it.
Pinned source/test bytes are checked for integrity after execution.

The project limit is 2,000 regular files / 8 MB; symlinks, submodules, tracked `.env`
and key files are rejected. There are one to ten configured checks, each at most
120 seconds. Fuse locks only state mutations; snapshot preparation and execution
happen outside the lock. The exact revision and binding are checked before saving
results. Changing intent, proposal, source, commands or image blocks old approvals.

A passing record means these commands exited successfully in this environment.
It does not prove every requirement or defend weak tests against malicious code
inside the same language runtime. Use independent regression checks, preferably a
separate test runner that detects premature termination. Test logs are untrusted
text. Static dependency candidates are suspicions, not demonstrated failures.

## Reproduce checkout

```sh
node cli/run.mjs semantic-demo --dir /tmp/fuse-semantic-example --json
node cli/run.mjs verifier "$IMAGE" --repo /tmp/fuse-semantic-example/checkout
```

Ask your coding agent to inspect `feature/coupons` and `feature/shipping` through
Fuse. The constructor includes requirements and configured compilation/policy checks.
Each branch passes its relevant checks. Their edits merge cleanly and compile;
the combined policy fails when the coupon crosses the free-shipping threshold.
Original subtotal controls eligibility, so 12000 minus a 3000 coupon totals 9000.
The test matrix also covers exact/below threshold and zero coupon. A separate
compatible fixture already uses original subtotal for shipping.

```sh
FUSE_TEST_IMAGE="$IMAGE" npm test
FUSE_TEST_IMAGE="$IMAGE" npm run test:e2e
```

These deterministic tests simulate agent submissions and human clicks only in
disposable fixtures. The live proof is separately recorded in `docs/verification.md`.
Existing shipping and validation demos retain their legacy A/B reconciliation and
post-application checks. They do not claim pre-application isolated verification.
