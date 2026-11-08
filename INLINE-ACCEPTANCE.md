# Inline MCP review delivery

Branch: feat/inline-mcp-review. Parent: main (dd10049). Initial tree clean.

- [x] Installed Codex local MCP presentation contract traced in runtime
- [x] Private result-metadata projection verified with actual client and independently reviewed
- [x] Review/session/expiry-bound human-action bridge implemented and tested
- [x] PM contract checkpoint before substantial implementation
- [x] Requested liquidglass package pinned, actual visual effect + accessible fallback
- [x] Compact inline card; expand visual/choice; agent verification updates; exact code approval (simulated host)
- [x] No model-callable confirmation/application bypass
- [x] Inline default has no external-browser launch; native behavior still requires acceptance
- [x] Real transport/browser negative and compatibility tests
- [x] Independent review and corrections
- [ ] Actual Codex interface proof / recording
- [x] Build, 61 tests with real Docker, 16 browser tests, 2 showcase tests, package/CLI, format
- [ ] GitHub CI
- [ ] Pushed PR with concrete evidence and honest limitations

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

Native acceptance is blocked by the Computer Use denial for `com.openai.codex`.
Keep the candidate draft and issue open until a permitted operator completes the
native flow and recording described in `docs/inline-review.md`.
