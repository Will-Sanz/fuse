# Inline MCP review delivery

Branch: feat/inline-mcp-review. Parent: main (dd10049). Initial tree clean.

- [x] Installed Codex local MCP presentation contract traced in runtime
- [x] Private result-metadata projection verified with actual client and independently reviewed
- [x] Review/session/expiry-bound human-action bridge implemented and tested
- [x] PM contract checkpoint before substantial implementation
- [x] Requested liquidglass package pinned, actual visual effect + accessible fallback
- [x] Compact inline card; expand visual/choice; agent verification updates; exact code approval (simulated host)
- [x] No model-callable confirmation/application bypass
- [x] Inline default has no external-browser launch; native rendering remains unverified
- [x] Real transport/browser negative and compatibility tests
- [x] Independent review and corrections
- [x] Build, 61 tests with real Docker, 16 browser tests, 2 showcase tests, package/CLI, format
- [x] GitHub CI for implementation commit ad54fb7: run 42532085393
- [x] Pushed PR with concrete evidence and honest limitations: PR #4

Two implementers own host/backend integration and liquidglass frontend. Lead owns scope,
GitHub tracking, frequent milestone reviews, integration and acceptance. Synced references
remain read-only. No global client configuration edits or deployment are planned.

Private metadata evidence: a sentinel-only MCP tool through the installed Codex CLI
and a deterministic local Responses test provider. Exact outgoing request after
`text(await tools.mcp__fuse_probe__probe_meta_privacy({}))` included public content and
structured result, omitted the exact random private marker/key from native `_meta`.
The independent reviewer repeated that comparison. This is client projection proof,
not native UI rendering proof; other clients are not presumed safe by this evidence.

Final review found no remaining material code defects after fixes for renderer
cleanup races and duplicate tool-result notifications overwriting a rotated capability.
Both portable installed-client privacy probes pass their assertions. Published
screenshots are explicitly simulated hosts, not native Codex captures.

Native rendering remains unverified because Computer Use denies access to
`com.openai.codex`. The user deferred the demo on 2026-11-08; native recording is
follow-up work, not a requirement for this implementation delivery. No native
acceptance is claimed. Follow-up: [issue #5](https://github.com/Will-Sanz/fuse/issues/5).
See `docs/inline-review.md` for future validation steps.
