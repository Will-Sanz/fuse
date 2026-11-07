# Behavioral review acceptance

Branch: feat/behavioral-proposals. Working tree was clean at start.

- [x] Clean-merge fixture, independent branches, strict regression and compatible negative
- [x] Structured issue / panel-confirmed intent / exact candidate contracts
- [x] Container isolation and baseline-versus-candidate checks
- [x] Exact verification gate, stale/dirty/integrity/cancellation failures
- [x] MCP + panel + source-grounded visual flow, legacy compatibility
- [x] Portable host instructions, docs, package and CI
- [x] Independent review, fixes and rereview
- [x] Build, unit/transport, browser/showcase, package, CLI
- [x] Real Docker acceptance and source preservation through explicit application
- [x] Separate live investigative agent + real MCP + live visual trace

Docker engine 27.4.0 is available (requires execution outside the app filesystem restriction). No host-code fallback is permitted.

Final evidence is in docs/verification.md and docs/evidence/semantic-checkout/.
Publication rerun: all 54 tests passed together with real Docker enabled. Browser: 9
passed. Showcase: 2 passed. Build, format, package and CLI acceptance passed.
All four independent-review findings fixed and rereviewed. No unresolved material
findings or live-dependency blockers. Human clicks were simulated ONLY in disposable
fixtures; live investigation/proposal used an independent agent and real MCP.
