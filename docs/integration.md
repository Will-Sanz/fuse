# Coding-tool and structured interface

## Codex MCP integration

Fuse uses the standard MCP SDK over stdio. The shared Git/analysis/reconciliation service does not depend on Codex or any other vendor. [Codex’s documented MCP mechanism](https://developers.openai.com/codex/mcp) supports a local command and argument array:

```sh
codex mcp add fuse -- node /absolute/path/to/fuse/cli/run.mjs mcp --repo /absolute/path/to/project
codex mcp get fuse
```

Run `npm ci && npm run build` in the Fuse checkout first. `mcp get` verifies configuration only. To verify actual use, ask Codex to call `fuse_inspect` and then `fuse_review` for the returned ID. Registration must already exist when using `sessions: true`.

Inspection writes a saved review, so it is not falsely marked read-only. Approve that tool call when the client asks. In noninteractive `codex exec`, the default approval policy can reject it. For an explicitly authorized verification invocation, use invocation-scoped settings:

```sh
codex exec --ignore-user-config --ephemeral --sandbox read-only --json \
  -C /absolute/path/to/project \
  -c 'mcp_servers.fuse.command="node"' \
  -c 'mcp_servers.fuse.args=["/absolute/path/to/fuse/cli/run.mjs","mcp","--repo","/absolute/path/to/project"]' \
  -c 'mcp_servers.fuse.required=true' \
  -c 'mcp_servers.fuse.tools.fuse_inspect.approval_mode="approve"' \
  -c 'mcp_servers.fuse.tools.fuse_review.approval_mode="approve"' \
  'Call fuse_inspect with sessions=true, then fuse_review for the returned ID. Report the registered session IDs, overlapping function, and targeted intent question. Do not modify source or apply changes.'
```

These settings apply to this invocation and these inspection tools only. This verification uses an existing authenticated Codex account; the Fuse engine and demo themselves require no paid API key.

### Actual verification

Verified on 2026-10-09 through the installed Codex CLI, not only an SDK test:

| Completed MCP call                                         | Observed result                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `fuse_inspect({sessions:true})`                            | Review `77441bed-fc0d-40a8-8bbc-011e2d256ac8`; registered sessions `request` and `schema`; shared function `validateBody` |
| `fuse_review({id:"77441bed-fc0d-40a8-8bbc-011e2d256ac8"})` | Same pinned sources and targeted question asking whether A or B should run first at shared insertion points               |

Both calls emitted `item.completed`, `type: mcp_tool_call`, `server: fuse`, `status: completed`, and no error. The first attempt correctly rejected an unapproved inspection under the noninteractive approval policy; the authorized invocation-scoped configuration above succeeded. No source was modified by the MCP calls.

The automated `tests/integration.test.ts` additionally starts the real executable through an MCP stdio client, lists its tools, records intent and a proposed choice, generates an exact preview, reads it back, and verifies stale-input errors. There is deliberately **no MCP application or command-execution tool**.

## Tool contracts

Each successful tool returns text containing `{ "schemaVersion": 1, "data": ... }`. Failures are MCP error results. Full TypeScript structures are defined in `shared/review.ts`.

| Tool              | Arguments                                          | Effect                                                                    |
| ----------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| `fuse_inspect`    | optional `base`, `a`, `b`, `sessions`              | Read Git and persist analysis                                             |
| `fuse_watch_once` | none                                               | Refresh two registered worktrees; return `alert`, `updated`, and `review` |
| `fuse_review`     | `id`                                               | Read exact saved evidence and outcomes                                    |
| `fuse_history`    | none                                               | Read review IDs, status, and commit references                            |
| `fuse_intent`     | `id`, `revision`, `intent: {first, rationale}`     | Record a developer-stated A/B precedence preference                       |
| `fuse_decide`     | `id`, `revision`, `path`, `conflictId`, `decision` | Save a supported proposed choice with a required rationale                |
| `fuse_preview`    | `id`, `revision`                                   | Persist exact output, hashes, configured commands, and approval token     |

The server binds to one repository at launch. Tools cannot provide arbitrary repository paths or configure commands. Code and comments are untrusted evidence, not instructions. A coding tool should present the targeted question instead of fabricating the developer’s intent, use the returned supported action list, and leave source application to the human.

## CLI JSON and exit codes

```sh
fuse inspect --sessions --repo /path/to/project --json
fuse watch --once --repo /path/to/project --json
fuse review REVIEW_ID --repo /path/to/project --json
```

A review contains pinned Git heads, a common base, registered source identities or explicit non-attribution, input fingerprints, changed functions, base/A/B graphs, observations with file/line/code references, supported actions, recommendation confidence, decisions, preview hashes, actual checks, local reviewer identity, events, and lifecycle state.

The CLI emits one JSON object per command. Continuous watch emits JSONL with `alert` and `updated`; unchanged state has `alert: false`. Treat stdout as structured data when `--json` is selected. Node diagnostic warnings may appear on stderr. `review --serve` prints the local URL and stays running until stopped; `mcp` uses protocol messages instead of CLI JSON.

| Exit | Meaning                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| 0    | Successful command or no new watch alert                                           |
| 1    | Invalid input, unsupported action, or operational failure                          |
| 2    | Unresolved review attention / new watch alert                                      |
| 3    | Stale revision, changed source/registration, dirty target, or wrong approval token |
| 4    | One or more configured checks failed, timed out, or could not start                |

Mutations support `--revision N`; tools should use it to reject stale state. Application always requires the exact current preview token. The preview token also pins configured command arguments.

## Local HTTP interface

The visual server is bound to loopback and one repository when started by `fuse review --serve`. `npm start` uses only generated demo repositories. Browser requests never select arbitrary local paths or define executable commands. JSON is required for mutations; unexpected Host headers and cross-origin mutations are rejected.

| Method | Endpoint                   | Body                                         |
| ------ | -------------------------- | -------------------------------------------- |
| GET    | `/api/reviews`             | —                                            |
| GET    | `/api/reviews/:id`         | —                                            |
| POST   | `/api/demo`                | optional `single` (demo server only)         |
| POST   | `/api/reviews/:id/intent`  | `revision`, `intent`                         |
| POST   | `/api/reviews/:id/decide`  | `revision`, `path`, `conflictId`, `decision` |
| POST   | `/api/reviews/:id/preview` | `revision`                                   |
| POST   | `/api/reviews/:id/apply`   | `revision`, exact `token`                    |
| POST   | `/api/reviews/:id/link`    | `revision`, `commit`                         |
| GET    | `/api/reviews/:id/audit`   | —                                            |

Malformed fields return 400; missing reviews 404; stale state 409; unsupported analysis/actions 422. No endpoint creates commits or silently upgrades local work to merged status.
