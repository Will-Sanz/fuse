# Fuse

Fuse explains code changes with a visual designed for the decision in front of you: **original code and highlighted conflict → visual explanation → choose the behavior → create the change**.

The local MCP reads real Git changes, sends bounded source context through the shared Fuse AI service to OpenAI, and asks **gpt-6-luna** to design an image and meaningful choices. Fuse renders that design as SVG and PNG. The deterministic TypeScript engine checks which resolutions are supported; the human chooses before any source is applied. No Codex CLI is needed.

## Connect once

Fuse is publicly installable from this GitHub repository. Teammates use a **private team MCP configuration** that already includes access to the shared AI service. They do not need an OpenAI account, API key, environment file, or local Fuse checkout. Node.js **24** and Git are prerequisites.

```json
{
  "mcpServers": {
    "fuse": {
      "command": "npx",
      "args": ["--yes", "--prefer-online", "github:Will-Sanz/fuse#main", "mcp"],
      "env": { "FUSE_SERVICE_TOKEN": "YOUR_TEAM_ACCESS_TOKEN" }
    }
  }
}
```

The project owner supplies the complete configuration privately, including the team access value. The public download never contains that value or the OpenAI API key. Different clients wrap this configuration differently; see [connection details](docs/integration.md), including Codex. Allow 180 seconds for startup and 300 seconds for tool calls. The first launch installs and builds Fuse automatically. Restarting the MCP checks the current GitHub `main` commit and updates the cached package when it changes. A running process stays on its current version until restarted.

## Try it on real code

Open a Git repository with a TypeScript edit or merge conflict and ask your coding assistant:

> Use Fuse to explain the change in this repository. Show the generated image, ask which behavior I want, and open the visual review.

The assistant calls `fuse_explain` with the project's absolute `repo` path. The MCP reads your local repository, sends bounded source context to the hosted Fuse AI service, and returns a fresh image with meaningful choices. `fuse_open_review` supplies a local browser link. Choose the behavior, inspect the proposed code, and explicitly click **Create this change**. No source is changed by the MCP tools themselves.

One connection works across repositories: pass `repo` on each tool call. An optional `--repo PATH` launch argument restricts a connection to one repository. Inspection without AI is available through `fuse_inspect`.

## Show it working in a meeting

For maintainers with the repository's ignored `.env` already configured:

```sh
npm run meeting
npm run meeting -- --scenario shipping
```

This creates a disposable repository with a real Git merge conflict, calls `fuse_explain` over MCP, generates an image, and opens the review on an available local port. Files and provider provenance are saved in the temporary directory printed by the runner. See the [meeting walkthrough](docs/meeting.md).

The packaged equivalent is `npx --yes --prefer-online github:Will-Sanz/fuse#main meeting`; it uses `FUSE_SERVICE_TOKEN` supplied by the environment. A configured MCP does not automatically export its environment into your shell.

## Terminal use

From a changed repository, with team access available in the process environment:

```sh
npx --yes --prefer-online github:Will-Sanz/fuse#main
```

This inspects the change, generates a visual, and opens the review. Use `--repo /path/to/project` to select another repository. Advanced commands remain available:

```sh
npm run fuse -- inspect --repo /path/to/project --json
npm run fuse -- inspect --repo /path/to/project --a feature/request --b feature/schema
npm run fuse -- session add request --repo /path/to/project --name 'Request validation' --worktree /path/to/request-worktree
npm run fuse -- session add schema --repo /path/to/project --name 'Schema validation' --worktree /path/to/schema-worktree
npm run fuse -- inspect --repo /path/to/project --sessions
```

## Development and hosting

```sh
npm ci
npm run dev
```

The local browser examples use prepared visuals and real disposable Git worktrees. The Vercel website uses prepared examples with downloadable resolved source. Live AI is accessed by the local MCP through `/api/visual`; Git operations and application stay on the developer's computer.

The Vercel project owner configures `OPENAI_API_KEY` and `FUSE_SERVICE_TOKEN` as production secrets and `FUSE_AI_MODEL=gpt-6-luna` as server configuration. The shared endpoint fails closed when access is unconfigured, requires the team token, bounds requests, fixes the model and output budget on the server, and never returns provider errors or credentials. It does not log source context. Teammates share the service access token; it is not an OpenAI key. Keep it private and rotate it on Vercel and in team connections if it leaks. Model usage is billed to the owner's API account; team authorization is not a spending cap.

For direct local development, an installation `.env` may contain `OPENAI_API_KEY`; the CLI never loads the target repository's environment file. `FUSE_AI_URL` optionally points to a self-hosted HTTPS service. Explicit service configuration takes precedence over a local OpenAI key. See `.env.example`.

## Application and checks

Decisions select A, B, supported additive composition in an explicit order, or acknowledgment of a possible dependency interaction. Preview uses deterministic reconciliation, not model-written code. Source freshness, review revision, preview token, output hashes, and configured check arguments are checked before application.

Automatic application supports one regular TypeScript file in either a clean checkout at the common base or an active Git merge containing only the reviewed conflict. In the latter case Fuse replaces the pinned conflict contents and stages the resolution. Newer edits, unrelated work, unsupported files, and unsupported compositions are blocked. A dirty ordinary working copy can be explained, but application requires an appropriate clean target.

Configure checks explicitly before previewing:

```sh
npm run fuse -- check add typecheck --repo /path/to/project --command /absolute/path/to/tsc --arg=--noEmit --timeout 30000
```

Commands run without a shell after the user clicks **Create this change**. Fuse does not discover and execute arbitrary repository scripts. Failed checks remain visible with actual output; no configured checks means behavior is unverified. Commit with your normal Git tools, then link the result:

```sh
npm run fuse -- link REVIEW_ID --repo /path/to/project --commit HEAD
npm run fuse -- history --repo /path/to/project --json
```

Local reviews preserve evidence, choices, rationale, preview hashes, actual check results, and verified Git references under the common Git directory's `fuse/` folder. Git identity is local attribution, not verified authentication. An exported or applied file is never labeled merged.

## Verification

```sh
npm run format:check
npm run check                 # typecheck, production build, engine/API/Git/CLI/MCP tests
npx playwright install chromium
npm run test:e2e              # browser → real files → checks, stale-input protection
npm run demo:verify           # full CLI acceptance including commit history, no paid key
npm run test:showcase         # hosted build → choices → downloaded source
npm run meeting:verify        # real MCP → OpenAI → image → real merge resolution and checks
npm run meeting:verify -- --scenario shipping
```

The last two commands incur model usage through the configured shared service or a direct local API key. CI runs the other checks. Live verification has passed for both checkout and shipping; the captured checkout image is in `public/mcp/checkout.png`.

## Current scope

Named top-level TypeScript functions and direct local calls; bounded context; constrained one-file application. The compact UI focuses on one conflict. Multiple files/conflicts and unsupported language constructs remain visible in structured reviews but can require CLI or manual resolution. AI explanations are grounded in source, not proof of runtime behavior; configured checks provide the executed evidence. AI calls send the selected before/A/B source, observations, and up to ten bounded context files to OpenAI with `store: false`. No automatic fallback presents a prepared image as a live result.

See [architecture](docs/architecture.md), [release criteria](docs/MVP.md), and [Untitled UI provenance](src/untitledui/PROVENANCE.md).
