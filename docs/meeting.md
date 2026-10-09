# Show Fuse in a meeting

The short story is: **“Two edits can both be reasonable. Fuse shows what each choice does, lets us choose the behavior, and creates the matching code.”**

## Before the meeting

In the Fuse checkout, use Node 24 and run `npm ci` and `npm run build`. Save your OpenAI key in Fuse's `.env` as `OPENAI_API_KEY`; use `FUSE_AI_MODEL=gpt-6-luna`. Do not screen-share the key. Your teammates can use their own keys; the runner does not need Codex CLI or a Codex subscription.

Run this once to confirm the entire live path:

```sh
npm run meeting:verify
```

A successful run ends with **PASS · real MCP → real AI image → chosen behavior → resolved file → checks passed.** This resolves only its disposable fixture. To present an undecided review, start a fresh run below.

## The two-minute live walkthrough

1. Share your terminal and run **`npm run meeting`**. Point to `UU checkout.ts`: Git has a real unresolved merge. The two edits are on committed branches in registered worktrees.
2. While it runs, explain: **“Fuse is calling its MCP tool, reading the code and nearby context, and asking Luna to design a visual for this particular conflict.”** The terminal prints the model and generation time. The first verified run took about 14 seconds; latency can vary.
3. The browser opens. Show **Original code** and the purple/blue **Conflicting changes**. Both edits add validation at the same place.
4. Scroll to the newly generated image. For an empty order, one ordering returns **“Your order is incomplete”**; the other returns **“email: enter a valid email address.”** Both validators stay in the combined result. The diagram's exact design can change on each run.
5. Ask the room which error should appear first. Click that behavior, show the proposed code, then click **Create this change**. The file is written, the Git conflict is staged as resolved, and the configured checkout checks run. The merge remains uncommitted.
6. For terminal proof, open another terminal and use the repository path printed in step 1:

```sh
git -C /printed/repository/path status --short
git -C /printed/repository/path diff --cached -- checkout.ts
```

`UU` is gone, and the staged diff contains the chosen order. The UI reports actual check results. The checks cover an empty order, valid checkout, and malformed email.

Stop the review server with Ctrl+C. Run `npm run meeting` again for a fresh conflict and new model request. Artifacts remain under ignored `data/meetings/<run-id>/`: `visual.png`, `visual.json`, and `session.json` plus the fixture repository. The image record includes the real model response ID and the source-context fingerprint.

## Show why visuals must vary

Stop the first run, then use:

```sh
npm run meeting -- --scenario shipping
```

This creates a conflict about the free-shipping threshold. A $120 basket receives a $30 discount. One policy tests $90 and adds $10 shipping; the other tests the original $120 and keeps shipping free. Ask: **“Should the customer pay $100 or $90?”** Choose, create, and show the resulting shipping check output.

The AI chooses the visual structure from the code; the behavior options must match the reconciler's supported actions. Luna designs a vector scene, which Fuse renders to SVG and a PNG returned through MCP. It is an actual generated image, not a separate raster-image-model call.

## Use your own coding client

The **Run live MCP** button contains a copyable stdio configuration and prompt. Configure your coding client to run `node /absolute/path/to/fuse/cli/run.mjs mcp --repo /your/project`, then ask it to call `fuse_explain` and show the image. For registered worktrees pass `sessions: true`; for an active merge or ordinary working change use `{}`.

The meeting command itself is an actual MCP client using the official SDK, so the live path is demonstrable without installing a particular coding assistant. Other clients may display image tool results differently. Open the saved review with the `review --serve --open` command in the README when needed.

## Share the website

Use the hosted page for an immediate explanation: original code → conflict → prepared visual → choice → downloadable resolved file. Switch between **Validation order** and **Shipping policy**. **Run live MCP** contains installation instructions and a captured real MCP image.

The public website uses prepared examples; it does not have your API key or access to a local Git repository. The terminal walkthrough is the fresh AI and real Git demonstration.

## If something fails

- **Missing key:** edit `.env` in the Fuse checkout and set `OPENAI_API_KEY`. Restart the runner.
- **401 / quota / unavailable model:** check your key's API project, billing, and access to the configured model. Provider errors are shown; Fuse does not silently substitute a prepared visual.
- **Port 3002 in use:** stop the earlier walkthrough, or run `npm run meeting -- --port 3003`.
- **No automatic browser opening:** follow the printed URL, or use `--no-open` and open it manually.
- **Stale review:** editing the conflict after inspection intentionally blocks application. Start a fresh walkthrough or inspect the changed repository again.
- **Offline presentation:** the hosted examples and the captured image explain the product; fresh AI generation needs internet access and a valid key.
