# MVP scope

Source: Fuse Senior Design – Group 11 presentation, slides 5–7 and milestone plan on slide 9.

The first release implements the flagship TypeScript example across three persistent surfaces: agent overview, conflict resolution, and decision history. It accepts a common base and two agent revisions, extracts named top-level functions with ts-morph, compares function changes, and shows the local call graph. Shared-function edits become decisions. Changes on the same call path become review candidates, not claims of a proven semantic conflict.

Resolution keeps A, keeps B, or composes insertions into an otherwise unchanged function body. Composition requires an explicit order where insertions share an anchor. Unsupported compositions stay blocked. Completed resolutions produce downloadable TypeScript and a decision record with the exact input and output hashes. Source is parsed and type-checked, never executed by the app.

React + Vite UI; TypeScript + Express API; local SQLite persistence. A no-key checkout example is fully interactive. GitHub import reads one file at three pinned commits; private repositories require a server-side token. Linear, Slack, Teams, autonomous agent execution, AI semantic judgments, multi-file resolution, and hosted multi-user authentication are follow-on work. The MVP is a local reviewer workspace and must bind to loopback.

Delivery checkpoints:
1. AST analysis, constrained composition, and engine tests.
2. Persistent API, GitHub import, and API tests.
3. Three-surface UI, browser tests, production build, and team setup documentation.
