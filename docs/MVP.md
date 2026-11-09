# Fuse visual explanation release

The inline-review candidate keeps human decisions in a compact MCP App using the
requested liquidglass library. Transport, component and privacy tests are distinct
from native Codex rendering, which is not yet accepted. The current acceptance
record is [inline review](inline-review.md); no browser or transcript simulation
counts as native-interface proof.

## MCP-first behavioral proposals

Fuse now supports **saved issue → human behavior confirmation → host-agent proposal
→ isolated baseline/candidate checks → exact preview → second human approval →
applied receipt**. This is separate from the preserved legacy A/B and active-merge
flows described below. See [the behavioral workflow](behavioral-review.md) for setup, tool contracts,
limits and a complete checkout walkthrough. Current verification evidence and
remaining blockers are in [verification](verification.md).

The product flow is **original code and highlighted conflict → custom visual explanation → choose the intended behavior → create the matching change**. The public website can use prepared examples. The real MCP must inspect a repository, call real AI, and generate the explanation image.

## Implemented milestones

1. Preserve the Git/worktree/CLI engine, explicit attribution, source freshness, deterministic reconciliation, checks, and persistent decision history.
2. Replace the browser dashboard with the focused three-step flow and actual source. Use distinct prepared visual metaphors for validation order and shipping eligibility. Remove demo narration and old Codex CLI playback.
3. Add real OpenAI Responses API generation with `gpt-6-luna`, bounded repository context, strict scene/action validation, safe SVG/PNG rendering, real response provenance, and explicit failures. No Codex CLI dependency.
4. Add actual active Git merge inspection and constrained, freshness-checked application/staging. Preserve unrelated or newer work.
5. Provide a one-command meeting runner using actual MCP transport, fresh disposable conflicts, fresh AI images, browser choice, application, and real checks. Include a captured real MCP image and teammate setup instructions.
6. Host the prepared browser experience on Vercel with downloadable engine-produced source, no API key, no local filesystem assumptions, and no fabricated test outcomes.

## Acceptance criteria

- The first thing shown is actual original code and highlighted competing edits.
- Validation order and shipping thresholds have different visual explanations and meaningful behavior choices.
- The local MCP uses the configured OpenAI API key, reads pinned code context, and returns an actual generated PNG image plus structured review data.
- Unsupported model actions, invalid scenes, provider failures, and stale generation cannot silently become successful explanations.
- The user chooses; preview shows the exact resulting code. Explicit creation writes only supported, current source and runs explicitly configured checks.
- A real merge conflict is resolved and staged without a commit. New conflict edits and unrelated work are preserved.
- The live runner works with Node 24, Git, and an API key, independently of any particular coding assistant.
- Both live scenarios pass MCP → OpenAI → image → decision → source application → checks.
- The hosted page works without an API server, downloads the correct selected source, and does not claim it changed a Git repository or ran checks.
- Ordinary changes, worktree overlaps/interactions, watcher deduplication, CLI JSON/exit codes, persistence, Git linking, and legacy safety checks remain covered.
- Browser loading/error/success, responsive layouts, portable setup, downloads, and actual local application pass end-to-end checks.
- Keep this milestone local on its feature branch; no deployment, push or merge is part of acceptance.

## Current boundaries

The analysis and automatic application scope remain deliberately narrow: TypeScript top-level named functions and one-file supported resolution. The compact browser focuses on one conflict. AI improves explanation and visual design; deterministic code generation constrains application. Local Git attribution is not authenticated identity. Public hosting serves prepared examples; live API credentials and repository changes remain local.
