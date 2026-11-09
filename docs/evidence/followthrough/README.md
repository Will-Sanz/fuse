# Follow-through evidence

Read [results and current completion status](RESULTS.md) alongside
[the protocol](../../benchmark-next.md). The original November 8 baseline is
preserved in its separate directory.

Each published epoch contains its frozen manifest, every arm result (including
failures), raw scorer summary, payload-use counts, compressed native events and
a trace index. Epochs remain separate; no successful retry replaces an unresolved
result. Repeated authored cases are correlated observations, not independent new
production conflicts. Dollar charges were not measured.

`payload-measurements.json` is the complete 53-case deterministic production-MCP
full/compact preservation check. `preflight-audit.json` distinguishes its original
raw file hash from the repository-formatted publication hash. These checks measure
UTF-8 MCP JSON text bytes, not model tokens or billing. Live per-epoch
`payload-usage.json` counts every completed native call, including repeat calls,
before path normalization. It records which optional detail level the agent
actually requested; omitted detail remains full.

## Publication and retained originals

One line of `native-events.jsonl.gz` contains `{caseId, arm, events}`. The index
records the original locally retained trace hash, normalized published line hash,
event count and gzip hash. Thread IDs, run/home paths and temporary working paths
are normalized. JSON formatting changes whitespace only. Source, decisions,
outcomes, event order, observed usage and evidence remain intact. Stderr content
and full raw privacy-probe model request bodies are not published; their original
hashes remain available. No authentication files were copied.

Independent audits checked both original records and normalized publication,
including exact source trees, unchanged files/index/refs, permitted tool calls,
native MCP provenance, usage and scores. Some rejected builtin attempts do not
appear as native action events; separate unscored synthetic-provider boundary
probes establish their denials and do not prove that every blocked attempt is
visible in scored traces.

The pre-reset infrastructure-loss attempt has no surviving raw cohort and is
excluded explicitly in `infrastructure-interruption.json`. Its final counts and
usage are unknown, not zero. Completed post-reset artifacts use persistent
storage and fresh `r2` epoch names.

## Source notices

RealWorld source excerpts retain the upstream
[MIT notice](../realworld-baseline/UPSTREAM-LICENSE). Adapted Click and ms excerpts
retain the [Click BSD notice](../adapted-baseline/CLICK-LICENSE) and
[ms MIT notice](../adapted-baseline/MS-LICENSE). The adapted scenarios are authored
on pinned upstream trees, not historical production conflicts.

Native card appearance was confirmed by the user in this chat. Full native
interaction acceptance remains tracked in
[issue #5](https://github.com/Will-Sanz/fuse/issues/5); these benchmark traces are
not UI rendering or demo evidence.
