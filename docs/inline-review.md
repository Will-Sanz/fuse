# Inline Fuse review

## Product contract

Fuse stays in the developer's coding agent. A compact MCP result card expands into
an explanation and intended-behavior choices. After the human confirms a behavior,
the host agent reads the saved review, submits exact code as data, and runs the
configured isolated checks. The developer can then expand the exact verified code
and explicitly approve application in the embedded panel. The two decisions remain
separate. Model assertions are never human confirmation or execution evidence.

The card uses the actual pinned ybouane/liquidglass distribution. Glass is confined
to its own embedded background; it cannot sample the surrounding Codex interface.
Code and check logs use readable solid surfaces. Reduced-motion and unavailable
WebGL retain the same functional, accessible card with a static treatment.

Existing ordinary/legacy reviews should show their explanation inline. Their older
resolution/application flow can use a clearly labeled browser review only when the
developer explicitly requests it. The default supported behavioral workflow must
not launch an external browser or pretend that a transcript viewer is native Codex.

## Authority and evidence gate

An MCP descriptor or hidden tool name is not authentication. The inline integration
must demonstrate a host-private component channel before using it for confirmation
or application. Model-visible results and resource HTML must never contain an
approval capability. UI actions must remain scoped to one review/session and require
current versions and, for application, the exact current verified-preview token.
The existing dirty-target, source freshness, verification binding and atomic-write
safeguards continue to apply.

Client presentation metadata is evidence of a protocol contract; it is not evidence
that the installed native UI rendered or accepted a card. Browser bridge harnesses
are simulations and must be labeled as such. Native-interface proof requires an
actual permitted host surface. This environment currently denies Computer Use access
to the native Codex window; no alternate UI automation is used to bypass that block.

## Delivery tracking

[GitHub issue #3](https://github.com/Will-Sanz/fuse/issues/3) and
`INLINE-ACCEPTANCE.md` track implementation, tests, review and remaining proof.
Implementation and host-specific setup details are added as the bridge is verified.

## Verified protocol and privacy compatibility

The installed desktop distribution is 26.1027.61615 and its Codex engine is
0.166.0-alpha.5.1. The installed renderer recognizes generic local MCP app resources
using `text/html;profile=mcp-app` and descriptor `ui.resourceUri` /
`openai/outputTemplate` metadata. This establishes a code path, not observed native
rendering. The new `fuse_present_review` presents an existing saved review rather
than reinspecting into another record. The static resource is bundled locally at
`dist/inline/review.html`; it needs no remote fonts, scripts, styles or CDN.

The private capability is delivered only through `_meta.fuse`, never public
`content`, `structuredContent`, resource HTML, or a model-visible URL. It is scoped
to the MCP connection, repository, review and computed source version; it expires
and rotates. Registered `fuse_ui_action` is component-only and requires the private
capability in addition to current revision and exact preview approval token. Knowing
the tool name or supplying a fabricated result is not enough. Existing execution
and application guards still enforce the actual result.

Privacy compatibility is narrowly allowlisted to the exact observed MCP client
name `codex-mcp-client` and version `0.166.0-alpha.5.1`. This is a compatibility
check, not authentication and not proof of native display. Other versions/clients
receive no capability and remain read-only until their projection is verified.
An unrestricted local process or malicious client remains outside Fuse's scoped-tool
boundary, as it already was for the existing local browser/CLI workflow.

Two deterministic tests exercised the actual installed Codex client with a local
fake Responses provider and harmless sentinel-only MCP tools. First, a generic
code-mode tool wrapper printed the tool result: outgoing model input included public
content/structured data but omitted the exact private metadata marker. Second, an
actual app-server direct `mcpServer/tool/call` carried the sentinel as a component
action argument: the next model turn omitted that argument, action name and result.
The independent reviewer verified the captures. These are real client/transport
privacy tests with simulated provider responses, not AI investigation or native UI
acceptance claims. No real API credentials or repository source were sent to the
local test provider.

## Use in a supported host

1. Ask the coding agent to inspect branches and investigate the pinned evidence.
2. It reports a suspected issue (or no issue/insufficient evidence), generates a
   visual on that saved review, and calls `fuse_present_review`.
3. Expand the card and choose intended behavior. Return to the chat and ask the
   agent to continue; there is no promised automatic resume.
4. The agent reads the confirmed choice, submits the whole replacement source as
   data, runs `fuse_verify`, and creates an exact `fuse_preview` after success.
5. Expand exact code in the same card and approve it. Application remains local
   and uncommitted; the saved review retains decisions and backend check evidence.

If no card appears, report the host limitation. A browser review is an explicit
compatibility fallback, never an automatic extra app. Ordinary legacy reviews keep
their existing resolution path; the embedded explanation is read-only for those
older decisions. Re-present an expired/failed component session through the coding
agent rather than asking the model to use private UI controls on your behalf.

## Reproduce the installed-client privacy checks

With Node 24, repository dependencies, and the installed `codex` executable on PATH:

```sh
node scripts/host-probe/projection.mjs
node scripts/host-probe/appserver.mjs
```

Set `FUSE_CODEX_BINARY` only if the executable is elsewhere. Both scripts use fresh
temporary directories, synthetic sentinels, a local fake Responses endpoint and
per-invocation configuration. They do not call a paid model, change global client
settings or inspect project source. Assertions require actual native MCP output,
action-handler execution, and omission from the subsequent model input. A failed
or unavailable probe is not a compatibility pass. A passing newer client version
still needs independent review before the production compatibility gate is extended.

Sanitized results are in `docs/evidence/inline-review/host-privacy.json`. The images
`simulated-host-compact.png` and `simulated-host-applied.png` show the real component
inside the explicitly simulated browser test host. They are not screenshots of
native Codex and do not close the native-interface acceptance item.

## Native acceptance still required

This environment's Computer Use tool returns: `Computer Use is not allowed to use
the app 'com.openai.codex' for safety reasons.` Consequently no native screen
recording, actual host UI negotiation or human-controls proof is claimed. The same
component passing a browser bridge harness is not a substitute.

To finish this gate, a permitted operator should connect this candidate build in
their normal Codex client, ask Fuse to inspect a disposable checkout and present its
saved review with `fuse_present_review`, then check compact/expanded rendering,
behavior confirmation, agent continuation, executed results and final exact-code
approval. Confirm that no external app opens by default. Record the actual Codex
interface and its host/version. Keep this candidate in a draft PR until that native
check is accepted; no additional backend bypass or global setting change is needed.

## Candidate verification

The local release checks passed: production build, 61 tests with a real prepared
Docker image, 16 browser tests, 2 showcase tests, CLI acceptance, production-only
package installation and formatting. Both installed-client privacy probes passed.
An independent code review found no remaining material defects after lifecycle and
rotated-capability notification fixes. GitHub CI is tracked on the candidate PR.
These results do not close the native acceptance gate above.
