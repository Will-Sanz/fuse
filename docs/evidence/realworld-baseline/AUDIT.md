# Independent baseline audit

The implementation was reviewed before the frozen experiment at `2e8917b`.
Corrections covered missing usage, exact requested/returned inspection provenance,
failed-assistance accounting, context/tool controls and evidence retention when
frozen inputs change. No product code or prompts were tuned during the scored run.

## Protocol checks

The independent reviewer audited the first ten completed records (rw-001 through
rw-005, both arms). Raw event/stderr hashes, locked source provenance, model/effort/
budget parity, usage sums and unchanged source fingerprints matched. Control used
only the common source MCP; treatment additionally made real native Fuse
inspections of the requested commits. No executed-check claims were found.

The final installed-client canary used synthetic provider responses only to inspect
effective tool/context exposure. Actual scored runs used the real installed agent
and ordinary account/provider. The registry contains four common source tools;
the Fuse arm adds production inspect/review. Shell/general file readers/web/apps
and skill/evaluator instructions are absent. Limited builtins remain advertised;
read-only patch writes are denied and ephemeral goal access is unavailable. Some
denied attempts have no native event, so event auditing is not a complete record
of blocked helper attempts.

## Causal explanation samples

Auditors read the outputs and pinned original source, rather than grading only
the binary answer. These checks do not constitute independent execution of the
target application's tests or full manual validation of every output.

| Case   | Audited output | Finding                                                                                                                                                                                                                                |
| ------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rw-011 | Both arms      | Correctly connect orphan-tag deletion with cache invalidation only on creation.                                                                                                                                                        |
| rw-012 | Both arms      | Correctly trace caller pre-hashing followed by the changed helper hashing again, breaking login.                                                                                                                                       |
| rw-014 | Both arms      | Official intent-label misses. Deleting unused tags and filtering to used tags compose safely; source-grounded compatibility judgment disagrees with the benchmark's overlapping-goal policy. Retain the official misses.               |
| rw-015 | Both arms      | Correct duplicate feed-filtering judgment. No invented merged runtime failure: the database filter makes the later controller filter redundant.                                                                                        |
| rw-016 | Both arms      | Correctly identify repeated authorization queries/checks across middleware and controller.                                                                                                                                             |
| rw-019 | Both arms      | Correct compatible cache twin: shared Prisma middleware invalidates on the orphan-tag write.                                                                                                                                           |
| rw-020 | Both arms      | Correct compatible password twin: B writes via a separate helper, so A's hashing change does not double-process it.                                                                                                                    |
| rw-021 | Both arms      | Correctly distinguish the renamed login secret from the independent reset-token secret; Fuse acknowledges unsupported-file evidence.                                                                                                   |
| rw-022 | Both arms      | Fuse-enabled correctly identifies the default-10 to page-2 transition skipping articles 11–20. Control reads the facts correctly but treats pagination modes independently, missing the continuity invariant. Retain the control miss. |
| rw-028 | Both arms      | Official intent-label misses. Both correctly recognize idempotent email normalization in controllers and database helpers, but do not flag duplicated responsibility.                                                                  |
| rw-034 | Both arms      | Official intent-label misses. Both correctly recognize compatible favorites endpoint/filter behavior but do not flag overlapping product intent.                                                                                       |
| rw-037 | Both arms      | Correctly trace Unicode-preserving slugs into an unchanged create/view flow versus an ASCII-only GET route.                                                                                                                            |
| rw-039 | Both arms      | Fuse-enabled identifies validation rejecting titles above 100 before B's above-120 truncation can run through the API. Control considers accepted inputs/direct helper calls but misses suppression of B's API behavior.               |
| rw-040 | Both arms      | Correctly trace normalized stored tags versus raw URL parameters in an exact lookup.                                                                                                                                                   |

The audited rw-019/rw-020/rw-022 Fuse inspections returned no local conflict flags.
The rw-022 diagnosis therefore required the agent's subsequent source tracing;
it should not be presented as an independently detected Fuse engine finding.
Observed arm differences alone do not prove which evidence caused a model answer.

## Complete original run and accepted recovery

Independent audit recomputed the saved original score exactly and checked all
106 individual/aggregate rows, raw event/stderr hashes, original/reconstructed
tree provenance and current source fingerprints. Each source store had exactly
three commits, generic refs and no remotes/alternates. All 51 native Fuse inspect
calls matched requested and returned source provenance; the control made no Fuse
calls. Usage sums matched all 95 known terminal records; eleven failed runs
correctly retained unknown usage. The 46-pair comparison independently recomputed
to 41 correct without Fuse and 43 with Fuse, with wins only on rw-022/rw-039.

The accepted recovery's 14 rows/traces/source stores and score were independently
checked by the data reviewer. Configuration and selected orders exactly matched
the original freeze; both arms were correct on all seven pairs. A separate
reviewer read all 14 recovery explanations against pinned original source:

| Recovery cases | Causal audit                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| rw-047/rw-048  | Correctly identify trimming in the shared password helpers versus direct untrimmed bcrypt comparison, including misleading message variants. |
| rw-049         | Correctly recognize the shared comparison helper keeps behavior compatible despite its misleading message.                                   |
| rw-050         | Correctly trace removal of email from login tokens into email-based moderator checks failing.                                                |
| rw-051         | Correctly recognize username-based moderation remains compatible.                                                                            |
| rw-052         | Correctly identify taking the last result after descending sort returns the oldest comment.                                                  |
| rw-053         | Correctly recognize max-ID selection is independent of result ordering.                                                                      |

No wrong-reason positives or unsupported test-execution claims were found in the
audited samples/recovery outputs. This is sampled causal review plus complete
protocol/integrity review, not manual proof of every original explanation.
Recovery engine conflict arrays were empty except identical whole-file
composition/manual-review flags in the positive/negative seed twins; these flags
do not distinguish the actual semantic bug from its compatible twin.

## Future diagnostics correction

Four original exit-1 traces report workspace routing discovery failures before any
tool call. The frozen runner mislabeled two as missing-inspection protocol errors
and masked the terminal cause with missing `final.json`. Original artifacts remain
unchanged. The later harness patch prioritizes genuine execution/turn failures,
preserves native error messages, and records process/watchdog/cleanup timestamps
for future runs. Independent review and regression tests cleared that patch.
No model runs used that later patch in the accepted datasets.
