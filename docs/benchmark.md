# RealWorld paired detection baseline

This benchmark compares the same real coding agent with and without the actual
Fuse MCP. It measures source-based conflict assessment, not repair, executed
application tests, native UI rendering or developer comprehension. Demo work is
deferred. Tracking: [issue #6](https://github.com/Will-Sanz/fuse/issues/6).

## Frozen inputs

The upstream repository is
[elizedrac/realworld-express-prisma](https://github.com/elizedrac/realworld-express-prisma/tree/8e8aa21b1c9968c291a981d7d97f30049a4525a8/eval),
pinned to commit `8e8aa21b1c9968c291a981d7d97f30049a4525a8`.
`scripts/benchmark/dataset-lock.json` additionally locks each original branch/base
commit and tree, since branch names can move independently of the evaluator commit.
There are 53 cases: 3 textual, 4 build, 4 test, 18 runtime, 6 intent and 18 compatible
negatives. Labels reflect this authored benchmark's judgments.

The initial model is the locally configured `gpt-6-astra`, reasoning `high`, through
the actual installed Codex CLI. Both arms use fresh ephemeral sessions, identical
common source tools, the same task (side A's stated intent only), schema and
180-second deadline. Arm order is counterbalanced deterministically across sorted
cases. The manifest records the model, client, harness hash, code commit, schedule,
dataset provenance and limits. One run per arm/case gives a descriptive baseline;
it does not establish statistical significance or broad production reliability.

## Treatment and boundaries

Both arms can list/read pinned source, inspect base-to-side diffs and read side
commit messages through a small common source MCP. Shell, browser, external search,
plugins, host skill discovery and bundled skill instructions are disabled. Some
built-in helpers remain in this installed CLI despite these settings. The final
canary checks the effective deferred tool registry and absence of skill/evaluator
instructions in both arms. The protocol rejects other action tools visible in
native events. Source tools cannot
read arbitrary host files, evaluator labels or oracles. Source edits are forbidden
and invalidate a run. The public synthetic `.env.test` remains available
equally because it is legitimate source evidence in this benchmark.

Independent synthetic canaries confirmed that read-only mode rejects patch writes
and ephemeral sessions reject goal access. Those rejected attempts do not emit
native action events, so the JSONL audit is not proof that every blocked helper
was never attempted. The available catalog has no general host-file reader.

The Fuse-enabled arm additionally connects the real production `serveMcp` over
stdio, exposing only `fuse_inspect` and `fuse_review`. The direct production
entrypoint avoids the CLI's optional dotenv loading; no Fuse implementation is
mocked or replaced. The agent must attempt the exact requested inspection. Native
MCP events distinguish successful inspection, unsupported file evidence and tool
errors. A valid fallback diagnosis after a failed Fuse call remains in the
intention-to-treat comparison, with assistance failure visible separately.

Each arm receives an independent Git object store containing only reconstructed
base/A/B commits and their exact original trees. There are no upstream remotes,
alternates, evaluator files, hidden oracle tests or upstream history. Generic refs,
a generic base message and removal of explicit case IDs from side messages avoid
unnecessary benchmark identifiers; misleading semantic message content is retained.
Original and reconstructed commits/tree hashes and message transformations are
recorded. Tracked source, index and refs must remain unchanged; Fuse may write its
normal review records under `.git/fuse`.

## Reproduce

Use Node 24, repository dependencies and an authenticated Codex CLI. Existing local
CLI authentication is reused without copying it into this repository or GitHub.
Do not put account credentials in benchmark outputs or workflow files.

```sh
git clone --no-checkout https://github.com/elizedrac/realworld-express-prisma /tmp/fuse-realworld-upstream
npm ci
npm run benchmark:test
FUSE_CODEX_CANARY=1 npm run benchmark:test
npm run benchmark:run -- --upstream /tmp/fuse-realworld-upstream --out /tmp/fuse-realworld-baseline --concurrency 4
```

Use a fresh output directory. `--case rw-012` (repeatable) selects a smoke subset;
do not publish that subset as all-case efficacy. `--resume` retains existing arm
records, including failures, and rejects changes to the frozen configuration,
dataset or harness. Retrying failed cases is a new experiment, not a replacement
for the original baseline. `FUSE_CODEX_BINARY` can select the installed executable.

No real agent runs are triggered by ordinary CI. CI runs the deterministic harness
tests; the real baseline is run explicitly using the operator's existing account.
The optional canary uses deterministic synthetic provider responses with the
installed client; it is not a scored model run. The baseline uses four pair
workers, with arms run sequentially within each pair and order counterbalanced.

## Scoring and interpretation

Report all 53 paired cases, valid diagnosis coverage, abstentions, operational
errors/timeouts, actual successful Fuse inspections, unsupported evidence, false
alarms, per-category outcomes, wall time and input/cached/output tokens. Missing
pricing is unknown cost, never zero dollars.

Binary label precision/recall alone can reward a plausible but wrong explanation.
Retain per-case explanations and audit important positive/negative near-twins
against pinned code. Category accuracy is secondary: source-only agents did not
execute the checks needed to establish a build/test/runtime distinction.
For compatibility, the upstream scorer's error-as-negative convention may also
be shown explicitly; it is not evidence that an errored negative case was safe.
Valid-only metrics must always show their denominator and coverage.

The upstream validation summary reports 53/53 valid cases, but is not our own
rerun of PostgreSQL/Prisma tests and does not cryptographically bind recorded
branch heads. This study does not compare like-for-like with the upstream
merge-check → LLM pipeline, which executes tests first. Its published scores are
context only. Future repair evaluation requires a separately prepared database
environment and broader product scope; current single-file application guards
remain unchanged.

## Results

Results and the independent audit will be added after the frozen real-agent run.
