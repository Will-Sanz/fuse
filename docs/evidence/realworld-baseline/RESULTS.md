# RealWorld baseline results — November 8, 2026

This is a controlled **source-only detection** study using the actual installed
Codex agent and the actual production Fuse MCP, not a simulated agent or demo.
The frozen version is `2e8917b82667b77af1a7144fdefe33db2547649a`; model
`gpt-6-astra`, reasoning `high`, client `0.166.0-alpha.5.1`. Four pair workers,
counterbalanced order, fresh sessions and a configured 180-second watchdog per arm.

## Original run: completion and matched comparison

All 53 pairs were attempted (106 arm records). **46 pairs completed in both arms**
(86.8% paired coverage). Compare those same pairs rather than different per-arm
success subsets:

| Metric                                        | Agent without Fuse | Agent with Fuse |
| --------------------------------------------- | -----------------: | --------------: |
| Completed arm runs, all attempted cases       |              48/53 |           47/53 |
| Correct assessments, same 46 completed pairs  |      41/46 (89.1%) |   43/46 (93.5%) |
| Conflict recall on those pairs                |      26/31 (83.9%) |   28/31 (90.3%) |
| False alarms among completed compatible pairs |               0/15 |            0/15 |
| Median duration, same 46 pairs                |            21.77 s |         30.69 s |
| Input + output tokens, same 46 pairs          |          3,319,697 |       5,010,078 |
| Cached input tokens, same 46 pairs            |          2,559,360 |       3,757,312 |

The Fuse-enabled arm made two additional correct judgments (`rw-022`, `rw-039`),
with no control-only wins among completed pairs: **+2/46, or +4.35 percentage
points**. Median duration was about **41% higher** and input-plus-output tokens
about **51% higher**. This single authored-repository run is descriptive, not
statistical evidence of a causal or broad production benefit.

The findings were made by the **agent using MCP evidence and source tracing**.
Audited Fuse engine conflict arrays were empty on both differential cases; these
are not standalone detections by Fuse's current local-function engine. See
[AUDIT.md](AUDIT.md) for independent causal checks.

## Failures and limits retained

The control had two errors and three timeouts; Fuse had four timeouts and two raw
`protocol_error` records. The union of affected pairs is `rw-047`–`rw-053`.
Four exit-1 runs explicitly report **workspace routing discovery failed** before
any MCP call. The two raw Fuse protocol errors are those pre-tool routing failures:
a status-precedence defect in the frozen harness mislabeled them. Original records
remain unchanged; a later harness fix improves future diagnostics only.

Other timeout traces do not establish the same cause. Configured watchdogs were
180 seconds; recorded timeout totals were 180.338–235.650 seconds and include
postprocessing. The frozen harness did not record process/cleanup phase times,
so execution versus event-loop/suspend/cleanup delay cannot be distinguished.
Future instrumentation addresses that limitation; no cause is assumed here.

No unresolved case is called safe. The upstream-compatible error-as-no-conflict
scores in `summary.json` are secondary only: they credit unresolved negative cases
and must not be used as completion-aware accuracy. Usage is known for 95/106 arm
runs; eleven unsuccessful runs have **unknown usage**, not zero. No dollar charges
were measured. Token totals are cumulative model-reported usage, including cached
context, not unique source bytes or measured account billing.

All 106 source fingerprints were preserved. All 51 completed native Fuse inspection
calls matched requested and returned repository/base/A/B provenance. Unsupported
file evidence was flagged in eight Fuse cases; no product safeguards were relaxed.
The upstream's 53/53 case-validation result is source-reported, not a local rerun
of target PostgreSQL/Prisma/oracle checks.

## Recovery cohort

A separately labeled recovery run repeats **both arms for every pair with any
original unresolved outcome**, using the exact frozen version/settings. It does
not overwrite or rescore the original experiment. Results are recorded separately.

An initial recovery start raced with a future diagnostics edit. It was stopped,
its two finished records rejected for frozen-input violations, and its artifacts
retained under `aborted-recovery/`. Other interrupted work has unknown usage. The
accepted recovery cohort runs from a separate immutable checkout of `2e8917b`.

The accepted recovery completed **14/14 arm runs**. Both agents were correct on
**7/7 pairs** (four conflicts and three compatible pairs), with no false alarms.
Independent audit verified the same model, effort, watchdog, concurrency, seed,
dataset, product/harness hashes, frozen commit and selected arm orders. All seven
real Fuse inspections matched the requested sources; source stayed unchanged.
Four recovery cases retained oversized-file/unsupported evidence flags.

For completeness, the **secondary multi-epoch composite** of 46 original completed
pairs plus seven recovery pairs is 48/53 correct without Fuse and 50/53 with Fuse,
with recall 30/35 versus 32/35 and no false alarms among 18 compatible pairs.
This is not a single uninterrupted 53-pair success or a replacement for the
first-attempt coverage/failure figures. See `recovered-composite.json` for the
explicit cohort selection and `recovery/` for its separate records and scores.

On the seven recovery pairs, median duration was 27.61 seconds without Fuse and
61.90 seconds with Fuse; input-plus-output tokens were 957,172 versus 1,181,633.
Usage was known for all 14 accepted recovery runs. No charges were measured, and
the rejected/interrupted attempt adds usage outside these scored totals.

## Interpretation

The initial result is a useful signal with meaningful overhead and incomplete
execution coverage. Three shared misses concern authored intent/duplication
warnings (`rw-014`, `rw-028`, `rw-034`), rather than demonstrated runtime failures.
Do not rescore those away. The next product priorities suggested by this baseline
are reliability/diagnostics, smaller evidence payloads and clearer intent-warning
policy, followed by multi-file/data-flow and repair evaluation. No product changes
were made to optimize this score. Native UI and demo work remain deferred.

## Per-case original outcomes

`miss` means a completed answer disagreed with the authored label. Errors/timeouts
are unresolved. The table preserves the frozen raw status for routing failures.

| Case   | Authored type | Without Fuse                | With Fuse                   |
| ------ | ------------- | --------------------------- | --------------------------- |
| rw-001 | test          | conflict (test); correct    | conflict (test); correct    |
| rw-002 | build         | conflict (build); correct   | conflict (build); correct   |
| rw-003 | negative      | no-conflict (none); correct | no-conflict (none); correct |
| rw-004 | textual       | conflict (textual); correct | conflict (textual); correct |
| rw-005 | textual       | conflict (textual); correct | conflict (textual); correct |
| rw-006 | textual       | conflict (test); correct    | conflict (test); correct    |
| rw-007 | build         | conflict (build); correct   | conflict (build); correct   |
| rw-008 | build         | conflict (build); correct   | conflict (build); correct   |
| rw-009 | test          | conflict (test); correct    | conflict (test); correct    |
| rw-010 | test          | conflict (test); correct    | conflict (test); correct    |
| rw-011 | runtime       | conflict (runtime); correct | conflict (runtime); correct |
| rw-012 | runtime       | conflict (runtime); correct | conflict (runtime); correct |
| rw-013 | runtime       | conflict (runtime); correct | conflict (runtime); correct |
| rw-014 | intent        | no-conflict (none); miss    | no-conflict (none); miss    |
| rw-015 | intent        | conflict (intent); correct  | conflict (intent); correct  |
| rw-016 | intent        | conflict (intent); correct  | conflict (intent); correct  |
| rw-017 | negative      | no-conflict (none); correct | no-conflict (none); correct |
| rw-018 | negative      | no-conflict (none); correct | no-conflict (none); correct |
| rw-019 | negative      | no-conflict (none); correct | no-conflict (none); correct |
| rw-020 | negative      | no-conflict (none); correct | no-conflict (none); correct |
| rw-021 | negative      | no-conflict (none); correct | no-conflict (none); correct |
| rw-022 | runtime       | no-conflict (none); miss    | conflict (runtime); correct |
| rw-023 | negative      | no-conflict (none); correct | no-conflict (none); correct |
| rw-024 | negative      | no-conflict (none); correct | no-conflict (none); correct |
| rw-025 | negative      | no-conflict (none); correct | no-conflict (none); correct |
| rw-026 | negative      | no-conflict (none); correct | no-conflict (none); correct |
| rw-027 | runtime       | conflict (runtime); correct | conflict (runtime); correct |
| rw-028 | intent        | no-conflict (none); miss    | no-conflict (none); miss    |
| rw-029 | runtime       | conflict (runtime); correct | conflict (runtime); correct |
| rw-030 | runtime       | conflict (runtime); correct | conflict (runtime); correct |
| rw-031 | build         | conflict (build); correct   | conflict (build); correct   |
| rw-032 | test          | conflict (test); correct    | conflict (test); correct    |
| rw-033 | runtime       | conflict (runtime); correct | conflict (runtime); correct |
| rw-034 | intent        | no-conflict (none); miss    | no-conflict (none); miss    |
| rw-035 | runtime       | conflict (runtime); correct | conflict (runtime); correct |
| rw-036 | negative      | no-conflict (none); correct | no-conflict (none); correct |
| rw-037 | runtime       | conflict (runtime); correct | conflict (runtime); correct |
| rw-038 | negative      | no-conflict (none); correct | no-conflict (none); correct |
| rw-039 | intent        | no-conflict (none); miss    | conflict (intent); correct  |
| rw-040 | runtime       | conflict (runtime); correct | conflict (runtime); correct |
| rw-041 | negative      | no-conflict (none); correct | no-conflict (none); correct |
| rw-042 | runtime       | conflict (runtime); correct | conflict (runtime); correct |
| rw-043 | negative      | no-conflict (none); correct | no-conflict (none); correct |
| rw-044 | runtime       | conflict (runtime); correct | conflict (runtime); correct |
| rw-045 | negative      | no-conflict (none); correct | no-conflict (none); correct |
| rw-046 | runtime       | conflict (runtime); correct | conflict (runtime); correct |
| rw-047 | runtime       | conflict (runtime); correct | timeout; unresolved         |
| rw-048 | runtime       | timeout; unresolved         | conflict (runtime); correct |
| rw-049 | negative      | no-conflict (none); correct | timeout; unresolved         |
| rw-050 | runtime       | error; unresolved           | timeout; unresolved         |
| rw-051 | negative      | error; unresolved           | timeout; unresolved         |
| rw-052 | runtime       | timeout; unresolved         | protocol_error; unresolved  |
| rw-053 | negative      | timeout; unresolved         | protocol_error; unresolved  |
