# Fuse follow-through — November 9, 2026

Status: the new baseline and deterministic evidence checks are complete. Two
candidate RealWorld epochs and two adapted-project epochs are running under the
[preregistered protocol](../../benchmark-next.md). Their results are pending;
this file is not a completed-study claim.

## Product change and exact evidence preservation

`fuse_inspect` and `fuse_review` accept `detail: "compact"`. The complete response
remains the default. Compact retains exact complete file inputs, provenance,
source versions, evidence indexes/locations/observations, unique graphs,
unsupported source and lifecycle state. It omits repeated source snippets and
snapshot code only where identical code remains in the complete input. Full
retrieval and stored review bytes remain unchanged. No detector or benchmark
label was changed.

The actual production MCP measured all 53 pinned RealWorld cases on frozen
candidate `6c74f6aba64d2ab2638548d9a13864e0fba60ad5`. Each case used a full
inspection, compact retrieval and another default/full retrieval of the same
saved review. Assertions checked rehydration, exact source/trees, unchanged
source/index/refs, persistence and returned provenance. Independent audit matched
all saved reviews and hashes, including 11 cases with unsupported evidence.

| Serialized MCP JSON text        |      Full |   Compact |
| ------------------------------- | --------: | --------: |
| Total UTF-8 bytes, all 53 cases | 6,554,688 | 4,293,027 |
| Median bytes per case           |    52,887 |    39,872 |

Total response text is **34.50% smaller**. This is a deterministic response-size
result, not model-token savings, latency, billing or detection efficacy. Actual
agent calls can repeat inspection/retrieval and use other source tools.

## Fresh baseline with the updated client

The `before-r2` epoch uses original product/harness commit
`7ad3058f931a0b284c4968ed0770f7a651fbf871`, actual Codex
`0.167.0-alpha.3.2`, `gpt-6-astra` / `high`, 180-second configured watchdog,
four pair workers, fresh sessions and recorded counterbalanced order. The same
client/model/settings and unchanged actor prompt/source access apply to the new
candidate cohorts. The historical November 8 results used a different client
and remain separate.

All 106 arm runs completed with determinate answers: 53/53 matched pairs,
zero errors, timeouts, abstentions or unknown-usage records. Independent audit
verified all trace/stderr hashes, terminal usage, exact pinned trees, source
fingerprints, three-commit isolation and native tool provenance.

| Same 53 completed pairs | Without Fuse | With original Fuse |
| ----------------------- | -----------: | -----------------: |
| Correct judgments       |        49/53 |              49/53 |
| Conflict recall         |        31/35 |              31/35 |
| False alarms            |         0/18 |               0/18 |
| Median duration         |     24.106 s |           33.601 s |
| Input + output tokens   |    4,414,387 |          6,016,828 |
| Cached input tokens     |    3,511,808 |          4,657,024 |

Fuse alone was correct on `rw-022`; the control alone was correct on `rw-039`.
Thus the historical two-case accuracy advantage did not recur in this epoch.
The version/epoch change prevents attributing that difference solely to model
variability. The shared overlap-policy misses remain official misses.

There were 66 actual successful, exact-provenance Fuse inspections, including
repeat calls; unsupported evidence appeared in 11 cases. This is agent-assisted
reasoning, not a claim that Fuse's local engine detected those semantic issues.
All model usage is reported cumulative usage, including cached context; no account
charges were measured. Conventional medians average the middle two for even
sample sizes. The frozen raw baseline scorer uses its original nearest-rank
implementation; independently derived comparisons use conventional medians.

## Client compatibility and inline acceptance

The environment update installed Codex `0.167.0-alpha.3.2`. Both actual-client
privacy probes and the registry/context/denial canaries passed before scored
post-reset runs. Only that exact tested version was added to the existing
compatibility allowlist. Untested versions remain read-only. Private capabilities
stay outside model-visible data and application still requires the existing
human decisions, exact preview and isolated verification.

The real connected MCP accepted an inspection, issue report and inline presentation
on a disposable checkout. The user confirmed that a card appeared and was expanded
in the actual chat. That is user-reported native appearance, not automated visual
or interaction acceptance. Native Computer Use still denies access to Codex, and
the permitted MCP Apps backend exposed no component tab after expansion. No
alternative OS automation bypass was attempted. Full native interaction acceptance
remains open in [issue #5](https://github.com/Will-Sanz/fuse/issues/5); demo recording
is deferred.

## Infrastructure interruption

An earlier November 9 before-run and partial payload measurements were lost when
the execution environment restarted and removed temporary storage. At least 38
completed arm records had passed an independent checkpoint, but final counts,
usage and raw evidence are unavailable. That interrupted attempt is excluded,
never counted as zero usage or silently replaced. See
[the incident record](infrastructure-interruption.json). Restored data and all
new epoch outputs use persistent project storage. The original published baseline
was preserved unchanged.
