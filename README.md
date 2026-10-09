# Fuse

Fuse explains code changes with a visual designed for the decision in front of you: **original code and highlighted conflict → visual explanation → choose the behavior → create the change**.

The local MCP reads real Git changes, sends bounded source context to the OpenAI API, and asks **gpt-6-luna** to design an image and meaningful choices. Fuse renders that design as SVG and PNG. The deterministic TypeScript engine checks which resolutions are supported; the human chooses before any source is applied. No Codex CLI is needed.

## Show it working

Use **Node.js 24**, Git, and an OpenAI API key with access to `gpt-6-luna`.

```sh
git clone https://github.com/Will-Sanz/fuse.git
cd fuse
npm ci
npm run build
cp .env.example .env
```

Open `.env` in your editor and set `OPENAI_API_KEY`. `FUSE_AI_MODEL` defaults to `gpt-6-luna`; it can select another Responses API model supporting structured output and low reasoning effort. Keep the key local. It is ignored by Git and excluded from Vercel uploads.

```sh
npm run meeting
```

This creates a disposable repository with a **real Git merge conflict**, calls the actual `fuse_explain` tool over MCP, waits for a fresh OpenAI-generated image, and opens the review on **http://127.0.0.1:3002**. Show the conflict, explain the image, choose the desired behavior, then click **Create this change**. Fuse writes and stages the resolution and runs the configured checks. It leaves the merge uncommitted for inspection. Stop with Ctrl+C.

For a different decision and visual:

```sh
npm run meeting -- --scenario shipping
```

The validation example asks which error an empty order should see first. The shipping example asks whether a discount removes free shipping: a $120 basket with a $30 discount costs either $90 or $100. Each run creates a fresh repository, review, and AI request. See the [meeting walkthrough](docs/meeting.md) for the presentation script and troubleshooting.

## Browser examples and hosting

```sh
npm start                     # after npm run build; http://127.0.0.1:3001
npm run dev                   # development UI; http://127.0.0.1:5173
```

The local browser examples use prepared, distinct visuals and real disposable Git worktrees, analysis, application, and checks. No API key is needed for these examples. **Run live MCP** opens the live instructions and an image captured from an actual MCP run.

The Vercel build (`npm run build:showcase`, configured in `vercel.json`) is a static website. Its examples use the same analyzer and reconciler at build time. Choices produce the corresponding downloadable source file and persist within the browser tab. It does not access your repository, run checks, or call OpenAI. Use the local MCP for fresh AI explanations and real Git changes. The API key is never included in the hosted build.

## Use the MCP in your coding tool

Add a stdio MCP server using your client's configuration UI or file:

```json
{
  "mcpServers": {
    "fuse": {
      "command": "node",
      "args": [
        "/absolute/path/to/fuse/cli/run.mjs",
        "mcp",
        "--repo",
        "/absolute/path/to/your/project"
      ]
    }
  }
}
```

Replace both paths. The CLI reads `.env` from the Fuse installation, so your teammates only need their own key. Ask the client: **“Use fuse_explain to explain my current change or merge conflict. Show the image and ask which behavior I want.”** The tool returns the saved review and a PNG. Client configuration formats and image display vary; the meeting runner is the verified, client-independent route.

To open a returned review, use its ID and repository:

```sh
node /absolute/path/to/fuse/cli/run.mjs review REVIEW_ID --repo /path/to/project --serve --open
```

The MCP can inspect, generate images, record intent and choices, and preview outputs. Application and check execution remain explicit browser/CLI actions. See [tool contracts and integration details](docs/integration.md).

## Inspect actual work from the terminal

Use `npm run fuse --` instead of the optional global `fuse` command:

```sh
npm run fuse -- inspect --repo /path/to/project
npm run fuse -- inspect --repo /path/to/project --a feature/request --b feature/schema
npm run fuse -- visualize REVIEW_ID --repo /path/to/project
npm run fuse -- review REVIEW_ID --repo /path/to/project --serve --open
```

An active Git merge is detected automatically using HEAD, MERGE_HEAD, and the common base. Ordinary working changes are also explained without inventing a conflict. Working changes are unattributed unless you explicitly register sessions:

```sh
npm run fuse -- session add request --repo /path/to/project --name 'Request validation' --worktree /path/to/request-worktree
npm run fuse -- session add schema --repo /path/to/project --name 'Schema validation' --worktree /path/to/schema-worktree
npm run fuse -- inspect --repo /path/to/project --sessions
npm run fuse -- watch --repo /path/to/project
```

The first registration is A and the second B. Watch reports new overlap evidence without repeatedly alerting for unchanged work. Inspection and core CLI acceptance work without an API key; image generation requires one.

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

The last two commands use your API key and incur model usage. CI runs the other checks. Live verification has passed for both checkout and shipping; the captured checkout image is in `public/mcp/checkout.png`.

## Current scope

Named top-level TypeScript functions and direct local calls; bounded context; constrained one-file application. The compact UI focuses on one conflict. Multiple files/conflicts and unsupported language constructs remain visible in structured reviews but can require CLI or manual resolution. AI explanations are grounded in source, not proof of runtime behavior; configured checks provide the executed evidence. AI calls send the selected before/A/B source, observations, and up to ten bounded context files to OpenAI with `store: false`. No automatic fallback presents a prepared image as a live result.

See [architecture](docs/architecture.md), [release criteria](docs/MVP.md), and [Untitled UI provenance](src/untitledui/PROVENANCE.md).
