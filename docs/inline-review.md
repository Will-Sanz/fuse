# Inline Fuse review

## Product contract

Fuse stays in the developer's coding agent. A compact MCP result card shows the
visual and current action immediately. Supporting evidence and logs expand on demand.
After the human confirms a behavior,
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

The November 8 implementation inspected desktop distribution 26.1027.61615 and
Codex engine 0.166.0-alpha.5.1. That renderer exposed generic local MCP app resources
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
name `codex-mcp-client` and versions `0.166.0-alpha.5.1` and `0.167.0-alpha.3.2`. This is a compatibility
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

After the November 9 environment restart, the installed CLI reported
`0.167.0-alpha.3.2`. Both portable privacy probes were rerun against that actual
client before adding its exact version to the allowlist. Captures again showed
public tool data reaching the model while private metadata and accepted/rejected
direct component actions stayed out of subsequent model input. This extends only
the verified privacy compatibility; native rendering and UI negotiation remain
unverified. Other versions, including the next patch version, stay read-only.

In a separate live-host check on November 9, actual Fuse MCP inspection, issue
reporting and `fuse_present_review` succeeded on a disposable checkout. The user
confirmed that the card appeared and was expanded in the actual chat. This is
user-reported native appearance, not an automated screenshot or click-through
acceptance. Native Computer Use remains denied, and the permitted MCP Apps
interface exposed no component tab after expansion. Full interaction acceptance
remains open in [issue #5](https://github.com/Will-Sanz/fuse/issues/5).

## Use in a supported host

1. Ask the coding agent to inspect branches and investigate the pinned evidence.
2. It reports a suspected issue (or no issue/insufficient evidence), generates a
   visual on that saved review, and calls `fuse_present_review`.
3. Choose intended behavior in the card. Once the backend confirms the human choice,
   a supported Codex host receives a continuation in this same chat. The presenting
   agent should end its turn while awaiting that click. A busy chat may queue the
   continuation; accepted delivery does not mean the correction has finished.
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

Sanitized results are in [the original November 8 evidence](evidence/inline-review/host-privacy.json)
and [the November 9 client recheck](evidence/inline-review/host-privacy-20261109.json). The images
`simulated-host-compact.png` and `simulated-host-applied.png` show the real component
inside the explicitly simulated browser test host. They are not screenshots of
native Codex and do not establish native rendering.

## Compact card correction (November 10)

[Issue #10](https://github.com/Will-Sanz/fuse/issues/10) tracks user feedback from
the native card: competing scrolling, unreliable images and excessive size/text.
The card now shows the visual and current action first, with the proposed fix
when available. Evidence, previous choices, full source, check logs and hashes
remain under **Review details**. Exact-code approval still has its own disclosure
and explicit apply button. The card is at most 640 px wide and requests at most
560 px of host height; long content uses the iframe document's ordinary scrolling.
There is no second scrolling content panel, and repeated height notices are
coalesced and deduplicated. Hosts retain control over the actual iframe size.

The unchanged pinned liquidglass library now captures a separate decorative tree;
live controls, diagrams and source stay outside its capture. Its padded canvases
are clipped to prevent horizontal overflow. The server uses the existing PNG
renderer for private component image metadata. XML-invalid text is removed before
SVG/PNG rendering. A failed image shows the visual's text summary while keeping
the human controls usable. Older SVG metadata remains supported during a running
connection's resource upgrade; replaced visuals cannot reuse a stale image.

The updated [compact card](evidence/inline-review/simulated-host-compact-20261110.png)
and [application receipt](evidence/inline-review/simulated-host-applied-20261110.png)
were visually inspected in the explicitly simulated browser host. They are not
native Codex screenshots. The correction passed 66 unit/integration tests with a
real Docker verifier, all 28 browser tests, production-only package installation
and CLI acceptance.
The narrow scroll regression passed three repeats with real wheel and keyboard
input, synchronizing on native `scrollend` before the next gesture.

The native user confirmed an intended behavior on November 10; the saved review
recorded `origin: human-panel`. Real Docker checks then failed the combined baseline
and passed the correction. Final native application was not confirmed: the user
reported these UI defects before that step. This is partial user-reported native
acceptance, not an automated native capture or a completed demo.

## Same-chat continuation checkpoint

[Issue #12](https://github.com/Will-Sanz/fuse/issues/12) scopes this release to
explicit Fuse requests in Codex. The successful behavior-click handler checks the
returned repository, review, advanced revision and matching `human-panel` intent
before sending a single `ui/message`. The fixed message contains only the public
repository/review/revision reference and instructions to read the saved choice,
submit and verify a correction, then present its exact preview for final approval.
It contains no private capability, preview token, source or test logs.

The host must advertise both `message.text` and `experimental["openai/message"]`.
The request uses `role: "user"` and
`_meta["openai/message"]: { target: "active", send: true }` per the
[OpenAI MCP message contract](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#uimessage-extensions).
Read-only installed renderer inspection confirms this routes to the card's chat
recipient and queues when its composer is busy. This inspection is not native
execution proof. No new chat or second coding agent is created.

Refreshing, receiving a tool-result notification, and reopening a saved card do not
dispatch continuation. A synchronous action guard prevents duplicate clicks while
confirmation or message delivery is pending; the selected choice cannot be clicked
again as an implicit retry. Rejection, unsupported hosts and uncertain timeouts keep
the confirmed choice and its rotated private session. Uncertain delivery is never
retried automatically, because the host might already have queued the request.
Final exact-code application remains an independent explicit human approval.

The connected native Fuse server was confirmed to serve the old **Review interaction**
resource after local implementation: this installation launches GitHub `main` using
`npx`. A running process retains its installed copy. The PR must merge and the Fuse
connection must refresh before new native acceptance; presenting a saved review
alone does not update an installed server. Check the actual connected resource for
the new **Review details** layout before recording. Do not quit Codex or interrupt
other chats to perform this check.

Background monitoring, unsolicited activation, automatic multi-agent integration
and other coding agents are outside this checkpoint. Same-chat continuation still
requires a native operator check on the updated installed build.

The browser harness exercises one click through the real MCP transport, then a
deterministic simulated agent reads the confirmed review, submits a correction,
runs actual Docker checks and creates/presents the preview. Additional cases cover
missing message capabilities, host rejection (result and JSON-RPC), uncertain
timeout, duplicate clicks, refresh/reopening and notifications during pending
delivery. These are explicitly simulated host/agent tests, not proof of a native
Codex model turn. The complete 28-case browser suite passes locally.

## Remaining native validation and demo

### High-DPI edge correction

The November 10 user click delivered an actual MCP App continuation to this same
chat. Reading the saved review confirmed `human-panel` intent, and the resumed
agent submitted the correction, ran real Docker checks and created its exact
preview. Baseline compilation passed while policy failed; both candidate checks
passed. Final application remains pending.

The native screenshot also exposed a broad white strip on the top/left glass rim.
[Issue #13](https://github.com/Will-Sanz/fuse/issues/13) reproduces it in the browser
host at 2x display scale. The library initializes its sample canvas white; our
rounded, inset ambient left part of that sample unpainted. Extending the opaque
ambient beyond the 20 px sampling margin and matching the shader's radius to the
16 px CSS radius removes the strip without changing vendor code or reducing the
glass effect. The backdrop remains clipped and separate from live controls.

The pixel regression covers 1x/2x scale, narrow/normal widths, light/dark hosts and
all four edges. It permits a thin intentional rim but rejects a broad near-white
strip and checks that sampled pixels are opaque, so an empty canvas cannot pass.
The explicitly simulated-host [before](evidence/inline-review/simulated-host-edges-before-2x.png)
and [after](evidence/inline-review/simulated-host-edges-after-2x.png) images show the
same card at 2x. They are not native screenshots or a recorded demo. Native edge
acceptance and final application remain open before recording.

This environment's Computer Use tool returns: `Computer Use is not allowed to use
the app 'com.openai.codex' for safety reasons.` Consequently no native screen
recording, actual host UI negotiation or automated human-controls proof is claimed. The same
component passing a browser bridge harness is not a substitute.

The user resumed demo work on November 10, after correcting the card feedback.
Full native interaction and recording remain open in
[issue #5](https://github.com/Will-Sanz/fuse/issues/5). For validation,
a permitted operator should connect this candidate build in
their normal Codex client, ask Fuse to inspect a disposable checkout and present its
saved review with `fuse_present_review`, then check the visual/current action,
behavior confirmation, agent continuation, executed results and final exact-code
approval. Confirm that no external app opens by default. Record the actual Codex
interface and its host/version. No native acceptance is claimed by the automated
tests; no additional backend bypass or global setting change is needed.

For a native recording, a permitted operator should record only the current Codex
conversation/card region with the system recorder. Rehearse on a disposable
checkout first: show the interaction visual, choose the original-subtotal policy,
let the agent submit and verify the correction, inspect the exact source, then
explicitly approve application. Include the real baseline failure, candidate pass
and local application receipt. Do not use a browser harness recording as the native
demo or capture unrelated chats. Codex need not be quit or restarted for recording.

## Original inline implementation verification

The original inline release checks passed: production build, 61 tests with a real prepared
Docker image, 16 browser tests, 2 showcase tests, CLI acceptance, production-only
package installation and formatting. Both installed-client privacy probes passed.
An independent code review found no remaining material defects after lifecycle and
rotated-capability notification fixes. [GitHub CI passed for implementation commit
ad54fb7](https://github.com/Will-Sanz/fuse/actions/runs/42532085393); current checks
are tracked on the candidate PR.
These results do not establish native rendering or replace the deferred demo.
